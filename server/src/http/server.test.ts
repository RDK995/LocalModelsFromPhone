import { describe, it, expect } from "bun:test";
import { createServer, setValidToken, getValidToken, type OllamaStateClient } from "./server";
import type {
  OllamaChatRequest,
  OllamaChatResponse,
  OllamaTagsResponse,
  OllamaPsResponse,
} from "../ollama/client";
import { OllamaClient } from "../ollama/client";

type ChatImpl = (
  request: OllamaChatRequest,
  signal?: AbortSignal
) => AsyncGenerator<OllamaChatResponse, void, unknown>;

/**
 * Fake Ollama client injected into createServer so tests never touch a real
 * Ollama instance. `chatImpl` drives the SSE stream; `tags`/`ps` are
 * overridable for /v1/state tests.
 */
class FakeOllamaClient implements OllamaStateClient {
  /** Overridable per test to hold or fail a load/unload mid-flight. */
  loadImpl: (name: string) => Promise<void> = async () => {};
  unloadImpl: (name: string) => Promise<void> = async () => {};

  constructor(
    private chatImpl: ChatImpl,
    private tagsResponse: OllamaTagsResponse = { models: [] },
    private psResponse: OllamaPsResponse = residentPs("fake-model")
  ) {}

  async tags(): Promise<OllamaTagsResponse> {
    return this.tagsResponse;
  }

  async ps(): Promise<OllamaPsResponse> {
    return this.psResponse;
  }

  async load(name: string): Promise<void> {
    await this.loadImpl(name);
  }

  async unload(name: string): Promise<void> {
    await this.unloadImpl(name);
  }

  chat(
    request: OllamaChatRequest,
    signal?: AbortSignal
  ): AsyncGenerator<OllamaChatResponse, void, unknown> {
    return this.chatImpl(request, signal);
  }
}

/** An Ollama ps() response reporting `name` as the single resident model. */
function residentPs(name: string): OllamaPsResponse {
  return {
    models: [
      {
        name,
        model: name,
        size: 1,
        digest: "d",
        details: { family: "", parameter_size: "", quantization_level: "" },
        expires_at: "",
        size_vram: 0,
      },
    ],
  };
}

function chunk(content: string, done: boolean): OllamaChatResponse {
  return {
    model: "fake-model",
    created_at: new Date().toISOString(),
    message: { role: "assistant", content },
    done,
    total_duration: 0,
    load_duration: 0,
    prompt_eval_count: 0,
    prompt_eval_duration: 0,
    eval_count: done ? 1 : 0,
    eval_duration: 0,
  };
}

/** A chat implementation that yields `count` content chunks then a done chunk. */
function completingChat(count: number): ChatImpl {
  return async function* () {
    for (let i = 0; i < count; i++) {
      yield chunk(`token-${i}`, false);
    }
    yield chunk("", true);
  };
}

/**
 * A chat implementation that yields one content chunk, then hangs until the
 * given AbortSignal fires, at which point it rejects (mirroring a real fetch
 * being aborted mid-stream).
 */
function abortAwareChat(): ChatImpl {
  return async function* (_request, signal) {
    yield chunk("token-0", false);
    await new Promise<void>((_resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
    });
  };
}

const CHAT_REQUEST_BODY = JSON.stringify({
  model: "fake-model",
  messages: [{ role: "user", content: "hello" }],
});

function authHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Parse concatenated SSE wire text into { id, event, data } records. Comment
 * lines (starting with ":") are ignored, as the SSE spec requires.
 */
function parseSSE(text: string): Array<{ id: string; event: string; data: string }> {
  return text
    .split("\n\n")
    .map((block) =>
      block
        .split("\n")
        .filter((line) => !line.startsWith(":"))
        .join("\n")
    )
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      const lines = block.split("\n");
      const id = lines.find((l) => l.startsWith("id: "))?.slice(4) ?? "";
      const event = lines.find((l) => l.startsWith("event: "))?.slice(7) ?? "";
      const data = lines.find((l) => l.startsWith("data: "))?.slice(6) ?? "";
      return { id, event, data };
    });
}

