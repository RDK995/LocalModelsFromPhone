/**
 * Behavioural tests for the API client: SSE parsing, bearer-token
 * authorization, unauthorized mapping, and cancellation. No network is used;
 * a fake `FetchImpl` is injected per the client's constructor option so the
 * client's real request/parsing logic runs against a controlled fake server.
 */

import { describe, it, expect, mock } from "bun:test";
import {
  APIClient,
  ConfirmationRequiredError,
  ServerError,
  UnauthorizedError,
  UnreachableError,
} from "./client";
import type { ClientLifecycle, FetchImpl, StreamEvent } from "./client";
import {
  describeError,
  UNREACHABLE_MESSAGE,
  OLLAMA_DOWN_MESSAGE,
} from "./errorMessages";

const BASE_URL = "http://localhost:7789";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * A non-OK response whose `.json()` resolves to `null` instead of rejecting
 * -- what Bun's `fetch` (and potentially other runtimes) can produce for a
 * `content-length: 0` response, e.g. Tailscale's TLS-terminating proxy
 * answering `502` with no body when the Mac is up but the server behind it
 * is down. A plain `new Response(null, {status})`'s `.json()` rejects (see
 * `parseErrorBody`'s catch), so this is deliberately a separate fake.
 */
function nullJsonResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: new Headers(),
    json: async () => null,
  } as unknown as Response;
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

describe("APIClient load/unload error mapping", () => {
  it("throws a ServerError with the body's code and message for a 404 from loadModel", async () => {
    const fetchMock = mock(async () =>
      jsonResponse(
        { error: "unknown_model", message: "No such model: bogus" },
        404
      )
    );

    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    const error = await client.loadModel({ name: "bogus" }).catch((e) => e);
    expect(error).toBeInstanceOf(ServerError);
    expect((error as ServerError).code).toBe("unknown_model");
    expect((error as ServerError).message).toBe("No such model: bogus");
  });

  it("throws a ServerError with the body's code and message for a 409 from unloadModel", async () => {
    const fetchMock = mock(async () =>
      jsonResponse(
        { error: "operation_in_progress", message: "Already unloading" },
        409
      )
    );

    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    const error = await client.unloadModel({}).catch((e) => e);
    expect(error).toBeInstanceOf(ServerError);
    expect((error as ServerError).code).toBe("operation_in_progress");
    expect((error as ServerError).message).toBe("Already unloading");
  });

  it("still maps a 401 from loadModel to UnauthorizedError, not ServerError", async () => {
    const fetchMock = mock(async () =>
      jsonResponse({ error: "unauthorized", message: "Invalid or missing bearer token" }, 401)
    );

    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("bad-token");

    await expect(client.loadModel({ name: "m" })).rejects.toBeInstanceOf(
      UnauthorizedError
    );
  });

  it("still maps a 401 from unloadModel to UnauthorizedError, not ServerError", async () => {
    const fetchMock = mock(async () =>
      jsonResponse({ error: "unauthorized", message: "Invalid or missing bearer token" }, 401)
    );

    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("bad-token");

    await expect(client.unloadModel({})).rejects.toBeInstanceOf(
      UnauthorizedError
    );
  });

  it("throws a ConfirmationRequiredError with the body's message and reasons for a 409 confirmation_required from loadModel", async () => {
    const fetchMock = mock(async () =>
      jsonResponse(
        {
          error: "confirmation_required",
          message: "A reply is still being generated.",
          reasons: ["reply_in_progress"],
        },
        409
      )
    );

    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    const error = await client.loadModel({ name: "m" }).catch((e) => e);
    expect(error).toBeInstanceOf(ConfirmationRequiredError);
    expect(error).toBeInstanceOf(ServerError);
    expect((error as ConfirmationRequiredError).code).toBe(
      "confirmation_required"
    );
    expect((error as ConfirmationRequiredError).message).toBe(
      "A reply is still being generated."
    );
    expect((error as ConfirmationRequiredError).reasons).toEqual([
      "reply_in_progress",
    ]);
  });

  it("throws a ConfirmationRequiredError with both reasons for a 409 confirmation_required from unloadModel", async () => {
    const fetchMock = mock(async () =>
      jsonResponse(
        {
          error: "confirmation_required",
          message: "This model may be in use elsewhere.",
          reasons: ["reply_in_progress", "not_loaded_by_server"],
        },
        409
      )
    );

    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    const error = await client.unloadModel({}).catch((e) => e);
    expect(error).toBeInstanceOf(ConfirmationRequiredError);
    expect((error as ConfirmationRequiredError).reasons).toEqual([
      "reply_in_progress",
      "not_loaded_by_server",
    ]);
  });

  it("sends confirm in the body only when the caller passes it, for both loadModel and unloadModel", async () => {
    const bodies: unknown[] = [];
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(init?.body as string));
      return jsonResponse({ operation: { kind: "loading", model: "m" } }, 202);
    });

    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    await client.loadModel({ name: "m" });
    await client.loadModel({ name: "m", confirm: true });
    await client.unloadModel({});
    await client.unloadModel({ confirm: true });

    expect(bodies).toEqual([
      { name: "m" },
      { name: "m", confirm: true },
      {},
      { confirm: true },
    ]);
  });
});

