import { describe, expect, test } from "bun:test";
import {
  checkPassBar,
  computeMetrics,
  mergeEvents,
  nearestRank,
  parseSse,
  buildResult,
  selectFr41Lines,
  selectRunEndLine,
  selectNoteDroppedLines,
  checkSavedSources,
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

describe("notes_kept from the deep_research_run_end line (M19g)", () => {
  const runEnd = JSON.stringify({ event: "deep_research_run_end", notes_kept: 7, pages_read: 9, status: "complete", elapsed_ms: 1234 });
  test("selectRunEndLine picks the run-end line verbatim, ignoring other lines", () => {
    const log = [line("brief", false, 1000), "noise", runEnd].join("\n");
    expect(selectRunEndLine(log)).toBe(runEnd);
    expect(selectFr41Lines(log).length).toBe(1);
  });
  test("buildResult takes notes_kept from that line", () => {
    const r = buildResult(events({}), [line("brief", false, 1000)], 10, {}, runEnd);
    expect(r.notes_kept).toBe(7);
    expect(r.notes_kept_reason).toBeUndefined();
  });
  test("buildResult reports null with a reason when no run-end line is in the window", () => {
    const r = buildResult(events({}), [line("brief", false, 1000)], 10, {}, null);
    expect(r.notes_kept).toBeNull();
    expect(typeof r.notes_kept_reason).toBe("string");
  });
});

describe("selectNoteDroppedLines (M24)", () => {
  const dropLine1 = JSON.stringify({ event: "deep_research_note_dropped", run: "gen1", n: 1, reason: "missing_quote", quote: "test quote" });
  const dropLine2 = JSON.stringify({ event: "deep_research_note_dropped", run: "gen1", n: 2, reason: "quote_not_found", quote: "another" });
  const dropLine3 = JSON.stringify({ event: "deep_research_note_dropped", run: "gen2", n: 1, reason: "missing_claim", quote: "claim" });

  test("picks only drop lines, verbatim", () => {
    const log = [line("brief", false, 1000), "noise", dropLine1, dropLine2, "more noise"].join("\n");
    const selected = selectNoteDroppedLines(log);
    expect(selected.length).toBe(2);
    expect(selected[0]).toBe(dropLine1);
    expect(selected[1]).toBe(dropLine2);
  });

  test("filters by runId when provided", () => {
    const log = [dropLine1, dropLine2, dropLine3].join("\n");
    const selected = selectNoteDroppedLines(log, "gen1");
    expect(selected.length).toBe(2);
    expect(selected[0]).toBe(dropLine1);
    expect(selected[1]).toBe(dropLine2);
  });

  test("ignores a non-JSON line containing the event name", () => {
    const log = ["some text with deep_research_note_dropped in it", dropLine1].join("\n");
    const selected = selectNoteDroppedLines(log);
    expect(selected.length).toBe(1);
    expect(selected[0]).toBe(dropLine1);
  });
});

describe("buildResult with notes dropped (M24)", () => {
  const dropLine1 = JSON.stringify({ event: "deep_research_note_dropped", run: "gen1", n: 1, reason: "quote_not_found", quote: "test" });
  const dropLine2 = JSON.stringify({ event: "deep_research_note_dropped", run: "gen1", n: 2, reason: "missing_quote", quote: "quote" });
  const runEnd = JSON.stringify({ event: "deep_research_run_end", notes_kept: 5, notes_dropped: 2, pages_read: 9, status: "complete", elapsed_ms: 1234 });

  test("includes notes_dropped, drop_reasons, and note_drop_lines from drop lines", () => {
    const r = buildResult(events({}), [line("brief", false, 1000)], 10, {}, runEnd, [dropLine1, dropLine2]);
    expect(r.notes_dropped).toBe(2);
    expect(r.drop_reasons).toEqual({ quote_not_found: 1, missing_quote: 1 });
    expect(r.note_drop_lines).toBe(2);
  });

  test("sets notes_dropped to null with reason when run-end line lacks the field", () => {
    const runEndNoDropped = JSON.stringify({ event: "deep_research_run_end", notes_kept: 5, pages_read: 9 });
    const r = buildResult(events({}), [line("brief", false, 1000)], 10, {}, runEndNoDropped, [dropLine1]);
    expect(r.notes_dropped).toBeNull();
    expect(typeof r.notes_dropped_reason).toBe("string");
  });
});

describe("checkSavedSources (M24)", () => {
  test("classifies a Client Challenge page as unreadable blocked", () => {
    const sources = [{ n: 1, url: "https://example.com/blocked" }];
    const texts = [{
      n: 1,
      url: "https://example.com/blocked",
      title: "Page",
      markdown: "Client Challenge - checking if the site connection is secure",
      x_cache: "hit",
    }];
    const result = checkSavedSources(sources, texts);
    expect(result.unreadable_sources.length).toBe(1);
    expect(result.unreadable_sources[0]!.reason).toBe("blocked");
    expect(result.ok).toBe(false);
  });

  test("classifies a 10-word page as unreadable empty", () => {
    const sources = [{ n: 1, url: "https://example.com/short" }];
    const texts = [{
      n: 1,
      url: "https://example.com/short",
      title: "Short",
      markdown: "one two three four five six seven eight nine ten",
      x_cache: "hit",
    }];
    const result = checkSavedSources(sources, texts);
    expect(result.unreadable_sources.length).toBe(1);
    expect(result.unreadable_sources[0]!.reason).toBe("empty");
    expect(result.ok).toBe(false);
  });

  test("classifies a 60-word article as readable", () => {
    const sources = [{ n: 1, url: "https://example.com/article" }];
    const words = Array(60).fill("word").join(" ");
    const texts = [{
      n: 1,
      url: "https://example.com/article",
      title: "Article",
      markdown: words,
      x_cache: "hit",
    }];
    const result = checkSavedSources(sources, texts);
    expect(result.unreadable_sources.length).toBe(0);
    expect(result.ok).toBe(true);
  });

  test("marks a source with no matching text entry as unchecked", () => {
    const sources = [{ n: 1, url: "https://example.com/a" }, { n: 2, url: "https://example.com/b" }];
    const texts = [{
      n: 1,
      url: "https://example.com/a",
      title: "A",
      markdown: "word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word",
      x_cache: "hit",
    }];
    const result = checkSavedSources(sources, texts);
    expect(result.unchecked_sources.length).toBe(1);
    expect(result.unchecked_sources[0]!.n).toBe(2);
    expect(result.ok).toBe(false);
  });

  test("ok only when all readable and no unchecked", () => {
    const sources = [{ n: 1, url: "https://example.com/1" }];
    const words = Array(60).fill("word").join(" ");
    const texts = [{
      n: 1,
      url: "https://example.com/1",
      title: "Good",
      markdown: words,
      x_cache: "hit",
    }];
    const result = checkSavedSources(sources, texts);
    expect(result.ok).toBe(true);
  });
});
