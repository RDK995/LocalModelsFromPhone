import { describe, it, expect } from "bun:test";
import { createServer, setValidToken, type OllamaStateClient } from "./server";
import type { OllamaChatResponse } from "../ollama/client";
import { GenerationManager, type GenerationWebTools } from "../generations/manager";
import type { ResearchSettings, ResearchWebTools } from "../generations/research";
import type { WebEvent } from "../web/tools";

// M19e FR45 (server half): a deep research run emits a "started" step BEFORE it awaits every search,
// read and model call. Every fake backend call here is held open until the test releases it, and the
// test checks over GET /v1/generations/{id}/events that the matching started step has already arrived.

/** FR43 skip rules off: tiny fixture pages; these tests are not about passage selection. */
const NO_SKIP = { noteMinWords: 0, noteMinRelevance: -1 };

const TOKEN = "test-token";
const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` });

function chunk(content: string, done: boolean): OllamaChatResponse {
  return {
    model: "fake-model",
    created_at: "",
    message: { role: "assistant", content },
    done,
    total_duration: 0,
    load_duration: 0,
    prompt_eval_count: 0,
    prompt_eval_duration: 0,
    eval_count: done ? 3 : 0,
    eval_duration: 0,
  } as OllamaChatResponse;
}

function parseSSE(text: string): Array<{ event: string; data: string }> {
  return text
    .split("\n\n")
    .map((b) => b.split("\n").filter((l) => !l.startsWith(":")).join("\n"))
    .filter((b) => b.trim().length > 0)
    .map((b) => {
      const lines = b.split("\n");
      return {
        event: lines.find((l) => l.startsWith("event: "))?.slice(7) ?? "",
        data: lines.find((l) => l.startsWith("data: "))?.slice(6) ?? "",
      };
    });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const REPORT = "Findings [1] and [2].";

type Step = "brief" | "plan" | "queries" | "pages" | "notes" | "gap" | "write";
const stepOf = (request: any): Step => {
  const keys = Object.keys(request.format?.properties ?? {});
  if (keys.includes("brief")) return "brief";
  if (keys.includes("sub_questions")) return "plan";
  if (keys.includes("queries")) return "queries";
  if (keys.includes("pages")) return "pages";
  if (keys.includes("notes")) return "notes";
  if (keys.includes("enough")) return "gap";
  return "write";
};
const subOf = (text: string): number => Number(text.match(/Current sub-question \((\d+) of \d+\)/)?.[1] ?? 0);

/** A backend call held open until released. */
type Held =
  | { kind: "search"; query: string; release: () => void }
  | { kind: "read"; url: string; release: () => void }
  | { kind: "chat"; step: Step; sub: number; url?: string; release: () => void };

type HeldInfo = Held extends infer H ? (H extends Held ? Omit<H, "release"> : never) : never;

type StepData = {
  step_id: string;
  kind: string;
  status: string;
  query?: string;
  url?: string;
  detail?: string;
  elapsed_ms?: number;
  budget_ms?: number;
};

interface SetupOptions {
  research?: Partial<ResearchSettings>;
  subs?: string[];
  pages?: number[];
  /** Gap reply (default enough). */
  gap?: { enough: boolean; next_query?: string };
}

function setup(opts: SetupOptions = {}) {
  const subs = opts.subs ?? ["sub one", "sub two"];
  const held: Held[] = [];
  const hold = <T>(entry: HeldInfo, value: () => T): Promise<T> =>
    new Promise<T>((resolve) => {
      held.push({ ...entry, release: () => resolve(value()) } as Held);
    });

  const client: OllamaStateClient = {
    tags: async () => ({ models: [{ name: "fake-model", modified_at: "", size: 1, digest: "d" }] }),
    ps: async () =>
      ({
        models: [
          { name: "fake-model", model: "fake-model", size: 1, digest: "d", details: { family: "", parameter_size: "", quantization_level: "" }, expires_at: "", size_vram: 0 },
        ],
      }) as any,
    show: async () => ({ capabilities: ["completion", "tools"] }),
    load: async () => {},
    unload: async () => {},
    chat: ((request: any) => {
      const user = String(request.messages[1].content);
      const step = stepOf(request);
      const sub = subOf(user);
      let reply: unknown;
      let url: string | undefined;
      if (step === "brief") reply = { brief: "About things" };
      else if (step === "plan") reply = { sub_questions: subs };
      else if (step === "queries") reply = { queries: [`q${sub}a`, `q${sub}b`, `q${sub}c`] };
      else if (step === "pages") reply = { pages: opts.pages ?? [1, 2] };
      else if (step === "notes") {
        const m = user.match(/Fact for (\S+)\. More words/);
        url = m?.[1];
        reply = { notes: m ? [{ quote: `Fact for ${m[1]}`, claim: `claim ${m[1]}` }] : [] };
      } else if (step === "gap") reply = opts.gap ?? { enough: true };
      else reply = { report: REPORT };
      const content = JSON.stringify(reply);
      // Held as soon as it is called, before any reply chunk exists.
      const gate = hold({ kind: "chat", step, sub, url }, () => undefined);
      return (async function* () {
        await gate;
        yield chunk(content, false);
        yield chunk("", true);
      })();
    }) as never,
  };

  let id = 0;
  const research: ResearchWebTools = {
    search(query) {
      // A leading "www." so the note label's domain drops it.
      const results = [1, 2, 3].map((i) => ({ title: `T ${query} ${i}`, url: `https://www.${query}.example/${i}`, snippet: "s" }));
      const step_id = `s${++id}`;
      // The web tool's own started step comes back only after the search resolves (the late copy).
      const events: WebEvent[] = [
        { type: "step", data: { step_id, kind: "search", status: "started", query } },
        { type: "step", data: { step_id, kind: "search", status: "done", query } },
      ];
      return hold({ kind: "search", query }, () => ({ results, events }));
    },
    read(url, _signal, numberPage) {
      return hold({ kind: "read", url }, () => {
        const n = numberPage(url);
        const step_id = `r${++id}`;
        const events: WebEvent[] = [
          { type: "step", data: { step_id, kind: "read", status: "started", url } },
          { type: "step", data: { step_id, kind: "read", status: "done", url } },
          { type: "source", data: { title: `Title ${url}`, url, n } },
        ];
        return { page: { n, title: `Title ${url}`, url, text: `Fact for ${url}. More words.`, truncated: false }, events };
      });
    },
  };
  const web: GenerationWebTools & ResearchWebTools = {
    tools: () => [],
    systemNote: () => "SYSTEM NOTE",
    execute: async () => ({ toolResult: "", events: [] }),
    ...research,
  };
  setValidToken(TOKEN);
  const manager = new GenerationManager(client, web, { ...NO_SKIP, ...opts.research });
  const server = createServer({ ollama: client, manager, port: 0, researchModel: "fake-model" });
  const base = `http://127.0.0.1:${server.port}`;

  /** Starts a run and follows GET /v1/generations/{id}/events live. */
  const start = async () => {
    const chat = await fetch(`${base}/v1/chat`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ model: "fake-model", messages: [{ role: "user", content: "things?" }], web: true, deep_research: true }),
    });
    expect(chat.status).toBe(200);
    void chat.text();
    const genId = chat.headers.get("x-generation-id")!;
    const res = await fetch(`${base}/v1/generations/${genId}/events`, { headers: headers() });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let ended = false;
    const pump = (async () => {
      try {
        for (;;) {
          const r = await reader.read();
          if (r.done) break;
          text += decoder.decode(r.value, { stream: true });
        }
      } catch {
        // The server was stopped mid-stream (a failed test's cleanup).
      }
      ended = true;
    })();
    /** Every complete event delivered so far. */
    const delivered = () => parseSSE(text.slice(0, text.lastIndexOf("\n\n") + 2));
    const steps = (): StepData[] => delivered().filter((e) => e.event === "step").map((e) => JSON.parse(e.data));
    return { genId, delivered, steps, ended: () => ended, finished: pump };
  };

  return { server, held, start };
}

