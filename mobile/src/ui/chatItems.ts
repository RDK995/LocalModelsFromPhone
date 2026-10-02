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
import type { StepEventData } from "@shared/api";
import { researchClockLabel } from "@/ui/deepResearch";

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
  steps?: StepEventData[];
  sources?: Array<{ title: string; url: string }>;
  /** Deep research result (finished run); absent for ordinary replies. */
  research?: Message["research"];
  /** Live "m:ss of m:ss" clock for a streaming deep research reply. */
  clockLabel?: string;
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
    ...(m.steps && m.steps.length > 0 ? { steps: m.steps } : {}),
    ...(m.sources && m.sources.length > 0 ? { sources: m.sources } : {}),
    ...(m.research ? { research: m.research } : {}),
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
        ...(pending.accumulator.steps && pending.accumulator.steps.length > 0
          ? { steps: pending.accumulator.steps }
          : {}),
        ...(pending.accumulator.sources && pending.accumulator.sources.length > 0
          ? { sources: pending.accumulator.sources }
          : {}),
        ...(pending.accumulator.research ? { research: pending.accumulator.research } : {}),
        ...streamingClock(pending.accumulator),
        streaming: true,
      });
    }
  }

  return items;
}

function streamingClock(acc: StreamAccumulator): { clockLabel?: string } {
  const clock = acc.research ?? acc.clock;
  return clock ? { clockLabel: researchClockLabel(clock.elapsed_ms, clock.budget_ms) } : {};
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

/** Label for a single web step event, formatted for display. */
export function stepLabel(step: StepEventData): string {
  const { kind, status, query, url } = step;

  // Handle new step kinds that don't have query/url fields
  if (kind === "continue") {
    return "Asked the model to continue";
  }
  if (kind === "answer_now") {
    return "Asked the model to answer now";
  }

  if (kind === "plan") {
    return status === "failed" ? "Planning (failed)" : "Planning";
  }
  if (kind === "write") {
    return status === "failed" ? "Writing report (failed)" : "Writing report";
  }

  if (status === "unavailable") {
    return kind === "search" ? "Search unavailable" : "Reading unavailable";
  }

  let base: string;
  if (kind === "search") {
    base = query ? `Searching: ${query}` : "Searching";
  } else {
    // kind === "read"
    let domain: string;
    if (url) {
      try {
        domain = new URL(url).hostname;
        // Strip leading www.
        if (domain.startsWith("www.")) {
          domain = domain.substring(4);
        }
      } catch {
        domain = url;
      }
    } else {
      domain = "";
    }
    base = domain ? `Reading: ${domain}` : "Reading";
  }

  return status === "failed" ? `${base} (failed)` : base;
}

/** Label for the web steps toggle button, by its current state. */
export function stepsToggleLabel(expanded: boolean, count: number): string {
  return expanded ? "Hide web steps" : `Show web steps (${count})`;
}

/** Label for a web source, preferring title over URL hostname. */
export function sourceLabel(source: { title: string; url: string }): string {
  const trimmedTitle = source.title.trim();
  if (trimmedTitle) {
    return trimmedTitle;
  }

  try {
    let hostname = new URL(source.url).hostname;
    // Strip leading www.
    if (hostname.startsWith("www.")) {
      hostname = hostname.substring(4);
    }
    return hostname;
  } catch {
    return source.url;
  }
}
