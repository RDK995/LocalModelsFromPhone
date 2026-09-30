import { describe, it, expect } from "bun:test";
import type { StepEventData } from "@shared/api";
import {
  applyStreamEvent,
  initialStreamAccumulator,
} from "@/ui/streamReducer";

const step = (
  step_id: string,
  status: StepEventData["status"],
  extra: Partial<StepEventData> = {}
) => ({
  type: "step" as const,
  data: { step_id, kind: "search" as const, status, ...extra },
});

describe("applyStreamEvent web steps and sources", () => {
  it("starts with empty steps and sources", () => {
    expect(initialStreamAccumulator.steps).toEqual([]);
    expect(initialStreamAccumulator.sources).toEqual([]);
  });

  it("upserts a step by id: started then done leaves one done entry", () => {
    const acc = [step("a", "started"), step("a", "done")].reduce(
      applyStreamEvent,
      initialStreamAccumulator
    );
    expect(acc.steps).toEqual([step("a", "done").data]);
  });

  it("does not add a second entry for a replayed duplicate", () => {
    const acc = [step("a", "started"), step("a", "started")].reduce(
      applyStreamEvent,
      initialStreamAccumulator
    );
    expect(acc.steps).toHaveLength(1);
  });

  it("keeps two steps in arrival order, replacing in place", () => {
    const acc = [step("a", "started"), step("b", "started"), step("a", "done")].reduce(
      applyStreamEvent,
      initialStreamAccumulator
    );
    expect(acc.steps.map((s) => [s.step_id, s.status])).toEqual([
      ["a", "done"],
      ["b", "started"],
    ]);
  });

  it("keeps n on sources", () => {
    const acc = applyStreamEvent(initialStreamAccumulator, {
      type: "sources",
      data: { items: [{ title: "A", url: "https://a", n: 1 }] },
    });
    expect(acc.sources).toEqual([{ title: "A", url: "https://a", n: 1 }]);
  });
  it("replaces sources with the latest event's items", () => {
    const one = applyStreamEvent(initialStreamAccumulator, {
      type: "sources",
      data: { items: [{ title: "A", url: "https://a" }] },
    });
    const two = applyStreamEvent(one, {
      type: "sources",
      data: { items: [{ title: "B", url: "https://b" }] },
    });
    expect(two.sources).toEqual([{ title: "B", url: "https://b" }]);
  });

  it("still accumulates thinking and content text", () => {
    const acc = applyStreamEvent(
      applyStreamEvent(initialStreamAccumulator, { type: "thinking", data: { text: "t" } }),
      { type: "content", data: { text: "c" } }
    );
    expect(acc.thinking).toBe("t");
    expect(acc.content).toBe("c");
  });
});
