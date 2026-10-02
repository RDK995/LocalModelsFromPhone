/**
 * M19g AC29/AC32 live-run evidence tool. Sends ONE deep research question through the server API,
 * captures the raw SSE stream, reads the run's FR41 log lines, and records the pass bar and speed figures.
 *
 * Usage (from server/):
 *   bun run scripts/ac29-live-run.ts --id <q1|q2|q3|heat> [--out-dir ../.harness/evidence --prefix M19g-T3]
 *   bun run scripts/ac29-live-run.ts --check-only <stream.txt> --log <fr41.log>
 * Exit: 0 pass, 1 a pass-bar check failed, 2 tool error.
 *
 * Metric definitions:
 *   total_wall_s          POST sent -> `done` event received (client clock).
 *   planning_s            sum of wall times of FR41 lines whose step is `plan` (all attempts, incl. a think:false re-issue).
 *   research_phase_calls  count of FR41 lines whose step is NOT brief, plan or write.
 *   routine p50/p95 (s)   nearest-rank percentiles of wall times of FR41 lines sent with think=false whose step
 *                         is not plan or write (brief, queries, pages, notes, gap).
 *   distinct_pages_read   distinct urls of `step` events of kind read with status done.
 *   notes_kept            null: the server exposes no notes count (not in FR41 lines, step events or `done`).
 *   pass bar              final status (done.research.status, else done.status) in {complete, partial};
 *                         total_wall_s <= budget_s + 60 (margin; no different M17 margin exists in server tests);
 *                         cited distinct read pages >= 3 (cited [n] that is in sources AND whose url had a done read step);
 *                         unresolved citations (cited [n] not in sources) empty. pass = all hold.
 *
 * FR41 lines (server/src/generations/research.ts logModelCall) are JSON lines on stdout, event
 * "deep_research_model_call", with NO run id and NO timestamp. They are selected by the run's window:
 * the server.log byte offset taken just before the POST up to the end of the log after `done`.
 * (Only one run at a time is therefore valid.) Budget default 480 s (research.ts DEFAULT budgetMs).
 */
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SseEvent {
  id: string | null;
  seq: number | null;
  type: string;
  data: any;
}

/** Parses SSE text; `:` comment lines are ignored, multi-line `data:` joined. */
export function parseSse(raw: string): SseEvent[] {
  const out: SseEvent[] = [];
  for (const block of raw.split(/\r?\n\r?\n/)) {
    let type = "";
    let id: string | null = null;
    const dataLines: string[] = [];
    for (const l of block.split(/\r?\n/)) {
      if (l.startsWith(":")) continue;
      if (l.startsWith("event:")) type = l.slice(6).trim();
      else if (l.startsWith("id:")) id = l.slice(3).trim();
      else if (l.startsWith("data:")) dataLines.push(l.slice(5).replace(/^ /, ""));
    }
    if (!type || dataLines.length === 0) continue;
    let data: any;
    try {
      data = JSON.parse(dataLines.join("\n"));
    } catch {
      continue;
    }
    const m = id?.match(/-(\d+)$/);
    out.push({ id, seq: m ? Number(m[1]) : null, type, data });
  }
  return out;
}

/** Appends resumed events, skipping any whose seq was already seen. */
export function mergeEvents(first: SseEvent[], more: SseEvent[]): SseEvent[] {
  const seen = new Set(first.filter((e) => e.seq !== null).map((e) => e.seq));
  const out = [...first];
  for (const e of more) {
    if (e.seq !== null && seen.has(e.seq)) continue;
    if (e.seq !== null) seen.add(e.seq);
    out.push(e);
  }
  return out;
}

export const MARGIN_S = 60;
export const DEFAULT_BUDGET_S = 480;

export interface Check {
  ok: boolean;
  value: unknown;
}
export interface PassBar {
  final_status: string | null;
  cited_read_pages: number;
  unresolved_citations: number[];
  checks: Record<"status_ok" | "within_budget" | "cited_read_pages_ok" | "no_unresolved_citations", Check>;
  pass: boolean;
}