/** Resolves true when `check` holds, false after `ms` (polling every few ms). */
async function within(check: () => boolean, ms = 2000): Promise<boolean> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) return false;
    await sleep(5);
  }
  return true;
}

const hostLabel = (url: string) => `Taking notes: ${new URL(url).hostname.replace(/^www\./, "")}`;
const MODEL_LABEL: Partial<Record<Step, string>> = {
  queries: "Choosing searches",
  pages: "Choosing pages",
  gap: "Checking for gaps",
};

/** What a held call's started step looks like: matching step data, and how many of them must exist by now. */
type Expectation = { what: string; match: (d: StepData) => boolean };
function expectationFor(h: Held): Expectation {
  if (h.kind === "search") return { what: `search ${h.query}`, match: (d) => d.kind === "search" && d.query === h.query };
  if (h.kind === "read") return { what: `read ${h.url}`, match: (d) => d.kind === "read" && d.url === h.url };
  if (h.step === "brief" || h.step === "plan") return { what: h.step, match: (d) => d.kind === "plan" };
  if (h.step === "write") return { what: "write", match: (d) => d.kind === "write" };
  const label = h.step === "notes" ? hostLabel(h.url!) : MODEL_LABEL[h.step]!;
  return { what: label, match: (d) => d.kind === "model" && d.detail === label };
}

