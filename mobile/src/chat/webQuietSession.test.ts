/**
 * Streamed path tests for web reply with new step kinds: "continue" and "answer_now".
 * M14-AC4: drives events through sendInConversation -> store -> buildChatItems,
 * matching the real streaming path for the new step kinds.
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

describe("sendInConversation: new web step kinds (M14)", () => {
  it("persists continue step with answer and shows 'Asked the model to continue' in chat items", async () => {
    const store = createConversationStore(createMemoryStorage());
    const c = await store.create();
    await store.setWebSearch(c.id, true);
    const bodies: Array<Record<string, unknown>> = [];
    const client = streamingClient(() => {
      const s = controlledSseResponse("gen-continue");
      s.push("event: step\ndata: {\"step_id\":\"c1\",\"kind\":\"continue\",\"status\":\"started\"}\n\n");
      s.push("event: step\ndata: {\"step_id\":\"c1\",\"kind\":\"continue\",\"status\":\"done\"}\n\n");
      s.push("event: content\ndata: {\"text\":\"here is the continuation\"}\n\n");
      s.push(doneEvent("llama3"));
      s.close();
      return s.response;
    }, bodies);
    await sendInConversation(client, store, c.id, "continue", newCallbacks().callbacks);

    // Check stored message
    const reply = (await store.get(c.id))!.messages[1];
    expect(reply.steps).toEqual([{ step_id: "c1", kind: "continue", status: "done" }]);
    expect(reply.content).toBe("here is the continuation");
    expect(reply.status).toBe("complete");

    // Check built chat items
    const items = buildChatItems((await store.get(c.id))!.messages, null);
    const assistantItem = items[1];
    expect(assistantItem.content).toBe("here is the continuation");
    expect(assistantItem.streaming).toBe(false);
    // The step label should show "Asked the model to continue"
    expect(assistantItem).toHaveProperty("steps");
    if (assistantItem.steps && assistantItem.steps.length > 0) {
      const label = stepLabel(assistantItem.steps[0]);
      expect(label).toBe("Asked the model to continue");
    }
  });

  it("persists answer_now step with answer and shows 'Asked the model to answer now' in chat items", async () => {
    const store = createConversationStore(createMemoryStorage());
    const c = await store.create();
    await store.setWebSearch(c.id, true);
    const bodies: Array<Record<string, unknown>> = [];
    const client = streamingClient(() => {
      const s = controlledSseResponse("gen-answer-now");
      s.push("event: step\ndata: {\"step_id\":\"a1\",\"kind\":\"answer_now\",\"status\":\"started\"}\n\n");
      s.push("event: step\ndata: {\"step_id\":\"a1\",\"kind\":\"answer_now\",\"status\":\"done\"}\n\n");
      s.push("event: content\ndata: {\"text\":\"the final answer\"}\n\n");
      s.push(doneEvent("llama3"));
      s.close();
      return s.response;
    }, bodies);
    await sendInConversation(client, store, c.id, "answer now", newCallbacks().callbacks);

    // Check stored message
    const reply = (await store.get(c.id))!.messages[1];
    expect(reply.steps).toEqual([{ step_id: "a1", kind: "answer_now", status: "done" }]);
    expect(reply.content).toBe("the final answer");
    expect(reply.status).toBe("complete");

    // Check built chat items
    const items = buildChatItems((await store.get(c.id))!.messages, null);
    const assistantItem = items[1];
    expect(assistantItem.content).toBe("the final answer");
    expect(assistantItem.streaming).toBe(false);
    // The step label should show "Asked the model to answer now"
    expect(assistantItem).toHaveProperty("steps");
    if (assistantItem.steps && assistantItem.steps.length > 0) {
      const label = stepLabel(assistantItem.steps[0]);
      expect(label).toBe("Asked the model to answer now");
    }
  });

  it("reopened saved conversation shows both continue and answer_now steps with correct labels", async () => {
    const store = createConversationStore(createMemoryStorage());
    const c = await store.create();
    await store.setWebSearch(c.id, true);
    const bodies: Array<Record<string, unknown>> = [];
    const client = streamingClient(() => {
      const s = controlledSseResponse("gen-both");
      s.push("event: step\ndata: {\"step_id\":\"s1\",\"kind\":\"search\",\"status\":\"started\",\"query\":\"test\"}\n\n");
      s.push("event: step\ndata: {\"step_id\":\"s1\",\"kind\":\"search\",\"status\":\"done\",\"query\":\"test\"}\n\n");
      s.push("event: step\ndata: {\"step_id\":\"c1\",\"kind\":\"continue\",\"status\":\"started\"}\n\n");
      s.push("event: step\ndata: {\"step_id\":\"c1\",\"kind\":\"continue\",\"status\":\"done\"}\n\n");
      s.push("event: step\ndata: {\"step_id\":\"a1\",\"kind\":\"answer_now\",\"status\":\"started\"}\n\n");
      s.push("event: step\ndata: {\"step_id\":\"a1\",\"kind\":\"answer_now\",\"status\":\"done\"}\n\n");
      s.push("event: content\ndata: {\"text\":\"full answer\"}\n\n");
      s.push(doneEvent("llama3"));
      s.close();
      return s.response;
    }, bodies);
    await sendInConversation(client, store, c.id, "test query", newCallbacks().callbacks);

    // Check stored message has all steps
    const reply = (await store.get(c.id))!.messages[1];
    expect(reply.steps).toHaveLength(3);
    expect(reply.steps![0].kind).toBe("search");
    expect(reply.steps![1].kind).toBe("continue");
    expect(reply.steps![2].kind).toBe("answer_now");

    // Simulate reopening by reloading from store
    const storedConversation = await store.get(c.id);
    expect(storedConversation).not.toBeNull();

    // Check built chat items from reopened conversation
    const items = buildChatItems(storedConversation!.messages, null);
    const assistantItem = items[1];
    expect(assistantItem.steps).toHaveLength(3);

    // Verify labels for each step
    const searchLabel = stepLabel(assistantItem.steps![0]);
    const continueLabel = stepLabel(assistantItem.steps![1]);
    const answerNowLabel = stepLabel(assistantItem.steps![2]);

    expect(searchLabel).toBe("Searching: test");
    expect(continueLabel).toBe("Asked the model to continue");
    expect(answerNowLabel).toBe("Asked the model to answer now");
  });
});
