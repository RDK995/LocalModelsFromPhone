/**
 * API client for communicating with the Phone Models server.
 * Streaming fetch support (via `expo/fetch`, which supports reading a
 * streaming response body in the Expo Go runtime) and typed error mapping.
 *
 * This module deliberately does not import "expo/fetch" itself: that import
 * pulls in react-native's Flow-typed sources, which bun's test runner cannot
 * parse. The default fetch implementation is wired in from
 * `./expoFetchClient`, which the app uses; tests inject a fake `FetchImpl`
 * directly via the constructor.
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
  /**
   * Called with the `x-generation-id` response header as soon as it
   * arrives, before the body is read. This lets a caller record the
   * generation id (so Stop can cancel it) without waiting for the stream to
   * finish.
   */
  onStart?: (generationId: string) => void;
  onEvent: (event: StreamEvent) => void;
  onError: (error: Error) => void;
  onComplete: () => void;
  signal?: AbortSignal;
}

/**
 * Minimal fetch shape the client depends on, so a fake implementation can be
 * injected in tests without a real network stack. `expo/fetch`'s `fetch`
 * satisfies this (its `FetchResponse` implements the standard `Response`
 * interface), as does the global `fetch`.
 */
export type FetchImpl = (
  url: string,
  init?: RequestInit
) => Promise<Response>;

/**
 * Thrown when the server rejects a request with 401 Unauthorized (missing or
 * invalid bearer token).
 */
export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized: invalid or missing bearer token") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Thrown when the server rejects `POST /v1/chat` with 409
 * `{error:"model_not_resident"}` -- the model that was resident when we
 * checked `GET /v1/state` was unloaded before the chat request landed.
 * Callers should treat this the same as no resident model at all (F2).
 */
export class ModelNotResidentError extends Error {
  constructor(message = "No model loaded") {
    super(message);
    this.name = "ModelNotResidentError";
  }
}

export class APIClient {
  private baseUrl: string;
  private token: string = "";
  private fetchImpl: FetchImpl;

  constructor(baseUrl: string, fetchImpl: FetchImpl) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
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

  /**
   * Throw a typed error for a non-OK response: `UnauthorizedError` for 401,
   * a generic `Error` otherwise.
   */
  private assertOk(response: Response, action: string): void {
    if (response.status === 401) {
      throw new UnauthorizedError();
    }
    if (!response.ok) {
      throw new Error(`Failed to ${action}: ${response.statusText}`);
    }
  }

  async getState(): Promise<StateResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/state`, {
      method: "GET",
      headers: this.getHeaders(),
    });

    this.assertOk(response, "get state");

    return response.json();
  }

  async loadModel(request: LoadRequest): Promise<OperationResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/models/load`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(request),
    });

    this.assertOk(response, "load model");

    return response.json();
  }

  async unloadModel(request: UnloadRequest): Promise<OperationResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/models/unload`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(request),
    });

    this.assertOk(response, "unload model");

    return response.json();
  }

  async chat(request: ChatRequest, options: StreamOptions): Promise<string> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/chat`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(request),
      signal: options.signal,
    });

    if (response.status === 409) {
      // The model resident when we checked GET /v1/state may have been
      // unloaded before this request landed; distinguish that from other
      // 409s (e.g. a generation already in flight) by the error code.
      let body: { error?: string; message?: string } = {};
      try {
        body = await response.json();
      } catch {
        // Not JSON (or empty body); fall through to the generic 409 error.
      }
      if (body.error === "model_not_resident") {
        throw new ModelNotResidentError(body.message);
      }
    }

    this.assertOk(response, "start chat");

    const generationId = response.headers.get("x-generation-id");
    if (!generationId) {
      throw new Error("No generation ID returned from server");
    }

    options.onStart?.(generationId);

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
    const response = await this.fetchImpl(
      `${this.baseUrl}/v1/generations/${generationId}/cancel`,
      {
        method: "POST",
        headers: this.getHeaders(),
      }
    );

    this.assertOk(response, "cancel generation");
  }
}

export function createAPIClient(
  baseUrl: string,
  fetchImpl: FetchImpl
): APIClient {
  return new APIClient(baseUrl, fetchImpl);
}
