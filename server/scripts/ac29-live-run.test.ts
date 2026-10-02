import { describe, expect, test } from "bun:test";
import {
  checkPassBar,
  computeMetrics,
  mergeEvents,
  nearestRank,
  parseSse,
  selectFr41Lines,
  type SseEvent,
} from "./ac29-live-run";

const ev = (seq: number, type: string, data: unknown) =>
  `id: g1-${seq}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

describe("parseSse", () => {
  test("ignores comment keep-alives and parses id/event/data", () => {
    const raw = `: connected\n\n${ev(0, "step", { kind: "plan" })}: keep-alive\n\n${ev(1, "content", { text: "hi" })}`;
    const events = parseSse(raw);
    expect(events.map((e) => e.type)).toEqual(["step", "content"]);
    expect(events[0]!.seq).toBe(0);
    expect(events[1]!.data.text).toBe("hi");
  });
  test("joins multi-line data", () => {
    const raw = `id: g1-5\nevent: content\ndata: {"text":\ndata: "ab"}\n\n`;
    expect(parseSse(raw)[0]!.data.text).toBe("ab");
  });
  test("resume concatenation drops duplicate seq", () => {
    const a = parseSse(ev(0, "step", {}) + ev(1, "step", {}));
    const b = parseSse(ev(1, "step", {}) + ev(2, "done", { status: "complete" }));
    const merged = mergeEvents(a, b);
    expect(merged.map((e) => e.seq)).toEqual([0, 1, 2]);
  });
});

const events = (opts: { status?: string; content?: string; reads?: number; sources?: number }): SseEvent[] => {
  const n = opts.sources ?? 3;
  const reads = opts.reads ?? 3;
  const out: string[] = [];
  let s = 0;
  for (let i = 1; i <= reads; i++) out.push(ev(s++, "step", { kind: "read", status: "done", url: `https://x/${i}` }));
  out.push(ev(s++, "sources", { items: Array.from({ length: n }, (_, i) => ({ n: i + 1, url: `https://x/${i + 1}`, title: "t" })) }));
  out.push(ev(s++, "content", { text: opts.content ?? "A [1] B [2] C [3]" }));
  out.push(ev(s++, "done", { status: "complete", research: { status: opts.status ?? "complete", elapsed_ms: 1, budget_ms: 480000 } }));
  return parseSse(out.join(""));
};

describe("checkPassBar", () => {
  test("passing case", () => {
    const r = checkPassBar(events({}), 300, 480);
    expect(r.pass).toBe(true);
    expect(r.cited_read_pages).toBe(3);
    expect(r.unresolved_citations).toEqual([]);
  });
  test("fails on status", () => {
    const r = checkPassBar(events({ status: "failed" }), 300, 480);
    expect(r.pass).toBe(false);
    expect(r.checks.status_ok.ok).toBe(false);
  });
  test("fails when over budget plus margin", () => {
    const r = checkPassBar(events({}), 541, 480);
    expect(r.checks.within_budget.ok).toBe(false);
    expect(r.pass).toBe(false);
    expect(checkPassBar(events({}), 540, 480).checks.within_budget.ok).toBe(true);
  });
  test("fails with fewer than 3 cited read pages", () => {
    const r = checkPassBar(events({ content: "A [1] B [2]" }), 300, 480);
    expect(r.cited_read_pages).toBe(2);
    expect(r.pass).toBe(false);
  });
  test("fails on unresolved citation", () => {
    const r = checkPassBar(events({ content: "A [1] [2] [3] [9]" }), 300, 480);
    expect(r.unresolved_citations).toEqual([9]);
    expect(r.pass).toBe(false);
  });
});

const line = (step: string, think: boolean | undefined, wall_ms: number, attempt = 1) =>
  JSON.stringify({ event: "deep_research_model_call", step, think, attempt, wall_ms, load_duration: 0, prompt_eval_count: 1, prompt_eval_duration: 1, eval_count: 1, eval_duration: 1, thinking_chars: 0, thinking_detected: false, outcome: "ok" });

describe("FR41 selection and metrics", () => {
  const log = [
    "some other line",
    JSON.stringify({ event: "deep_research_page_skipped", n: 1 }),
    line("brief", false, 2000),
    line("plan", true, 30000),
    line("plan", false, 10000, 2),
    line("queries", false, 4000),
    line("notes", false, 6000),
    line("notes", false, 8000),
    line("gap", false, 12000),
    line("write", true, 90000),
  ].join("\n");

  test("selects only model-call lines, verbatim", () => {
    const sel = selectFr41Lines(log);
    expect(sel.length).toBe(8);
    expect(sel[0]).toBe(line("brief", false, 2000));
  });
  test("nearest-rank percentiles", () => {
    expect(nearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(nearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(nearestRank([], 50)).toBeNull();
  });
  test("metrics", () => {
    const m = computeMetrics(selectFr41Lines(log));
    expect(m.planning_s).toBe(40);
    expect(m.research_phase_calls).toBe(4); // queries, notes, notes, gap
    expect(m.routine_calls).toBe(5); // brief, queries, notes, notes, gap
    expect(m.routine_p50_s).toBe(6);
    expect(m.routine_p95_s).toBe(12);
  });
});
