/**
 * Generation Manager - owns the lifecycle of every reply.
 *
 * Admits one generation at a time. The manager itself runs the Ollama loop for
 * a generation, appends each event to a seq-numbered log, and notifies any
 * subscribers. HTTP responses (/v1/chat, /v1/generations/{id}/events) are only
 * subscribers: a subscriber going away never stops or wedges the generation.
 * A generation ends by completing, failing, or being cancelled; in every case
 * the active slot is released.
 */

import type { OllamaChatRequest, OllamaChatResponse } from "../ollama/client";
import type { ChatRequest, ContentEvent, DoneEvent, ErrorEvent, ThinkingEvent } from "@shared/api";

export interface GenerationEvent {
  seq: number;
  timestamp: number;
  type: "thinking" | "content" | "done" | "error";
  data: string;
}

/**
 * The subset of OllamaClient that GenerationManager depends on. Declared as
 * an interface (rather than importing the concrete class) so tests can inject
 * a fake without satisfying OllamaClient's private fields.
 */
export interface OllamaChatClient {
  chat(
    request: OllamaChatRequest,
    signal?: AbortSignal
  ): AsyncGenerator<OllamaChatResponse, void, unknown>;
}

/** How long a finished generation's log is kept for resume. */
const LOG_RETENTION_MS = 10 * 60 * 1000;

interface GenerationRecord {
  model: string;
  abortController: AbortController;
  log: GenerationEvent[];
  running: boolean;
  /** Resolvers for subscribers waiting for the next event. */
  waiters: Array<() => void>;
  expiry?: ReturnType<typeof setTimeout>;
}

function isTerminal(type: GenerationEvent["type"]): boolean {
  return type === "done" || type === "error";
}

export class GenerationManager {
  private activeGenId: string | null = null;
  private generations: Map<string, GenerationRecord> = new Map();
  private ollamaClient: OllamaChatClient;

  constructor(ollamaClient: OllamaChatClient) {
    this.ollamaClient = ollamaClient;
  }

  /**
   * Admit and start a new generation. The manager runs it to its end in the
   * background; read its events with `subscribe`. Throws if another
   * generation is already active.
   */
  startGeneration(genId: string, request: ChatRequest): void {
    if (this.activeGenId !== null) {
      throw new Error(`Generation already in progress: ${this.activeGenId}`);
    }

    const record: GenerationRecord = {
      model: request.model,
      abortController: new AbortController(),
      log: [],
      running: true,
      waiters: [],
    };
    this.activeGenId = genId;
    this.generations.set(genId, record);

    // Explicit copy: only model and {role, content} reach Ollama.
    const chatRequest: OllamaChatRequest = {
      model: request.model,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    };

    void this.run(genId, record, chatRequest);
  }

  /**
   * Run the Ollama loop for one generation. Never rejects.
   */
  private async run(
    genId: string,
    record: GenerationRecord,
    request: OllamaChatRequest
  ): Promise<void> {
    const signal = record.abortController.signal;
    const startTime = Date.now();
    let contentChunks = 0;
    let terminal: { type: "done" | "error"; data: string };

    // Resolves when cancelled, so a chat stream that ignores the signal
    // cannot keep the generation alive after a cancel.
    const aborted = new Promise<"aborted">((resolve) => {
      if (signal.aborted) resolve("aborted");
      else signal.addEventListener("abort", () => resolve("aborted"), { once: true });
    });

    let iterator: AsyncGenerator<OllamaChatResponse, void, unknown> | undefined;
    try {
      iterator = this.ollamaClient.chat(request, signal);
      let finalChunk: OllamaChatResponse | undefined;

      for (;;) {
        const next = await Promise.race([iterator.next(), aborted]);
        if (next === "aborted") {
          throw new DOMException("Generation cancelled", "AbortError");
        }
        if (next.done) break;

        const chunk = next.value;
        if (chunk.message?.thinking) {
          const thinking: ThinkingEvent = { text: chunk.message.thinking };
          this.append(record, "thinking", JSON.stringify(thinking));
        }
        if (chunk.message?.content) {
          contentChunks++;
          const content: ContentEvent = { text: chunk.message.content };
          this.append(record, "content", JSON.stringify(content));
        }
        if (chunk.done) {
          finalChunk = chunk;
          break;
        }
      }

      if (signal.aborted) {
        throw new DOMException("Generation cancelled", "AbortError");
      }

      terminal = {
        type: "done",
        data: JSON.stringify(this.completeStats(request.model, finalChunk, contentChunks, startTime)),
      };
    } catch (error) {
      if (signal.aborted) {
        const cancelled: DoneEvent = {
          status: "cancelled",
          model: request.model,
          eval_count: contentChunks,
          tokens_per_second: 0,
        };
        terminal = { type: "done", data: JSON.stringify(cancelled) };
      } else {
        const failure: ErrorEvent = {
          code: "generation_error",
          message: error instanceof Error ? error.message : String(error),
        };
        terminal = { type: "error", data: JSON.stringify(failure) };
      }
    }

    // Stop the upstream stream if it is still open (cancel, or an early
    // final chunk). Not awaited: a generator suspended mid-await would block.
    if (iterator) {
      iterator.return(undefined).catch(() => {});
    }

    // Release the slot before publishing the terminal event, so a client that
    // sees `done` can start its next chat immediately.
    record.running = false;
    if (this.activeGenId === genId) {
      this.activeGenId = null;
    }
    this.append(record, terminal.type, terminal.data);

    record.expiry = setTimeout(() => {
      this.generations.delete(genId);
    }, LOG_RETENTION_MS);
    record.expiry.unref?.();
  }

