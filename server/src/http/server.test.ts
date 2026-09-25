import { describe, it, expect } from "bun:test";
import { createServer, setValidToken, getValidToken, type OllamaStateClient } from "./server";
import type {
  OllamaChatRequest,
  OllamaChatResponse,
  OllamaTagsResponse,
  OllamaPsResponse,
} from "../ollama/client";

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
  constructor(
    private chatImpl: ChatImpl,
    private tagsResponse: OllamaTagsResponse = { models: [] },
    private psResponse: OllamaPsResponse = { models: [] }
  ) {}

  async tags(): Promise<OllamaTagsResponse> {
    return this.tagsResponse;
  }

  async ps(): Promise<OllamaPsResponse> {
    return this.psResponse;
  }

  chat(
    request: OllamaChatRequest,
    signal?: AbortSignal
  ): AsyncGenerator<OllamaChatResponse, void, unknown> {
    return this.chatImpl(request, signal);
  }
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

/** Parse concatenated SSE wire text into { id, event, data } records. */
function parseSSE(text: string): Array<{ id: string; event: string; data: string }> {
  return text
    .split("\n\n")
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
    const client = new FakeOllamaClient(completingChat(0));
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
      server.stop();
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
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(202);
    } finally {
      server.stop();
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
