/**
 * Streamed path tests for web reply with failed/unavailable steps.
 * M13-AC1, M13-AC2: drives events through sendInConversation -> store -> buildChatItems,
 * matching the real streaming path that conversationSession.test.ts uses for started/done steps.
 */

import { describe, it, expect, mock } from "bun:test";
import { APIClient } from "@/api/client";
import type { StreamEvent } from "@/api/client";
import { buildChatItems, stepLabel } from "@/ui/chatItems";
import { createConversationStore } from "@/store/conversationStore";
import { createMemoryStorage } from "@/store/storagePort";
import {
  sendInConversation,
} from "./conversationSession";

const BASE_URL = "https://ryans-mac-studio.tailc3648a.ts.net:8443";

function stateResponse(
  resident: { name: string } | null,
  models: Array<{ name: string; size_bytes: number; tools: boolean }> = []
): Response {
  return new Response(
    JSON.stringify({
      models,
      resident: resident ? { name: resident.name, loaded_by_server: true } : null,
      operation: { kind: "idle" },
      generation: null,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

/** An SSE response whose body is delivered chunk by chunk via `push`. */
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

function doneEvent(model: string, status: "complete" | "cancelled" = "complete"): string {
  return `event: done\ndata: {"status":"${status}","model":"${model}","eval_count":1,"tokens_per_second":1}\n\n`;
}

function streamingClient(
  respond: () => Response,
  bodies: Array<Record<string, unknown>>
): APIClient {
  const fetchMock = mock(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/v1/state")) {
      return stateResponse({ name: "llama3" }, [
        { name: "llama3", size_bytes: 1, tools: true },
      ]);
    }
    if (url.endsWith("/v1/chat")) {
      bodies.push(JSON.parse(init!.body as string));
      return respond();
    }
    throw new Error(`unexpected request: ${url}`);
  });
  const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
  client.setToken("t");
  return client;
}

function newCallbacks() {
  const events: StreamEvent[] = [];
  let blocked: string | null = null;
  let errored: Error | null = null;
  let completed = 0;

  return {
    events,
    get blocked() {
      return blocked;
    },
    get errored() {
      return errored;
    },
    get completed() {
      return completed;
    },
    get callbacks() {
      return {
        onEvent: (event: StreamEvent) => events.push(event),
        onBlocked: (msg: string) => (blocked = msg),
        onError: (err: Error) => (errored = err),
        onUnauthorized: () => {},
        onComplete: () => completed++,
      };
    },
  };
}

describe("sendInConversation: web steps unavailable/failed (M13)", () => {
  it("persists unavailable search step with answer and shows 'Search unavailable' in chat items", async () => {
    const store = createConversationStore(createMemoryStorage());
    const c = await store.create();
    await store.setWebSearch(c.id, true);
    const bodies: Array<Record<string, unknown>> = [];
    const client = streamingClient(() => {
      const s = controlledSseResponse("gen-web");
      s.push("event: step\ndata: {\"step_id\":\"s1\",\"kind\":\"search\",\"status\":\"started\",\"query\":\"q\"}\n\n");
      s.push("event: step\ndata: {\"step_id\":\"s1\",\"kind\":\"search\",\"status\":\"unavailable\"}\n\n");
      s.push("event: content\ndata: {\"text\":\"answer based on available information\"}\n\n");
      s.push(doneEvent("llama3"));
      s.close();
      return s.response;
    }, bodies);
    await sendInConversation(client, store, c.id, "hi", newCallbacks().callbacks);

    // Check stored message
    const reply = (await store.get(c.id))!.messages[1];
    expect(reply.steps).toEqual([{ step_id: "s1", kind: "search", status: "unavailable" }]);
    expect(reply.content).toBe("answer based on available information");
    expect(reply.status).toBe("complete");

    // Check built chat items
    const items = buildChatItems((await store.get(c.id))!.messages, null);
    const assistantItem = items[1];
    expect(assistantItem.content).toBe("answer based on available information");
    expect(assistantItem.streaming).toBe(false);
    // The step label should show "Search unavailable"
    expect(assistantItem).toHaveProperty("steps");
    if (assistantItem.steps && assistantItem.steps.length > 0) {
      const label = stepLabel(assistantItem.steps[0]);
      expect(label).toBe("Search unavailable");
    }
  });

  it("persists failed search step (timeout) with answer and shows failed label in chat items", async () => {
    const store = createConversationStore(createMemoryStorage());
    const c = await store.create();
    await store.setWebSearch(c.id, true);
    const bodies: Array<Record<string, unknown>> = [];
    const client = streamingClient(() => {
      const s = controlledSseResponse("gen-web");
      s.push("event: step\ndata: {\"step_id\":\"s1\",\"kind\":\"search\",\"status\":\"started\",\"query\":\"climate change\"}\n\n");
      s.push("event: step\ndata: {\"step_id\":\"s1\",\"kind\":\"search\",\"status\":\"failed\",\"detail\":\"timeout\",\"query\":\"climate change\"}\n\n");
      s.push("event: content\ndata: {\"text\":\"I could not search due to timeout\"}\n\n");
      s.push(doneEvent("llama3"));
      s.close();
      return s.response;
    }, bodies);
    await sendInConversation(client, store, c.id, "search climate", newCallbacks().callbacks);

    // Check stored message
    const reply = (await store.get(c.id))!.messages[1];
    expect(reply.steps).toEqual([
      { step_id: "s1", kind: "search", status: "failed", detail: "timeout", query: "climate change" }
    ]);
    expect(reply.content).toBe("I could not search due to timeout");
    expect(reply.status).toBe("complete");

    // Check built chat items
    const items = buildChatItems((await store.get(c.id))!.messages, null);
    const assistantItem = items[1];
    expect(assistantItem.content).toBe("I could not search due to timeout");
    expect(assistantItem.streaming).toBe(false);
    // The step label should show "Searching: climate change (failed)"
    expect(assistantItem).toHaveProperty("steps");
    if (assistantItem.steps && assistantItem.steps.length > 0) {
      const label = stepLabel(assistantItem.steps[0]);
      expect(label).toBe("Searching: climate change (failed)");
    }
  });

  it("persists failed read step (timeout) with answer and shows failed label in chat items", async () => {
    const store = createConversationStore(createMemoryStorage());
    const c = await store.create();
    await store.setWebSearch(c.id, true);
    const bodies: Array<Record<string, unknown>> = [];
    const client = streamingClient(() => {
      const s = controlledSseResponse("gen-web");
      s.push("event: step\ndata: {\"step_id\":\"s1\",\"kind\":\"search\",\"status\":\"started\",\"query\":\"example\"}\n\n");
      s.push("event: step\ndata: {\"step_id\":\"s1\",\"kind\":\"search\",\"status\":\"done\",\"query\":\"example\"}\n\n");
      s.push("event: step\ndata: {\"step_id\":\"s2\",\"kind\":\"read\",\"status\":\"started\",\"url\":\"https://www.example.com/page\"}\n\n");
      s.push("event: step\ndata: {\"step_id\":\"s2\",\"kind\":\"read\",\"status\":\"failed\",\"detail\":\"timeout\",\"url\":\"https://www.example.com/page\"}\n\n");
      s.push("event: content\ndata: {\"text\":\"Could not read the page due to timeout\"}\n\n");
      s.push(doneEvent("llama3"));
      s.close();
      return s.response;
    }, bodies);
    await sendInConversation(client, store, c.id, "read page", newCallbacks().callbacks);

    // Check stored message
    const reply = (await store.get(c.id))!.messages[1];
    expect(reply.steps).toEqual([
      { step_id: "s1", kind: "search", status: "done", query: "example" },
      { step_id: "s2", kind: "read", status: "failed", detail: "timeout", url: "https://www.example.com/page" }
    ]);
    expect(reply.content).toBe("Could not read the page due to timeout");
    expect(reply.status).toBe("complete");

    // Check built chat items
    const items = buildChatItems((await store.get(c.id))!.messages, null);
    const assistantItem = items[1];
    expect(assistantItem.content).toBe("Could not read the page due to timeout");
    expect(assistantItem.streaming).toBe(false);
    // The failed read step label should show with "(failed)"
    expect(assistantItem).toHaveProperty("steps");
    if (assistantItem.steps && assistantItem.steps.length > 1) {
      const label = stepLabel(assistantItem.steps[1]);
      expect(label).toContain("(failed)");
    }
  });
});