describe("HTTP Server with Bearer Auth", () => {
  it("should allow setting and getting valid token", () => {
    const testToken = "test-token-12345";
    setValidToken(testToken);
    expect(getValidToken()).toBe(testToken);
  });

  it("should be able to create a server instance bound to a spare port", () => {
    const client = new FakeOllamaClient(completingChat(0));
    setValidToken("test-token");
    const server = createServer({ ollama: client, port: 0 });
    expect(server).toBeDefined();
    expect(server.hostname).toBe("127.0.0.1");
    expect(server.port).not.toBe(7789);
    server.stop();
  });

  it("should reject requests without bearer token", async () => {
    const client = new FakeOllamaClient(completingChat(0));
    const testToken = "secure-token-123";
    setValidToken(testToken);
    const server = createServer({ ollama: client, port: 0 });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/v1/state`, {
        method: "GET",
      });

      expect(response.status).toBe(401);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("unauthorized");
    } finally {
      server.stop();
    }
  });

  it("should reject requests with invalid bearer token", async () => {
    const client = new FakeOllamaClient(completingChat(0));
    const testToken = "valid-token";
    setValidToken(testToken);
    const server = createServer({ ollama: client, port: 0 });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/v1/state`, {
        method: "GET",
        headers: {
          Authorization: "Bearer invalid-token",
        },
      });

      expect(response.status).toBe(401);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("unauthorized");
    } finally {
      server.stop();
    }
  });

  it("should return 404 for non-existent routes", async () => {
    const client = new FakeOllamaClient(completingChat(0));
    const testToken = "test-token";
    setValidToken(testToken);
    const server = createServer({ ollama: client, port: 0 });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/v1/nonexistent`, {
        method: "GET",
        headers: authHeaders(testToken),
      });

      expect(response.status).toBe(404);
    } finally {
      server.stop();
    }
  });

  it("should enforce auth before routing 404", async () => {
    const client = new FakeOllamaClient(completingChat(0));
    const testToken = "test-token";
    setValidToken(testToken);
    const server = createServer({ ollama: client, port: 0 });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/v1/nonexistent`, {
        method: "GET",
        headers: {
          Authorization: "Bearer wrong-token",
        },
      });

      // Should be 401 (auth failure) before 404 (route not found)
      expect(response.status).toBe(401);
    } finally {
      server.stop();
    }
  });

  it("should require auth on every route (with no token and with a wrong token)", async () => {
    const client = new FakeOllamaClient(completingChat(0));
    const testToken = "test-token";
    setValidToken(testToken);
    const server = createServer({ ollama: client, port: 0 });

    try {
      const endpoints = [
        { method: "GET", path: "/v1/state" },
        { method: "POST", path: "/v1/models/load" },
        { method: "POST", path: "/v1/models/unload" },
        { method: "POST", path: "/v1/chat" },
        { method: "GET", path: "/v1/generations/test-id/events" },
        { method: "POST", path: "/v1/generations/test-id/cancel" },
      ];

      for (const endpoint of endpoints) {
        const noAuth = await fetch(`http://127.0.0.1:${server.port}${endpoint.path}`, {
          method: endpoint.method,
          headers: { "Content-Type": "application/json" },
        });
        expect(
          noAuth.status,
          `${endpoint.method} ${endpoint.path} without token did not return 401`
        ).toBe(401);

        const wrongAuth = await fetch(`http://127.0.0.1:${server.port}${endpoint.path}`, {
          method: endpoint.method,
          headers: authHeaders("wrong-token"),
        });
        expect(
          wrongAuth.status,
          `${endpoint.method} ${endpoint.path} with wrong token did not return 401`
        ).toBe(401);
      }
    } finally {
      server.stop();
    }
  });

  it("should support /v1/models/load endpoint", async () => {
    const client = new FakeOllamaClient(
      completingChat(0),
      { models: [{ name: "test-model", modified_at: "", size: 1, digest: "d" }] },
      { models: [] }
    );
    const testToken = "test-token";
    setValidToken(testToken);
    const server = createServer({ ollama: client, port: 0 });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/v1/models/load`, {
        method: "POST",
        headers: authHeaders(testToken),
        body: JSON.stringify({ name: "test-model" }),
      });

      expect(response.status).toBe(202);
    } finally {
      server.stop(true);
    }
  });

  it("should support /v1/models/unload endpoint", async () => {
    const client = new FakeOllamaClient(completingChat(0));
    const testToken = "test-token";
    setValidToken(testToken);
    const server = createServer({ ollama: client, port: 0 });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/v1/models/unload`, {
        method: "POST",
        headers: authHeaders(testToken),
        body: JSON.stringify({ confirm: true }),
      });

      expect(response.status).toBe(202);
    } finally {
      server.stop(true);
    }
  });

  it("/v1/state reports real models, resident state, and active generation", async () => {
    const client = new FakeOllamaClient(
      completingChat(0),
      { models: [{ name: "llama3", modified_at: "", size: 42, digest: "abc" }] },
      { models: [{ name: "llama3", model: "llama3", size: 42, digest: "abc", details: { family: "", parameter_size: "", quantization_level: "" }, expires_at: "", size_vram: 0 }] }
    );
    const testToken = "test-token";
    setValidToken(testToken);
    const server = createServer({ ollama: client, port: 0 });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/v1/state`, {
        method: "GET",
        headers: authHeaders(testToken),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        models: Array<{ name: string; size_bytes: number }>;
        resident: { name: string; loaded_by_server: boolean } | null;
        operation: { kind: string };
        generation: unknown;
      };
      expect(body.models).toEqual([{ name: "llama3", size_bytes: 42 }]);
      expect(body.resident).toEqual({ name: "llama3", loaded_by_server: false });
      expect(body.operation.kind).toBe("idle");
      expect(body.generation).toBeNull();
    } finally {
      server.stop();
    }
  });

  it("/v1/state reports resident:null when nothing is loaded", async () => {
    const client = new FakeOllamaClient(
      completingChat(0),
      { models: [{ name: "llama3", modified_at: "", size: 42, digest: "abc" }] },
      { models: [] }
    );
    const testToken = "test-token";
    setValidToken(testToken);
    const server = createServer({ ollama: client, port: 0 });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/v1/state`, {
        method: "GET",
        headers: authHeaders(testToken),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        resident: { name: string; loaded_by_server: boolean } | null;
      };
      expect(body.resident).toBeNull();
    } finally {
      server.stop();
    }
  });

  it("POST /v1/chat streams content events then a terminal complete event", async () => {
    const client = new FakeOllamaClient(completingChat(2));
    const testToken = "test-token";
    setValidToken(testToken);
    const server = createServer({ ollama: client, port: 0 });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/v1/chat`, {
        method: "POST",
        headers: authHeaders(testToken),
        body: CHAT_REQUEST_BODY,
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream");
      const genId = response.headers.get("x-generation-id");
      expect(genId).toBeTruthy();

      const text = await response.text();
      const events = parseSSE(text);

      expect(events.length).toBe(3);
      expect(events[0].event).toBe("content");
      expect(JSON.parse(events[0].data)).toEqual({ text: "token-0" });
      expect(events[1].event).toBe("content");
      expect(JSON.parse(events[1].data)).toEqual({ text: "token-1" });
      expect(events[2].event).toBe("done");
      const doneData = JSON.parse(events[2].data);
      expect(doneData.status).toBe("complete");
    } finally {
      server.stop();
    }
  });

  it("refuses a second concurrent chat with the contract's busy response", async () => {
    // First chat's generator hangs after its first chunk, so the generation
    // stays active until the test drains it.
    const client = new FakeOllamaClient(abortAwareChat());
    const testToken = "test-token";
    setValidToken(testToken);
    const server = createServer({ ollama: client, port: 0 });

    try {
      const first = await fetch(`http://127.0.0.1:${server.port}/v1/chat`, {
        method: "POST",
        headers: authHeaders(testToken),
        body: CHAT_REQUEST_BODY,
      });
      expect(first.status).toBe(200);
      const firstGenId = first.headers.get("x-generation-id")!;
      expect(firstGenId).toBeTruthy();

      const second = await fetch(`http://127.0.0.1:${server.port}/v1/chat`, {
        method: "POST",
        headers: authHeaders(testToken),
        body: CHAT_REQUEST_BODY,
      });
      expect(second.status).toBe(409);
      const secondBody = (await second.json()) as {
        error: string;
        generation_id: string;
      };
      expect(secondBody.error).toBe("generation_in_flight");
      expect(secondBody.generation_id).toBe(firstGenId);

      // Cancel the first so it terminates cleanly and its body can drain.
      await fetch(`http://127.0.0.1:${server.port}/v1/generations/${firstGenId}/cancel`, {
        method: "POST",
        headers: authHeaders(testToken),
      });
      await first.text();
    } finally {
      server.stop();
    }
  });

  it("cancel ends the stream with a cancelled terminal event and aborts Ollama", async () => {
    const client = new FakeOllamaClient(abortAwareChat());
    const testToken = "test-token";
    setValidToken(testToken);
    const server = createServer({ ollama: client, port: 0 });

    try {
      const chatResponse = await fetch(`http://127.0.0.1:${server.port}/v1/chat`, {
        method: "POST",
        headers: authHeaders(testToken),
        body: CHAT_REQUEST_BODY,
      });
      expect(chatResponse.status).toBe(200);
      const genId = chatResponse.headers.get("x-generation-id");
      expect(genId).toBeTruthy();

      const textPromise = chatResponse.text();

      const cancelResponse = await fetch(
        `http://127.0.0.1:${server.port}/v1/generations/${genId}/cancel`,
        { method: "POST", headers: authHeaders(testToken) }
      );
      expect(cancelResponse.status).toBe(200);
      const cancelBody = (await cancelResponse.json()) as { status: string };
      expect(cancelBody.status).toBe("cancelled");

      const text = await textPromise;
      const events = parseSSE(text);
      const last = events[events.length - 1];
      expect(last.event).toBe("done");
      const doneData = JSON.parse(last.data);
      expect(doneData.status).toBe("cancelled");
    } finally {
      server.stop();
    }
  });

  it("cancel of an unknown generation returns 404", async () => {
    const client = new FakeOllamaClient(completingChat(0));
    const testToken = "test-token";
    setValidToken(testToken);
    const server = createServer({ ollama: client, port: 0 });

    try {
      const response = await fetch(
        `http://127.0.0.1:${server.port}/v1/generations/never-started/cancel`,
        { method: "POST", headers: authHeaders(testToken) }
      );
      expect(response.status).toBe(404);
    } finally {
      server.stop();
    }
  });

  it("events endpoint resumes from a Last-Event-ID seq, replaying only later events", async () => {
    const client = new FakeOllamaClient(completingChat(3));
    const testToken = "test-token";
    setValidToken(testToken);
    const server = createServer({ ollama: client, port: 0 });

    try {
      const chatResponse = await fetch(`http://127.0.0.1:${server.port}/v1/chat`, {
        method: "POST",
        headers: authHeaders(testToken),
        body: CHAT_REQUEST_BODY,
      });
      const genId = chatResponse.headers.get("x-generation-id")!;
      // Drain the full stream so the event log is fully populated:
      // 3 content events (seq 0,1,2) + 1 done event (seq 3).
      await chatResponse.text();

      const resumeResponse = await fetch(
        `http://127.0.0.1:${server.port}/v1/generations/${genId}/events`,
        {
          method: "GET",
          headers: {
            ...authHeaders(testToken),
            "Last-Event-ID": `${genId}-1`,
          },
        }
      );
      expect(resumeResponse.status).toBe(200);
      const text = await resumeResponse.text();
      const events = parseSSE(text);

      // Resuming after seq 1 should replay only seq 2 (content) and seq 3 (done).
      expect(events.length).toBe(2);
      expect(events[0].id).toBe(`${genId}-2`);
      expect(events[0].event).toBe("content");
      expect(events[1].id).toBe(`${genId}-3`);
      expect(events[1].event).toBe("done");
    } finally {
      server.stop();
    }
  });

  it("events endpoint returns 404 for an unknown generation", async () => {
    const client = new FakeOllamaClient(completingChat(0));
    const testToken = "test-token";
    setValidToken(testToken);
    const server = createServer({ ollama: client, port: 0 });

    try {
      const response = await fetch(
        `http://127.0.0.1:${server.port}/v1/generations/never-started/events`,
        { method: "GET", headers: authHeaders(testToken) }
      );
      expect(response.status).toBe(404);
    } finally {
      server.stop();
    }
  });
});

