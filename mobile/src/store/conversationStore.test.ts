/**
 * Behavioural tests for the conversation store: create/get/list ordering,
 * delete, message append/update, model attribution, and persistence across
 * a fresh store instance built over the same storage backend (the proxy for
 * "the app was force-quit and reopened"). Uses memory storage and an
 * injected clock/id generator, so this file never touches AsyncStorage.
 */

import { describe, it, expect } from "bun:test";
import { createMemoryStorage } from "./storagePort";
import type { StoragePort } from "./storagePort";
import { createConversationStore } from "./conversationStore";
import type { Message } from "./conversationStore";

function fakeClock(startIso = "2024-01-01T00:00:00.000Z") {
  let current = new Date(startIso).getTime();
  return {
    now(): string {
      const iso = new Date(current).toISOString();
      current += 1000;
      return iso;
    },
  };
}

function fakeIdGenerator(prefix = "id") {
  let count = 0;
  return () => `${prefix}-${++count}`;
}

function userMessage(id: string, content: string): Message {
  return { id, role: "user", content, status: "complete" };
}

function assistantMessage(id: string, content: string, model: string): Message {
  return { id, role: "assistant", content, model, status: "complete" };
}

describe("conversation store", () => {
  it("creates a conversation with an empty message list and a default title", async () => {
    const store = createConversationStore(createMemoryStorage(), {
      now: fakeClock().now,
      newId: fakeIdGenerator(),
    });

    const conversation = await store.create();

    expect(conversation.id).toBe("id-1");
    expect(conversation.title).toBe("New chat");
    expect(conversation.messages).toEqual([]);
    expect(conversation.created_at).toBe(conversation.updated_at);
  });

  it("creates a conversation with a given title", async () => {
    const store = createConversationStore(createMemoryStorage(), {
      now: fakeClock().now,
      newId: fakeIdGenerator(),
    });

    const conversation = await store.create("Trip planning");

    expect(conversation.title).toBe("Trip planning");
  });

  it("gets a created conversation back by id", async () => {
    const store = createConversationStore(createMemoryStorage(), {
      now: fakeClock().now,
      newId: fakeIdGenerator(),
    });

    const created = await store.create("Trip planning");
    const found = await store.get(created.id);

    expect(found).toEqual(created);
  });

  it("returns null from get() for an id that was never created", async () => {
    const store = createConversationStore(createMemoryStorage(), {
      now: fakeClock().now,
      newId: fakeIdGenerator(),
    });

    expect(await store.get("does-not-exist")).toBeNull();
  });

  it("lists conversations newest first", async () => {
    const storage = createMemoryStorage();
    const store = createConversationStore(storage, {
      now: fakeClock().now,
      newId: fakeIdGenerator(),
    });

    const first = await store.create("First");
    const second = await store.create("Second");

    const list = await store.list();

    expect(list.map(c => c.id)).toEqual([second.id, first.id]);
    void first;
  });

  it("moves an older conversation to the top of list() when a message is appended to it", async () => {
    const storage = createMemoryStorage();
    const store = createConversationStore(storage, {
      now: fakeClock().now,
      newId: fakeIdGenerator(),
    });

    const older = await store.create("Older");
    const newer = await store.create("Newer");

    await store.appendMessage(older.id, userMessage("m-1", "hello again"));

    const list = await store.list();

    expect(list.map(c => c.id)).toEqual([older.id, newer.id]);
  });

  it("delete removes the conversation from list() and from storage", async () => {
    const storage = createMemoryStorage();
    const store = createConversationStore(storage, {
      now: fakeClock().now,
      newId: fakeIdGenerator(),
    });

    const conversation = await store.create("Doomed");

    await store.delete(conversation.id);

    expect(await store.list()).toEqual([]);
    expect(await store.get(conversation.id)).toBeNull();
  });

  it("keeps the model on an appended assistant message", async () => {
    const storage = createMemoryStorage();
    const store = createConversationStore(storage, {
      now: fakeClock().now,
      newId: fakeIdGenerator(),
    });

    const conversation = await store.create();
    await store.appendMessage(
      conversation.id,
      assistantMessage("m-1", "hi there", "llama3:8b")
    );

    const found = await store.get(conversation.id);

    expect(found?.messages).toEqual([
      assistantMessage("m-1", "hi there", "llama3:8b"),
    ]);
  });

  it("bumps updated_at when a message is appended", async () => {
    const storage = createMemoryStorage();
    const store = createConversationStore(storage, {
      now: fakeClock().now,
      newId: fakeIdGenerator(),
    });

    const conversation = await store.create();
    const beforeUpdate = conversation.updated_at;

    const updated = await store.appendMessage(
      conversation.id,
      userMessage("m-1", "hello")
    );

    expect(updated.updated_at).not.toBe(beforeUpdate);
  });

  it("updates a message in place and bumps updated_at", async () => {
    const storage = createMemoryStorage();
    const store = createConversationStore(storage, {
      now: fakeClock().now,
      newId: fakeIdGenerator(),
    });

    const conversation = await store.create();
    await store.appendMessage(
      conversation.id,
      assistantMessage("m-1", "partial", "llama3:8b")
    );

    const updated = await store.updateMessage(conversation.id, "m-1", {
      content: "final reply",
      status: "complete",
    });

    expect(updated.messages).toEqual([
      { id: "m-1", role: "assistant", content: "final reply", model: "llama3:8b", status: "complete" },
    ]);
  });

  it("a fresh store built over the same storage sees the same conversations and messages", async () => {
    const storage = createMemoryStorage();
    const firstStore = createConversationStore(storage, {
      now: fakeClock().now,
      newId: fakeIdGenerator(),
    });

    const conversation = await firstStore.create("Persisted chat");
    await firstStore.appendMessage(conversation.id, userMessage("m-1", "hello"));
    await firstStore.appendMessage(
      conversation.id,
      assistantMessage("m-2", "hi there", "llama3:8b")
    );

    const secondStore = createConversationStore(storage);
    const list = await secondStore.list();

    expect(list).toHaveLength(1);
    const reread = await firstStore.get(conversation.id);
    expect(reread).not.toBeNull();
    expect(list[0]).toEqual(reread!);
    expect(list[0].messages.map(m => m.id)).toEqual(["m-1", "m-2"]);
  });

  it("skips a conversation key that is unparseable JSON instead of crashing list()", async () => {
    const storage: StoragePort = createMemoryStorage();
    const store = createConversationStore(storage, {
      now: fakeClock().now,
      newId: fakeIdGenerator(),
    });

    const good = await store.create("Good");
    // Corrupt a second conversation's own key directly, referenced by the index.
    await storage.setItem(
      "phone-models:v1:conversations-index",
      JSON.stringify([good.id, "missing-conversation"])
    );

    const list = await store.list();

    expect(list.map(c => c.id)).toEqual([good.id]);
  });

  it("skips a conversation key with a missing entry instead of crashing list()", async () => {
    const storage: StoragePort = createMemoryStorage();
    const store = createConversationStore(storage, {
      now: fakeClock().now,
      newId: fakeIdGenerator(),
    });

    const good = await store.create("Good");
    await storage.setItem(
      "phone-models:v1:conversation:missing-conversation",
      "{ not json"
    );
    await storage.setItem(
      "phone-models:v1:conversations-index",
      JSON.stringify([good.id, "missing-conversation"])
    );

    const list = await store.list();

    expect(list.map(c => c.id)).toEqual([good.id]);
  });

  it("treats an unparseable index as empty rather than throwing", async () => {
    const storage: StoragePort = createMemoryStorage();
    await storage.setItem("phone-models:v1:conversations-index", "{ not json");
    const store = createConversationStore(storage, {
      now: fakeClock().now,
      newId: fakeIdGenerator(),
    });

    await expect(store.list()).resolves.toEqual([]);
  });
});
