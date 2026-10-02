import { describe, it, expect } from "bun:test";
import { createServer, setValidToken, type OllamaStateClient } from "./server";
import type { OllamaChatResponse } from "../ollama/client";
import { GenerationManager, type GenerationWebTools } from "../generations/manager";
import type { ResearchSettings, ResearchWebTools } from "../generations/research";
import type { ReadPage, WebEvent } from "../web/tools";

// M19d FR44: breadth-first sub-questions, parallel page prefetch, one model call at a time,
// and a sub-question that ends early when a search adds no new URLs.

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
const SUBS = ["sub one", "sub two", "sub three"];

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
/** The "Current sub-question (k of P)" number of a request, or 0. */
const subOf = (text: string): number => Number(text.match(/Current sub-question \((\d+) of \d+\)/)?.[1] ?? 0);
/** The sub-question a search query belongs to (queries are named q<k>...). */
const subOfQuery = (query: string): number => Number(query.match(/^q(\d+)/)?.[1] ?? 0);

type TimelineEntry =
  | { kind: "chat"; step: Step; sub: number }
  | { kind: "read-start"; url: string; sub: number }
  | { kind: "read-end"; url: string; sub: number }
  | { kind: "search"; query: string; sub: number };

interface SetupOptions {
  research?: Partial<ResearchSettings>;
  /** Sub-questions in the plan. */
  subs?: string[];
  /** Gap reply for sub-question k on its n-th gap check (default enough). */
  gap?: (sub: number, n: number) => { enough: boolean; next_query?: string };
  /** Page choice reply (default [1, 2]). */
  pages?: number[];
  /** Search results' URLs for a query (default three fresh URLs per query). */
  searchUrls?: (query: string) => string[];
  /** A query whose search fails: its step ends failed or unavailable and it returns no results. */
  searchFails?: (query: string) => "failed" | "unavailable" | undefined;
  /** Delay before each model reply, ms. */
  chatDelayMs?: number;
  /**
   * Replaces the page read. Return undefined for the normal read (after `readDelayMs`).
   * `complete` numbers and returns the page normally.
   */
  read?: (
    url: string,
    signal: AbortSignal,
    complete: () => { page: ReadPage | null; events: WebEvent[] }
  ) => Promise<{ page: ReadPage | null; events: WebEvent[] }> | undefined;
  readDelayMs?: number;
}