export function checkPassBar(events: SseEvent[], totalWallS: number, budgetS: number): PassBar {
  const done = events.filter((e) => e.type === "done").pop();
  const finalStatus: string | null = done?.data?.research?.status ?? done?.data?.status ?? null;
  const content = events.filter((e) => e.type === "content").map((e) => e.data.text ?? "").join("");
  const sources: { n: number; url: string }[] = events.filter((e) => e.type === "sources").pop()?.data.items ?? [];
  const readUrls = new Set(
    events.filter((e) => e.type === "step" && e.data.kind === "read" && e.data.status === "done").map((e) => e.data.url)
  );
  const cited = new Set<number>();
  for (const m of content.matchAll(/\[(\d+)\]/g)) cited.add(Number(m[1]));
  const sourceNs = new Set(sources.map((s) => s.n));
  const unresolved = [...cited].filter((n) => !sourceNs.has(n)).sort((a, b) => a - b);
  const citedReadPages = new Set(sources.filter((s) => cited.has(s.n) && readUrls.has(s.url)).map((s) => s.url)).size;
  const checks = {
    status_ok: { ok: finalStatus === "complete" || finalStatus === "partial", value: finalStatus },
    within_budget: { ok: totalWallS <= budgetS + MARGIN_S, value: { total_wall_s: totalWallS, limit_s: budgetS + MARGIN_S } },
    cited_read_pages_ok: { ok: citedReadPages >= 3, value: citedReadPages },
    no_unresolved_citations: { ok: unresolved.length === 0, value: unresolved },
  };
  return {
    final_status: finalStatus,
    cited_read_pages: citedReadPages,
    unresolved_citations: unresolved,
    checks,
    pass: Object.values(checks).every((c) => c.ok),
  };
}

/** The FR41 model-call lines of a log, verbatim. */
export function selectFr41Lines(logText: string): string[] {
  return logText.split("\n").filter((l) => {
    if (!l.includes("deep_research_model_call")) return false;
    try {
      return JSON.parse(l).event === "deep_research_model_call";
    } catch {
      return false;
    }
  });
}

export function nearestRank(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)]!;
}

export function computeMetrics(fr41: string[]) {
  const calls = fr41.map((l) => JSON.parse(l) as { step: string; think?: boolean; wall_ms: number });
  const planning = calls.filter((c) => c.step === "plan").reduce((a, c) => a + c.wall_ms, 0) / 1000;
  const research = calls.filter((c) => !["brief", "plan", "write"].includes(c.step));
  const routine = calls.filter((c) => c.think === false && c.step !== "plan" && c.step !== "write").map((c) => c.wall_ms / 1000);
  return {
    planning_s: planning,
    research_phase_calls: research.length,
    routine_calls: routine.length,
    routine_p50_s: nearestRank(routine, 50),
    routine_p95_s: nearestRank(routine, 95),
  };
}

export function distinctPagesRead(events: SseEvent[]): number {
  return new Set(
    events.filter((e) => e.type === "step" && e.data.kind === "read" && e.data.status === "done").map((e) => e.data.url)
  ).size;
}

export function budgetFromEvents(events: SseEvent[]): number {
  for (const e of events) if (typeof e.data?.budget_ms === "number") return e.data.budget_ms / 1000;
  return DEFAULT_BUDGET_S;
}

export function buildResult(events: SseEvent[], fr41: string[], totalWallS: number, extra: Record<string, unknown>) {
  const budgetS = budgetFromEvents(events);
  const bar = checkPassBar(events, totalWallS, budgetS);
  return {
    ...extra,
    budget_s: budgetS,
    total_wall_s: totalWallS,
    ...computeMetrics(fr41),
    fr41_lines: fr41.length,
    distinct_pages_read: distinctPagesRead(events),
    notes_kept: null,
    notes_kept_reason: "the server exposes no notes count (not in FR41 lines, step events or the done event)",
    ...bar,
  };
}

// ---------------------------------------------------------------- CLI