describe("APIClient network/server error mapping (FR16, M5b)", () => {
  it("throws UnreachableError when the initial getState fetch rejects for a network reason", async () => {
    const fetchMock = mock(async () => {
      throw new TypeError("fetch failed");
    });

    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    await expect(client.getState()).rejects.toBeInstanceOf(UnreachableError);
  });

  it("throws ServerError('ollama_down') for a 503 from /v1/state", async () => {
    const fetchMock = mock(async () =>
      jsonResponse({ error: "ollama_down", message: "Unable to reach Ollama" }, 503)
    );

    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    const error = await client.getState().catch((e) => e);
    expect(error).toBeInstanceOf(ServerError);
    expect((error as ServerError).code).toBe("ollama_down");
    expect((error as ServerError).message).toBe("Unable to reach Ollama");
  });

  it("throws ServerError('generation_in_flight') for a 409 from the initial chat POST", async () => {
    const fetchMock = mock(async () =>
      jsonResponse(
        { error: "generation_in_flight", message: "A reply is already in progress" },
        409
      )
    );

    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    const error = await client
      .chat(
        { model: "m", messages: [{ role: "user", content: "hi" }] },
        {
          onEvent: () => {},
          onError: () => {},
          onComplete: () => {},
        }
      )
      .catch((e) => e);

    expect(error).toBeInstanceOf(ServerError);
    expect((error as ServerError).code).toBe("generation_in_flight");
    expect((error as ServerError).message).toBe("A reply is already in progress");
  });

  it("throws UnreachableError (not a generic Error) for a bodiless 502 from getState, mapping to the unreachable message", async () => {
    const fetchMock = mock(async () => new Response(null, { status: 502 }));

    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    const error = await client.getState().catch((e) => e);
    expect(error).toBeInstanceOf(UnreachableError);
    expect(describeError(error)).toBe(UNREACHABLE_MESSAGE);
  });

  it("throws UnreachableError for a bodiless 502 from loadModel", async () => {
    const fetchMock = mock(async () => new Response(null, { status: 502 }));

    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    const error = await client.loadModel({ name: "m" }).catch((e) => e);
    expect(error).toBeInstanceOf(UnreachableError);
    expect(describeError(error)).toBe(UNREACHABLE_MESSAGE);
  });

  it("throws UnreachableError for a bodiless 503 from the initial chat POST", async () => {
    const fetchMock = mock(async () => new Response(null, { status: 503 }));

    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    const error = await client
      .chat(
        { model: "m", messages: [{ role: "user", content: "hi" }] },
        {
          onEvent: () => {},
          onError: () => {},
          onComplete: () => {},
        }
      )
      .catch((e) => e);

    expect(error).toBeInstanceOf(UnreachableError);
    expect(describeError(error)).toBe(UNREACHABLE_MESSAGE);
  });

  it("does not throw a TypeError, and maps to UnreachableError, when a 502's body resolves to null (getState)", async () => {
    const fetchMock = mock(async () => nullJsonResponse(502));

    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    const error = await client.getState().catch((e) => e);
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error).toBeInstanceOf(UnreachableError);
    expect(describeError(error)).toBe(UNREACHABLE_MESSAGE);
  });

  it("does not throw a TypeError, and maps to UnreachableError, when a 504's body resolves to null (loadModel, via assertLoadUnloadOk)", async () => {
    const fetchMock = mock(async () => nullJsonResponse(504));

    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    const error = await client.loadModel({ name: "m" }).catch((e) => e);
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error).toBeInstanceOf(UnreachableError);
    expect(describeError(error)).toBe(UNREACHABLE_MESSAGE);
  });

  it("still maps a 503 {error: 'ollama_down'} body to ServerError/OLLAMA_DOWN_MESSAGE, not unreachable", async () => {
    const fetchMock = mock(async () =>
      jsonResponse({ error: "ollama_down", message: "Unable to reach Ollama" }, 503)
    );

    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    const error = await client.getState().catch((e) => e);
    expect(error).toBeInstanceOf(ServerError);
    expect((error as ServerError).code).toBe("ollama_down");
    expect(describeError(error)).toBe(OLLAMA_DOWN_MESSAGE);
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

describe("APIClient step and sources events", () => {
  const doneChunk =
    "event: done\ndata: {\"status\":\"complete\",\"model\":\"m\",\"eval_count\":1,\"tokens_per_second\":1}\n\n";

  async function run(chunks: string[], request: Parameters<APIClient["chat"]>[0]) {
    const bodies: string[] = [];
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      bodies.push(init?.body as string);
      return sseResponse(chunks);
    });
    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");
    const events: StreamEvent[] = [];
    let errored: Error | null = null;
    await client.chat(request, {
      onEvent: (e) => events.push(e),
      onError: (e) => {
        errored = e;
      },
      onComplete: () => {},
    });
    return { events, bodies, errored };
  }

  const req = { model: "m", messages: [{ role: "user" as const, content: "hi" }] };

  it("delivers step, step, sources, done in order with parsed data", async () => {
    const { events, errored } = await run(
      [
        "event: step\ndata: {\"step_id\":\"s1\",\"kind\":\"search\",\"status\":\"started\",\"query\":\"cats\"}\n\n",
        "event: step\ndata: {\"step_id\":\"s1\",\"kind\":\"search\",\"status\":\"done\",\"query\":\"cats\"}\n\n",
        "event: sources\ndata: {\"items\":[{\"title\":\"A\",\"url\":\"https://a\"},{\"title\":1,\"url\":\"x\"},{\"title\":\"B\"}]}\n\n",
        doneChunk,
      ],
      req
    );
    expect(errored).toBeNull();
    expect(events.map((e) => e.type)).toEqual(["step", "step", "sources", "done"]);
    expect(events[0]).toEqual({
      type: "step",
      data: { step_id: "s1", kind: "search", status: "started", query: "cats" },
    });
    expect(events[1]).toMatchObject({ type: "step", data: { status: "done" } });
    expect(events[2]).toEqual({
      type: "sources",
      data: { items: [{ title: "A", url: "https://a" }] },
    });
  });

  it("drops a malformed step without breaking the stream", async () => {
    const { events, errored } = await run(
      [
        "event: step\ndata: {\"kind\":\"search\",\"status\":\"started\"}\n\n",
        "event: step\ndata: {\"step_id\":\"s2\",\"kind\":\"search\",\"status\":\"bogus\"}\n\n",
        "event: step\ndata: {\"step_id\":\"s3\",\"kind\":\"nope\",\"status\":\"done\"}\n\n",
        "event: content\ndata: {\"text\":\"hi\"}\n\n",
        doneChunk,
      ],
      req
    );
    expect(errored).toBeNull();
    expect(events.map((e) => e.type)).toEqual(["content", "done"]);
  });

  it("sends web:true in the chat body when the request carries it", async () => {
    const { bodies } = await run([doneChunk], { ...req, web: true });
    expect(JSON.parse(bodies[0]).web).toBe(true);
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

/**
 * Like `controlledSseResponse`, but also exposes `fail` (simulates
 * `reader.read()` rejecting with a transport error -- a drop, distinct from a
 * caller abort) and `endWithoutTerminal` (simulates the body closing before a
 * `done`/`error` event was delivered -- also a drop, per AC2) for the resume
 * tests below.
 */
function resumableSseResponse(
  options: {
    generationId?: string;
    signal?: AbortSignal | null;
    status?: number;
  } = {}
): {
  response: Response;
  push: (chunk: string) => void;
  fail: (error?: Error) => void;
  endWithoutTerminal: () => void;
} {
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
    status: options.status ?? 200,
    headers: {
      "Content-Type": "text/event-stream",
      "x-generation-id": options.generationId ?? "gen-1",
    },
  });

  return {
    response,
    push: (chunk: string) => controllerRef.enqueue(encoder.encode(chunk)),
    fail: (error?: Error) =>
      controllerRef.error(error ?? new Error("transport drop")),
    endWithoutTerminal: () => controllerRef.close(),
  };
}

/** Formats one SSE event exactly as the server does (server.ts formatSSE). */
function sseEvent(id: string, type: string, data: unknown): string {
  return `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * A fake sleep/clock pair for the resume loop's backoff waits and budget
 * check, so tests run instantly and deterministically (per the task's
 * injectable-clock constraint). `sleep` records each requested delay and
 * returns a promise that stays pending until the test calls `release()`
 * (oldest first) or the passed `signal` aborts -- mirroring the real
 * implementation's "resolve promptly on abort" contract. `advance` moves the
 * virtual clock `now()` reports, independently of `release`/`sleep`, so a
 * budget-exhaustion test does not need to release dozens of pending sleeps.
 */
function fakeClock(): {
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  sleeps: number[];
  release: () => void;
  advance: (ms: number) => void;
} {
  let current = 0;
  const sleeps: number[] = [];
  const pending: Array<() => void> = [];

  return {
    now: () => current,
    sleep: (ms: number, signal?: AbortSignal) =>
      new Promise((resolve) => {
        sleeps.push(ms);
        if (signal?.aborted) {
          resolve();
          return;
        }
        const onAbort = () => resolve();
        signal?.addEventListener("abort", onAbort, { once: true });
        pending.push(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        });
      }),
    sleeps,
    release: () => {
      const next = pending.shift();
      if (next) next();
    },
    advance: (ms: number) => {
      current += ms;
    },
  };
}

/** Yields to the macrotask queue, letting pending microtasks settle. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Polls `predicate` until it is true, rather than guessing a tick count. */
async function waitFor(
  predicate: () => boolean,
  description: string
): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (predicate()) {
      return;
    }
    await flush();
  }
  throw new Error(`Timed out waiting for: ${description}`);
}

/** Builds a sequential fake fetch: call N is handled by `handlers[N]`. */
function sequentialFetch(
  handlers: Array<
    (url: string, init?: RequestInit) => Promise<Response> | Response
  >
): ReturnType<typeof mock> & {
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = mock(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const handler = handlers[calls.length - 1];
    if (!handler) {
      throw new Error(`Unexpected fetch call #${calls.length}: ${url}`);
    }
    return handler(url, init);
  });
  return Object.assign(fetchMock, { calls });
}

