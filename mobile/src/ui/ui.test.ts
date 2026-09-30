/**
 * Behavioural tests for the pure stream-to-display logic used by the chat
 * screen (src/app/chat.tsx): folding a sequence of `StreamEvent`s into the
 * thinking/content text shown to the user.
 */

import { describe, it, expect } from "bun:test";
import {
  applyStreamEvent,
  initialStreamAccumulator,
} from "./streamReducer";
import type { StreamEvent } from "@/api/client";

describe("applyStreamEvent", () => {
  it("appends content events to the displayed content, in order", () => {
    const events: StreamEvent[] = [
      { type: "content", data: { text: "Hel" } },
      { type: "content", data: { text: "lo" } },
      { type: "content", data: { text: " World" } },
    ];

    const result = events.reduce(applyStreamEvent, initialStreamAccumulator);

    expect(result).toEqual({
      thinking: "",
      content: "Hello World",
      steps: [],
      sources: [],
    });
  });

  it("appends thinking events to the displayed thinking text, separately from content", () => {
    const events: StreamEvent[] = [
      { type: "thinking", data: { text: "Let " } },
      { type: "content", data: { text: "answer: " } },
      { type: "thinking", data: { text: "me think" } },
      { type: "content", data: { text: "42" } },
    ];

    const result = events.reduce(applyStreamEvent, initialStreamAccumulator);

    expect(result).toEqual({
      thinking: "Let me think",
      content: "answer: 42",
      steps: [],
      sources: [],
    });
  });

  it("leaves the accumulator unchanged on a done event", () => {
    const afterContent = applyStreamEvent(initialStreamAccumulator, {
      type: "content",
      data: { text: "hi" },
    });

    const result = applyStreamEvent(afterContent, {
      type: "done",
      data: { status: "complete", model: "m", eval_count: 1, tokens_per_second: 1 },
    });

    expect(result).toBe(afterContent);
  });

  it("leaves the accumulator unchanged on an error event", () => {
    const afterContent = applyStreamEvent(initialStreamAccumulator, {
      type: "content",
      data: { text: "hi" },
    });

    const result = applyStreamEvent(afterContent, {
      type: "error",
      data: { code: "internal_error", message: "boom" },
    });

    expect(result).toBe(afterContent);
  });
});
