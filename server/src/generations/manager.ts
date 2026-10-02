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

import type {
  OllamaChatRequest,
  OllamaChatResponse,
  OllamaTool,
  OllamaToolCall,
} from "../ollama/client";
import { createWebTools, type WebEvent, type WebToolCall } from "../web/tools";
import { createPageNumberer } from "../web/pageNumbers";
import { DEFAULT_RESEARCH_SETTINGS, logModelCall, runResearch, type ModelCallLog, type ResearchSettings, type ResearchWebTools } from "./research";
import type {
  ChatRequest,
  ContentEvent,
  DoneEvent,
  ErrorEvent,
  SourcesEvent,
  ThinkingEvent,
} from "@shared/api";

export interface GenerationEvent {
  seq: number;
  timestamp: number;
  type: "thinking" | "content" | "done" | "error" | "step" | "sources";
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
    signal?: AbortSignal,
    tools?: OllamaTool[]
  ): AsyncGenerator<OllamaChatResponse & { toolCalls?: OllamaToolCall[] }, void, unknown>;
}

/** The web tools (C12) the generation loop depends on; satisfied by createWebTools(). */
export interface GenerationWebTools {
  tools(): OllamaTool[];
  systemNote(now: Date): string;
  execute(
    call: WebToolCall,
    signal: AbortSignal,
    numberPage?: (finalUrl: string) => number
  ): Promise<{ toolResult: string; events: WebEvent[] }>;
}

/** At most this many tool calls per reply (FR19). */
const MAX_TOOL_CALLS = 10;

/** At most this many prods per reply when a web round goes quiet (FR33). */
const MAX_PRODS = 2;

const PROD_MESSAGE =
  "No answer has been given yet. If you need more information, call a tool; otherwise write your final answer now.";
const ANSWER_NOW_MESSAGE =
  "Answer now from the information you already have. Do not call any tools; write your final answer.";
export const NO_ANSWER_NOTE =
  "No answer was produced \u2014 the model stopped without answering. Try asking again.";

/** How long a finished generation's log is kept for resume. */
const LOG_RETENTION_MS = 10 * 60 * 1000;

interface GenerationRecord {
  model: string;
  abortController: AbortController;
  /** Deep research only (FR38): the first Stop aborts this ("wrap up"); a later Stop aborts the hard controller. */
  stopController?: AbortController;
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

  private webTools: GenerationWebTools & Partial<ResearchWebTools>;

  private researchSettings: Partial<ResearchSettings>;

  private log: (line: ModelCallLog) => void;

  constructor(
    ollamaClient: OllamaChatClient,
    webTools: GenerationWebTools & Partial<ResearchWebTools> = createWebTools(),
    researchSettings: Partial<ResearchSettings> = {},
    logModelCallLine: (line: ModelCallLog) => void = logModelCall
  ) {
    this.log = logModelCallLine;
    this.ollamaClient = ollamaClient;
    this.webTools = webTools;
    this.researchSettings = researchSettings;
  }

  /** The num_ctx every deep research request uses (FR41); also sent when its model is loaded. */
  researchNumCtx(): number {
    return { ...DEFAULT_RESEARCH_SETTINGS, ...this.researchSettings }.numCtx;
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

    const web = request.web === true;
    if (web && request.deep_research === true) {
      record.stopController = new AbortController();
      void this.runDeepResearch(genId, record, request);
      return;
    }
    if (web) {
      chatRequest.messages.unshift({ role: "system", content: this.webTools.systemNote(new Date()) });
    }

    void this.run(genId, record, chatRequest, web);
  }

