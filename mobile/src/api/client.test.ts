/**
 * Behavioural tests for the API client: SSE parsing, bearer-token
 * authorization, unauthorized mapping, and cancellation. No network is used;
 * a fake `FetchImpl` is injected per the client's constructor option so the
 * client's real request/parsing logic runs against a controlled fake server.
 */

import { describe, it, expect, mock } from "bun:test";
import { APIClient, UnauthorizedError } from "./client";
import type { StreamEvent } from "./client";

const BASE_URL = "http://localhost:7789";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Build a streaming SSE response whose body is delivered as the given raw
 * text chunks (each chunk is one `reader.read()` result), and which errors
 * with an AbortError if the passed signal is aborted before the stream ends.
 */
function sseResponse(
  chunks: string[],
  options: { generationId?: string; signal?: AbortSignal | null } = {}
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const onAbort = () => {
        const abortError = new Error("Aborted");
        abortError.name = "AbortError";
        controller.error(abortError);
      };
      if (options.signal) {
        if (options.signal.aborted) {
          onAbort();
          return;
        }
        options.signal.addEventListener("abort", onAbort);
      }
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "x-generation-id": options.generationId ?? "gen-1",
    },
  });
}

/**
 * Like `sseResponse`, but the caller controls exactly when bytes arrive via
 * the returned `push` function, so a test can assert on state in between
 * chunks (e.g. abort after some tokens have already streamed in).
 */
function controlledSseResponse(options: {
  generationId?: string;
  signal?: AbortSignal | null;
}): { response: Response; push: (chunk: string) => void } {
  const encoder = new TextEncoder();
  let controllerRef!: ReadableStreamDefaultController<Uint8Array>;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      const onAbort = () => {
        const abortError = new Error("Aborted");
        abortError.name = "AbortError";
        controller.error(abortError);
      };
      if (options.signal) {
        if (options.signal.aborted) {
          onAbort();
        } else {
          options.signal.addEventListener("abort", onAbort);
        }
      }
    },
  });

  const response = new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "x-generation-id": options.generationId ?? "gen-1",
    },
  });

  return {
    response,
    push: (chunk: string) => controllerRef.enqueue(encoder.encode(chunk)),
  };
}

describe("APIClient authorization", () => {
  it("sends every request with the current bearer token", async () => {
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer first-token");
      return jsonResponse({
        models: [],
        resident: null,
        operation: { kind: "idle" },
        generation: null,
      });
    });

    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("first-token");
    await client.getState();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the new token on the next request after setToken", async () => {
    const seenTokens: Array<string | undefined> = [];
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      seenTokens.push(headers.Authorization);
      return jsonResponse({
        models: [],
        resident: null,
        operation: { kind: "idle" },
        generation: null,
      });
    });

    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("old-token");
    await client.getState();

    client.setToken("new-token");
    await client.getState();

    expect(seenTokens).toEqual(["Bearer old-token", "Bearer new-token"]);
  });

  it("maps a 401 response to UnauthorizedError", async () => {
    const fetchMock = mock(async () =>
      jsonResponse({ error: "unauthorized", message: "Invalid or missing bearer token" }, 401)
    );

    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("bad-token");

    await expect(client.getState()).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe("APIClient SSE streaming", () => {
  it("yields token events in order, even split across chunk boundaries, then a terminal complete event", async () => {
    // Two content events and a terminal done event, deliberately split so
    // that one event's data line is cut across two chunk boundaries.
    const chunk1 = "event: content\ndata: {\"text\":\"Hel";
    const chunk2 = "lo\"}\n\nevent: content\ndata: {\"text\":\" World\"}\n\n";
    const chunk3 =
      "event: done\ndata: {\"status\":\"complete\",\"model\":\"m\",\"eval_count\":2,\"tokens_per_second\":10}\n\n";

    const fetchMock = mock(async () =>
      sseResponse([chunk1, chunk2, chunk3], { generationId: "gen-42" })
    );

    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    const events: StreamEvent[] = [];
    let completed = false;
    let errored: Error | null = null;

    const generationId = await client.chat(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      {
        onEvent: (event) => events.push(event),
        onError: (error) => {
          errored = error;
        },
        onComplete: () => {
          completed = true;
        },
      }
    );

    expect(generationId).toBe("gen-42");
    expect(errored).toBeNull();
    expect(completed).toBe(true);

    expect(events.map((e) => e.type)).toEqual(["content", "content", "done"]);
    expect(events[0]).toEqual({ type: "content", data: { text: "Hello" } });
    expect(events[1]).toEqual({ type: "content", data: { text: " World" } });
    expect(events[2]).toMatchObject({
      type: "done",
      data: { status: "complete", model: "m", eval_count: 2 },
    });
  });
});

describe("APIClient SSE comment lines", () => {
  it("ignores the leading ': connected' comment line the server sends to open the stream", async () => {
    // Every SSE response begins with a ": connected" comment line before any
    // real events; the parser must skip it rather than treat it as an event.
    const chunk1 = ": connected\n\n";
    const chunk2 = "event: content\ndata: {\"text\":\"hi\"}\n\n";
    const chunk3 =
      "event: done\ndata: {\"status\":\"complete\",\"model\":\"m\",\"eval_count\":1,\"tokens_per_second\":1}\n\n";

    const fetchMock = mock(async () =>
      sseResponse([chunk1, chunk2, chunk3], { generationId: "gen-1" })
    );

    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    const events: StreamEvent[] = [];
    let completed = false;
    let errored: Error | null = null;

    await client.chat(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      {
        onEvent: (event) => events.push(event),
        onError: (error) => {
          errored = error;
        },
        onComplete: () => {
          completed = true;
        },
      }
    );

    expect(errored).toBeNull();
    expect(completed).toBe(true);
    expect(events.map((e) => e.type)).toEqual(["content", "done"]);
  });
});

describe("APIClient cancellation (Stop)", () => {
  it("stops yielding further tokens once the request is aborted, without an error", async () => {
    const abortController = new AbortController();
    let stream: { response: Response; push: (chunk: string) => void };

    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      stream = controlledSseResponse({
        generationId: "gen-99",
        signal: init?.signal ?? null,
      });
      return stream.response;
    });

    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    const events: StreamEvent[] = [];
    let completed = false;
    let errored: Error | null = null;

    const chatPromise = client.chat(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      {
        onEvent: (event) => events.push(event),
        onError: (error) => {
          errored = error;
        },
        onComplete: () => {
          completed = true;
        },
        signal: abortController.signal,
      }
    );

    // Let the client's fetch resolve and attach its reader before the first
    // token arrives.
    await Promise.resolve();
    await Promise.resolve();

    stream!.push("event: content\ndata: {\"text\":\"one\"}\n\n");
    // Give the read loop a turn to process the token that already arrived.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toHaveLength(1);

    // Stop is pressed: abort mid-stream, before a second token arrives.
    abortController.abort();

    const generationId = await chatPromise;

    expect(generationId).toBe("gen-99");
    expect(events).toHaveLength(1); // no further tokens after the abort
    expect(errored).toBeNull();
    expect(completed).toBe(true);
  });

  it("calls the server's cancel route for the generation id", async () => {
    const fetchMock = mock(async (url: string, init?: RequestInit) => {
      expect(url).toBe(`${BASE_URL}/v1/generations/gen-7/cancel`);
      expect(init?.method).toBe("POST");
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer t");
      return new Response(null, { status: 200 });
    });

    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    await client.cancelGeneration("gen-7");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