  /**
   * Stats for a completed reply: Ollama's final-chunk eval_count and
   * eval_duration (ns) when present, otherwise a wall-clock estimate.
   */
  private completeStats(
    model: string,
    finalChunk: OllamaChatResponse | undefined,
    contentChunks: number,
    startTime: number
  ): DoneEvent {
    const evalCount =
      typeof finalChunk?.eval_count === "number" ? finalChunk.eval_count : contentChunks;
    const evalDuration = finalChunk?.eval_duration;
    let tokensPerSecond: number;
    if (typeof evalDuration === "number" && evalDuration > 0) {
      tokensPerSecond = evalCount / (evalDuration / 1e9);
    } else {
      const seconds = (Date.now() - startTime) / 1000;
      tokensPerSecond = seconds > 0 ? evalCount / seconds : 0;
    }
    return { status: "complete", model, eval_count: evalCount, tokens_per_second: tokensPerSecond };
  }

  private append(record: GenerationRecord, type: GenerationEvent["type"], data: string): void {
    record.log.push({ seq: record.log.length, timestamp: Date.now(), type, data });
    const waiters = record.waiters;
    record.waiters = [];
    for (const wake of waiters) wake();
  }

  /**
   * Events of a generation with seq >= fromSeq: first the logged ones, then
   * live ones as they are appended, ending after the terminal event. Ends
   * immediately for an unknown generation. Abandoning the iterator does not
   * affect the generation.
   */
  async *subscribe(genId: string, fromSeq: number = 0): AsyncGenerator<GenerationEvent, void, unknown> {
    let next = Math.max(0, fromSeq);
    for (;;) {
      const record = this.generations.get(genId);
      if (!record) return;

      while (next < record.log.length) {
        const event = record.log[next++];
        yield event;
        if (isTerminal(event.type)) return;
      }
      if (!record.running) return;

      await new Promise<void>((resolve) => record.waiters.push(resolve));
    }
  }

  /**
   * Get historical events from the log (for resume after connection drop)
   */
  getEventLog(genId: string, fromSeq: number = 0): GenerationEvent[] {
    const log = this.generations.get(genId)?.log ?? [];
    return log.filter((e) => e.seq >= fromSeq);
  }

  /**
   * Cancel a running generation: aborts its Ollama request. Returns false if
   * the generation is unknown or has already ended.
   */
  cancelGeneration(genId: string): boolean {
    const record = this.generations.get(genId);
    if (!record || !record.running) {
      return false;
    }
    record.abortController.abort();
    return true;
  }

  /**
   * Cancel whichever generation is active (I8, used by a confirmed model
   * load/unload). Returns false when none is. The slot is released once the
   * generation's loop notices the abort; poll `getActiveGeneration()` for it.
   */
  cancelActive(): boolean {
    return this.activeGenId !== null && this.cancelGeneration(this.activeGenId);
  }

  /**
   * Get the currently active generation ID
   */
  getActiveGenId(): string | null {
    return this.activeGenId;
  }

  /**
   * Get the currently active generation's id and model, for /v1/state.
   */
  getActiveGeneration(): { id: string; model: string } | null {
    if (this.activeGenId === null) {
      return null;
    }
    const record = this.generations.get(this.activeGenId);
    if (!record) {
      return null;
    }
    return { id: this.activeGenId, model: record.model };
  }

  /**
   * Check if a generation is active
   */
  isGenerationActive(genId: string): boolean {
    return this.activeGenId === genId && this.generations.get(genId)?.running === true;
  }

  /**
   * Check if log exists (generation running, or ended but not expired)
   */
  hasEventLog(genId: string): boolean {
    return this.generations.has(genId);
  }
}