/** Builds a fetch whose response for call N is computed lazily from the
 * request's `init` (in particular, its internal abort `signal`) rather than
 * fixed up-front -- needed for the foreground tests below, where each
 * transport's own internal controller (not the caller's `options.signal`)
 * must be wired to the SSE response so aborting it makes the pending read
 * reject. */
function dynamicFetch(
  makeResponse: (
    callIndex: number,
    url: string,
    init?: RequestInit
  ) => Response
): ReturnType<typeof mock> & {
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = mock(async (url: string, init?: RequestInit) => {
    const callIndex = calls.length;
    calls.push({ url, init });
    return makeResponse(callIndex, url, init);
  });
  return Object.assign(fetchMock, { calls });
}

/**
 * A fake `ClientLifecycle` for the foreground-resume tests: `fireForeground`
 * invokes every currently-subscribed listener (mirroring the app-side
 * `AppState` adapter's already-computed "became active" event), and
 * `subscriberCount` lets a test assert that `chat()` unsubscribed once the
 * reply settled.
 */
function fakeLifecycle(): {
  lifecycle: ClientLifecycle;
  setForeground: (value: boolean) => void;
  fireForeground: () => void;
  subscriberCount: () => number;
} {
  let foreground = true;
  const listeners = new Set<() => void>();
  const lifecycle: ClientLifecycle = {
    isForeground: () => foreground,
    onForeground: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    lifecycle,
    setForeground: (value: boolean) => {
      foreground = value;
    },
    fireForeground: () => {
      for (const listener of Array.from(listeners)) {
        listener();
      }
    },
    subscriberCount: () => listeners.size,
  };
}

