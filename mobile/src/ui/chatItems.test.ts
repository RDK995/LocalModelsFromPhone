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
  stepLabel,
  stepsToggleLabel,
  sourceLabel,
  type PendingTurn,
} from "./chatItems";
import type { Message } from "@/store/conversationStore";
import type { StepEventData } from "@shared/api";
import { initialStreamAccumulator } from "@/ui/streamReducer";
import { parseInline } from "@/ui/markdown";
import { presentCitation } from "@/ui/inlineLink";
import { sourceListHeader } from "@/ui/sourceListModel";

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

describe("buildChatItems: web steps and sources", () => {
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

  it("includes steps and sources from pending accumulator when non-empty", () => {
    const steps: StepEventData[] = [
      {
        step_id: "s1",
        kind: "search",
        status: "done",
        query: "test",
      },
    ];
    const sources = [{ title: "Example", url: "https://example.com" }];

    const items = buildChatItems(
      [],
      pendingTurn({
        accumulator: { content: "test", thinking: "", steps, sources },
      })
    );

    expect(items[1]).toHaveProperty("steps", steps);
    expect(items[1]).toHaveProperty("sources", sources);
  });

  it("omits steps from pending assistant item when empty", () => {
    const items = buildChatItems(
      [],
      pendingTurn({
        accumulator: { content: "test", thinking: "", steps: [], sources: [] },
      })
    );

    expect(items[1]).not.toHaveProperty("steps");
  });

  it("omits sources from pending assistant item when empty", () => {
    const items = buildChatItems(
      [],
      pendingTurn({
        accumulator: { content: "test", thinking: "", steps: [], sources: [] },
      })
    );

    expect(items[1]).not.toHaveProperty("sources");
  });

  it("includes steps and sources from persisted message when non-empty", () => {
    const steps: StepEventData[] = [
      {
        step_id: "s1",
        kind: "search",
        status: "done",
        query: "test",
      },
    ];
    const sources = [{ title: "Example", url: "https://example.com" }];
    const persisted = [
      assistantMessage("a1", "hello", { steps, sources }),
    ];

    const items = buildChatItems(persisted, null);

    expect(items[0]).toHaveProperty("steps", steps);
    expect(items[0]).toHaveProperty("sources", sources);
  });

  it("omits steps and sources from persisted message when not present", () => {
    const persisted = [assistantMessage("a1", "hello", {})];

    const items = buildChatItems(persisted, null);

    expect(items[0]).not.toHaveProperty("steps");
    expect(items[0]).not.toHaveProperty("sources");
  });

  it("omits steps and sources from persisted message when empty arrays", () => {
    const persisted = [
      assistantMessage("a1", "hello", { steps: [], sources: [] }),
    ];

    const items = buildChatItems(persisted, null);

    expect(items[0]).not.toHaveProperty("steps");
    expect(items[0]).not.toHaveProperty("sources");
  });
});

