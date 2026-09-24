/**
 * Generation Manager - handles concurrent generation requests with SSE streaming
 * Maintains one active generation at a time, stores seq-numbered event log for resume
 */

import { OllamaClient, OllamaChatResponse } from "../ollama/client";
import type { ChatRequest, SSEEvent, ContentEvent, DoneEvent } from "@shared/api";

export interface GenerationEvent {
  seq: number;
  timestamp: number;
  type: "content" | "done" | "error";
  data: string;
}

export class GenerationManager {
  private activeGenId: string | null = null;
  private eventLog: Map<string, GenerationEvent[]> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();
  private ollamaClient: OllamaClient;
  private logExpiry: Map<string, NodeJS.Timeout> = new Map();

  constructor(ollamaClient: OllamaClient) {
    this.ollamaClient = ollamaClient;
  }

  /**
   * Start a new generation (chat completion)
   * Only allows one active generation at a time
   */
  startGeneration(
    genId: string,
    request: ChatRequest
  ): AsyncGenerator<SSEEvent, void, unknown> {
    if (this.activeGenId !== null && this.activeGenId !== genId) {
      throw new Error(`Generation already in progress: ${this.activeGenId}`);
    }

    this.activeGenId = genId;
    const abortController = new AbortController();
    this.abortControllers.set(genId, abortController);
    this.eventLog.set(genId, []);

    // Clear any existing expiry timer
    if (this.logExpiry.has(genId)) {
      clearTimeout(this.logExpiry.get(genId));
      this.logExpiry.delete(genId);
    }

    return this._generateEvents(genId, request, abortController);
  }

  /**
   * Internal async generator for streaming events
   */
  private async *_generateEvents(
    genId: string,
    request: ChatRequest,
    abortController: AbortController
  ): AsyncGenerator<SSEEvent, void, unknown> {
    let tokenCount = 0;
    const startTime = Date.now();
    const eventLog = this.eventLog.get(genId) || [];
    let seq = eventLog.length;

    try {
      // Stream from Ollama
      for await (const chunk of this.ollamaClient.chat(request, abortController.signal)) {
        const chatResponse = chunk as OllamaChatResponse;

        if (chatResponse.message?.content) {
          tokenCount++;
          const contentEvent: ContentEvent = {
            text: chatResponse.message.content,
          };

          const sseEvent: SSEEvent = {
            id: `${genId}-${seq}`,
            event: "content",
            data: JSON.stringify(contentEvent),
          };

          const logEntry: GenerationEvent = {
            seq,
            timestamp: Date.now(),
            type: "content",
            data: JSON.stringify(contentEvent),
          };

          eventLog.push(logEntry);
          seq++;
          yield sseEvent;
        }

        // Check if this is the final chunk
        if (chatResponse.done) {
          const duration = Date.now() - startTime;
          const tokensPerSecond = tokenCount / (duration / 1000);

          const doneEvent: DoneEvent = {
            status: "complete",
            model: request.model,
            eval_count: tokenCount,
            tokens_per_second: tokensPerSecond,
          };

          const sseEvent: SSEEvent = {
            id: `${genId}-${seq}`,
            event: "done",
            data: JSON.stringify(doneEvent),
          };

          const logEntry: GenerationEvent = {
            seq,
            timestamp: Date.now(),
            type: "done",
            data: JSON.stringify(doneEvent),
          };

          eventLog.push(logEntry);
          seq++;
          yield sseEvent;
          break;
        }
      }
    } catch (error) {
      // Check if it was cancelled
      if (abortController.signal.aborted) {
        const doneEvent: DoneEvent = {
          status: "cancelled",
          model: request.model,
          eval_count: tokenCount,
          tokens_per_second: 0,
        };

        const sseEvent: SSEEvent = {
          id: `${genId}-${seq}`,
          event: "done",
          data: JSON.stringify(doneEvent),
        };

        const logEntry: GenerationEvent = {
          seq,
          timestamp: Date.now(),
          type: "done",
          data: JSON.stringify(doneEvent),
        };

        eventLog.push(logEntry);
        seq++;
        yield sseEvent;
      } else {
        // Real error
        const errorEvent = {
          code: "generation_error",
          message: error instanceof Error ? error.message : String(error),
        };

        const sseEvent: SSEEvent = {
          id: `${genId}-${seq}`,
          event: "error",
          data: JSON.stringify(errorEvent),
        };

        const logEntry: GenerationEvent = {
          seq,
          timestamp: Date.now(),
          type: "error",
          data: JSON.stringify(errorEvent),
        };

        eventLog.push(logEntry);
        seq++;
        yield sseEvent;
      }
    } finally {
      // Mark generation as complete and schedule log cleanup
      this.activeGenId = null;
      this.abortControllers.delete(genId);

      // Keep log for 10 minutes after terminal event, then discard
      const timer = setTimeout(() => {
        this.eventLog.delete(genId);
        this.logExpiry.delete(genId);
      }, 10 * 60 * 1000);
      this.logExpiry.set(genId, timer);
    }
  }

  /**
   * Get historical events from the log (for resume after connection drop)
   */
  getEventLog(genId: string, fromSeq: number = 0): GenerationEvent[] {
    const log = this.eventLog.get(genId) || [];
    return log.filter((e) => e.seq >= fromSeq);
  }

  /**
   * Cancel an active generation
   */
  cancelGeneration(genId: string): boolean {
    const controller = this.abortControllers.get(genId);
    if (!controller) {
      return false;
    }
    controller.abort();
    return true;
  }

  /**
   * Get the currently active generation ID
   */
  getActiveGenId(): string | null {
    return this.activeGenId;
  }

  /**
   * Check if a generation is active
   */
  isGenerationActive(genId: string): boolean {
    return this.activeGenId === genId && this.abortControllers.has(genId);
  }

  /**
   * Check if log exists (generation completed but not expired)
   */
  hasEventLog(genId: string): boolean {
    return this.eventLog.has(genId);
  }
}
