/**
 * Behavioural tests for the send/stop logic (F2, F3), against a fake fetch
 * and the real `APIClient` (no network). No React/React Native involved --
 * this is exactly what `chat.tsx` is meant to be thin wiring over.
 */

import { describe, it, expect, mock } from "bun:test";
import { APIClient } from "@/api/client";
import type { StreamEvent } from "@/api/client";
import {
  NO_MODEL_LOADED_MESSAGE,
  sendMessage,
  stopGeneration,
} from "./chatController";

function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

const BASE_URL = "https://ryans-mac-studio.tailc3648a.ts.net:8443";

function stateResponse(
  resident: { name: string } | null,
  models: Array<{ name: string; size_bytes: number; tools: boolean }> = [],
  deepResearchModel?: string
): Response {
  return new Response(
    JSON.stringify({
      ...(deepResearchModel === undefined ? {} : { deep_research_model: deepResearchModel }),
      models,
      resident: resident ? { name: resident.name, loaded_by_server: true } : null,
      operation: { kind: "idle" },
      generation: null,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

/**
 * An SSE response whose body is delivered chunk by chunk via the returned
 * `push`, so a test can drive events in and assert in between them.
 */
function controlledSseResponse(generationId: string): {
  response: Response;
  push: (chunk: string) => void;
  close: () => void;
} {
  const encoder = new TextEncoder();
  let controllerRef!: ReadableStreamDefaultController<Uint8Array>;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
    },
  });

  const response = new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "x-generation-id": generationId,
    },
  });

  return {
    response,
    push: (chunk: string) => controllerRef.enqueue(encoder.encode(chunk)),
    close: () => controllerRef.close(),
  };
}

function newCallbacks() {
  const events: StreamEvent[] = [];
  let started: string | null = null;
  let blocked: string | null = null;
  let errored: Error | null = null;
  let completed = false;
  let unauthorizedCount = 0;

  return {
    events,
    get started() {
      return started;
    },
    get blocked() {
      return blocked;
    },
    get errored() {
      return errored;
    },
    get completed() {
      return completed;
    },
    get unauthorizedCount() {
      return unauthorizedCount;
    },
    callbacks: {
      onStart: (id: string) => {
        started = id;
      },
      onEvent: (event: StreamEvent) => events.push(event),
      onBlocked: (message: string) => {
        blocked = message;
      },
      onError: (error: Error) => {
        errored = error;
      },
      onComplete: () => {
        completed = true;
      },
      onUnauthorized: () => {
        unauthorizedCount += 1;
      },
    },
  };
}