/**
 * A chat implementation that yields one content chunk, then waits for
 * `release()` (or rejects if the AbortSignal fires first), then yields a second
 * content chunk and a done chunk. Once released, later calls do not wait.
 */
function gatedChat(): { impl: ChatImpl; release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const impl: ChatImpl = async function* (_request, signal) {
    yield chunk("token-0", false);
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      gate.then(resolve);
    });
    yield chunk("token-1", false);
    yield chunk("", true);
  };
  return { impl, release };
}

async function getState(port: number | undefined, token: string): Promise<{ generation: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}/v1/state`, { headers: authHeaders(token) });
  expect(res.status).toBe(200);
  return (await res.json()) as { generation: unknown };
}

/** Poll `predicate` every 20ms until it is true or `timeoutMs` elapses. */
async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() >= deadline) return false;
    await Bun.sleep(20);
  }
}

/** Start a chat, read until its first content event, then abort the client fetch. */
async function chatThenDisconnect(port: number | undefined, token: string): Promise<string> {
  const controller = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}/v1/chat`, {
    method: "POST",
    headers: authHeaders(token),
    body: CHAT_REQUEST_BODY,
    signal: controller.signal,
  });
  expect(res.status).toBe(200);
  const genId = res.headers.get("x-generation-id")!;
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let received = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    received += decoder.decode(value, { stream: true });
    if (received.includes("token-0")) break;
  }
  expect(received).toContain("token-0");
  controller.abort();
  await reader.cancel().catch(() => {});
  return genId;
}

