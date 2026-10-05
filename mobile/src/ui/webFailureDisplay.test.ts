/**
 * Test: web reply with failed/unavailable steps and answer content renders correctly.
 * M13-AC1, M13-AC2: both failed steps and completed answer shown, reply not in progress.
 */

import { describe, it, expect } from "bun:test";
import { buildChatItems, stepLabel } from "./chatItems";
import type { Message } from "@/store/conversationStore";
import type { StepEventData } from "@shared/api";

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


describe("Web failure display: unavailable and failed steps with answer", () => {
  it("shows 'Search unavailable' and answer text when unavailable search step precedes done", () => {
    // M13-AC1: unavailable search + answer + done → chat items show "Search unavailable" and answer, reply not in progress
    const steps: StepEventData[] = [
      {
        step_id: "s1",
        kind: "search",
        status: "unavailable",
      },
    ];

    const persisted = [
      userMessage("u1", "search for something"),
      assistantMessage("a1", "Here is the answer based on available information.", {
        steps,
      }),
    ];

    const items = buildChatItems(persisted, null);

    // Assistant item is the second item
    const assistantItem = items[1];

    // Steps should be included
    expect(assistantItem).toHaveProperty("steps", steps);

    // The label should be "Search unavailable"
    expect(stepLabel(steps[0])).toBe("Search unavailable");

    // Answer content should be present
    expect(assistantItem.content).toBe(
      "Here is the answer based on available information."
    );

    // Reply should not be in progress (persisted messages have streaming: false)
    expect(assistantItem.streaming).toBe(false);
  });

  it("shows failed search step label and answer when search fails with timeout", () => {
    // M13-AC2: failed search (detail timeout) + answer → shows "Searching: <query> (failed)" and answer
    const steps: StepEventData[] = [
      {
        step_id: "s1",
        kind: "search",
        status: "failed",
        query: "climate change",
        detail: "timeout",
      },
    ];

    const persisted = [
      userMessage("u1", "search for climate"),
      assistantMessage(
        "a1",
        "I could not search online due to a timeout, but here is what I know.",
        { steps }
      ),
    ];

    const items = buildChatItems(persisted, null);

    const assistantItem = items[1];

    // Steps should be included
    expect(assistantItem).toHaveProperty("steps", steps);

    // The label should include "(failed)"
    expect(stepLabel(steps[0])).toBe("Searching: climate change (failed)");

    // Answer content should be present
    expect(assistantItem.content).toBe(
      "I could not search online due to a timeout, but here is what I know."
    );

    // Reply should be complete (not in progress)
    expect(assistantItem.streaming).toBe(false);
  });

  it("shows failed read step label and answer when read fails with timeout", () => {
    // M13-AC2: failed read (detail timeout) + answer → shows read label with "(failed)" and answer
    const steps: StepEventData[] = [
      {
        step_id: "s1",
        kind: "search",
        status: "done",
        query: "example",
      },
      {
        step_id: "s2",
        kind: "read",
        status: "failed",
        url: "https://www.example.com/page",
        detail: "timeout",
      },
    ];

    const persisted = [
      userMessage("u1", "find information"),
      assistantMessage("a1", "The page could not be read due to a timeout.", {
        steps,
      }),
    ];

    const items = buildChatItems(persisted, null);

    const assistantItem = items[1];

    // Steps should be included
    expect(assistantItem).toHaveProperty("steps", steps);

    // The failed read label should include "(failed)"
    const failedReadStep = steps[1];
    expect(stepLabel(failedReadStep)).toBe("Reading: example.com (failed)");

    // Answer content should be present
    expect(assistantItem.content).toBe(
      "The page could not be read due to a timeout."
    );

    // Reply should be complete (not in progress)
    expect(assistantItem.streaming).toBe(false);
  });

  it("shows multiple steps including unavailable and failed alongside completed answer", () => {
    // Complex scenario: multiple steps with different statuses, all shown with answer content
    const steps: StepEventData[] = [
      {
        step_id: "s1",
        kind: "search",
        status: "unavailable",
      },
      {
        step_id: "s2",
        kind: "search",
        status: "failed",
        query: "backup search",
        detail: "timeout",
      },
    ];

    const persisted = [
      userMessage("u1", "get information"),
      assistantMessage(
        "a1",
        "Multiple searches were attempted but encountered issues. Here is my answer.",
        { steps }
      ),
    ];

    const items = buildChatItems(persisted, null);

    const assistantItem = items[1];

    // All steps should be included
    expect(assistantItem).toHaveProperty("steps", steps);

    // First step label
    expect(stepLabel(steps[0])).toBe("Search unavailable");

    // Second step label
    expect(stepLabel(steps[1])).toBe("Searching: backup search (failed)");

    // Answer content should be present
    expect(assistantItem.content).toContain(
      "Multiple searches were attempted but encountered issues"
    );

    // Reply should be complete
    expect(assistantItem.streaming).toBe(false);
  });

  it("includes failed steps in persisted messages with completed answers", () => {
    // Test with persisted messages (not pending turn)
    const steps: StepEventData[] = [
      {
        step_id: "s1",
        kind: "search",
        status: "failed",
        query: "test query",
        detail: "timeout",
      },
    ];

    const persisted = [
      userMessage("u1", "search for test"),
      assistantMessage("a1", "The search failed but here is general information.", {
        steps,
      }),
    ];

    const items = buildChatItems(persisted, null);

    const assistantItem = items[1];

    // Steps should be present in the built item
    expect(assistantItem).toHaveProperty("steps", steps);

    // Should have the failed step label
    expect(stepLabel(steps[0])).toBe("Searching: test query (failed)");

    // Answer should be complete
    expect(assistantItem.content).toBe(
      "The search failed but here is general information."
    );

    // Persisted messages are never in progress
    expect(assistantItem.streaming).toBe(false);
  });
});