  /**
   * Run one deep research reply (FR35): the server-driven research module
   * produces the events, which go to the log unchanged. Never rejects.
   */
  private async runDeepResearch(genId: string, record: GenerationRecord, request: ChatRequest): Promise<void> {
    const signal = record.abortController.signal;
    const question = [...request.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const startTime = Date.now();
    let terminal: { type: "done" | "error"; data: string } | undefined;
    try {
      const { search, read } = this.webTools;
      if (!search || !read) throw new Error("Deep research is unavailable: web tools lack search/read");
      const events = runResearch({
        model: request.model,
        question,
        client: this.ollamaClient,
        webTools: { search: search.bind(this.webTools), read: read.bind(this.webTools) },
        signal,
        stopSignal: record.stopController?.signal,
        settings: this.researchSettings,
        log: this.log,
      });
      for await (const event of events) {
        if (event.type === "done" || event.type === "error") {
          terminal = { type: event.type, data: event.data };
          break;
        }
        this.append(record, event.type, event.data);
      }
      if (!terminal) throw new Error("Research ended without a result");
    } catch (error) {
      if (signal.aborted) {
        const cancelled: DoneEvent = { status: "cancelled", model: request.model, eval_count: 0, tokens_per_second: 0 };
        terminal = { type: "done", data: JSON.stringify(cancelled) };
      } else {
        // FR36: a deep research reply never ends in an error with no reply.
        const text: ContentEvent = { text: "The research failed before it could produce a report. Try asking again." };
        this.append(record, "content", JSON.stringify(text));
        const failed: DoneEvent = {
          status: "complete",
          model: request.model,
          eval_count: 0,
          tokens_per_second: 0,
          research: {
            status: "failed",
            elapsed_ms: Date.now() - startTime,
            budget_ms: this.researchSettings.budgetMs ?? DEFAULT_RESEARCH_SETTINGS.budgetMs,
          },
        };
        terminal = { type: "done", data: JSON.stringify(failed) };
      }
    }

    record.running = false;
    if (this.activeGenId === genId) this.activeGenId = null;
    this.append(record, terminal!.type, terminal!.data);
    record.expiry = setTimeout(() => {
      this.generations.delete(genId);
    }, LOG_RETENTION_MS);
    record.expiry.unref?.();
  }

  /**
   * Run the Ollama loop for one generation. Never rejects.
   */
  private async run(
    genId: string,
    record: GenerationRecord,
    request: OllamaChatRequest,
    web: boolean
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

    let iterator: AsyncGenerator<OllamaChatResponse & { toolCalls?: OllamaToolCall[] }, void, unknown> | undefined;
    let toolCallCount = 0;
    const sources: SourcesEvent["items"] = [];
    const numberPage = createPageNumberer();
    let prodsUsed = 0;
    let answerNow = false;
    const appendStep = (step_id: string, kind: "continue" | "answer_now") => {
      for (const status of ["started", "done"] as const) {
        this.append(record, "step", JSON.stringify({ step_id, kind, status }));
      }
    };
    try {
      let finalChunk: OllamaChatResponse | undefined;

      for (;;) {
        const offered = web && !answerNow && toolCallCount < MAX_TOOL_CALLS;
        iterator = offered
          ? this.ollamaClient.chat(request, signal, this.webTools.tools())
          : this.ollamaClient.chat(request, signal);
        finalChunk = undefined;
        const roundCalls: OllamaToolCall[] = [];
        let roundContent = "";

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
            roundContent += chunk.message.content;
            const content: ContentEvent = { text: chunk.message.content };
            this.append(record, "content", JSON.stringify(content));
          }
          if (chunk.toolCalls) roundCalls.push(...chunk.toolCalls);
          if (chunk.done) {
            finalChunk = chunk;
            break;
          }
        }

        const quiet = roundCalls.length === 0 && roundContent.trim() === "";
        if (web && quiet && !signal.aborted) {
          // FR33: a quiet web round is never the end of the reply.
          if (!offered) {
            const note: ContentEvent = { text: NO_ANSWER_NOTE };
            this.append(record, "content", JSON.stringify(note));
            break;
          }
          iterator.return(undefined).catch(() => {});
          iterator = undefined;
          request.messages.push({ role: "assistant", content: roundContent });
          if (prodsUsed < MAX_PRODS) {
            prodsUsed++;
            appendStep(`prod-${prodsUsed}`, "continue");
            request.messages.push({ role: "user", content: PROD_MESSAGE });
          } else {
            answerNow = true;
            appendStep("answer-now", "answer_now");
            request.messages.push({ role: "user", content: ANSWER_NOW_MESSAGE });
          }
          continue;
        }

        if (!offered || roundCalls.length === 0) break;

        // Stop this round's stream before running tools.
        iterator.return(undefined).catch(() => {});
        iterator = undefined;

        request.messages.push({ role: "assistant", content: roundContent, tool_calls: roundCalls });
        for (const toolCall of roundCalls) {
          if (toolCallCount >= MAX_TOOL_CALLS) {
            request.messages.push({
              role: "tool",
              tool_name: toolCall.function.name,
              content:
                "Tool-call limit reached: this call was not run. Answer from the information you already have.",
            });
            continue;
          }
          const outcome = await Promise.race([this.webTools.execute(toolCall, signal, numberPage), aborted]);
          if (outcome === "aborted") {
            throw new DOMException("Generation cancelled", "AbortError");
          }
          toolCallCount++;
          for (const event of outcome.events) {
            if (event.type === "step") {
              this.append(record, "step", JSON.stringify(event.data));
            } else {
              const existing = sources.find((s) => s.url === event.data.url);
              if (!existing) {
                sources.push(
                  event.data.n === undefined
                    ? { title: event.data.title, url: event.data.url }
                    : { title: event.data.title, url: event.data.url, n: event.data.n }
                );
              } else if (event.data.n !== undefined) {
                existing.n = event.data.n;
              }
            }
          }
          request.messages.push({
            role: "tool",
            tool_name: toolCall.function.name,
            content: outcome.toolResult,
          });
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
    if (toolCallCount > 0 && terminal.type === "done") {
      const event: SourcesEvent = { items: sources };
      this.append(record, "sources", JSON.stringify(event));
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
    if (record.stopController && !record.stopController.signal.aborted) {
      record.stopController.abort(); // FR38: first Stop wraps up with a short report
      return true;
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
    if (this.activeGenId === null) return false;
    // A confirmed load/unload aborts a deep research run hard, never waiting for a write-up.
    this.generations.get(this.activeGenId)?.stopController?.abort();
    return this.cancelGeneration(this.activeGenId);
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