type Record_ = { held: Held; what: string; startedBeforeRelease: boolean; startedCount: number; required: number };

/**
 * Drives a whole run: each held call is released only after checking (waiting up to a bounded time) that
 * its started step has been delivered. `beforeRelease` may add checks while the call is held.
 */
async function drive(
  s: ReturnType<typeof setup>,
  beforeRelease?: (h: Held, stream: Awaited<ReturnType<ReturnType<typeof setup>["start"]>>) => Promise<void>
) {
  const stream = await s.start();
  const records: Record_[] = [];
  const seen = new Map<string, number>();
  for (;;) {
    const got = await within(() => s.held.length > 0 || stream.ended(), 5000);
    if (!got) throw new Error("run stalled: nothing held and the stream is still open");
    if (s.held.length === 0) break;
    const h = s.held.shift()!;
    const exp = expectationFor(h);
    // brief and plan share the one "plan" started step; repeated labels need one started step each.
    const key = h.kind === "chat" && (h.step === "brief" || h.step === "plan") ? "plan" : exp.what;
    const required = key === "plan" ? 1 : (seen.get(key) ?? 0) + 1;
    seen.set(key, required);
    const count = () => stream.steps().filter((d) => d.status === "started" && exp.match(d)).length;
    const ok = await within(() => count() >= required, 1000);
    if (beforeRelease) await beforeRelease(h, stream);
    records.push({ held: h, what: exp.what, startedBeforeRelease: ok, startedCount: count(), required });
    h.release();
  }
  await stream.finished;
  return { records, events: stream.delivered(), steps: stream.steps() };
}

const SETTINGS: Partial<ResearchSettings> = { subQuestionCount: 2, pagesPerSubQuestion: 3, minSearches: 2, maxSearches: 3 };

