/**
 * Pure logic for applying a stream of `StreamEvent`s to the text displayed on
 * the chat screen. Extracted out of `src/app/chat.tsx` (a `.tsx` module,
 * which cannot be imported by a bun test) so it can be tested directly.
 */

import type { StreamEvent } from "@/api/client";

export interface StreamAccumulator {
  thinking: string;
  content: string;
}

export const initialStreamAccumulator: StreamAccumulator = {
  thinking: "",
  content: "",
};

/**
 * Fold one `StreamEvent` into the accumulated thinking/content text shown to
 * the user. `thinking` and `content` events append their text; `done` and
 * `error` events carry no displayed text of their own and leave the
 * accumulator unchanged (the caller is responsible for reacting to them,
 * e.g. throwing on `error`).
 */
export function applyStreamEvent(
  acc: StreamAccumulator,
  event: StreamEvent
): StreamAccumulator {
  switch (event.type) {
    case "thinking":
      return { ...acc, thinking: acc.thinking + event.data.text };
    case "content":
      return { ...acc, content: acc.content + event.data.text };
    case "done":
    case "error":
      return acc;
  }
}