describe("stepLabel", () => {
  it("formats search started as 'Searching: <query>'", () => {
    const step: StepEventData = {
      step_id: "s1",
      kind: "search",
      status: "started",
      query: "test query",
    };
    expect(stepLabel(step)).toBe("Searching: test query");
  });

  it("formats search done as 'Searching: <query>'", () => {
    const step: StepEventData = {
      step_id: "s1",
      kind: "search",
      status: "done",
      query: "test query",
    };
    expect(stepLabel(step)).toBe("Searching: test query");
  });

  it("formats search with missing query as 'Searching'", () => {
    const step: StepEventData = {
      step_id: "s1",
      kind: "search",
      status: "done",
    };
    expect(stepLabel(step)).toBe("Searching");
  });

  it("appends ' (failed)' to failed search", () => {
    const step: StepEventData = {
      step_id: "s1",
      kind: "search",
      status: "failed",
      query: "test query",
    };
    expect(stepLabel(step)).toBe("Searching: test query (failed)");
  });

  it("returns 'Search unavailable' for unavailable search", () => {
    const step: StepEventData = {
      step_id: "s1",
      kind: "search",
      status: "unavailable",
    };
    expect(stepLabel(step)).toBe("Search unavailable");
  });

  it("formats read started as 'Reading: <hostname>'", () => {
    const step: StepEventData = {
      step_id: "s1",
      kind: "read",
      status: "started",
      url: "https://www.example.com/path",
    };
    expect(stepLabel(step)).toBe("Reading: example.com");
  });

  it("formats read done as 'Reading: <hostname>'", () => {
    const step: StepEventData = {
      step_id: "s1",
      kind: "read",
      status: "done",
      url: "https://www.example.com",
    };
    expect(stepLabel(step)).toBe("Reading: example.com");
  });

  it("strips www. from hostname", () => {
    const step: StepEventData = {
      step_id: "s1",
      kind: "read",
      status: "done",
      url: "https://www.github.com/",
    };
    expect(stepLabel(step)).toBe("Reading: github.com");
  });

  it("handles hostname without www.", () => {
    const step: StepEventData = {
      step_id: "s1",
      kind: "read",
      status: "done",
      url: "https://github.com",
    };
    expect(stepLabel(step)).toBe("Reading: github.com");
  });

  it("uses raw URL when hostname parsing fails", () => {
    const step: StepEventData = {
      step_id: "s1",
      kind: "read",
      status: "done",
      url: "not a valid url",
    };
    expect(stepLabel(step)).toBe("Reading: not a valid url");
  });

  it("returns 'Reading' when url is missing and read failed", () => {
    const step: StepEventData = {
      step_id: "s1",
      kind: "read",
      status: "failed",
    };
    expect(stepLabel(step)).toBe("Reading (failed)");
  });

  it("appends ' (failed)' to failed read with URL", () => {
    const step: StepEventData = {
      step_id: "s1",
      kind: "read",
      status: "failed",
      url: "https://www.example.com",
    };
    expect(stepLabel(step)).toBe("Reading: example.com (failed)");
  });

  it("returns 'Reading unavailable' for unavailable read", () => {
    const step: StepEventData = {
      step_id: "s1",
      kind: "read",
      status: "unavailable",
    };
    expect(stepLabel(step)).toBe("Reading unavailable");
  });

  it("does not throw on bad URL in try/catch", () => {
    const step: StepEventData = {
      step_id: "s1",
      kind: "read",
      status: "done",
      url: "ht!tp://inv@lid",
    };
    // Should not throw
    expect(() => stepLabel(step)).not.toThrow();
  });
});

describe("stepsToggleLabel", () => {
  it("returns 'Hide web steps' when expanded", () => {
    expect(stepsToggleLabel(true, 3)).toBe("Hide web steps");
  });

  it("returns 'Show web steps (<count>)' when collapsed", () => {
    expect(stepsToggleLabel(false, 3)).toBe("Show web steps (3)");
  });

  it("handles count of 0", () => {
    expect(stepsToggleLabel(false, 0)).toBe("Show web steps (0)");
  });

  it("handles count of 1", () => {
    expect(stepsToggleLabel(false, 1)).toBe("Show web steps (1)");
  });
});

describe("sourceLabel", () => {
  it("returns title when present and non-empty", () => {
    const source = { title: "Example Article", url: "https://example.com" };
    expect(sourceLabel(source)).toBe("Example Article");
  });

  it("returns hostname when title is empty string", () => {
    const source = { title: "", url: "https://www.example.com" };
    expect(sourceLabel(source)).toBe("example.com");
  });

  it("returns hostname when title is whitespace only", () => {
    const source = { title: "   ", url: "https://www.example.com" };
    expect(sourceLabel(source)).toBe("example.com");
  });

  it("strips www. from hostname", () => {
    const source = { title: "", url: "https://www.github.com/path" };
    expect(sourceLabel(source)).toBe("github.com");
  });

  it("handles hostname without www.", () => {
    const source = { title: "", url: "https://github.com" };
    expect(sourceLabel(source)).toBe("github.com");
  });

  it("handles bad URL gracefully", () => {
    const source = { title: "", url: "not a valid url" };
    // Should either return the URL or handle gracefully
    expect(() => sourceLabel(source)).not.toThrow();
  });
});