describe("APIClient dropped-connection resume (FR11)", () => {
  it("(a) resumes once after a drop mid-reply: GET events with Last-Event-ID g-2, then g-3.. and done, each event delivered once, onComplete once", async () => {
    const initial = resumableSseResponse({ generationId: "gen-a" });
    const resumed = resumableSseResponse({ generationId: "gen-a" });
    const clock = fakeClock();

    const fetchMock = sequentialFetch([
      () => initial.response,
      () => resumed.response,
    ]);

    const client = new APIClient(BASE_URL, fetchMock as unknown as FetchImpl, {
      sleep: clock.sleep,
      now: clock.now,
    });
    client.setToken("t");

    const events: StreamEvent[] = [];
    let completed = false;
    let errored: Error | null = null;
    let startedGenerationId: string | null = null;

    const chatPromise = client.chat(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      {
        onStart: (id) => {
          startedGenerationId = id;
        },
        onEvent: (event) => events.push(event),
        onError: (error) => {
          errored = error;
        },
        onComplete: () => {
          completed = true;
        },
      }
    );

    await waitFor(() => fetchMock.calls.length >= 1, "initial chat request");

    initial.push(sseEvent("gen-a-1", "content", { text: "Hello" }));
    initial.push(sseEvent("gen-a-2", "content", { text: " World" }));
    await waitFor(() => events.length === 2, "g-1 and g-2 delivered");

    initial.fail();
    await waitFor(() => clock.sleeps.length === 1, "backoff wait requested");
    expect(clock.sleeps).toEqual([500]);

    clock.release();
    await waitFor(() => fetchMock.calls.length === 2, "resume GET request");

    const resumeCall = fetchMock.calls[1]!;
    expect(resumeCall.url).toBe(`${BASE_URL}/v1/generations/gen-a/events`);
    const resumeHeaders = resumeCall.init?.headers as Record<string, string>;
    expect(resumeHeaders["Last-Event-ID"]).toBe("gen-a-2");
    expect(resumeHeaders.Authorization).toBe("Bearer t");

    resumed.push(sseEvent("gen-a-3", "content", { text: "!" }));
    resumed.push(
      sseEvent("gen-a-4", "done", {
        status: "complete",
        model: "m",
        eval_count: 3,
        tokens_per_second: 1,
      })
    );

    await chatPromise;

    // Cast: TS narrows this `let` to `null` from its initializer, since the
    // reassignment happens inside a nested closure it cannot see as having
    // run by this point in the (synchronous) control flow.
    expect(startedGenerationId as string | null).toBe("gen-a");
    expect(errored).toBeNull();
    expect(completed).toBe(true);
    expect(events.map((e) => e.type)).toEqual([
      "content",
      "content",
      "content",
      "done",
    ]);
    expect(fetchMock.calls.length).toBe(2);
  });

  it("(b) does not redeliver an event the resumed stream re-sends", async () => {
    const initial = resumableSseResponse({ generationId: "gen-b" });
    const resumed = resumableSseResponse({ generationId: "gen-b" });
    const clock = fakeClock();

    const fetchMock = sequentialFetch([
      () => initial.response,
      () => resumed.response,
    ]);

    const client = new APIClient(BASE_URL, fetchMock as unknown as FetchImpl, {
      sleep: clock.sleep,
      now: clock.now,
    });
    client.setToken("t");

    const events: StreamEvent[] = [];
    let completed = false;

    const chatPromise = client.chat(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      {
        onEvent: (event) => events.push(event),
        onError: () => {},
        onComplete: () => {
          completed = true;
        },
      }
    );

    await waitFor(() => fetchMock.calls.length >= 1, "initial chat request");
    initial.push(sseEvent("gen-b-1", "content", { text: "a" }));
    initial.push(sseEvent("gen-b-2", "content", { text: "b" }));
    await waitFor(() => events.length === 2, "g-1 and g-2 delivered");

    initial.fail();
    await waitFor(() => clock.sleeps.length === 1, "backoff wait requested");
    clock.release();
    await waitFor(() => fetchMock.calls.length === 2, "resume GET request");

    // The resumed stream re-sends the already-delivered g-2, then a new
    // event and done.
    resumed.push(sseEvent("gen-b-2", "content", { text: "b" }));
    resumed.push(sseEvent("gen-b-3", "content", { text: "c" }));
    resumed.push(
      sseEvent("gen-b-4", "done", {
        status: "complete",
        model: "m",
        eval_count: 3,
        tokens_per_second: 1,
      })
    );

    await chatPromise;

    expect(completed).toBe(true);
    expect(events.map((e) => e.type)).toEqual([
      "content",
      "content",
      "content",
      "done",
    ]);
    expect(events.map((e) => (e as { data: { text?: string } }).data.text)).toEqual(
      ["a", "b", "c", undefined]
    );
  });

  it("(c) resumes when the body ends without a done/error event", async () => {
    const initial = resumableSseResponse({ generationId: "gen-c" });
    const resumed = resumableSseResponse({ generationId: "gen-c" });
    const clock = fakeClock();

    const fetchMock = sequentialFetch([
      () => initial.response,
      () => resumed.response,
    ]);

    const client = new APIClient(BASE_URL, fetchMock as unknown as FetchImpl, {
      sleep: clock.sleep,
      now: clock.now,
    });
    client.setToken("t");

    const events: StreamEvent[] = [];
    let completed = false;

    const chatPromise = client.chat(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      {
        onEvent: (event) => events.push(event),
        onError: () => {},
        onComplete: () => {
          completed = true;
        },
      }
    );

    await waitFor(() => fetchMock.calls.length >= 1, "initial chat request");
    initial.push(sseEvent("gen-c-1", "content", { text: "a" }));
    await waitFor(() => events.length === 1, "g-1 delivered");

    // Body ends cleanly, but no done/error event was ever delivered.
    initial.endWithoutTerminal();
    await waitFor(() => clock.sleeps.length === 1, "backoff wait requested");
    clock.release();
    await waitFor(() => fetchMock.calls.length === 2, "resume GET request");

    resumed.push(
      sseEvent("gen-c-2", "done", {
        status: "complete",
        model: "m",
        eval_count: 1,
        tokens_per_second: 1,
      })
    );

    await chatPromise;

    expect(completed).toBe(true);
    expect(events.map((e) => e.type)).toEqual(["content", "done"]);
    expect(fetchMock.calls.length).toBe(2);
  });

  it("(d) omits Last-Event-ID when the drop happens before any event carried an id", async () => {
    const initial = resumableSseResponse({ generationId: "gen-d" });
    const resumed = resumableSseResponse({ generationId: "gen-d" });
    const clock = fakeClock();

    const fetchMock = sequentialFetch([
      () => initial.response,
      () => resumed.response,
    ]);

    const client = new APIClient(BASE_URL, fetchMock as unknown as FetchImpl, {
      sleep: clock.sleep,
      now: clock.now,
    });
    client.setToken("t");

    const chatPromise = client.chat(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      {
        onEvent: () => {},
        onError: () => {},
        onComplete: () => {},
      }
    );

    await waitFor(() => fetchMock.calls.length >= 1, "initial chat request");
    initial.fail();
    await waitFor(() => clock.sleeps.length === 1, "backoff wait requested");
    clock.release();
    await waitFor(() => fetchMock.calls.length === 2, "resume GET request");

    const resumeHeaders = fetchMock.calls[1]!.init?.headers as Record<
      string,
      string
    >;
    expect("Last-Event-ID" in resumeHeaders).toBe(false);

    resumed.push(
      sseEvent("gen-d-1", "done", {
        status: "complete",
        model: "m",
        eval_count: 0,
        tokens_per_second: 0,
      })
    );

    await chatPromise;
  });

  it("(e) a user abort mid-read makes no resume request and completes once", async () => {
    const abortController = new AbortController();
    let stream: ReturnType<typeof resumableSseResponse>;
    const clock = fakeClock();

    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      stream = resumableSseResponse({
        generationId: "gen-e",
        signal: init?.signal ?? null,
      });
      return stream.response;
    });

    const client = new APIClient(BASE_URL, fetchMock as unknown as FetchImpl, {
      sleep: clock.sleep,
      now: clock.now,
    });
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

    await flush();
    stream!.push(sseEvent("gen-e-1", "content", { text: "one" }));
    await waitFor(() => events.length === 1, "one token delivered");

    abortController.abort();
    await chatPromise;

    expect(errored).toBeNull();
    expect(completed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(clock.sleeps).toEqual([]);
  });

  it("(f) a user abort during a backoff wait makes no resume request and completes once", async () => {
    const abortController = new AbortController();
    const initial = resumableSseResponse({
      generationId: "gen-f",
      signal: abortController.signal,
    });
    const clock = fakeClock();

    const fetchMock = sequentialFetch([() => initial.response]);

    const client = new APIClient(BASE_URL, fetchMock as unknown as FetchImpl, {
      sleep: clock.sleep,
      now: clock.now,
    });
    client.setToken("t");

    let completed = false;
    let errored: Error | null = null;

    const chatPromise = client.chat(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      {
        onEvent: () => {},
        onError: (error) => {
          errored = error;
        },
        onComplete: () => {
          completed = true;
        },
        signal: abortController.signal,
      }
    );

    await waitFor(() => fetchMock.calls.length >= 1, "initial chat request");
    initial.fail();
    await waitFor(() => clock.sleeps.length === 1, "backoff wait requested");

    // Stop is pressed while the backoff wait is still pending.
    abortController.abort();
    await chatPromise;

    expect(errored).toBeNull();
    expect(completed).toBe(true);
    expect(fetchMock.calls.length).toBe(1); // no resume GET was ever sent
  });

  it("(g) waits 500, 1000, 2000ms across consecutive failed resume attempts", async () => {
    const initial = resumableSseResponse({ generationId: "gen-g" });
    const finalStream = resumableSseResponse({ generationId: "gen-g" });
    const clock = fakeClock();

    const fetchMock = sequentialFetch([
      () => initial.response,
      () => {
        throw new Error("network error");
      },
      () => new Response(JSON.stringify({ error: "ollama_down" }), {
        status: 503,
      }),
      () => finalStream.response,
    ]);

    const client = new APIClient(BASE_URL, fetchMock as unknown as FetchImpl, {
      sleep: clock.sleep,
      now: clock.now,
    });
    client.setToken("t");

    let completed = false;

    const chatPromise = client.chat(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      {
        onEvent: () => {},
        onError: () => {},
        onComplete: () => {
          completed = true;
        },
      }
    );

    await waitFor(() => fetchMock.calls.length >= 1, "initial chat request");
    initial.fail();

    await waitFor(() => clock.sleeps.length === 1, "attempt 1 wait");
    clock.release();
    await waitFor(() => fetchMock.calls.length === 2, "attempt 1 request");

    await waitFor(() => clock.sleeps.length === 2, "attempt 2 wait");
    clock.release();
    await waitFor(() => fetchMock.calls.length === 3, "attempt 2 request");

    await waitFor(() => clock.sleeps.length === 3, "attempt 3 wait");
    clock.release();
    await waitFor(() => fetchMock.calls.length === 4, "attempt 3 request");

    finalStream.push(
      sseEvent("gen-g-1", "done", {
        status: "complete",
        model: "m",
        eval_count: 0,
        tokens_per_second: 0,
      })
    );

    await chatPromise;

    expect(clock.sleeps).toEqual([500, 1000, 2000]);
    expect(completed).toBe(true);
  });

  it("(h) a 404 from the resume request ends the loop with ServerError unknown_generation and no further requests", async () => {
    const initial = resumableSseResponse({ generationId: "gen-h" });
    const clock = fakeClock();

    const fetchMock = sequentialFetch([
      () => initial.response,
      () =>
        new Response(
          JSON.stringify({
            error: "unknown_generation",
            message: "No such generation",
          }),
          { status: 404 }
        ),
    ]);

    const client = new APIClient(BASE_URL, fetchMock as unknown as FetchImpl, {
      sleep: clock.sleep,
      now: clock.now,
    });
    client.setToken("t");

    let errored: Error | null = null;
    let completed = false;

    const chatPromise = client.chat(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      {
        onEvent: () => {},
        onError: (error) => {
          errored = error;
        },
        onComplete: () => {
          completed = true;
        },
      }
    );

    await waitFor(() => fetchMock.calls.length >= 1, "initial chat request");
    initial.fail();
    await waitFor(() => clock.sleeps.length === 1, "backoff wait requested");
    clock.release();

    await chatPromise;

    expect(completed).toBe(false);
    expect(errored).toBeInstanceOf(ServerError);
    expect((errored as unknown as ServerError).code).toBe("unknown_generation");
    expect((errored as unknown as ServerError).message).toBe(
      "No such generation"
    );
    expect(fetchMock.calls.length).toBe(2);
  });

  it("(i) stops and reports an error once the resume budget is exhausted", async () => {
    const initial = resumableSseResponse({ generationId: "gen-i" });
    const clock = fakeClock();

    const fetchMock = sequentialFetch([
      () => initial.response,
      () => {
        throw new Error("network error");
      },
    ]);

    const client = new APIClient(BASE_URL, fetchMock as unknown as FetchImpl, {
      sleep: clock.sleep,
      now: clock.now,
    });
    client.setToken("t");

    let errored: Error | null = null;
    let completed = false;

    const chatPromise = client.chat(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      {
        onEvent: () => {},
        onError: (error) => {
          errored = error;
        },
        onComplete: () => {
          completed = true;
        },
      }
    );

    await waitFor(() => fetchMock.calls.length >= 1, "initial chat request");
    initial.fail();
    await waitFor(() => clock.sleeps.length === 1, "attempt 1 wait");

    // Simulate a very long time having passed before attempt 1 lands.
    clock.advance(300_001);
    clock.release();

    await waitFor(() => fetchMock.calls.length === 2, "attempt 1 request");
    // Attempt 1's request fails (network error); the loop re-checks the
    // budget before attempt 2 and stops instead of waiting/retrying again.

    await chatPromise;

    expect(completed).toBe(false);
    expect(errored).not.toBeNull();
    expect(errored).not.toBeInstanceOf(ServerError);
    expect(errored!.message).toContain("connection to the Mac was lost");
    expect(clock.sleeps.length).toBe(1); // no second backoff wait
    expect(fetchMock.calls.length).toBe(2); // no further resume attempts
  });

  it("(j) an exception thrown by onEvent is reported to onError, without a resume request", async () => {
    const initial = resumableSseResponse({ generationId: "gen-j" });
    const clock = fakeClock();

    const fetchMock = sequentialFetch([() => initial.response]);

    const client = new APIClient(BASE_URL, fetchMock as unknown as FetchImpl, {
      sleep: clock.sleep,
      now: clock.now,
    });
    client.setToken("t");

    const thrown = new Error("boom: onEvent callback failed");
    let errored: Error | null = null;
    let completed = false;

    const chatPromise = client.chat(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      {
        onEvent: () => {
          throw thrown;
        },
        onError: (error) => {
          errored = error;
        },
        onComplete: () => {
          completed = true;
        },
      }
    );

    await waitFor(() => fetchMock.calls.length >= 1, "initial chat request");
    initial.push(sseEvent("gen-j-1", "content", { text: "x" }));

    await chatPromise;

    // Cast: same narrowing quirk as above (see the comment on
    // startedGenerationId).
    expect(errored as Error | null).toBe(thrown);
    expect(completed).toBe(false);
    expect(fetchMock.calls.length).toBe(1);
    expect(clock.sleeps).toEqual([]);
  });

  it("(k) a drop on the resumed stream itself resumes again from the latest id", async () => {
    const initial = resumableSseResponse({ generationId: "gen-k" });
    const resumedOnce = resumableSseResponse({ generationId: "gen-k" });
    const resumedTwice = resumableSseResponse({ generationId: "gen-k" });
    const clock = fakeClock();

    const fetchMock = sequentialFetch([
      () => initial.response,
      () => resumedOnce.response,
      () => resumedTwice.response,
    ]);

    const client = new APIClient(BASE_URL, fetchMock as unknown as FetchImpl, {
      sleep: clock.sleep,
      now: clock.now,
    });
    client.setToken("t");

    const events: StreamEvent[] = [];
    let completed = false;

    const chatPromise = client.chat(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      {
        onEvent: (event) => events.push(event),
        onError: () => {},
        onComplete: () => {
          completed = true;
        },
      }
    );

    await waitFor(() => fetchMock.calls.length >= 1, "initial chat request");
    initial.push(sseEvent("gen-k-1", "content", { text: "a" }));
    await waitFor(() => events.length === 1, "g-1 delivered");

    initial.fail();
    await waitFor(() => clock.sleeps.length === 1, "first backoff wait");
    clock.release();
    await waitFor(() => fetchMock.calls.length === 2, "first resume request");
    expect(
      (fetchMock.calls[1]!.init?.headers as Record<string, string>)[
        "Last-Event-ID"
      ]
    ).toBe("gen-k-1");

    resumedOnce.push(sseEvent("gen-k-2", "content", { text: "b" }));
    await waitFor(() => events.length === 2, "g-2 delivered");

    // The resumed stream itself drops before a terminal event.
    resumedOnce.fail();
    await waitFor(() => clock.sleeps.length === 2, "second backoff wait");
    expect(clock.sleeps).toEqual([500, 500]); // attempt counter reset to 1
    clock.release();
    await waitFor(() => fetchMock.calls.length === 3, "second resume request");
    expect(
      (fetchMock.calls[2]!.init?.headers as Record<string, string>)[
        "Last-Event-ID"
      ]
    ).toBe("gen-k-2");

    resumedTwice.push(
      sseEvent("gen-k-3", "done", {
        status: "complete",
        model: "m",
        eval_count: 2,
        tokens_per_second: 1,
      })
    );

    await chatPromise;

    expect(completed).toBe(true);
    expect(events.map((e) => e.type)).toEqual(["content", "content", "done"]);
    expect(fetchMock.calls.length).toBe(3);
  });
});

