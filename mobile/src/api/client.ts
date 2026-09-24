/**
 * API client for communicating with the Phone Models server
 * Includes streaming fetch support and typed error mapping
 */

import type {
  StateResponse,
  LoadRequest,
  UnloadRequest,
  ChatRequest,
  OperationResponse,
  ThinkingEvent,
  ContentEvent,
  DoneEvent,
  ErrorEvent,
} from "@shared/api";

export type StreamEvent =
  | { type: "thinking"; data: ThinkingEvent }
  | { type: "content"; data: ContentEvent }
  | { type: "done"; data: DoneEvent }
  | { type: "error"; data: ErrorEvent };

interface StreamOptions {
  onEvent: (event: StreamEvent) => void;
  onError: (error: Error) => void;
  onComplete: () => void;
  signal?: AbortSignal;
}

export class APIClient {
  private baseUrl: string;
  private token: string = "";

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  setToken(token: string): void {
    this.token = token;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    return headers;
  }

  async getState(): Promise<StateResponse> {
    const response = await fetch(`${this.baseUrl}/v1/state`, {
      method: "GET",
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to get state: ${response.statusText}`);
    }

    return response.json();
  }

  async loadModel(request: LoadRequest): Promise<OperationResponse> {
    const response = await fetch(`${this.baseUrl}/v1/models/load`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`Failed to load model: ${response.statusText}`);
    }

    return response.json();
  }

  async unloadModel(request: UnloadRequest): Promise<OperationResponse> {
    const response = await fetch(`${this.baseUrl}/v1/models/unload`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`Failed to unload model: ${response.statusText}`);
    }

    return response.json();
  }

  async chat(request: ChatRequest, options: StreamOptions): Promise<string> {
    const response = await fetch(`${this.baseUrl}/v1/chat`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(request),
      signal: options.signal,
    });

    if (!response.ok) {
      throw new Error(`Failed to start chat: ${response.statusText}`);
    }

    const generationId = response.headers.get("x-generation-id");
    if (!generationId) {
      throw new Error("No generation ID returned from server");
    }

    // Stream events from server
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Response body is not readable");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      for (;;) {
        const { done, value } = await reader.read();

        if (done) {
          options.onComplete();
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // SSE events are separated by a blank line; keep the trailing
        // incomplete event in the buffer
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || "";

        for (const block of blocks) {
          let eventType = "";
          const dataLines: string[] = [];
          for (const line of block.split(/\r?\n/)) {
            if (line.startsWith("event:")) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              dataLines.push(line.slice(5).replace(/^ /, ""));
            }
          }
          if (!eventType || dataLines.length === 0) {
            continue;
          }
          const event = this.parseSSEEvent(
            eventType as "thinking" | "content" | "done" | "error",
            dataLines.join("\n")
          );
          if (event) {
            options.onEvent(event);
          }
        }
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "AbortError"
      ) {
        // Normal cancellation
        options.onComplete();
      } else {
        options.onError(
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }

    return generationId;
  }

  private parseSSEEvent(
    type: "thinking" | "content" | "done" | "error",
    data: string
  ): StreamEvent | null {
    try {
      const parsed = JSON.parse(data);

      switch (type) {
        case "thinking":
          return {
            type: "thinking",
            data: { text: parsed.text || "" } as ThinkingEvent,
          };
        case "content":
          return {
            type: "content",
            data: { text: parsed.text || "" } as ContentEvent,
          };
        case "done":
          return {
            type: "done",
            data: {
              status: parsed.status || "complete",
              model: parsed.model || "",
              eval_count: parsed.eval_count || 0,
              tokens_per_second: parsed.tokens_per_second || 0,
            } as DoneEvent,
          };
        case "error":
          return {
            type: "error",
            data: {
              code: parsed.code || "unknown",
              message: parsed.message || "",
            } as ErrorEvent,
          };
        default:
          return null;
      }
    } catch (error) {
      console.error("Failed to parse SSE event:", error);
      return null;
    }
  }

  async cancelGeneration(generationId: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/v1/generations/${generationId}/cancel`,
      {
        method: "POST",
        headers: this.getHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to cancel generation: ${response.statusText}`);
    }
  }
}

export function createAPIClient(baseUrl: string): APIClient {
  return new APIClient(baseUrl);
}