describe("deep research items", () => {
  const research = { status: "partial" as const, elapsed_ms: 400000, budget_ms: 480000 };
  const researchSteps: StepEventData[] = [
    { step_id: "p", kind: "plan", status: "done", elapsed_ms: 1000, budget_ms: 480000 },
    { step_id: "s", kind: "search", status: "done", query: "q", elapsed_ms: 2000, budget_ms: 480000 },
    { step_id: "r", kind: "read", status: "done", url: "https://www.x.test/a", elapsed_ms: 3000, budget_ms: 480000 },
    { step_id: "w", kind: "write", status: "done", elapsed_ms: 400000, budget_ms: 480000 },
  ];
  const sources = [
    { title: "X", url: "https://x.test/a", n: 1 },
    { title: "Y", url: "https://y.test/b", n: 2 },
  ];

  it("labels plan and write steps", () => {
    expect(stepLabel(researchSteps[0] as StepEventData)).toBe("Planning");
    expect(stepLabel(researchSteps[3] as StepEventData)).toBe("Writing report");
    expect(stepLabel({ step_id: "w", kind: "write", status: "failed" })).toBe("Writing report (failed)");
    expect(stepLabel({ step_id: "p", kind: "plan", status: "failed" })).toBe("Planning (failed)");
    expect(stepLabel(researchSteps[2] as StepEventData)).toBe("Reading: x.test");
    expect(stepLabel(researchSteps[1] as StepEventData)).toBe("Searching: q");
  });

  it("a persisted deep research message builds an item with research, steps and sources (n)", () => {
    const [item] = buildChatItems(
      [assistantMessage("a1", "report [1][2]", { steps: researchSteps, sources, research })],
      null
    );
    expect(item?.research).toEqual(research);
    expect(item?.steps).toEqual(researchSteps);
    expect(item?.sources).toEqual(sources);
    expect(item?.streaming).toBe(false);
    expect(item && "clockLabel" in item).toBe(false);
  });

  it("an ordinary message has no research", () => {
    const [item] = buildChatItems([assistantMessage("a1", "hi")], null);
    expect(item && "research" in item).toBe(false);
  });

  it("AC3.3: a reopened deep research message with empty content builds items with steps and 'Sources (n)' without throwing", () => {
    // Stopped deep research message: no content, but has steps and sources
    const stoppedMessage = assistantMessage("a1", "", { steps: researchSteps, sources, status: "stopped" });

    // Should not throw
    const items = buildChatItems([stoppedMessage], null);
    const [item] = items;

    // Should have the steps and sources
    expect(item?.steps).toEqual(researchSteps);
    expect(item?.sources).toEqual(sources);
    expect(item?.content).toBe("");
    expect(sourceListHeader(item?.sources ?? [])).toBe("Sources (2)");
    expect(item?.streaming).toBe(false);
  });

  it("a streaming item exposes the live clock label from the latest clock", () => {
    const pending: PendingTurn = {
      userMessageId: "u",
      prompt: "p",
      assistantMessageId: "a",
      blocked: false,
      accumulator: {
        ...initialStreamAccumulator,
        steps: researchSteps.slice(0, 2),
        clock: { elapsed_ms: 192000, budget_ms: 480000 },
      },
    };
    const item = buildChatItems([], pending)[1];
    expect(item?.clockLabel).toBe("3:12 of 8:00");
    expect(item && "research" in item).toBe(false);
  });

  it("a streaming item whose done result arrived carries research and the clock from it", () => {
    const pending: PendingTurn = {
      userMessageId: "u",
      prompt: "p",
      assistantMessageId: "a",
      blocked: false,
      accumulator: {
        ...initialStreamAccumulator,
        clock: { elapsed_ms: 1000, budget_ms: 480000 },
        research,
      },
    };
    const item = buildChatItems([], pending)[1];
    expect(item?.research).toEqual(research);
    expect(item?.clockLabel).toBe("6:40 of 8:00");
  });

  it("an ordinary streaming item has no clock label", () => {
    const pending: PendingTurn = {
      userMessageId: "u",
      prompt: "p",
      assistantMessageId: "a",
      blocked: false,
      accumulator: initialStreamAccumulator,
    };
    expect(buildChatItems([], pending)[1] && "clockLabel" in (buildChatItems([], pending)[1] as object)).toBe(false);
  });

  it("the report's [n] marks resolve to site logos through the ordinary citation path, and Sources counts the pages", () => {
    const [item] = buildChatItems(
      [assistantMessage("a1", "Fact [1] and more [2].", { sources, research })],
      null
    );
    const cites = parseInline(item?.content ?? []).flatMap((n) => (n.type === "cite" ? n.numbers : []));
    expect(cites).toEqual([1, 2]);
    expect(cites.map((n) => presentCitation(n, item?.sources))).toEqual([
      { kind: "source", url: "https://x.test/a", host: "x.test" },
      { kind: "source", url: "https://y.test/b", host: "y.test" },
    ]);
    expect(sourceListHeader(item?.sources ?? [])).toBe("Sources (2)");
  });
});
