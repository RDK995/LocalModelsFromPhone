/**
 * Pure view-model for the Conversations screen (src/app/conversations.tsx):
 * turning the store's `Conversation[]` (M3-T1) into the rows the screen
 * renders. Extracted the same way `modelList.ts` is extracted out of
 * `models.tsx`, so list/order behaviour is unit-testable without React
 * Native.
 */

import type { Conversation } from "@/store/conversationStore";

export interface ConversationRow {
  id: string;
  title: string;
  updatedLabel: string;
}

export interface ConversationListView {
  rows: ConversationRow[];
}

/**
 * Formats an ISO timestamp as "YYYY-MM-DD HH:MM" by slicing the string
 * (`Date.parse`'s ISO output is always this shape), rather than a
 * locale/relative format. That keeps this deterministic and testable
 * without injecting a fake "now" -- it depends only on the stored
 * timestamp, not on when the test runs.
 */
export function formatUpdatedAt(isoTimestamp: string): string {
  return `${isoTimestamp.slice(0, 10)} ${isoTimestamp.slice(11, 16)}`;
}

/**
 * Builds the rows the Conversations screen renders: newest-updated first.
 * The store's own `list()` already sorts this way, but this re-sorts
 * defensively so the view is correct regardless of the order it is called
 * with.
 */
export function toConversationListView(
  conversations: Conversation[]
): ConversationListView {
  const rows = [...conversations]
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
    .map((c) => ({
      id: c.id,
      title: c.title,
      updatedLabel: formatUpdatedAt(c.updated_at),
    }));

  return { rows };
}