describe("deep research started steps precede every await (M19e FR45, M19e-AC1)", () => {
  it("S1: while a search is held, its started step has already been delivered, with elapsed_ms", async () => {
    const s = setup({ research: SETTINGS });
    try {
      const { records, steps } = await drive(s);
      const searches = records.filter((r) => r.held.kind === "search");
      expect(searches.length).toBeGreaterThanOrEqual(4);
      for (const r of searches) expect({ what: r.what, startedBeforeRelease: r.startedBeforeRelease }).toEqual({ what: r.what, startedBeforeRelease: true });
      for (const d of steps.filter((d) => d.kind === "search" && d.status === "started")) {
        expect(typeof d.elapsed_ms).toBe("number");
        expect(typeof d.budget_ms).toBe("number");
      }
    } finally {
      s.server.stop(true);
    }
  }, 30_000);

  it("S2: while a page read is held its started step has been delivered; two prefetched reads both announce before either is released", async () => {
    const s = setup({ research: SETTINGS });
    let pairChecked = 0;
    try {
      const { records } = await drive(s, async (h, stream) => {
        if (h.kind !== "read") return;
        // The first read of a page choice: its sibling read is in flight too (prefetch), not yet released.
        const sibling = s.held.find((x) => x.kind === "read");
        if (!sibling || sibling.kind !== "read") return;
        const both = await within(() => {
          const started = stream.steps().filter((d) => d.kind === "read" && d.status === "started").map((d) => d.url);
          return started.includes(h.url) && started.includes(sibling.url);
        }, 1000);
        expect(both).toBe(true);
        pairChecked++;
      });
      const reads = records.filter((r) => r.held.kind === "read");
      expect(reads.length).toBeGreaterThanOrEqual(4);
      for (const r of reads) expect({ what: r.what, startedBeforeRelease: r.startedBeforeRelease }).toEqual({ what: r.what, startedBeforeRelease: true });
      expect(pairChecked).toBeGreaterThanOrEqual(2);
    } finally {
      s.server.stop(true);
    }
  }, 30_000);

  it("S3: while each model call is held, its labelled started step has been delivered, and each later ends done with the same step_id", async () => {
    const s = setup({ research: SETTINGS });
    try {
      const { records, steps } = await drive(s);
      const chats = records.filter((r) => r.held.kind === "chat");
      for (const r of chats) expect({ what: r.what, startedBeforeRelease: r.startedBeforeRelease }).toEqual({ what: r.what, startedBeforeRelease: true });
      const labels = new Set(chats.map((r) => r.what));
      expect(labels.has("Choosing searches")).toBe(true);
      expect(labels.has("Choosing pages")).toBe(true);
      expect(labels.has("Checking for gaps")).toBe(true);
      expect(labels.has("Taking notes: q1a.example")).toBe(true);

      const model = steps.filter((d) => d.kind === "model");
      const startedModel = model.filter((d) => d.status === "started");
      expect(startedModel.length).toBe(chats.filter((r) => r.held.kind === "chat" && ["queries", "pages", "notes", "gap"].includes(r.held.step)).length);
      for (const st of startedModel) {
        expect(typeof st.elapsed_ms).toBe("number");
        expect(typeof st.budget_ms).toBe("number");
        const ends = model.filter((d) => d.step_id === st.step_id && d.status !== "started");
        expect(ends.map((d) => [d.status, d.detail])).toEqual([["done", st.detail]]);
      }
      expect(steps[steps.length - 1]).toMatchObject({ kind: "write", status: "done" });
    } finally {
      s.server.stop(true);
    }
  }, 30_000);

  it("S4: across a full run, every step_id has at most one started step, and searches and reads keep their done step", async () => {
    const s = setup({ research: SETTINGS });
    try {
      const { steps, events } = await drive(s);
      const startedIds = steps.filter((d) => d.status === "started").map((d) => d.step_id);
      expect(startedIds.length).toBeGreaterThan(0);
      expect(new Set(startedIds).size).toBe(startedIds.length);
      // Each search/read step still ends: its done step shares the started step's id.
      for (const kind of ["search", "read"]) {
        const started = steps.filter((d) => d.kind === kind && d.status === "started");
        const done = steps.filter((d) => d.kind === kind && d.status === "done");
        expect(started.length).toBeGreaterThan(0);
        expect(done.map((d) => d.step_id).sort()).toEqual(started.map((d) => d.step_id).sort());
        for (const d of done) expect(steps.findIndex((x) => x.step_id === d.step_id)).toBeLessThan(steps.indexOf(d));
      }
      const last = events[events.length - 1]!;
      expect(last.event).toBe("done");
      expect(JSON.parse(last.data).research.status).toBe("complete");
    } finally {
      s.server.stop(true);
    }
  }, 30_000);
});
