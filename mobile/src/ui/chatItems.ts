/**
 * Pure view-model for the chat screen's message list (src/app/chat.tsx),
 * built for M4a-T2 to fix the on-device M3 finding that the user's prompt
 * doesn't show until the reply settles, and the in-flight reply streams in a
 * separate block below the list instead of in it (FR7/FR9/FR10, M4-AC4/AC5).
 *
 * `buildChatItems` merges the persisted messages from the store (M3-T1) with
 * an optional `PendingTurn` -- the prompt and in-flight reply for a send that
 * hasn't settled yet -- into the single list the screen renders. The pending
 * turn's user/assistant ids are minted by the screen up front (via
 * `newMessageId`, see conversationSession.ts) and passed to
 * `sendInConversation`'s `options`, so the same ids appear in this list
 * before, during and after the send: the item at a given index never changes
 * key, which is what keeps a keyed list (e.g. FlatList) from unmounting and
 * remounting the row -- and losing any per-row UI state such as thinking
 * expanded/collapsed -- as the pending turn is replaced by the persisted
 * messages once the store settles.
 */

import type { Message } from "@/store/conversationStore";
import type { StreamAccumulator } from "@/ui/streamReducer";

export interface PendingTurn {
  userMessageId: string;
  prompt: string;
  assistantMessageId: string;
  accumulator: StreamAccumulator;
  /** Send was blocked (no resident model): no assistant item is shown. */
  blocked: boolean;
}

export interface ChatItem {
  key: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  model?: string;
  streaming: boolean;
}

/**
 * Builds the items the chat screen renders: every persisted message, in
 * stored order, followed by the pending turn's user/assistant items -- unless
 * a persisted message already carries that id, which is how a pending item
 * is replaced in place once `sendInConversation` has persisted it, rather
 * than appearing twice.
 */
export function buildChatItems(
  persisted: Message[],
  pending: PendingTurn | null
): ChatItem[] {
  const items: ChatItem[] = persisted.map((m) => ({
    key: m.id,
    role: m.role,
    content: m.content,
    ...(m.thinking ? { thinking: m.thinking } : {}),
    ...(m.model ? { model: m.model } : {}),
    streaming: false,
  }));

  if (pending) {
    const persistedIds = new Set(persisted.map((m) => m.id));

    if (!persistedIds.has(pending.userMessageId)) {
      items.push({
        key: pending.userMessageId,
        role: "user",
        content: pending.prompt,
        streaming: false,
      });
    }

    if (!pending.blocked && !persistedIds.has(pending.assistantMessageId)) {
      items.push({
        key: pending.assistantMessageId,
        role: "assistant",
        content: pending.accumulator.content,
        ...(pending.accumulator.thinking ? { thinking: pending.accumulator.thinking } : {}),
        streaming: true,
      });
    }
  }

  return items;
}

/** Label for the thinking-section toggle button, by its current state. */
export function thinkingToggleLabel(expanded: boolean): string {
  return expanded ? "Hide thinking" : "Show thinking";
}

/**
 * Returns a new set with `key`'s membership flipped, leaving `expanded`
 * unchanged (the screen holds the expanded set in React state, which needs a
 * new object to detect the change).
 */
export function toggleExpanded(
  expanded: ReadonlySet<string>,
  key: string
): Set<string> {
  const next = new Set(expanded);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}