describe("Generation lifecycle survives client disconnect (F4)", () => {
  it("a client abort mid-stream does not cancel the reply; it completes and the server accepts a new chat", async () => {
    const gated = gatedChat();
    const client = new FakeOllamaClient(gated.impl);
    const token = "test-token";
    setValidToken(token);
    const server = createServer({ ollama: client, port: 0 });

    try {
      const genId = await chatThenDisconnect(server.port, token);

      // A dropped connection must not cancel the generation (FR11).
      await Bun.sleep(100);
      const during = await getState(server.port, token);
      expect(during.generation).toEqual({ id: genId, model: "fake-model" });

      gated.release();
      const cleared = await waitUntil(
        async () => (await getState(server.port, token)).generation === null
      );
      expect(cleared).toBe(true);

      // The full reply is still in the log for resume.
      const replay = await fetch(`http://127.0.0.1:${server.port}/v1/generations/${genId}/events`, {
        headers: authHeaders(token),
      });
      const replayed = parseSSE(await replay.text());
      expect(replayed.map((e) => e.event)).toEqual(["content", "content", "done"]);
      expect(JSON.parse(replayed[2].data).status).toBe("complete");

      const next = await fetch(`http://127.0.0.1:${server.port}/v1/chat`, {
        method: "POST",
        headers: authHeaders(token),
        body: CHAT_REQUEST_BODY,
      });
      expect(next.status).toBe(200);
      const events = parseSSE(await next.text());
      expect(events[events.length - 1].event).toBe("done");
    } finally {
      server.stop(true);
    }
  });

  it("after a client abort, cancel stops the Ollama request and frees the server", async () => {
    let aborted = false;
    const impl: ChatImpl = async function* (request, signal) {
      signal?.addEventListener("abort", () => {
        aborted = true;
      });
      yield* abortAwareChat()(request, signal);
    };
    const client = new FakeOllamaClient(impl);
    const token = "test-token";
    setValidToken(token);
    const server = createServer({ ollama: client, port: 0 });

    try {
      const genId = await chatThenDisconnect(server.port, token);

      const cancel = await fetch(`http://127.0.0.1:${server.port}/v1/generations/${genId}/cancel`, {
        method: "POST",
        headers: authHeaders(token),
      });
      expect(cancel.status).toBe(200);
      expect(((await cancel.json()) as { status: string }).status).toBe("cancelled");

      const cleared = await waitUntil(
        async () => (await getState(server.port, token)).generation === null
      );
      expect(cleared).toBe(true);
      expect(aborted).toBe(true);

      const next = await fetch(`http://127.0.0.1:${server.port}/v1/chat`, {
        method: "POST",
        headers: authHeaders(token),
        body: CHAT_REQUEST_BODY,
      });
      expect(next.status).toBe(200);
      const nextId = next.headers.get("x-generation-id")!;
      await fetch(`http://127.0.0.1:${server.port}/v1/generations/${nextId}/cancel`, {
        method: "POST",
        headers: authHeaders(token),
      });
      await next.text();
    } finally {
      server.stop(true);
    }
  });

  it("cancel while a subscriber keeps reading ends with done cancelled and clears the generation", async () => {
    const client = new FakeOllamaClient(abortAwareChat());
    const token = "test-token";
    setValidToken(token);
    const server = createServer({ ollama: client, port: 0 });

    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/v1/chat`, {
        method: "POST",
        headers: authHeaders(token),
        body: CHAT_REQUEST_BODY,
      });
      const genId = res.headers.get("x-generation-id")!;
      const textPromise = res.text();

      const cancel = await fetch(`http://127.0.0.1:${server.port}/v1/generations/${genId}/cancel`, {
        method: "POST",
        headers: authHeaders(token),
      });
      expect(cancel.status).toBe(200);

      const events = parseSSE(await textPromise);
      const last = events[events.length - 1];
      expect(last.event).toBe("done");
      expect(JSON.parse(last.data).status).toBe("cancelled");
      expect((await getState(server.port, token)).generation).toBeNull();
    } finally {
      server.stop(true);
    }
  });

  it("events endpoint replays after Last-Event-ID then goes live until the terminal event", async () => {
    const gated = gatedChat();
    const client = new FakeOllamaClient(gated.impl);
    const token = "test-token";
    setValidToken(token);
    const server = createServer({ ollama: client, port: 0 });

    try {
      const genId = await chatThenDisconnect(server.port, token);

      const resume = await fetch(`http://127.0.0.1:${server.port}/v1/generations/${genId}/events`, {
        headers: { ...authHeaders(token), "Last-Event-ID": `${genId}-0` },
      });
      expect(resume.status).toBe(200);
      const textPromise = resume.text();
      await Bun.sleep(50);
      gated.release();

      const events = parseSSE(await textPromise);
      expect(events.map((e) => e.id)).toEqual([`${genId}-1`, `${genId}-2`]);
      expect(events.map((e) => e.event)).toEqual(["content", "done"]);
      expect(JSON.parse(events[0].data)).toEqual({ text: "token-1" });
    } finally {
      server.stop(true);
    }
  });
});