describe("APIClient foreground resume (M4c, FR11/AC M4-AC3)", () => {
  it("(a) foreground during a pending read aborts that transport and resumes at once with no backoff wait", async () => {
    const clock = fakeClock();
    const fg = fakeLifecycle();
    const streams: Array<ReturnType<typeof resumableSseResponse>> = [];

    const fetchMock = dynamicFetch((_callIndex, _url, init) => {
      const stream = resumableSseResponse({
        generationId: "gen-fa",
        signal: init?.signal ?? null,
      });
      streams.push(stream);
      return stream.response;
    });

    const client = new APIClient(BASE_URL, fetchMock as unknown as FetchImpl, {
      sleep: clock.sleep,
      now: clock.now,
      lifecycle: fg.lifecycle,
    });
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
      }
    );

    await waitFor(() => streams.length >= 1, "initial chat request");
    streams[0]!.push(sseEvent("gen-fa-1", "content", { text: "Hello" }));
    streams[0]!.push(sseEvent("gen-fa-2", "content", { text: " World" }));
    await waitFor(() => events.length === 2, "g-1 and g-2 delivered");

    // App returns to the foreground while the read is pending.
    fg.fireForeground();

    await waitFor(() => streams.length >= 2, "resume GET request");
    expect(clock.sleeps).toEqual([]); // no backoff wait before this attempt

    // The chat transport's own internal controller was aborted (not the
    // caller's signal, which was never supplied here).
    const chatSignal = fetchMock.calls[0]!.init?.signal as AbortSignal;
    expect(chatSignal.aborted).toBe(true);

    const resumeCall = fetchMock.calls[1]!;
    expect(resumeCall.url).toBe(`${BASE_URL}/v1/generations/gen-fa/events`);
    const resumeHeaders = resumeCall.init?.headers as Record<string, string>;
    expect(resumeHeaders["Last-Event-ID"]).toBe("gen-fa-2");

    streams[1]!.push(sseEvent("gen-fa-3", "content", { text: "!" }));
    streams[1]!.push(
      sseEvent("gen-fa-4", "done", {
        status: "complete",
        model: "m",
        eval_count: 3,
        tokens_per_second: 1,
      })
    );

    await chatPromise;

    expect(errored).toBeNull();
    expect(completed).toBe(true);
    expect(events.map((e) => e.type)).toEqual([
      "content",
      "content",
      "content",
      "done",
    ]);
    expect(fetchMock.calls.length).toBe(2);
    expect(fetchMock.calls.some((c) => c.url.includes("/cancel"))).toBe(false);
  });

  it("(b) the resumed stream re-sending the last delivered event does not duplicate it", async () => {
    const clock = fakeClock();
    const fg = fakeLifecycle();
    const streams: Array<ReturnType<typeof resumableSseResponse>> = [];

    const fetchMock = dynamicFetch((_callIndex, _url, init) => {
      const stream = resumableSseResponse({
        generationId: "gen-fb",
        signal: init?.signal ?? null,
      });
      streams.push(stream);
      return stream.response;
    });

    const client = new APIClient(BASE_URL, fetchMock as unknown as FetchImpl, {
      sleep: clock.sleep,
      now: clock.now,
      lifecycle: fg.lifecycle,
    });
    client.setToken("t");

    const events: StreamEvent[] = [];
    let completed = false;

    const chatPromise = client.chat(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      {
        onEvent: (event) => events.push(event),
        onError: () => {},
        onComplete: () => {
          completed = true;
        },
      }
    );

    await waitFor(() => streams.length >= 1, "initial chat request");
    streams[0]!.push(sseEvent("gen-fb-1", "content", { text: "a" }));
    streams[0]!.push(sseEvent("gen-fb-2", "content", { text: "b" }));
    await waitFor(() => events.length === 2, "g-1 and g-2 delivered");

    fg.fireForeground();
    await waitFor(() => streams.length >= 2, "resume GET after foreground");

    // The resumed stream re-sends the already-delivered g-2.
    streams[1]!.push(sseEvent("gen-fb-2", "content", { text: "b" }));
    streams[1]!.push(sseEvent("gen-fb-3", "content", { text: "c" }));
    streams[1]!.push(
      sseEvent("gen-fb-4", "done", {
        status: "complete",
        model: "m",
        eval_count: 3,
        tokens_per_second: 1,
      })
    );

    await chatPromise;

    expect(completed).toBe(true);
    expect(events.map((e) => e.type)).toEqual([
      "content",
      "content",
      "content",
      "done",
    ]);
    expect(
      events.map((e) => (e as { data: { text?: string } }).data.text)
    ).toEqual(["a", "b", "c", undefined]);
  });

  it("(c) the resume body already carrying the remaining events and terminal done delivers done once", async () => {
    const clock = fakeClock();
    const fg = fakeLifecycle();
    const streams: Array<ReturnType<typeof resumableSseResponse>> = [];

    const fetchMock = dynamicFetch((_callIndex, _url, init) => {
      const stream = resumableSseResponse({
        generationId: "gen-fc",
        signal: init?.signal ?? null,
      });
      streams.push(stream);
      return stream.response;
    });

    const client = new APIClient(BASE_URL, fetchMock as unknown as FetchImpl, {
      sleep: clock.sleep,
      now: clock.now,
      lifecycle: fg.lifecycle,
    });
    client.setToken("t");

    const events: StreamEvent[] = [];
    let completed = false;

    const chatPromise = client.chat(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      {
        onEvent: (event) => events.push(event),
        onError: () => {},
        onComplete: () => {
          completed = true;
        },
      }
    );

    await waitFor(() => streams.length >= 1, "initial chat request");
    streams[0]!.push(sseEvent("gen-fc-1", "content", { text: "a" }));
    await waitFor(() => events.length === 1, "g-1 delivered");

    // App returns to the foreground; meanwhile the generation already
    // finished on the server, so the resume body carries every remaining
    // event through the terminal `done`.
    fg.fireForeground();
    await waitFor(() => streams.length >= 2, "resume GET after foreground");

    streams[1]!.push(sseEvent("gen-fc-2", "content", { text: "b" }));
    streams[1]!.push(
      sseEvent("gen-fc-3", "done", {
        status: "complete",
        model: "m",
        eval_count: 2,
        tokens_per_second: 1,
      })
    );

    await chatPromise;

    expect(completed).toBe(true);
    expect(events.map((e) => e.type)).toEqual(["content", "content", "done"]);
  });

  it("(d) foreground during a backoff wait ends it early and makes the next attempt at once", async () => {
    const clock = fakeClock();
    const fg = fakeLifecycle();
    const streams: Array<ReturnType<typeof resumableSseResponse>> = [];

    const fetchMock = dynamicFetch((_callIndex, _url, init) => {
      const stream = resumableSseResponse({
        generationId: "gen-fd",
        signal: init?.signal ?? null,
      });
      streams.push(stream);
      return stream.response;
    });

    const client = new APIClient(BASE_URL, fetchMock as unknown as FetchImpl, {
      sleep: clock.sleep,
      now: clock.now,
      lifecycle: fg.lifecycle,
    });
    client.setToken("t");

    let completed = false;

    const chatPromise = client.chat(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      {
        onEvent: () => {},
        onError: () => {},
        onComplete: () => {
          completed = true;
        },
      }
    );

    await waitFor(() => streams.length >= 1, "initial chat request");
    streams[0]!.fail(); // a genuine transport drop, not foreground-triggered
    await waitFor(() => clock.sleeps.length === 1, "backoff wait requested");
    expect(clock.sleeps).toEqual([500]);

    // Foreground fires while that backoff wait is still pending.
    fg.fireForeground();

    await waitFor(() => streams.length >= 2, "resume GET fires immediately");
    expect(clock.sleeps).toEqual([500]); // no second (longer) wait was requested

    streams[1]!.push(
      sseEvent("gen-fd-1", "done", {
        status: "complete",
        model: "m",
        eval_count: 0,
        tokens_per_second: 0,
      })
    );

    await chatPromise;

    expect(completed).toBe(true);
    expect(fetchMock.calls.length).toBe(2);
  });

  it("(e) budget exhaustion while backgrounded waits for foreground instead of erroring, then resumes", async () => {
    const clock = fakeClock();
    const fg = fakeLifecycle();
    const initial = resumableSseResponse({ generationId: "gen-fe" });
    const resumed = resumableSseResponse({ generationId: "gen-fe" });

    const fetchMock = sequentialFetch([
      () => initial.response,
      () => {
        throw new Error("network error");
      },
      () => resumed.response,
    ]);

    const client = new APIClient(BASE_URL, fetchMock as unknown as FetchImpl, {
      sleep: clock.sleep,
      now: clock.now,
      lifecycle: fg.lifecycle,
    });
    client.setToken("t");

    let completed = false;
    let errored: Error | null = null;

    const chatPromise = client.chat(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      {
        onEvent: () => {},
        onError: (error) => {
          errored = error;
        },
        onComplete: () => {
          completed = true;
        },
      }
    );

    await waitFor(() => fetchMock.calls.length >= 1, "initial chat request");
    initial.fail();
    await waitFor(() => clock.sleeps.length === 1, "attempt 1 wait");

    // Backgrounded, and enough time has passed to exhaust the budget by the
    // time attempt 1's request lands and fails.
    fg.setForeground(false);
    clock.advance(300_001);
    clock.release();

    await waitFor(() => fetchMock.calls.length === 2, "attempt 1 request");

    // The budget is exhausted, but the app is backgrounded: no onError, no
    // further request -- just a wait for the next foreground event.
    await flush();
    expect(errored).toBeNull();
    expect(completed).toBe(false);
    expect(fetchMock.calls.length).toBe(2);

    fg.setForeground(true);
    fg.fireForeground();

    await waitFor(() => fetchMock.calls.length === 3, "resume GET after foreground");
    expect(clock.sleeps.length).toBe(1); // still no additional backoff wait

    resumed.push(
      sseEvent("gen-fe-1", "done", {
        status: "complete",
        model: "m",
        eval_count: 0,
        tokens_per_second: 0,
      })
    );

    await chatPromise;

    expect(errored).toBeNull();
    expect(completed).toBe(true);
  });

  it("(f) unsubscribes from the lifecycle on completion, and a foreground event after settling does nothing", async () => {
    const clock = fakeClock();
    const fg = fakeLifecycle();
    const stream = resumableSseResponse({ generationId: "gen-ff" });
    const fetchMock = sequentialFetch([() => stream.response]);

    const client = new APIClient(BASE_URL, fetchMock as unknown as FetchImpl, {
      sleep: clock.sleep,
      now: clock.now,
      lifecycle: fg.lifecycle,
    });
    client.setToken("t");

    let completed = false;

    const chatPromise = client.chat(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      {
        onEvent: () => {},
        onError: () => {},
        onComplete: () => {
          completed = true;
        },
      }
    );

    await waitFor(() => fetchMock.calls.length >= 1, "initial chat request");
    expect(fg.subscriberCount()).toBe(1);

    stream.push(
      sseEvent("gen-ff-1", "done", {
        status: "complete",
        model: "m",
        eval_count: 0,
        tokens_per_second: 0,
      })
    );

    await chatPromise;

    expect(completed).toBe(true);
    expect(fg.subscriberCount()).toBe(0); // unsubscribed once settled

    // A foreground event after settling does nothing (no new request).
    fg.fireForeground();
    await flush();
    expect(fetchMock.calls.length).toBe(1);
  });

  it("(f2) unsubscribes from the lifecycle on the onError path too", async () => {
    const clock = fakeClock();
    const fg = fakeLifecycle();
    const stream = resumableSseResponse({ generationId: "gen-ff2" });
    const fetchMock = sequentialFetch([() => stream.response]);

    const client = new APIClient(BASE_URL, fetchMock as unknown as FetchImpl, {
      sleep: clock.sleep,
      now: clock.now,
      lifecycle: fg.lifecycle,
    });
    client.setToken("t");

    const thrown = new Error("boom: onEvent callback failed");
    let errored: Error | null = null;

    const chatPromise = client.chat(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      {
        onEvent: () => {
          throw thrown;
        },
        onError: (error) => {
          errored = error;
        },
        onComplete: () => {},
      }
    );

    await waitFor(() => fetchMock.calls.length >= 1, "initial chat request");
    expect(fg.subscriberCount()).toBe(1);

    stream.push(sseEvent("gen-ff2-1", "content", { text: "x" }));

    await chatPromise;

    expect(errored as Error | null).toBe(thrown);
    expect(fg.subscriberCount()).toBe(0); // unsubscribed on the error path too
  });

  it("(g) foreground events never POST /cancel and never abort the caller's own signal", async () => {
    const clock = fakeClock();
    const fg = fakeLifecycle();
    const callerAbort = new AbortController();
    const streams: Array<ReturnType<typeof resumableSseResponse>> = [];

    const fetchMock = dynamicFetch((_callIndex, _url, init) => {
      const stream = resumableSseResponse({
        generationId: "gen-fg",
        signal: init?.signal ?? null,
      });
      streams.push(stream);
      return stream.response;
    });

    const client = new APIClient(BASE_URL, fetchMock as unknown as FetchImpl, {
      sleep: clock.sleep,
      now: clock.now,
      lifecycle: fg.lifecycle,
    });
    client.setToken("t");

    let completed = false;

    const chatPromise = client.chat(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      {
        onEvent: () => {},
        onError: () => {},
        onComplete: () => {
          completed = true;
        },
        signal: callerAbort.signal,
      }
    );

    await waitFor(() => streams.length >= 1, "initial chat request");
    fg.fireForeground();
    await waitFor(() => streams.length >= 2, "resume GET after foreground");

    expect(callerAbort.signal.aborted).toBe(false);
    expect(fetchMock.calls.some((c) => c.url.includes("/cancel"))).toBe(false);

    streams[1]!.push(
      sseEvent("gen-fg-1", "done", {
        status: "complete",
        model: "m",
        eval_count: 0,
        tokens_per_second: 0,
      })
    );

    await chatPromise;

    expect(completed).toBe(true);
    expect(callerAbort.signal.aborted).toBe(false);
    expect(fetchMock.calls.some((c) => c.url.includes("/cancel"))).toBe(false);
  });

  it("(h) user Stop after a foreground resume ends the reply with no further requests", async () => {
    const clock = fakeClock();
    const fg = fakeLifecycle();
    const callerAbort = new AbortController();
    const streams: Array<ReturnType<typeof resumableSseResponse>> = [];

    const fetchMock = dynamicFetch((_callIndex, _url, init) => {
      const stream = resumableSseResponse({
        generationId: "gen-fh",
        signal: init?.signal ?? null,
      });
      streams.push(stream);
      return stream.response;
    });

    const client = new APIClient(BASE_URL, fetchMock as unknown as FetchImpl, {
      sleep: clock.sleep,
      now: clock.now,
      lifecycle: fg.lifecycle,
    });
    client.setToken("t");

    let completed = false;
    let errored: Error | null = null;

    const chatPromise = client.chat(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      {
        onEvent: () => {},
        onError: (error) => {
          errored = error;
        },
        onComplete: () => {
          completed = true;
        },
        signal: callerAbort.signal,
      }
    );

    await waitFor(() => streams.length >= 1, "initial chat request");
    fg.fireForeground();
    await waitFor(() => streams.length >= 2, "resume GET after foreground");

    // Stop is pressed while the foreground-triggered resume is in flight
    // (its response has arrived; the reader is now pending).
    callerAbort.abort();

    await chatPromise;

    expect(errored).toBeNull();
    expect(completed).toBe(true);
    expect(fetchMock.calls.length).toBe(2); // no further requests after Stop
  });

  it("(i) two foreground events during a pending resume fetch still result in exactly one transport", async () => {
    const clock = fakeClock();
    const fg = fakeLifecycle();
    let initial: ReturnType<typeof resumableSseResponse>;

    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let resolveResumeFetch: ((response: Response) => void) | null = null;

    const fetchMock = mock(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (calls.length === 1) {
        initial = resumableSseResponse({
          generationId: "gen-fi",
          signal: init?.signal ?? null,
        });
        return initial.response;
      }
      return new Promise<Response>((resolve) => {
        resolveResumeFetch = resolve;
      });
    });

    const client = new APIClient(BASE_URL, fetchMock as unknown as FetchImpl, {
      sleep: clock.sleep,
      now: clock.now,
      lifecycle: fg.lifecycle,
    });
    client.setToken("t");

    let completed = false;

    const chatPromise = client.chat(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      {
        onEvent: () => {},
        onError: () => {},
        onComplete: () => {
          completed = true;
        },
      }
    );

    await waitFor(() => calls.length >= 1, "initial chat request");
    fg.fireForeground(); // triggers the (only) resume fetch
    await waitFor(() => calls.length >= 2, "resume GET issued");
    expect(calls.length).toBe(2);

    // Two more foreground events while that fetch is still pending.
    fg.fireForeground();
    fg.fireForeground();
    await flush();
    expect(calls.length).toBe(2); // still only one transport in flight

    const resumed = resumableSseResponse({ generationId: "gen-fi" });
    resolveResumeFetch!(resumed.response);

    resumed.push(
      sseEvent("gen-fi-1", "done", {
        status: "complete",
        model: "m",
        eval_count: 0,
        tokens_per_second: 0,
      })
    );

    await chatPromise;

    expect(completed).toBe(true);
    expect(calls.length).toBe(2);
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
