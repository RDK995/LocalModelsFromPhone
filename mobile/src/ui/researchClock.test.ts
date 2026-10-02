import { describe, it, expect } from "bun:test";
import { applyStreamEvent, initialStreamAccumulator, type StreamAccumulator } from "./streamReducer";
import { buildChatItems, type PendingTurn } from "./chatItems";
import { liveResearchElapsedMs, startSecondTicker } from "./deepResearch";

const t0 = 1_000_000;
const stepEvent = (id: string, elapsed_ms?: number, budget_ms = 480000) => ({
  type: "step" as const,
  data: {
    step_id: id,
    kind: "search" as const,
    status: "started" as const,
    ...(elapsed_ms === undefined ? {} : { elapsed_ms, budget_ms }),
  },
});

function label(acc: StreamAccumulator, now: number): string | undefined {
  const pending: PendingTurn = {
    userMessageId: "u",
    prompt: "p",
    assistantMessageId: "a",
    blocked: false,
    accumulator: acc,
  };
  const item = buildChatItems([], pending, now)[1];
  return item?.clockLabel;
}

describe("research clock ticks locally", () => {
  it("ticks every second from the last server elapsed_ms", () => {
    const acc = applyStreamEvent(initialStreamAccumulator, stepEvent("a", 10000), t0);
    expect(label(acc, t0)).toBe("0:10 of 8:00");
    expect(label(acc, t0 + 1000)).toBe("0:11 of 8:00");
    expect(label(acc, t0 + 2000)).toBe("0:12 of 8:00");
    expect(label(acc, t0 + 3000)).toBe("0:13 of 8:00");
  });

  it("never exceeds the budget", () => {
    const acc = applyStreamEvent(initialStreamAccumulator, stepEvent("a", 479000), t0);
    expect(label(acc, t0 + 5000)).toBe("8:00 of 8:00");
    expect(liveResearchElapsedMs({ elapsed_ms: 479000, budget_ms: 480000, anchored_at: t0 }, t0 + 5000)).toBe(480000);
  });

  it("re-anchors on every new server event", () => {
    let acc = applyStreamEvent(initialStreamAccumulator, stepEvent("a", 10000), t0);
    expect(label(acc, t0 + 4000)).toBe("0:14 of 8:00");
    acc = applyStreamEvent(acc, stepEvent("b", 12000), t0 + 4000);
    expect(label(acc, t0 + 4000)).toBe("0:12 of 8:00");
    expect(label(acc, t0 + 6000)).toBe("0:14 of 8:00");
  });

  it("re-anchors on the first event after a resume", () => {
    let acc = applyStreamEvent(initialStreamAccumulator, stepEvent("a", 20000), t0);
    acc = applyStreamEvent(acc, stepEvent("b", 30000), t0 + 10000);
    // dropped: no events for 60 s of local time; label keeps ticking locally
    expect(label(acc, t0 + 70000)).toBe("1:30 of 8:00");
    // resumed: first event after the resume carries the server's elapsed_ms
    acc = applyStreamEvent(acc, stepEvent("c", 75000), t0 + 70000);
    expect(label(acc, t0 + 70000)).toBe("1:15 of 8:00");
    expect(label(acc, t0 + 72000)).toBe("1:17 of 8:00");
  });

  it("ordinary replies get no clock label", () => {
    const acc = applyStreamEvent(initialStreamAccumulator, stepEvent("a"), t0);
    expect(label(acc, t0 + 5000)).toBeUndefined();
  });
});

describe("startSecondTicker", () => {
  it("calls onTick every 1000 ms and stops after the stop function", () => {
    let fn: (() => void) | undefined;
    let ms = 0;
    let cleared: unknown;
    const timers = {
      setInterval: (f: () => void, m: number) => {
        fn = f;
        ms = m;
        return 7;
      },
      clearInterval: (h: unknown) => {
        cleared = h;
        fn = undefined;
      },
    };
    let ticks = 0;
    const stop = startSecondTicker(() => ticks++, timers);
    expect(ms).toBe(1000);
    fn?.();
    fn?.();
    expect(ticks).toBe(2);
    stop();
    expect(cleared).toBe(7);
    expect(fn).toBeUndefined();
  });
});
