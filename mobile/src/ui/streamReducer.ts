/**
 * Pure logic for applying a stream of `StreamEvent`s to the text displayed on
 * the chat screen. Extracted out of `src/app/chat.tsx` (a `.tsx` module,
 * which cannot be imported by a bun test) so it can be tested directly.
 */

import type { StreamEvent } from "@/api/client";
import type { DoneEvent, SourcesEvent, StepEventData } from "@shared/api";

export interface StreamAccumulator {
  thinking: string;
  content: string;
  /** Web steps in arrival order, one entry per step_id. */
  steps: StepEventData[];
  sources: SourcesEvent["items"];
  /** Latest deep research clock from a step event; absent for ordinary replies. */
  clock?: { elapsed_ms: number; budget_ms: number };
  /** Deep research result from the done event; absent for ordinary replies. */
  research?: NonNullable<DoneEvent["research"]>;
}

export const initialStreamAccumulator: StreamAccumulator = {
  thinking: "",
  content: "",
  steps: [],
  sources: [],
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
    case "step": {
      const i = acc.steps.findIndex((s) => s.step_id === event.data.step_id);
      const steps =
        i === -1
          ? [...acc.steps, event.data]
          : acc.steps.map((s, j) => (j === i ? event.data : s));
      const { elapsed_ms, budget_ms } = event.data;
      return {
        ...acc,
        steps,
        ...(elapsed_ms !== undefined && budget_ms !== undefined
          ? { clock: { elapsed_ms, budget_ms } }
          : {}),
      };
    }
    case "sources":
      return { ...acc, sources: event.data.items };
    case "done":
      return event.data.research
        ? { ...acc, research: event.data.research }
        : acc;
    case "error":
      return acc;
  }
}
