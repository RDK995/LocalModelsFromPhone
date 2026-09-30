/**
 * Behavioural tests for the pure chat-list view-model (src/app/chat.tsx):
 * merging persisted messages with an in-flight (pending) turn into one list,
 * and the thinking-section toggle helpers. See chatItems.ts's doc comment
 * for why key/index stability across a send matters.
 */

import { describe, it, expect } from "bun:test";
import {
  buildChatItems,
  thinkingToggleLabel,
  toggleExpanded,
  type PendingTurn,
} from "./chatItems";
import type { Message } from "@/store/conversationStore";
import { initialStreamAccumulator } from "@/ui/streamReducer";

function userMessage(id: string, content: string): Message {
  return { id, role: "user", content, status: "complete" };
}

function assistantMessage(
  id: string,
  content: string,
  extra: Partial<Message> = {}
): Message {
  return { id, role: "assistant", content, status: "complete", ...extra };
}

describe("buildChatItems: persisted only", () => {
  it("lists persisted messages in stored order, all non-streaming", () => {
    const persisted = [userMessage("u1", "hi"), assistantMessage("a1", "hello")];

    const items = buildChatItems(persisted, null);

    expect(items).toEqual([
      { key: "u1", role: "user", content: "hi", streaming: false },
      { key: "a1", role: "assistant", content: "hello", streaming: false },
    ]);
  });

  it("carries thinking only when non-empty, and model when present", () => {
    const persisted = [
      assistantMessage("a1", "hello", { thinking: "let me think", model: "llama3" }),
      assistantMessage("a2", "hi", {}),
    ];

    const items = buildChatItems(persisted, null);

    expect(items[0]).toEqual({
      key: "a1",
      role: "assistant",
      content: "hello",
      thinking: "let me think",
      model: "llama3",
      streaming: false,
    });
    expect(items[1]).not.toHaveProperty("thinking");
    expect(items[1]).not.toHaveProperty("model");
  });
});

describe("buildChatItems: pending turn", () => {
  function pendingTurn(overrides: Partial<PendingTurn> = {}): PendingTurn {
    return {
      userMessageId: "u1",
      prompt: "hi",
      assistantMessageId: "a1",
      accumulator: initialStreamAccumulator,
      blocked: false,
      ...overrides,
    };
  }

  it("appends the user item and a streaming assistant item at Send (empty accumulator)", () => {
    const items = buildChatItems([], pendingTurn());

    expect(items).toEqual([
      { key: "u1", role: "user", content: "hi", streaming: false },
      { key: "a1", role: "assistant", content: "", streaming: true },
    ]);
  });

  it("reflects accumulated content and thinking while streaming", () => {
    const items = buildChatItems(
      [],
      pendingTurn({ accumulator: { content: "Hel", thinking: "reasoning", steps: [], sources: [] } })
    );

    expect(items[1]).toEqual({
      key: "a1",
      role: "assistant",
      content: "Hel",
      thinking: "reasoning",
      streaming: true,
    });
  });

  it("omits thinking on the pending assistant item when it is empty", () => {
    const items = buildChatItems(
      [],
      pendingTurn({ accumulator: { content: "Hel", thinking: "", steps: [], sources: [] } })
    );

    expect(items[1]).not.toHaveProperty("thinking");
  });

  it("gives only the user item when the send was blocked", () => {
    const items = buildChatItems([], pendingTurn({ blocked: true }));

    expect(items).toEqual([
      { key: "u1", role: "user", content: "hi", streaming: false },
    ]);
  });

  it("does not duplicate the user item once it has been persisted", () => {
    const items = buildChatItems([userMessage("u1", "hi")], pendingTurn());

    expect(items).toEqual([
      { key: "u1", role: "user", content: "hi", streaming: false },
      { key: "a1", role: "assistant", content: "", streaming: true },
    ]);
  });

  it("does not duplicate the assistant item once it has been persisted", () => {
    const items = buildChatItems(
      [userMessage("u1", "hi"), assistantMessage("a1", "hello there")],
      pendingTurn()
    );

    expect(items).toEqual([
      { key: "u1", role: "user", content: "hi", streaming: false },
      { key: "a1", role: "assistant", content: "hello there", streaming: false },
    ]);
  });
});

describe("buildChatItems: index/key stability across Send -> streaming -> persisted", () => {
  it("keeps the same keys at the same indices through every stage", () => {
    const pending: PendingTurn = {
      userMessageId: "u1",
      prompt: "hi",
      assistantMessageId: "a1",
      accumulator: initialStreamAccumulator,
      blocked: false,
    };

    // 1. At Send: nothing persisted yet, accumulator empty.
    const atSend = buildChatItems([], pending);

    // 2. While streaming: content has arrived.
    const streaming = buildChatItems([], {
      ...pending,
      accumulator: { content: "Hello", thinking: "", steps: [], sources: [] },
    });

    // 3. Both messages now persisted, pending not yet cleared by the caller.
    const persistedBoth = [userMessage("u1", "hi"), assistantMessage("a1", "Hello")];
    const settledPendingStillSet = buildChatItems(persistedBoth, {
      ...pending,
      accumulator: { content: "Hello", thinking: "", steps: [], sources: [] },
    });

    // 4. Caller has cleared the pending turn.
    const settledPendingCleared = buildChatItems(persistedBoth, null);

    for (const items of [atSend, streaming, settledPendingStillSet, settledPendingCleared]) {
      expect(items.map((i) => i.key)).toEqual(["u1", "a1"]);
      expect(items.map((i) => i.role)).toEqual(["user", "assistant"]);
      expect(items).toHaveLength(2);
    }

    // No id ever appears twice, in any stage.
    for (const items of [atSend, streaming, settledPendingStillSet, settledPendingCleared]) {
      const keys = items.map((i) => i.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe("thinkingToggleLabel", () => {
  it("reads 'Show thinking' when collapsed", () => {
    expect(thinkingToggleLabel(false)).toBe("Show thinking");
  });

  it("reads 'Hide thinking' when expanded", () => {
    expect(thinkingToggleLabel(true)).toBe("Hide thinking");
  });
});

describe("toggleExpanded", () => {
  it("adds a key that is not yet expanded", () => {
    const result = toggleExpanded(new Set(), "a1");
    expect(result.has("a1")).toBe(true);
  });

  it("removes a key that is already expanded", () => {
    const result = toggleExpanded(new Set(["a1"]), "a1");
    expect(result.has("a1")).toBe(false);
  });

  it("returns a new set instance rather than mutating the input", () => {
    const original = new Set<string>();
    const result = toggleExpanded(original, "a1");
    expect(result).not.toBe(original);
    expect(original.has("a1")).toBe(false);
  });

  it("leaves other keys untouched", () => {
    const result = toggleExpanded(new Set(["a1", "a2"]), "a2");
    expect(result).toEqual(new Set(["a1"]));
  });
});
