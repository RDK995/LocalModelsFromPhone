/**
 * Behavioural tests for the pure view-model behind the Conversations screen
 * (src/app/conversations.tsx): turning the store's `Conversation[]` into the
 * rows the screen renders (newest first, formatted "last updated" label).
 */

import { describe, it, expect } from "bun:test";
import type { Conversation } from "@/store/conversationStore";
import { toConversationListView, formatUpdatedAt } from "./conversationList";

function conversation(overrides: Partial<Conversation>): Conversation {
  return {
    id: "id",
    title: "New chat",
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
    messages: [],
    ...overrides,
  };
}

describe("formatUpdatedAt", () => {
  it("formats an ISO timestamp as YYYY-MM-DD HH:MM, timezone-free", () => {
    expect(formatUpdatedAt("2024-03-05T13:47:22.123Z")).toBe("2024-03-05 13:47");
  });
});

describe("toConversationListView", () => {
  it("orders rows newest-updated first, even if the input is not already sorted", () => {
    const conversations = [
      conversation({ id: "old", title: "Old", updated_at: "2024-01-01T00:00:00.000Z" }),
      conversation({ id: "new", title: "New", updated_at: "2024-06-01T00:00:00.000Z" }),
      conversation({ id: "mid", title: "Mid", updated_at: "2024-03-01T00:00:00.000Z" }),
    ];

    const view = toConversationListView(conversations);

    expect(view.rows.map((r) => r.id)).toEqual(["new", "mid", "old"]);
  });

  it("carries the title and a formatted updated-at label for each row", () => {
    const conversations = [
      conversation({
        id: "a",
        title: "Hello there",
        updated_at: "2024-06-15T09:05:00.000Z",
      }),
    ];

    const view = toConversationListView(conversations);

    expect(view.rows).toEqual([
      { id: "a", title: "Hello there", updatedLabel: "2024-06-15 09:05" },
    ]);
  });

  it("returns no rows for an empty conversation list", () => {
    expect(toConversationListView([])).toEqual({ rows: [] });
  });
});