function setup(opts: SetupOptions = {}) {
  const subs = opts.subs ?? SUBS;
  const requests: any[] = [];
  const timeline: TimelineEntry[] = [];
  const readSignals: Array<{ url: string; signal: AbortSignal }> = [];
  const completedUrls: string[] = [];
  let chatInFlight = 0;
  let maxChatInFlight = 0;
  let readsInFlight = 0;
  let maxReadsInFlight = 0;
  const gapCount = new Map<number, number>();
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
      requests.push(JSON.parse(JSON.stringify(request)));
      const user = String(request.messages[1].content);
      const step = stepOf(request);
      const sub = subOf(user);
      timeline.push({ kind: "chat", step, sub });
      let reply: unknown;
      if (step === "brief") reply = { brief: "About things" };
      else if (step === "plan") reply = { sub_questions: subs };
      else if (step === "queries") reply = { queries: [`q${sub}a`, `q${sub}b`, `q${sub}c`] };
      else if (step === "pages") reply = { pages: opts.pages ?? [1, 2] };
      else if (step === "notes") {
        const m = user.match(/Fact for (\S+?)\./);
        reply = { notes: m ? [{ quote: `Fact for ${m[1]}`, claim: `claim ${m[1]}` }] : [] };
      } else if (step === "gap") {
        const n = (gapCount.get(sub) ?? 0) + 1;
        gapCount.set(sub, n);
        reply = opts.gap ? opts.gap(sub, n) : { enough: true };
      } else reply = { report: REPORT };
      const content = JSON.stringify(reply);
      return (async function* () {
        chatInFlight++;
        maxChatInFlight = Math.max(maxChatInFlight, chatInFlight);
        try {
          if (opts.chatDelayMs) await sleep(opts.chatDelayMs);
          yield chunk(content, false);
          yield chunk("", true);
        } finally {
          chatInFlight--;
        }
      })();
    }) as never,
  };
  let id = 0;
  const urlSub = new Map<string, number>();
  const research: ResearchWebTools = {
    async search(query) {
      const sub = subOfQuery(query);
      timeline.push({ kind: "search", query, sub });
      const urls = opts.searchUrls ? opts.searchUrls(query) : [1, 2, 3].map((i) => `https://${query}.example/${i}`);
      for (const u of urls) if (!urlSub.has(u)) urlSub.set(u, sub);
      const results = urls.map((url, i) => ({ title: `T ${query} ${i}`, url, snippet: "s" }));
      const step_id = `s${++id}`;
      const failure = opts.searchFails?.(query);
      const events: WebEvent[] = [
        { type: "step", data: { step_id, kind: "search", status: "started", query } },
        { type: "step", data: { step_id, kind: "search", status: failure ?? "done", query } },
      ];
      return { results: failure ? [] : results, events };
    },
    async read(url, signal, numberPage) {
      const sub = urlSub.get(url) ?? 0;
      readSignals.push({ url, signal });
      timeline.push({ kind: "read-start", url, sub });
      readsInFlight++;
      maxReadsInFlight = Math.max(maxReadsInFlight, readsInFlight);
      // Numbered when the read completes, as the real web tools do.
      const complete = () => {
        const n = numberPage(url);
        completedUrls.push(url);
        const step_id = `r${++id}`;
        const events: WebEvent[] = [
          { type: "step", data: { step_id, kind: "read", status: "started", url } },
          { type: "step", data: { step_id, kind: "read", status: "done", url } },
          { type: "source", data: { title: `Title ${url}`, url, n } },
        ];
        return { page: { n, title: `Title ${url}`, url, text: `Fact for ${url}. More words.`, truncated: false }, events };
      };
      try {
        const custom = opts.read?.(url, signal, complete);
        if (custom) return await custom;
        if (opts.readDelayMs) await sleep(opts.readDelayMs);
        return complete();
      } finally {
        readsInFlight--;
        timeline.push({ kind: "read-end", url, sub });
      }
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
  const start = async () => {
    const chat = await fetch(`${base}/v1/chat`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ model: "fake-model", messages: [{ role: "user", content: "things?" }], web: true, deep_research: true }),
    });
    expect(chat.status).toBe(200);
    return { genId: chat.headers.get("x-generation-id")!, body: chat.text().then(parseSSE) };
  };
  const run = async () => (await start()).body;
  const cancel = async (genId: string) => {
    const r = await fetch(`${base}/v1/generations/${genId}/cancel`, { method: "POST", headers: headers() });
    return (await r.json()) as { status: string };
  };
  return {
    server,
    requests,
    timeline,
    readSignals,
    completedUrls,
    start,
    run,
    cancel,
    stats: () => ({ maxChatInFlight, maxReadsInFlight }),
  };
}

const doneOf = (events: Array<{ event: string; data: string }>) => {
  const last = events[events.length - 1]!;
  expect(last.event).toBe("done");
  return JSON.parse(last.data);
};
const sourcesOf = (events: Array<{ event: string; data: string }>) =>
  JSON.parse(events.find((e) => e.event === "sources")!.data).items as Array<{ url: string; n: number }>;
const contentOf = (events: Array<{ event: string; data: string }>) =>
  events.filter((e) => e.event === "content").map((e) => JSON.parse(e.data).text).join("");
/** Resolves when `check` is true, polling every few ms (bounded). */
async function until(check: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not reached");
    await sleep(5);
  }
}

