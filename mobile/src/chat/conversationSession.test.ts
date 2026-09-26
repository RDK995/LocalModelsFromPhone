/**
 * Behavioural tests for the pure send-in-conversation logic behind the chat
 * screen (FR7/FR8): building the full conversation history for a send,
 * persisting the user prompt and the assistant's reply through the M3-T1
 * store, and model attribution across a mid-conversation model switch. Uses
 * a real `APIClient` against a fake fetch (no network) and a real
 * `createConversationStore` over `createMemoryStorage()` (no AsyncStorage),
 * the same patterns as chatController.test.ts and conversationStore.test.ts.
 */

import { describe, it, expect, mock } from "bun:test";
import { APIClient } from "@/api/client";
import type { StreamEvent } from "@/api/client";
import { createConversationStore } from "@/store/conversationStore";
import { createMemoryStorage } from "@/store/storagePort";
import {
  BLOCKED_MESSAGE,
  newMessageId,
  sendInConversation,
  titleFromPrompt,
} from "./conversationSession";

const BASE_URL = "https://ryans-mac-studio.tailc3648a.ts.net:8443";

function stateResponse(resident: { name: string } | null): Response {
  return new Response(
    JSON.stringify({
      models: [],
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

/** A one-shot chat response: `content`, then a `done` event, then close. */
function completedChatResponse(content: string, model: string): Response {
  const stream = controlledSseResponse(`gen-${model}`);
  stream.push(`event: content\ndata: {"text":${JSON.stringify(content)}}\n\n`);
  stream.push(doneEvent(model));
  stream.close();
  return stream.response;
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
    callbacks: {
      onEvent: (event: StreamEvent) => events.push(event),
      onBlocked: (message: string) => {
        blocked = message;
      },
      onError: (error: Error) => {
        errored = error;
      },
      onUnauthorized: () => {},
      onComplete: () => {
        completed += 1;
      },
    },
  };
}

describe("titleFromPrompt", () => {
  it("uses the prompt verbatim when it is short", () => {
    expect(titleFromPrompt("Hello there")).toBe("Hello there");
  });

  it("trims surrounding whitespace", () => {
    expect(titleFromPrompt("  hi  ")).toBe("hi");
  });

  it("truncates to 40 characters", () => {
    const long = "x".repeat(60);
    const title = titleFromPrompt(long);
    expect(title.length).toBe(40);
    expect(title).toBe("x".repeat(40));
  });
});

describe("sendInConversation: history (FR7)", () => {
  it("sends all earlier turns in order plus the new prompt, and persists the new user message", async () => {
    const store = createConversationStore(createMemoryStorage());
    const conversation = await store.create();
    await store.appendMessage(conversation.id, {
      id: "m1",
      role: "user",
      content: "first question",
      status: "complete",
    });
    await store.appendMessage(conversation.id, {
      id: "m2",
      role: "assistant",
      content: "first answer",
      model: "llama3",
      status: "complete",
    });

    let sentMessages: Array<{ role: string; content: string }> = [];
    const fetchMock = mock(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/state")) {
        return stateResponse({ name: "llama3" });
      }
      if (url.endsWith("/v1/chat")) {
        sentMessages = JSON.parse(init!.body as string).messages;
        return completedChatResponse("second answer", "llama3");
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    const result = newCallbacks();
    await sendInConversation(
      client,
      store,
      conversation.id,
      "second question",
      result.callbacks
    );

    expect(sentMessages).toEqual([
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "second question" },
    ]);

    const stored = await store.get(conversation.id);
    expect(stored!.messages.map((m) => ({ role: m.role, content: m.content }))).toEqual([
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "second question" },
      { role: "assistant", content: "second answer" },
    ]);
  });

  it("sets the conversation title from the prompt on the first send", async () => {
    const store = createConversationStore(createMemoryStorage());
    const conversation = await store.create();
    expect(conversation.title).toBe("New chat");

    const fetchMock = mock(async (url: string) => {
      if (url.endsWith("/v1/state")) {
        return stateResponse({ name: "llama3" });
      }
      if (url.endsWith("/v1/chat")) {
        return completedChatResponse("hi back", "llama3");
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    const result = newCallbacks();
    await sendInConversation(
      client,
      store,
      conversation.id,
      "  This prompt is exactly long enough to need truncating at forty chars  ",
      result.callbacks
    );

    const stored = await store.get(conversation.id);
    expect(stored!.title).toBe(
      "This prompt is exactly long enough to ne"
    );
    expect(stored!.title.length).toBe(40);
  });

  it("does not rename the conversation on a later send", async () => {
    const store = createConversationStore(createMemoryStorage());
    const conversation = await store.create();
    await store.rename(conversation.id, "Existing title");
    await store.appendMessage(conversation.id, {
      id: "m1",
      role: "user",
      content: "earlier",
      status: "complete",
    });

    const fetchMock = mock(async (url: string) => {
      if (url.endsWith("/v1/state")) {
        return stateResponse({ name: "llama3" });
      }
      if (url.endsWith("/v1/chat")) {
        return completedChatResponse("reply", "llama3");
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    const result = newCallbacks();
    await sendInConversation(client, store, conversation.id, "later prompt", result.callbacks);

    const stored = await store.get(conversation.id);
    expect(stored!.title).toBe("Existing title");
  });
});

describe("sendInConversation: model attribution (FR8)", () => {
  it("persists each reply with the model from its own done event, and leaves the first unchanged after the second", async () => {
    const store = createConversationStore(createMemoryStorage());
    const conversation = await store.create();

    let respondWith = "model-a";
    const fetchMock = mock(async (url: string) => {
      if (url.endsWith("/v1/state")) {
        return stateResponse({ name: respondWith });
      }
      if (url.endsWith("/v1/chat")) {
        return completedChatResponse(`reply from ${respondWith}`, respondWith);
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    await sendInConversation(client, store, conversation.id, "first", newCallbacks().callbacks);

    respondWith = "model-b";
    await sendInConversation(client, store, conversation.id, "second", newCallbacks().callbacks);

    const stored = await store.get(conversation.id);
    const assistantReplies = stored!.messages.filter((m) => m.role === "assistant");
    expect(assistantReplies).toHaveLength(2);
    expect(assistantReplies[0]).toMatchObject({
      content: "reply from model-a",
      model: "model-a",
      status: "complete",
    });
    expect(assistantReplies[1]).toMatchObject({
      content: "reply from model-b",
      model: "model-b",
      status: "complete",
    });
  });

  it("falls back to the model the send targeted when the done event carries no model", async () => {
    const store = createConversationStore(createMemoryStorage());
    const conversation = await store.create();

    const fetchMock = mock(async (url: string) => {
      if (url.endsWith("/v1/state")) {
        return stateResponse({ name: "resident-model" });
      }
      if (url.endsWith("/v1/chat")) {
        const stream = controlledSseResponse("gen-1");
        stream.push("event: content\ndata: {\"text\":\"hi\"}\n\n");
        stream.push(
          "event: done\ndata: {\"status\":\"complete\",\"eval_count\":1,\"tokens_per_second\":1}\n\n"
        );
        stream.close();
        return stream.response;
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    await sendInConversation(client, store, conversation.id, "hi", newCallbacks().callbacks);

    const stored = await store.get(conversation.id);
    expect(stored!.messages[1]).toMatchObject({
      role: "assistant",
      model: "resident-model",
      status: "complete",
    });
  });

  it("marks a reply stopped when the done event's status is cancelled", async () => {
    const store = createConversationStore(createMemoryStorage());
    const conversation = await store.create();

    const fetchMock = mock(async (url: string) => {
      if (url.endsWith("/v1/state")) {
        return stateResponse({ name: "llama3" });
      }
      if (url.endsWith("/v1/chat")) {
        const stream = controlledSseResponse("gen-1");
        stream.push("event: content\ndata: {\"text\":\"partial\"}\n\n");
        stream.push(doneEvent("llama3", "cancelled"));
        stream.close();
        return stream.response;
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    await sendInConversation(client, store, conversation.id, "hi", newCallbacks().callbacks);

    const stored = await store.get(conversation.id);
    expect(stored!.messages[1]).toMatchObject({
      content: "partial",
      status: "stopped",
    });
  });
});

describe("sendInConversation: stream error (keeps partial content)", () => {
  it("persists the partial reply with status error and calls onError", async () => {
    const store = createConversationStore(createMemoryStorage());
    const conversation = await store.create();

    const fetchMock = mock(async (url: string) => {
      if (url.endsWith("/v1/state")) {
        return stateResponse({ name: "llama3" });
      }
      if (url.endsWith("/v1/chat")) {
        const stream = controlledSseResponse("gen-1");
        stream.push("event: content\ndata: {\"text\":\"partial answer\"}\n\n");
        stream.push(
          "event: error\ndata: {\"code\":\"generation_failed\",\"message\":\"model crashed\"}\n\n"
        );
        stream.close();
        return stream.response;
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    const result = newCallbacks();
    await sendInConversation(client, store, conversation.id, "hi", result.callbacks);

    expect(result.errored).not.toBeNull();
    expect(result.errored!.message).toContain("generation_failed");

    const stored = await store.get(conversation.id);
    expect(stored!.messages[1]).toMatchObject({
      role: "assistant",
      content: "partial answer",
      status: "error",
    });
  });
});

describe("sendInConversation: blocked (no resident model, FR8)", () => {
  it("persists the user prompt, stores no assistant reply, makes no chat request, and reports blocked", async () => {
    const store = createConversationStore(createMemoryStorage());
    const conversation = await store.create();

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
    await sendInConversation(client, store, conversation.id, "hello?", result.callbacks);

    expect(result.blocked).toBe(BLOCKED_MESSAGE);
    expect(result.errored).toBeNull();
    expect(calls.some((url) => url.endsWith("/v1/chat"))).toBe(false);

    const stored = await store.get(conversation.id);
    expect(stored!.messages).toHaveLength(1);
    expect(stored!.messages[0]).toMatchObject({ role: "user", content: "hello?" });
  });

  it("still sets the conversation title from the blocked prompt on the first send", async () => {
    const store = createConversationStore(createMemoryStorage());
    const conversation = await store.create();

    const fetchMock = mock(async (url: string) => {
      if (url.endsWith("/v1/state")) {
        return stateResponse(null);
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    await sendInConversation(client, store, conversation.id, "hello?", newCallbacks().callbacks);

    const stored = await store.get(conversation.id);
    expect(stored!.title).toBe("hello?");
  });
});

describe("newMessageId", () => {
  it("returns a non-empty id, different each call", () => {
    const a = newMessageId();
    const b = newMessageId();
    expect(a).not.toBe("");
    expect(a).not.toBe(b);
  });
});

describe("sendInConversation: caller-supplied ids (M4a-T2)", () => {
  it("uses fresh ids when no options are supplied", async () => {
    const store = createConversationStore(createMemoryStorage());
    const conversation = await store.create();

    const fetchMock = mock(async (url: string) => {
      if (url.endsWith("/v1/state")) {
        return stateResponse({ name: "llama3" });
      }
      if (url.endsWith("/v1/chat")) {
        return completedChatResponse("reply", "llama3");
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    await sendInConversation(client, store, conversation.id, "hi", newCallbacks().callbacks);

    const stored = await store.get(conversation.id);
    expect(stored!.messages[0].id).not.toBe("");
    expect(stored!.messages[1].id).not.toBe("");
    expect(stored!.messages[0].id).not.toBe(stored!.messages[1].id);
  });

  it("persists the user message and a completed reply under the supplied ids", async () => {
    const store = createConversationStore(createMemoryStorage());
    const conversation = await store.create();

    const fetchMock = mock(async (url: string) => {
      if (url.endsWith("/v1/state")) {
        return stateResponse({ name: "llama3" });
      }
      if (url.endsWith("/v1/chat")) {
        return completedChatResponse("reply", "llama3");
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    await sendInConversation(
      client,
      store,
      conversation.id,
      "hi",
      newCallbacks().callbacks,
      { userMessageId: "u-1", assistantMessageId: "a-1" }
    );

    const stored = await store.get(conversation.id);
    expect(stored!.messages).toEqual([
      expect.objectContaining({ id: "u-1", role: "user", content: "hi" }),
      expect.objectContaining({
        id: "a-1",
        role: "assistant",
        content: "reply",
        status: "complete",
      }),
    ]);
  });

  it("persists a stopped reply under the supplied assistant id", async () => {
    const store = createConversationStore(createMemoryStorage());
    const conversation = await store.create();

    const fetchMock = mock(async (url: string) => {
      if (url.endsWith("/v1/state")) {
        return stateResponse({ name: "llama3" });
      }
      if (url.endsWith("/v1/chat")) {
        const stream = controlledSseResponse("gen-1");
        stream.push("event: content\ndata: {\"text\":\"partial\"}\n\n");
        stream.push(doneEvent("llama3", "cancelled"));
        stream.close();
        return stream.response;
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    await sendInConversation(
      client,
      store,
      conversation.id,
      "hi",
      newCallbacks().callbacks,
      { userMessageId: "u-2", assistantMessageId: "a-2" }
    );

    const stored = await store.get(conversation.id);
    expect(stored!.messages[1]).toMatchObject({
      id: "a-2",
      status: "stopped",
      content: "partial",
    });
  });

  it("persists an error reply under the supplied assistant id", async () => {
    const store = createConversationStore(createMemoryStorage());
    const conversation = await store.create();

    const fetchMock = mock(async (url: string) => {
      if (url.endsWith("/v1/state")) {
        return stateResponse({ name: "llama3" });
      }
      if (url.endsWith("/v1/chat")) {
        const stream = controlledSseResponse("gen-1");
        stream.push("event: content\ndata: {\"text\":\"partial answer\"}\n\n");
        stream.push(
          "event: error\ndata: {\"code\":\"generation_failed\",\"message\":\"model crashed\"}\n\n"
        );
        stream.close();
        return stream.response;
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    await sendInConversation(
      client,
      store,
      conversation.id,
      "hi",
      newCallbacks().callbacks,
      { userMessageId: "u-3", assistantMessageId: "a-3" }
    );

    const stored = await store.get(conversation.id);
    expect(stored!.messages[0]).toMatchObject({ id: "u-3" });
    expect(stored!.messages[1]).toMatchObject({
      id: "a-3",
      status: "error",
      content: "partial answer",
    });
  });

  it("persists the prompt under the supplied user id and stores no reply when blocked", async () => {
    const store = createConversationStore(createMemoryStorage());
    const conversation = await store.create();

    const fetchMock = mock(async (url: string) => {
      if (url.endsWith("/v1/state")) {
        return stateResponse(null);
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch);
    client.setToken("t");

    await sendInConversation(
      client,
      store,
      conversation.id,
      "hello?",
      newCallbacks().callbacks,
      { userMessageId: "u-4", assistantMessageId: "a-4" }
    );

    const stored = await store.get(conversation.id);
    expect(stored!.messages).toEqual([
      expect.objectContaining({ id: "u-4", role: "user", content: "hello?" }),
    ]);
  });
});