const BASE = "http://127.0.0.1:7789";
const SERVER_LOG = join(homedir(), "Library/Logs/phone-models/server.log");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function readFrom(path: string, offset: number): string {
  const size = statSync(path).size;
  if (size <= offset) return "";
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(size - offset);
    readSync(fd, buf, 0, buf.length, offset);
    return buf.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/** Reads the response into the stream file until `done` arrives, the stream ends, or the deadline passes. */
async function pump(res: Response, streamPath: string, deadline: number): Promise<boolean> {
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let tail = "";
  let sawDone = false;
  for (;;) {
    if (Date.now() >= deadline) break;
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = dec.decode(value, { stream: true });
    appendFileSync(streamPath, chunk);
    tail = (tail + chunk).slice(-4000);
    if (/event: done\n/.test(tail)) {
      sawDone = true;
      break;
    }
  }
  await reader.cancel().catch(() => {});
  return sawDone;
}

async function live(): Promise<number> {
  const id = arg("--id");
  const questions = JSON.parse(readFileSync(join(import.meta.dir, "ac29-questions.json"), "utf8"));
  if (!id || !(id in questions)) throw new Error("--id must be one of " + Object.keys(questions).join("|"));
  const outDir = arg("--out-dir") ?? "../.harness/evidence";
  const prefix = arg("--prefix") ?? "M19g";
  const base = `${outDir}/${prefix}-${id}`;
  const token = readFileSync(join(homedir(), ".phone-models/token"), "utf8").trim();
  const headers = { Authorization: `Bearer ${token}` };
  const question: string = questions[id];
  const streamPath = `${base}-stream.txt`;
  writeFileSync(streamPath, "");
  const offset = existsSync(SERVER_LOG) ? statSync(SERVER_LOG).size : 0;
  const start = Date.now();
  const deadline = start + (DEFAULT_BUDGET_S + 120) * 1000;
  let sawDone = false;
  try {
    const res = await fetch(`${BASE}/v1/chat`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "qwen3.5:35b-a3b", web: true, deep_research: true, messages: [{ role: "user", content: question }] }),
      signal: AbortSignal.timeout(deadline - Date.now()),
    });
    sawDone = await pump(res, streamPath, deadline);
  } catch (e) {
    console.error("stream dropped:", (e as Error).message);
  }
  // Resume after a drop with Last-Event-ID until done or the hard client cap.
  for (let tries = 0; !sawDone && Date.now() < deadline && tries < 200; tries++) {
    const last = parseSse(readFileSync(streamPath, "utf8")).filter((e) => e.id).pop();
    if (!last?.id) break;
    const gen = last.id.replace(/-\d+$/, "");
    try {
      const res = await fetch(`${BASE}/v1/generations/${gen}/events`, {
        headers: { ...headers, "Last-Event-ID": last.id },
        signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
      });
      sawDone = await pump(res, streamPath, deadline);
    } catch (e) {
      console.error("resume failed:", (e as Error).message);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  const end = Date.now();
  const events = mergeEvents([], parseSse(readFileSync(streamPath, "utf8")));
  const fr41 = selectFr41Lines(existsSync(SERVER_LOG) ? readFrom(SERVER_LOG, offset) : "");
  writeFileSync(`${base}-fr41.log`, fr41.join("\n") + (fr41.length ? "\n" : ""));
  const result = buildResult(events, fr41, (end - start) / 1000, {
    id,
    question,
    generation_id: events.find((e) => e.id)?.id?.replace(/-\d+$/, "") ?? null,
    started_at: new Date(start).toISOString(),
    ended_at: new Date(end).toISOString(),
    fr41_selection: "server.log bytes written between just before the POST and after done (lines carry no run id)",
    saw_done: sawDone,
  });
  writeFileSync(`${base}-result.json`, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
  return result.pass ? 0 : 1;
}

function checkOnly(streamFile: string): number {
  const events = mergeEvents([], parseSse(readFileSync(streamFile, "utf8")));
  const logFile = arg("--log");
  const fr41 = logFile ? selectFr41Lines(readFileSync(logFile, "utf8")) : [];
  const done = events.filter((e) => e.type === "done").pop();
  const wall = done?.data?.research?.elapsed_ms !== undefined ? done.data.research.elapsed_ms / 1000 : 0;
  const result = buildResult(events, fr41, wall, {
    stream_file: streamFile,
    note: "check-only: total_wall_s taken from done.research.elapsed_ms (0 when absent)",
  });
  console.log(JSON.stringify(result, null, 2));
  return result.pass ? 0 : 1;
}

if (import.meta.main) {
  try {
    const co = arg("--check-only");
    process.exit(co ? checkOnly(co) : await live());
  } catch (e) {
    console.error("tool error:", (e as Error).message);
    process.exit(2);
  }
}