describe("Explicit Ollama chat request (F7) and stats (F11)", () => {
  /** A fake Ollama HTTP server on port 0 that records /api/chat bodies. */
  function fakeOllamaHttp(resident: string[]) {
    const chatBodies: unknown[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (req) => {
        const path = new URL(req.url).pathname;
        if (path === "/api/tags") {
          return Response.json({ models: [] });
        }
        if (path === "/api/ps") {
          return Response.json({ models: resident.flatMap((name) => residentPs(name).models) });
        }
        if (path === "/api/chat") {
          chatBodies.push(await req.json());
          const lines = [
            { model: "m", created_at: "", message: { role: "assistant", content: "hi" }, done: false },
            {
              model: "m",
              created_at: "",
              message: { role: "assistant", content: "" },
              done: true,
              eval_count: 10,
              eval_duration: 2_000_000_000,
            },
          ];
          return new Response(lines.map((l) => JSON.stringify(l)).join("\n") + "\n", {
            headers: { "Content-Type": "application/x-ndjson" },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    return { server, chatBodies };
  }

  it("sends Ollama exactly {model, messages, keep_alive:-1, stream:true} and reports Ollama's eval stats", async () => {
    const fake = fakeOllamaHttp(["llama3"]);
    const token = "test-token";
    setValidToken(token);
    const server = createServer({
      ollama: new OllamaClient(`http://127.0.0.1:${fake.server.port}`),
      port: 0,
    });

    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/v1/chat`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          model: "llama3",
          messages: [
            { role: "user", content: "hello", images: ["x"] },
            { role: "assistant", content: "hi" },
          ],
          keep_alive: 5,
          options: { num_ctx: 99 },
          format: "json",
          stream: false,
        }),
      });
      expect(res.status).toBe(200);
      const events = parseSSE(await res.text());

      expect(fake.chatBodies).toEqual([
        {
          model: "llama3",
          messages: [
            { role: "user", content: "hello" },
            { role: "assistant", content: "hi" },
          ],
          keep_alive: -1,
          stream: true,
        },
      ]);

      const done = JSON.parse(events[events.length - 1].data);
      expect(done).toEqual({
        status: "complete",
        model: "llama3",
        eval_count: 10,
        tokens_per_second: 5,
      });
    } finally {
      server.stop(true);
      fake.server.stop(true);
    }
  });

  it("returns 409 model_not_resident when the model is not in ps(), without calling Ollama chat", async () => {
    const fake = fakeOllamaHttp(["other-model"]);
    const token = "test-token";
    setValidToken(token);
    const server = createServer({
      ollama: new OllamaClient(`http://127.0.0.1:${fake.server.port}`),
      port: 0,
    });

    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/v1/chat`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ model: "llama3", messages: [{ role: "user", content: "hello" }] }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string; message: string };
      expect(body.error).toBe("model_not_resident");
      expect(typeof body.message).toBe("string");
      expect(fake.chatBodies).toEqual([]);
      expect((await getState(server.port, token)).generation).toBeNull();
    } finally {
      server.stop(true);
      fake.server.stop(true);
    }
  });

  it("rejects invalid chat bodies with 400 bad_request", async () => {
    const client = new FakeOllamaClient(completingChat(1));
    const token = "test-token";
    setValidToken(token);
    const server = createServer({ ollama: client, port: 0 });

    const invalid: Array<[string, string]> = [
      ["malformed JSON", "{not json"],
      ["missing model", JSON.stringify({ messages: [{ role: "user", content: "x" }] })],
      ["non-string model", JSON.stringify({ model: 3, messages: [{ role: "user", content: "x" }] })],
      ["non-array messages", JSON.stringify({ model: "fake-model", messages: "hello" })],
      ["bad role", JSON.stringify({ model: "fake-model", messages: [{ role: "system", content: "x" }] })],
      ["non-string content", JSON.stringify({ model: "fake-model", messages: [{ role: "user", content: 5 }] })],
      ["non-object message", JSON.stringify({ model: "fake-model", messages: ["hello"] })],
      ["non-object body", JSON.stringify(["fake-model"])],
    ];

    try {
      for (const [label, body] of invalid) {
        const res = await fetch(`http://127.0.0.1:${server.port}/v1/chat`, {
          method: "POST",
          headers: authHeaders(token),
          body,
        });
        expect(res.status, label).toBe(400);
        const json = (await res.json()) as { error: string; message: string };
        expect(json.error, label).toBe("bad_request");
        expect(typeof json.message, label).toBe("string");
      }
      expect((await getState(server.port, token)).generation).toBeNull();
    } finally {
      server.stop(true);
    }
  });
});