describe("sendMessage (F2: model attribution)", () => {
  it("sends to the resident model reported by GET /v1/state", async () => {
    const calls: Array<{ url: string; body?: string }> = [];

    const fetchMock = mock(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string | undefined });
      if (url.endsWith("/v1/state")) {
        return stateResponse({ name: "llama3" });
      }
      if (url.endsWith("/v1/chat")) {
        const stream = controlledSseResponse("gen-1");
        stream.push(
          "event: done\ndata: {\"status\":\"complete\",\"model\":\"llama3\",\"eval_count\":1,\"tokens_per_second\":1}\n\n"
        );
        stream.close();
        return stream.response;
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    const result = newCallbacks();
    await sendMessage(
      client,
      [{ role: "user", content: "hi" }],
      result.callbacks
    );

    expect(result.blocked).toBeNull();
    expect(result.errored).toBeNull();
    expect(result.started).toBe("gen-1");
    expect(result.completed).toBe(true);

    const chatCall = calls.find((c) => c.url.endsWith("/v1/chat"));
    expect(chatCall).toBeDefined();
    const sentBody = JSON.parse(chatCall!.body!);
    expect(sentBody.model).toBe("llama3");
  });

  it("sends web:true only when callbacks.web is true, else no web key", async () => {
    async function bodyFor(
      web?: boolean,
      models: Array<{ name: string; size_bytes: number; tools: boolean }> = [
        { name: "llama3", size_bytes: 1, tools: true },
      ]
    ): Promise<Record<string, unknown>> {
      let body = "";
      const fetchMock = mock(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/v1/state")) {
          return stateResponse({ name: "llama3" }, models);
        }
        body = init?.body as string;
        const stream = controlledSseResponse("gen-1");
        stream.push(
          "event: done\ndata: {\"status\":\"complete\",\"model\":\"llama3\",\"eval_count\":1,\"tokens_per_second\":1}\n\n"
        );
        stream.close();
        return stream.response;
      });
      const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
      client.setToken("t");
      const result = newCallbacks();
      await sendMessage(client, [{ role: "user", content: "hi" }], {
        ...result.callbacks,
        ...(web === undefined ? {} : { web }),
      });
      return JSON.parse(body);
    }

    expect((await bodyFor(true)).web).toBe(true);
    expect("web" in (await bodyFor())).toBe(false);
    expect("web" in (await bodyFor(false))).toBe(false);

    // Requested but the resident lacks tools, or is not in the model list:
    // no web key (FR18).
    const noTools = [{ name: "llama3", size_bytes: 1, tools: false }];
    expect("web" in (await bodyFor(true, noTools))).toBe(false);
    expect("web" in (await bodyFor(true, []))).toBe(false);
  });

  it("blocks sending and makes no /v1/chat request when no model is resident", async () => {
    const calls: string[] = [];

    const fetchMock = mock(async (url: string) => {
      calls.push(url);
      if (url.endsWith("/v1/state")) {
        return stateResponse(null);
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    const result = newCallbacks();
    await sendMessage(
      client,
      [{ role: "user", content: "hi" }],
      result.callbacks
    );

    expect(result.blocked).toBe(NO_MODEL_LOADED_MESSAGE);
    expect(result.errored).toBeNull();
    expect(result.started).toBeNull();
    expect(calls.some((url) => url.endsWith("/v1/chat"))).toBe(false);
  });

  it("blocks sending when the resident model is unloaded between GET /v1/state and POST /v1/chat (409 model_not_resident)", async () => {
    const fetchMock = mock(async (url: string) => {
      if (url.endsWith("/v1/state")) {
        return stateResponse({ name: "llama3" });
      }
      if (url.endsWith("/v1/chat")) {
        return new Response(
          JSON.stringify({
            error: "model_not_resident",
            message: "Model \"llama3\" is not loaded; load it first",
          }),
          { status: 409, headers: { "Content-Type": "application/json" } }
        );
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    const result = newCallbacks();
    await sendMessage(
      client,
      [{ role: "user", content: "hi" }],
      result.callbacks
    );

    expect(result.blocked).toBe(NO_MODEL_LOADED_MESSAGE);
    expect(result.errored).toBeNull();
    expect(result.started).toBeNull();
  });
});

describe("sendMessage (FR13: 401 routes to onUnauthorized, not onError)", () => {
  it("a 401 from GET /v1/state calls onUnauthorized once, not onError, and makes no POST /v1/chat request", async () => {
    const calls: string[] = [];

    const fetchMock = mock(async (url: string) => {
      calls.push(url);
      if (url.endsWith("/v1/state")) {
        return unauthorizedResponse();
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("wrong-token");

    const result = newCallbacks();
    await sendMessage(
      client,
      [{ role: "user", content: "hi" }],
      result.callbacks
    );

    expect(result.unauthorizedCount).toBe(1);
    expect(result.errored).toBeNull();
    expect(result.blocked).toBeNull();
    expect(calls.some((url) => url.endsWith("/v1/chat"))).toBe(false);
  });

  it("a 401 from POST /v1/chat calls onUnauthorized once and does not call onError", async () => {
    const fetchMock = mock(async (url: string) => {
      if (url.endsWith("/v1/state")) {
        return stateResponse({ name: "llama3" });
      }
      if (url.endsWith("/v1/chat")) {
        return unauthorizedResponse();
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("wrong-token");

    const result = newCallbacks();
    await sendMessage(
      client,
      [{ role: "user", content: "hi" }],
      result.callbacks
    );

    expect(result.unauthorizedCount).toBe(1);
    expect(result.errored).toBeNull();
    expect(result.blocked).toBeNull();
  });

  it("a non-401 failure (500 from GET /v1/state) still calls onError and not onUnauthorized", async () => {
    const fetchMock = mock(async (url: string) => {
      if (url.endsWith("/v1/state")) {
        return new Response("Internal Server Error", { status: 500 });
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    const result = newCallbacks();
    await sendMessage(
      client,
      [{ role: "user", content: "hi" }],
      result.callbacks
    );

    expect(result.errored).not.toBeNull();
    expect(result.unauthorizedCount).toBe(0);
  });
});

describe("stopGeneration (F3: Stop cancels without aborting the fetch)", () => {
  it("POSTs cancel with the right id; the stream keeps reading to the terminal cancelled event; no content applied after it", async () => {
    let stream!: ReturnType<typeof controlledSseResponse>;
    const requests: Array<{ url: string; method?: string }> = [];

    const fetchMock = mock(async (url: string, init?: RequestInit) => {
      requests.push({ url, method: init?.method });
      if (url.endsWith("/v1/state")) {
        return stateResponse({ name: "llama3" });
      }
      if (url.endsWith("/v1/chat")) {
        stream = controlledSseResponse("gen-7");
        return stream.response;
      }
      if (url.endsWith("/v1/generations/gen-7/cancel")) {
        return new Response(JSON.stringify({ status: "cancelled" }), {
          status: 200,
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    const result = newCallbacks();
    const sendPromise = sendMessage(
      client,
      [{ role: "user", content: "hi" }],
      result.callbacks
    );

    // Let the state lookup and the chat POST resolve, and the generation id
    // arrive via onStart, before any tokens are streamed. This is two
    // sequential awaited fetches (GET /v1/state, then POST /v1/chat) before
    // `onStart` fires, so a fixed number of microtask ticks is fragile;
    // waiting for a macrotask tick flushes all of them deterministically.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.started).toBe("gen-7");

    stream.push("event: content\ndata: {\"text\":\"partial\"}\n\n");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.events).toHaveLength(1);

    // Stop is pressed: cancel is POSTed for the id from onStart. The fetch
    // itself is never aborted.
    await stopGeneration(client, result.started!);

    const cancelRequest = requests.find((r) =>
      r.url.endsWith("/v1/generations/gen-7/cancel")
    );
    expect(cancelRequest).toBeDefined();
    expect(cancelRequest!.method).toBe("POST");

    // The stream is still open after cancel: it keeps reading until the
    // server sends the terminal cancelled event and closes it.
    expect(result.completed).toBe(false);

    stream.push(
      "event: done\ndata: {\"status\":\"cancelled\",\"model\":\"llama3\",\"eval_count\":1,\"tokens_per_second\":1}\n\n"
    );
    stream.close();

    await sendPromise;

    expect(result.completed).toBe(true);
    expect(result.errored).toBeNull();
    expect(result.events.map((e) => e.type)).toEqual(["content", "done"]);
    expect(result.events[1]).toMatchObject({
      type: "done",
      data: { status: "cancelled" },
    });
  });
});

describe("sendMessage: deep research (M18)", () => {
  const DR = "some-other:7b";

  async function run(opts: {
    deepResearch?: boolean;
    web?: boolean;
    resident?: string | null;
    tools?: boolean;
    deepModel?: string;
  }) {
    const chatBodies: Array<Record<string, unknown>> = [];
    const resident = opts.resident === undefined ? DR : opts.resident;
    const fetchMock = mock(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/state")) {
        return stateResponse(
          resident ? { name: resident } : null,
          resident ? [{ name: resident, size_bytes: 1, tools: opts.tools ?? true }] : [],
          opts.deepModel ?? DR
        );
      }
      chatBodies.push(JSON.parse(init?.body as string));
      const stream = controlledSseResponse("gen-1");
      stream.push(
        "event: done\ndata: {\"status\":\"complete\",\"model\":\"x\",\"eval_count\":1,\"tokens_per_second\":1}\n\n"
      );
      stream.close();
      return stream.response;
    });
    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");
    const result = newCallbacks();
    await sendMessage(client, [{ role: "user", content: "hi" }], {
      ...result.callbacks,
      ...(opts.web === undefined ? {} : { web: opts.web }),
      ...(opts.deepResearch === undefined ? {} : { deepResearch: opts.deepResearch }),
    });
    return { chatBodies, result };
  }

  it("sends web:true and deep_research:true when the resident is the deep research model", async () => {
    const { chatBodies, result } = await run({ deepResearch: true, web: true });
    expect(chatBodies).toEqual([
      { model: DR, messages: [{ role: "user", content: "hi" }], web: true, deep_research: true },
    ]);
    expect(result.blocked).toBeNull();
  });

  it("blocks with the load explanation, and makes no chat request, for another model", async () => {
    const { chatBodies, result } = await run({ deepResearch: true, web: true, resident: "llama3" });
    expect(chatBodies).toHaveLength(0);
    expect(result.blocked).toBe(`Load ${DR} to use deep research`);
  });

  it("blocks with the load explanation when no model is resident", async () => {
    const { chatBodies, result } = await run({ deepResearch: true, web: true, resident: null });
    expect(chatBodies).toHaveLength(0);
    expect(result.blocked).toBe(`Load ${DR} to use deep research`);
  });

  it("blocks when web is not on, or the resident has no tools", async () => {
    const noWeb = await run({ deepResearch: true, web: false });
    expect(noWeb.chatBodies).toHaveLength(0);
    expect(noWeb.result.blocked).toBe("Deep research needs web search to be on.");
    const noWebKey = await run({ deepResearch: true });
    expect(noWebKey.chatBodies).toHaveLength(0);
    const noTools = await run({ deepResearch: true, web: true, tools: false });
    expect(noTools.chatBodies).toHaveLength(0);
    expect(noTools.result.blocked).toBe(`Load ${DR} to use deep research`);
  });

  it("is unchanged when deepResearch is false or absent", async () => {
    expect((await run({ web: true })).chatBodies).toEqual([
      { model: DR, messages: [{ role: "user", content: "hi" }], web: true },
    ]);
    const off = await run({ deepResearch: false, web: true });
    expect("deep_research" in off.chatBodies[0]).toBe(false);
  });
});