describe("deep research breadth first and prefetch (M19d FR44)", () => {
  it("AC1a: the first three note decisions are sub-questions 1, 2, 3 in plan order, all searches come before the 4th, and the report cites read pages", async () => {
    const s = setup({ research: { pagesPerSubQuestion: 2, subQuestionCount: 3 } });
    try {
      const events = await s.run();
      const chats = s.timeline.filter((t) => t.kind === "chat") as Array<{ kind: "chat"; step: Step; sub: number }>;
      const noteSubs = chats.filter((c) => c.step === "notes").map((c) => c.sub);
      expect(noteSubs.length).toBe(6);
      expect(noteSubs.slice(0, 3)).toEqual([1, 2, 3]);
      expect([...noteSubs.slice(3)].sort()).toEqual([1, 2, 3]);
      // Every sub-question's searches happen before the 4th note request.
      const fourthNote = s.timeline.findIndex(
        (t, i) => t.kind === "chat" && t.step === "notes" && s.timeline.slice(0, i).filter((x) => x.kind === "chat" && x.step === "notes").length === 3
      );
      expect(fourthNote).toBeGreaterThan(0);
      const searches = s.timeline.map((t, i) => [t, i] as const).filter(([t]) => t.kind === "search");
      for (const sub of [1, 2, 3]) expect(searches.some(([t]) => t.sub === sub)).toBe(true);
      for (const [, i] of searches) expect(i).toBeLessThan(fourthNote);

      // A cited report with every read page in Sources, numbered without gaps.
      expect(contentOf(events)).toBe(REPORT);
      const sources = sourcesOf(events);
      expect(sources.map((x) => x.n)).toEqual(sources.map((_, i) => i + 1));
      expect(new Set(sources.map((x) => x.url))).toEqual(new Set(s.completedUrls));
      expect(sources.length).toBe(6);
      expect(doneOf(events).research.status).toBe("complete");
    } finally {
      s.server.stop(true);
    }
  });

  it("AC1a: breadth-first order holds when a sub-question's first chosen read fails", async () => {
    const s = setup({
      research: { pagesPerSubQuestion: 2, subQuestionCount: 3 },
      read: (url, _signal, complete) => {
        if (url === "https://q1a.example/1") {
          return Promise.resolve({ page: null, events: [{ type: "step", data: { step_id: "rf", kind: "read", status: "failed", url } }] as WebEvent[] });
        }
        return Promise.resolve(complete());
      },
    });
    try {
      const events = await s.run();
      const noteSubs = (s.timeline.filter((t) => t.kind === "chat" && t.step === "notes") as Array<{ sub: number }>).map((c) => c.sub);
      expect(noteSubs.slice(0, 3)).toEqual([1, 2, 3]);
      expect(noteSubs.length).toBe(5);
      const sources = sourcesOf(events);
      expect(sources.map((x) => x.n)).toEqual(sources.map((_, i) => i + 1));
      expect(sources.map((x) => x.url)).not.toContain("https://q1a.example/1");
    } finally {
      s.server.stop(true);
    }
  });

  it("AC1b: a sub-question whose second search adds no new URLs runs no further search and no gap check; the others continue", async () => {
    const s = setup({
      research: { pagesPerSubQuestion: 4, subQuestionCount: 3, minSearches: 2, maxSearches: 3 },
      // Sub-question 2's second search returns only URLs its first search already found.
      searchUrls: (query) => {
        const base = query === "q2b" ? "q2a" : query;
        return [1, 2, 3].map((i) => `https://${base}.example/${i}`);
      },
      gap: (sub, n) => ({ enough: false, next_query: `q${sub}gap${n}` }),
    });
    try {
      const events = await s.run();
      const searchesFor = (sub: number) => s.timeline.filter((t) => t.kind === "search" && t.sub === sub).length;
      const gapsFor = (sub: number) => s.timeline.filter((t) => t.kind === "chat" && t.step === "gap" && t.sub === sub).length;
      expect(searchesFor(2)).toBe(2);
      expect(gapsFor(2)).toBe(0);
      // The others are unaffected: they reach maxSearches through gap checks.
      expect(searchesFor(1)).toBe(3);
      expect(searchesFor(3)).toBe(3);
      expect(gapsFor(1)).toBeGreaterThan(0);
      expect(gapsFor(3)).toBeGreaterThan(0);
      // Sub-question 2 still notes the pages it chose.
      const noteSubs = (s.timeline.filter((t) => t.kind === "chat" && t.step === "notes") as Array<{ sub: number }>).map((c) => c.sub);
      expect(noteSubs.filter((k) => k === 2).length).toBe(2);
      expect(noteSubs.slice(0, 3)).toEqual([1, 2, 3]);
      expect(doneOf(events).research.status).toBe("complete");
    } finally {
      s.server.stop(true);
    }
  });

  it("AC1b: a later search that returns nothing ends that sub-question's searching", async () => {
    const s = setup({
      research: { pagesPerSubQuestion: 4, subQuestionCount: 2, minSearches: 1, maxSearches: 3 },
      // One page per choice, so the page quota does not end a sub-question before maxSearches.
      pages: [1],
      searchUrls: (query) => (query === "q1gap1" ? [] : [1, 2, 3].map((i) => `https://${query}.example/${i}`)),
      gap: (sub, n) => ({ enough: false, next_query: `q${sub}gap${n}` }),
    });
    try {
      await s.run();
      const searches = (sub: number) => s.timeline.filter((t) => t.kind === "search" && t.sub === sub).map((t: any) => t.query);
      const gapsFor = (sub: number) => s.timeline.filter((t) => t.kind === "chat" && t.step === "gap" && t.sub === sub).length;
      expect(searches(1)).toEqual(["q1a", "q1gap1"]);
      expect(gapsFor(1)).toBe(1);
      expect(searches(2)).toEqual(["q2a", "q2gap1", "q2gap2"]);
    } finally {
      s.server.stop(true);
    }
  });

  for (const status of ["failed", "unavailable"] as const) {
    it(`F1: a sub-question whose first search ${status} searches again and still gets its first page`, async () => {
      const s = setup({
        research: { pagesPerSubQuestion: 2, subQuestionCount: 3, minSearches: 2, maxSearches: 3 },
        searchFails: (query) => (query === "q2a" ? status : undefined),
      });
      try {
        const events = await s.run();
        const searches = (sub: number) => s.timeline.filter((t) => t.kind === "search" && t.sub === sub).map((t: any) => t.query);
        expect(searches(2).slice(0, 2)).toEqual(["q2a", "q2b"]);
        const noteSubs = (s.timeline.filter((t) => t.kind === "chat" && t.step === "notes") as Array<{ sub: number }>).map((c) => c.sub);
        expect(noteSubs.slice(0, 3)).toEqual([1, 2, 3]);
        expect(noteSubs.filter((k) => k === 2).length).toBeGreaterThan(0);
        expect(doneOf(events).research.status).toBe("complete");
      } finally {
        s.server.stop(true);
      }
    });
  }

  it("F1: a later-round failed search does not end that sub-question's searching", async () => {
    const s = setup({
      research: { pagesPerSubQuestion: 4, subQuestionCount: 2, minSearches: 1, maxSearches: 3 },
      pages: [1],
      searchFails: (query) => (query === "q1gap1" ? "failed" : undefined),
      gap: (sub, n) => ({ enough: false, next_query: `q${sub}gap${n}` }),
    });
    try {
      await s.run();
      const searches = (sub: number) => s.timeline.filter((t) => t.kind === "search" && t.sub === sub).map((t: any) => t.query);
      expect(searches(1)).toEqual(["q1a", "q1gap1", "q1gap2"]);
    } finally {
      s.server.stop(true);
    }
  });

  it("AC2a: chosen pages are read in parallel before the note call, and model calls never overlap", async () => {
    const s = setup({
      research: { pagesPerSubQuestion: 2, subQuestionCount: 3 },
      chatDelayMs: 3,
      // Sub-question 1's second page is slow, so it is still being read while sub-question 2 works.
      read: (url, _signal, complete) => sleep(url === "https://q1a.example/2" ? 300 : 120).then(complete),
    });
    try {
      const events = await s.run();
      const { maxChatInFlight, maxReadsInFlight } = s.stats();
      expect(maxChatInFlight).toBe(1);
      expect(maxReadsInFlight).toBeGreaterThanOrEqual(2);
      // Sub-question 1: both chosen reads start right after its page choice, before its first note request
      // and before any other model call.
      const t = s.timeline;
      const firstPages = t.findIndex((x) => x.kind === "chat" && x.step === "pages");
      const nextChat = t.findIndex((x, i) => i > firstPages && x.kind === "chat");
      const firstNotes = t.findIndex((x) => x.kind === "chat" && x.step === "notes");
      const readStarts = t.map((x, i) => [x, i] as const).filter(([x, i]) => x.kind === "read-start" && i > firstPages && i < nextChat);
      expect(readStarts.length).toBe(2);
      expect(nextChat).toBe(firstNotes);
      expect(readStarts[1]![1]).toBeLessThan(firstNotes);
      // Sub-question 1's second read is still in flight while sub-question 2's model calls run.
      const secondUrl = (readStarts[1]![0] as { url: string }).url;
      const secondEnd = t.findIndex((x) => x.kind === "read-end" && x.url === secondUrl);
      const sub2Chat = t.findIndex((x) => x.kind === "chat" && x.sub === 2);
      expect(sub2Chat).toBeGreaterThan(0);
      expect(secondEnd).toBeGreaterThan(sub2Chat);
      expect(doneOf(events).research.status).toBe("complete");
    } finally {
      s.server.stop(true);
    }
  });

  it("AC2b: at the research deadline every hanging prefetched read sees its signal aborted and the run writes up in time", async () => {
    const BUDGET = 800;
    const s = setup({
      research: { pagesPerSubQuestion: 2, subQuestionCount: 3, budgetMs: BUDGET },
      read: (url, signal, complete) => {
        // Sub-question 1's first page reads at once (so a note is kept); every other read hangs until aborted
        // and then rejects, as the real web tools do.
        if (url === "https://q1a.example/1") return Promise.resolve(complete());
        if (url === "https://q1a.example/2") return sleep(30).then(complete);
        return new Promise((_, reject) => {
          const fail = () => reject(signal.reason ?? new DOMException("aborted", "AbortError"));
          if (signal.aborted) fail();
          else signal.addEventListener("abort", fail, { once: true });
        });
      },
    });
    try {
      const sent = Date.now();
      const events = await s.run();
      const wall = Date.now() - sent;
      const hanging = s.readSignals.filter((r) => !r.url.startsWith("https://q1a.example/"));
      expect(hanging.length).toBeGreaterThanOrEqual(2);
      for (const r of hanging) expect(r.signal.aborted).toBe(true);
      // Prefetched reads get the run's one signal: they abort together.
      const done = doneOf(events);
      expect(done.status).toBe("complete");
      expect(done.research.status).toBe("partial");
      expect(wall).toBeLessThan(BUDGET + 500);
      const sources = sourcesOf(events);
      expect(sources.map((x) => x.url).sort()).toEqual([...s.completedUrls].sort());
      expect(sources.map((x) => x.n)).toEqual(sources.map((_, i) => i + 1));
      expect(s.completedUrls).toContain("https://q1a.example/2");
    } finally {
      s.server.stop(true);
    }
  });

  it("AC2c: a first Stop aborts every in-flight prefetched read and the run gives the short write-up", async () => {
    const s = setup({
      research: { pagesPerSubQuestion: 2, subQuestionCount: 3, stopWriteMs: 5000 },
      read: (url, signal, complete) => {
        if (url === "https://q1a.example/1") return Promise.resolve(complete());
        return new Promise((_, reject) => {
          const fail = () => reject(signal.reason ?? new DOMException("aborted", "AbortError"));
          if (signal.aborted) fail();
          else signal.addEventListener("abort", fail, { once: true });
        });
      },
    });
    try {
      const { genId, body } = await s.start();
      // Sub-question 1's second read and both of sub-question 2's reads are hanging.
      await until(() => s.readSignals.length >= 4);
      expect((await s.cancel(genId)).status).toBe("cancelled");
      const events = await body;
      const hanging = s.readSignals.filter((r) => r.url !== "https://q1a.example/1");
      expect(hanging.length).toBeGreaterThanOrEqual(3);
      for (const r of hanging) expect(r.signal.aborted).toBe(true);
      const steps = events.filter((e) => e.event === "step").map((e) => JSON.parse(e.data));
      expect(steps.filter((x) => x.kind === "write").length).toBe(2);
      expect(steps[steps.length - 1]).toMatchObject({ kind: "write", status: "done" });
      // Only page 1 was read: the citation of page 2 is dropped.
      expect(contentOf(events)).toContain("[1]");
      expect(contentOf(events)).not.toContain("[2]");
      const done = doneOf(events);
      expect(done.status).toBe("complete");
      expect(done.research.status).toBe("partial");
      expect(sourcesOf(events).map((x) => x.url)).toEqual(["https://q1a.example/1"]);
      expect(s.stats().maxChatInFlight).toBe(1);
    } finally {
      s.server.stop(true);
    }
  });
});