describe("Bearer comparison (F9)", () => {
  it("rejects a token that is a prefix, extension or case variant of the valid token", async () => {
    const client = new FakeOllamaClient(completingChat(0));
    setValidToken("valid-token");
    const server = createServer({ ollama: client, port: 0 });

    try {
      for (const candidate of ["valid-toke", "valid-token-extra", "valid-tokeN", ""]) {
        const res = await fetch(`http://127.0.0.1:${server.port}/v1/state`, {
          headers: { Authorization: `Bearer ${candidate}` },
        });
        expect(res.status, candidate).toBe(401);
      }
      const ok = await fetch(`http://127.0.0.1:${server.port}/v1/state`, {
        headers: authHeaders("valid-token"),
      });
      expect(ok.status).toBe(200);
    } finally {
      server.stop(true);
    }
  });
});

describe("Model load/unload operations (M2b)", () => {
  it("POST /v1/models/load returns 202 {operation:{kind:'loading',model}}", async () => {
    const client = new FakeOllamaClient(
      completingChat(0),
      { models: [{ name: "llama3", modified_at: "", size: 1, digest: "d" }] },
      { models: [] }
    );
    const token = "test-token";
    setValidToken(token);
    const server = createServer({ ollama: client, port: 0 });

    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/v1/models/load`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ name: "llama3" }),
      });
      expect(res.status).toBe(202);
      const body = (await res.json()) as { operation: { kind: string; model?: string } };
      expect(body.operation).toEqual({ kind: "loading", model: "llama3" });
    } finally {
      server.stop(true);
    }
  });

  it("POST /v1/models/load returns 400 bad_request for malformed JSON or a missing/non-string name", async () => {
    const client = new FakeOllamaClient(completingChat(0));
    const token = "test-token";
    setValidToken(token);
    const server = createServer({ ollama: client, port: 0 });

    try {
      const cases: Array<[string, string]> = [
        ["malformed JSON", "{not json"],
        ["missing name", "{}"],
        ["non-string name", JSON.stringify({ name: 5 })],
        ["non-object body", JSON.stringify(["llama3"])],
      ];
      for (const [label, body] of cases) {
        const res = await fetch(`http://127.0.0.1:${server.port}/v1/models/load`, {
          method: "POST",
          headers: authHeaders(token),
          body,
        });
        expect(res.status, label).toBe(400);
        const json = (await res.json()) as { error: string };
        expect(json.error, label).toBe("bad_request");
      }
    } finally {
      server.stop(true);
    }
  });

  it("POST /v1/models/load returns 404 unknown_model for a name not installed", async () => {
    const client = new FakeOllamaClient(completingChat(0), { models: [] });
    const token = "test-token";
    setValidToken(token);
    const server = createServer({ ollama: client, port: 0 });

    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/v1/models/load`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ name: "missing-model" }),
      });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("unknown_model");
    } finally {
      server.stop(true);
    }
  });

  it("POST /v1/models/load returns 409 operation_in_progress while a load is in flight", async () => {
    const client = new FakeOllamaClient(
      completingChat(0),
      { models: [{ name: "llama3", modified_at: "", size: 1, digest: "d" }] },
      { models: [] }
    );
    let release!: () => void;
    client.loadImpl = () => new Promise((resolve) => (release = resolve));
    const token = "test-token";
    setValidToken(token);
    const server = createServer({ ollama: client, port: 0 });

    try {
      const first = await fetch(`http://127.0.0.1:${server.port}/v1/models/load`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ name: "llama3" }),
      });
      expect(first.status).toBe(202);

      const second = await fetch(`http://127.0.0.1:${server.port}/v1/models/load`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ name: "llama3" }),
      });
      expect(second.status).toBe(409);
      const body = (await second.json()) as { error: string };
      expect(body.error).toBe("operation_in_progress");

      release();
    } finally {
      server.stop(true);
    }
  });

  it("POST /v1/models/unload returns 202 {operation}", async () => {
    const client = new FakeOllamaClient(completingChat(0));
    const token = "test-token";
    setValidToken(token);
    const server = createServer({ ollama: client, port: 0 });

    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/v1/models/unload`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ confirm: true }),
      });
      expect(res.status).toBe(202);
      const body = (await res.json()) as { operation: { kind: string } };
      expect(body.operation.kind).toBe("unloading");
    } finally {
      server.stop(true);
    }
  });

  it("POST /v1/models/unload returns 409 operation_in_progress while an unload is in flight", async () => {
    const client = new FakeOllamaClient(completingChat(0));
    let release!: () => void;
    client.unloadImpl = () => new Promise((resolve) => (release = resolve));
    const token = "test-token";
    setValidToken(token);
    const server = createServer({ ollama: client, port: 0 });

    try {
      const first = await fetch(`http://127.0.0.1:${server.port}/v1/models/unload`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ confirm: true }),
      });
      expect(first.status).toBe(202);

      const second = await fetch(`http://127.0.0.1:${server.port}/v1/models/unload`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ confirm: true }),
      });
      expect(second.status).toBe(409);
      const body = (await second.json()) as { error: string };
      expect(body.error).toBe("operation_in_progress");

      release();
    } finally {
      server.stop(true);
    }
  });

  it("POST /v1/models/unload fired twice with no await between returns one 202 and one 409", async () => {
    const client = new FakeOllamaClient(completingChat(0));
    const token = "test-token";
    setValidToken(token);
    const server = createServer({ ollama: client, port: 0 });

    try {
      const [first, second] = await Promise.all([
        fetch(`http://127.0.0.1:${server.port}/v1/models/unload`, {
          method: "POST",
          headers: authHeaders(token),
          body: JSON.stringify({ confirm: true }),
        }),
        fetch(`http://127.0.0.1:${server.port}/v1/models/unload`, {
          method: "POST",
          headers: authHeaders(token),
          body: JSON.stringify({ confirm: true }),
        }),
      ]);

      const statuses = [first.status, second.status].sort((a, b) => a - b);
      expect(statuses).toEqual([202, 409]);

      const conflictResponse = first.status === 409 ? first : second;
      const body = (await conflictResponse.json()) as { error: string };
      expect(body.error).toBe("operation_in_progress");
    } finally {
      server.stop(true);
    }
  });

  it("POST /v1/chat returns 409 operation_in_progress while a load is in flight", async () => {
    const client = new FakeOllamaClient(
      completingChat(0),
      { models: [{ name: "llama3", modified_at: "", size: 1, digest: "d" }] },
      { models: [] }
    );
    let release!: () => void;
    client.loadImpl = () => new Promise((resolve) => (release = resolve));
    const token = "test-token";
    setValidToken(token);
    const server = createServer({ ollama: client, port: 0 });

    try {
      const load = await fetch(`http://127.0.0.1:${server.port}/v1/models/load`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ name: "llama3" }),
      });
      expect(load.status).toBe(202);

      const chat = await fetch(`http://127.0.0.1:${server.port}/v1/chat`, {
        method: "POST",
        headers: authHeaders(token),
        body: CHAT_REQUEST_BODY,
      });
      expect(chat.status).toBe(409);
      const body = (await chat.json()) as { error: string };
      expect(body.error).toBe("operation_in_progress");

      release();
    } finally {
      server.stop(true);
    }
  });
});

describe("Busy confirmation before a swap or unload (M2c)", () => {
  const TAGS: OllamaTagsResponse = {
    models: [
      { name: "fake-model", modified_at: "", size: 1, digest: "d" },
      { name: "other-model", modified_at: "", size: 1, digest: "d" },
    ],
  };

  interface StateBody {
    resident: { name: string; loaded_by_server: boolean } | null;
    operation: { kind: string; model?: string; error?: string };
    generation: { id: string; model: string } | null;
  }

  async function state(port: number | undefined, token: string): Promise<StateBody> {
    const res = await fetch(`http://127.0.0.1:${port}/v1/state`, { headers: authHeaders(token) });
    expect(res.status).toBe(200);
    return (await res.json()) as StateBody;
  }

  function post(port: number | undefined, token: string, path: string, body?: string): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: authHeaders(token),
      body,
    });
  }

  /**
   * A fake whose load/unload calls are recorded in `calls` and change what
   * ps() reports (starting with "fake-model" resident, loaded by someone else).
   */
  function recordingClient(chat: ChatImpl): { client: FakeOllamaClient; calls: string[] } {
    const client = new FakeOllamaClient(chat, TAGS);
    const calls: string[] = [];
    let resident: string[] = ["fake-model"];
    client.ps = async () => ({ models: resident.flatMap((name) => residentPs(name).models) });
    client.loadImpl = async (name) => {
      calls.push(`load:${name}`);
      if (!resident.includes(name)) resident.push(name);
    };
    client.unloadImpl = async (name) => {
      calls.push(`unload:${name}`);
      resident = resident.filter((n) => n !== name);
    };
    return { client, calls };
  }

  async function expectConfirmationRequired(res: Response, reasons: string[]): Promise<void> {
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; message: unknown; reasons: unknown };
    expect(body.error).toBe("confirmation_required");
    expect(typeof body.message).toBe("string");
    expect((body.message as string).length).toBeGreaterThan(0);
    expect(body.reasons).toEqual(reasons);
  }

  async function waitIdle(port: number | undefined, token: string): Promise<void> {
    expect(await waitUntil(async () => (await state(port, token)).operation.kind === "idle")).toBe(true);
  }

  it("load and unload answer 409 confirmation_required when the resident model was not loaded by this server; nothing changes", async () => {
    const { client, calls } = recordingClient(completingChat(0));
    const token = "test-token";
    setValidToken(token);
    const server = createServer({ ollama: client, port: 0 });

    try {
      await expectConfirmationRequired(
        await post(server.port, token, "/v1/models/load", JSON.stringify({ name: "fake-model" })),
        ["not_loaded_by_server"]
      );
      await expectConfirmationRequired(
        await post(server.port, token, "/v1/models/unload", JSON.stringify({ confirm: false })),
        ["not_loaded_by_server"]
      );

      const after = await state(server.port, token);
      expect(after.operation).toEqual({ kind: "idle" });
      expect(after.resident).toEqual({ name: "fake-model", loaded_by_server: false });
      expect(calls).toEqual([]);

      const confirmedUnload = await post(server.port, token, "/v1/models/unload", JSON.stringify({ confirm: true }));
      expect(confirmedUnload.status).toBe(202);
      await waitIdle(server.port, token);
      const confirmedLoad = await post(
        server.port,
        token,
        "/v1/models/load",
        JSON.stringify({ name: "fake-model", confirm: true })
      );
      expect(confirmedLoad.status).toBe(202);
      await waitIdle(server.port, token);
    } finally {
      server.stop(true);
    }
  });

  it("load and unload (empty body) answer 409 confirmation_required while a reply is in progress; the reply keeps streaming", async () => {
    const { client, calls } = recordingClient(abortAwareChat());
    const token = "test-token";
    setValidToken(token);
    const server = createServer({ ollama: client, port: 0 });

    try {
      // Make the resident model one this server loaded, so only the reply applies.
      const load = await post(server.port, token, "/v1/models/load", JSON.stringify({ name: "fake-model", confirm: true }));
      expect(load.status).toBe(202);
      await waitIdle(server.port, token);
      calls.length = 0;

      const chat = await post(server.port, token, "/v1/chat", CHAT_REQUEST_BODY);
      expect(chat.status).toBe(200);
      const genId = chat.headers.get("x-generation-id")!;
      const textPromise = chat.text();

      await expectConfirmationRequired(
        await post(server.port, token, "/v1/models/load", JSON.stringify({ name: "fake-model" })),
        ["reply_in_progress"]
      );
      await expectConfirmationRequired(await post(server.port, token, "/v1/models/unload"), ["reply_in_progress"]);

      const after = await state(server.port, token);
      expect(after.operation).toEqual({ kind: "idle" });
      expect(after.resident).toEqual({ name: "fake-model", loaded_by_server: true });
      expect(after.generation?.id).toBe(genId);
      expect(calls).toEqual([]);

      await post(server.port, token, `/v1/generations/${genId}/cancel`);
      await textPromise;
    } finally {
      server.stop(true);
    }
  });

  it("both situations list both reasons in contract order", async () => {
    const { client } = recordingClient(abortAwareChat());
    const token = "test-token";
    setValidToken(token);
    const server = createServer({ ollama: client, port: 0 });

    try {
      const chat = await post(server.port, token, "/v1/chat", CHAT_REQUEST_BODY);
      expect(chat.status).toBe(200);
      const genId = chat.headers.get("x-generation-id")!;
      const textPromise = chat.text();

      await expectConfirmationRequired(
        await post(server.port, token, "/v1/models/load", JSON.stringify({ name: "fake-model" })),
        ["reply_in_progress", "not_loaded_by_server"]
      );
      await expectConfirmationRequired(await post(server.port, token, "/v1/models/unload", "{}"), [
        "reply_in_progress",
        "not_loaded_by_server",
      ]);

      await post(server.port, token, `/v1/generations/${genId}/cancel`);
      await textPromise;
    } finally {
      server.stop(true);
    }
  });

  for (const [label, path, body] of [
    ["load", "/v1/models/load", JSON.stringify({ name: "other-model", confirm: true })],
    ["unload", "/v1/models/unload", JSON.stringify({ confirm: true })],
  ] as const) {
    it(`a confirmed ${label} returns 202, ends the in-flight reply with done cancelled, then runs`, async () => {
      const { client, calls } = recordingClient(abortAwareChat());
      const token = "test-token";
      setValidToken(token);
      const server = createServer({ ollama: client, port: 0 });

      try {
        const chat = await post(server.port, token, "/v1/chat", CHAT_REQUEST_BODY);
        expect(chat.status).toBe(200);
        const textPromise = chat.text();

        const res = await post(server.port, token, path, body);
        expect(res.status).toBe(202);

        const events = parseSSE(await textPromise);
        const last = events[events.length - 1];
        expect(last.event).toBe("done");
        expect(JSON.parse(last.data).status).toBe("cancelled");

        await waitIdle(server.port, token);
        const after = await state(server.port, token);
        expect(after.generation).toBeNull();
        expect(after.operation.error).toBeUndefined();
        expect(calls[0]).toBe("unload:fake-model");
      } finally {
        server.stop(true);
      }
    });
  }

  it("a chat that passed the busy check before a load was claimed is refused when it would start", async () => {
    const { client, calls } = recordingClient(abortAwareChat());
    const slowPs = client.ps.bind(client);
    client.ps = async () => {
      await Bun.sleep(40);
      return slowPs();
    };
    const token = "test-token";
    setValidToken(token);
    const server = createServer({ ollama: client, port: 0 });

    try {
      // The chat passes isBusy() and waits on ps(); the load claims meanwhile.
      const chatPromise = post(server.port, token, "/v1/chat", CHAT_REQUEST_BODY);
      await Bun.sleep(10);
      const load = await post(server.port, token, "/v1/models/load", JSON.stringify({ name: "fake-model", confirm: true }));
      expect(load.status).toBe(202);

      const chat = await chatPromise;
      expect(chat.status).toBe(409);
      expect(((await chat.json()) as { error: string }).error).toBe("operation_in_progress");

      await waitIdle(server.port, token);
      expect(calls).toEqual(["load:fake-model"]);
    } finally {
      server.stop(true);
    }
  });

  it("a non-boolean confirm is 400 bad_request for load and unload", async () => {
    const { client, calls } = recordingClient(completingChat(0));
    const token = "test-token";
    setValidToken(token);
    const server = createServer({ ollama: client, port: 0 });

    try {
      const cases: Array<[string, string]> = [
        ["/v1/models/load", JSON.stringify({ name: "fake-model", confirm: "yes" })],
        ["/v1/models/load", JSON.stringify({ name: "fake-model", confirm: 1 })],
        ["/v1/models/unload", JSON.stringify({ confirm: "true" })],
        ["/v1/models/unload", JSON.stringify({ confirm: null })],
        ["/v1/models/unload", "{not json"],
        ["/v1/models/unload", JSON.stringify([true])],
      ];
      for (const [path, body] of cases) {
        const res = await post(server.port, token, path, body);
        expect(res.status, `${path} ${body}`).toBe(400);
        expect(((await res.json()) as { error: string }).error).toBe("bad_request");
      }
      expect(calls).toEqual([]);
      expect((await state(server.port, token)).operation).toEqual({ kind: "idle" });
    } finally {
      server.stop(true);
    }
  });
});
