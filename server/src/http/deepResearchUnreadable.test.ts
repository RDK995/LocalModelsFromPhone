import { describe, it, expect, spyOn } from "bun:test";
import { createServer, setValidToken, type OllamaStateClient } from "./server";
import type { OllamaChatResponse } from "../ollama/client";
import { GenerationManager } from "../generations/manager";
import { COULD_NOT_READ_NOTE, type ResearchSettings } from "../generations/research";
import { createWebTools } from "../web/tools";

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
    eval_count: 0,
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

const SUB_QUESTION = "zebra migration routes";
const REPORT = "Zebras follow the rivers [1]. Herds cross the plains [2].";

/** A page FR47 counts as a bot check ("Client Challenge"). */
const CHALLENGE = { title: "Client Challenge", markdown: "Please wait while we check your browser. JavaScript is required." };
/** A page under FR43's 40 words. */
const THIN = { title: "Stub", markdown: "Zebra migration routes page with only ten words here." };
/** A readable page relevant to the sub-question; its first sentence is quoted in its note. */
const good = (tag: string) => ({
  title: `Zebra Atlas ${tag}`,
  markdown:
    `Zebra migration routes ${tag} follow the rivers each year across the plains. ` +
    "The zebra migration routes cross the plains and rivers every single year with the herds and calves. ".repeat(5),
});
const quoteOf = (body: string) => body.match(/Zebra migration routes \w+ follow the rivers each year across the plains\./)?.[0];

interface Page {
  title: string;
  markdown: string;
  /** Delay before the reply (ms). */
  delayMs?: number;
}

interface SetupOptions {
  /** Search results, in order, for the one search; each URL maps to its page. */
  results: Array<{ url: string; page: Page }>;
  /** The "Choosing pages" reply (1-based indexes into the unread results). */
  pick: number[];
  research?: Partial<ResearchSettings>;
}

function setup(opts: SetupOptions) {
  const requests: any[] = [];
  const client: OllamaStateClient = {
    tags: async () => ({ models: [{ name: "fake-model", modified_at: "", size: 1, digest: "d" }] }),
    ps: async () =>
      ({
        models: [{ name: "fake-model", model: "fake-model", size: 1, digest: "d", details: { family: "", parameter_size: "", quantization_level: "" }, expires_at: "", size_vram: 0 }],
      }) as any,
    show: async () => ({ capabilities: ["completion", "tools"] }),
    load: async () => {},
    unload: async () => {},
    chat: ((request: any) => {
      requests.push(JSON.parse(JSON.stringify(request)));
      const keys = Object.keys(request.format?.properties ?? {});
      let reply: unknown;
      if (keys.includes("brief")) reply = { brief: "About zebras" };
      else if (keys.includes("sub_questions")) reply = { sub_questions: [SUB_QUESTION] };
      else if (keys.includes("queries")) reply = { queries: ["alpha"] };
      else if (keys.includes("pages")) reply = { pages: opts.pick };
      else if (keys.includes("notes")) {
        const quote = quoteOf(String(request.messages[1].content));
        reply = { notes: quote ? [{ quote, claim: `claim: ${quote}` }] : [] };
      } else if (keys.includes("enough")) reply = { enough: true };
      else if (keys.includes("report")) reply = { report: REPORT };
      else throw new Error("unknown step");
      const content = JSON.stringify(reply);
      return (async function* () {
        yield chunk(content, false);
        yield chunk("", true);
      })();
    }) as never,
  };

  const pages = new Map(opts.results.map((r) => [r.url, r.page]));
  const searchCalls: string[] = [];
  const readCalls: string[] = [];
  const search = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const path = new URL(req.url).pathname;
      const body: any = await req.json().catch(() => ({}));
      if (path === "/v1/search") {
        searchCalls.push(body.query);
        return Response.json({ results: opts.results.map((r, i) => ({ title: `Result ${i + 1}`, url: r.url, snippet: "s" })) });
      }
      if (path === "/v1/read") {
        readCalls.push(body.url);
        const page = pages.get(body.url);
        if (!page) return new Response("nope", { status: 404 });
        if (page.delayMs) await new Promise((r) => setTimeout(r, page.delayMs));
        return Response.json({ url: body.url, final_url: body.url, title: page.title, markdown: page.markdown, truncated: false });
      }
      return new Response("nope", { status: 404 });
    },
  });
  const web = createWebTools({ baseUrl: `http://127.0.0.1:${search.port}` });
  setValidToken(TOKEN);
  const research: Partial<ResearchSettings> = {
    subQuestionCount: 1,
    minSearches: 1,
    maxSearches: 3,
    pagesPerSubQuestion: 2,
    ...opts.research,
  };
  const server = createServer({ ollama: client, manager: new GenerationManager(client, web, research), port: 0, researchModel: "fake-model" });
  const base = `http://127.0.0.1:${server.port}`;
  const run = async () => {
    const res = await fetch(`${base}/v1/chat`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ model: "fake-model", messages: [{ role: "user", content: "zebras?" }], web: true, deep_research: true }),
    });
    expect(res.status).toBe(200);
    return parseSSE(await res.text());
  };
  const stop = () => {
    server.stop(true);
    search.stop(true);
  };
  return { requests, searchCalls, readCalls, run, stop };
}

type Events = Array<{ event: string; data: string }>;
const steps = (events: Events) => events.filter((e) => e.event === "step").map((e) => JSON.parse(e.data));
const readSteps = (events: Events) => steps(events).filter((s) => s.kind === "read");
const sourceItems = (events: Events): Array<{ url: string; n?: number }> => {
  const saved = events.filter((e) => e.event === "sources");
  return saved.length ? JSON.parse(saved[saved.length - 1]!.data).items : [];
};
const report = (events: Events) =>
  events
    .filter((e) => e.event === "content")
    .map((e) => JSON.parse(e.data).text ?? "")
    .join("");
const doneEvent = (events: Events) => JSON.parse(events.find((e) => e.event === "done")!.data);
const isNotes = (request: any) => Object.keys(request.format?.properties ?? {}).includes("notes");
const notedPages = (requests: any[]) =>
  requests.filter(isNotes).map((r) => Number(String(r.messages[1].content).match(/^<untrusted_data source="page (\d+)">/)![1]));
const isPick = (request: any) => Object.keys(request.format?.properties ?? {}).includes("pages");

/** The read step of a URL: its statuses in order, and its failed detail. */
function stepOf(events: Events, url: string) {
  const ids = new Set(readSteps(events).filter((s) => s.url === url).map((s) => s.step_id));
  expect(ids.size).toBe(1);
  const id = [...ids][0];
  const all = readSteps(events).filter((s) => s.step_id === id);
  return { statuses: all.map((s) => s.status), detail: all.find((s) => s.status !== "started")?.detail };
}

/** Every read step has exactly one started step and one terminal step. */
function expectWholeReadSteps(events: Events) {
  const byId = new Map<string, string[]>();
  for (const s of readSteps(events)) byId.set(s.step_id, [...(byId.get(s.step_id) ?? []), s.status]);
  for (const statuses of byId.values()) {
    expect(statuses.filter((x) => x === "started").length).toBe(1);
    expect(statuses.filter((x) => x !== "started").length).toBe(1);
  }
}

function skipLines(spy: { mock: { calls: unknown[][] } }): any[] {
  return spy.mock.calls
    .map((c) => String(c[0]))
    .filter((l) => l.includes('"event":"deep_research_page_skipped"'))
    .map((l) => JSON.parse(l));
}

/** Every [n] in the report resolves to a saved source. */
function expectCitationsResolve(events: Events) {
  const numbers = new Set(sourceItems(events).map((s) => s.n));
  const cited = [...report(events).matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  expect(cited.length).toBeGreaterThan(0);
  for (const n of cited) expect(numbers.has(n)).toBe(true);
}

describe("Deep research replaces unreadable pages (M22 FR47a)", () => {
  it("AC1: a bot-check page and a near-empty page are replaced by the next unread results, with no extra search", async () => {
    const logSpy = spyOn(console, "log");
    const s = setup({
      results: [
        { url: "https://www.scribd.com/doc/1", page: CHALLENGE },
        { url: "https://thin.example/p", page: THIN },
        { url: "https://good.example/one", page: good("one") },
        { url: "https://good.example/two", page: { ...good("two"), delayMs: 60 } },
      ],
      pick: [1, 2],
    });
    try {
      const events = await s.run();
      // No additional search and no additional page choice for the replacements.
      expect(s.searchCalls).toEqual(["alpha"]);
      expect(s.requests.filter(isPick).length).toBe(1);
      expect(s.readCalls).toEqual([
        "https://www.scribd.com/doc/1",
        "https://thin.example/p",
        "https://good.example/one",
        "https://good.example/two",
      ]);
      // The unreadable pages' read steps failed; the replacements' read steps are whole.
      expect(stepOf(events, "https://www.scribd.com/doc/1")).toEqual({ statuses: ["started", "failed"], detail: "bot_check" });
      expect(stepOf(events, "https://thin.example/p")).toEqual({ statuses: ["started", "failed"], detail: "no_content" });
      expect(stepOf(events, "https://good.example/one").statuses).toEqual(["started", "done"]);
      expect(stepOf(events, "https://good.example/two").statuses).toEqual(["started", "done"]);
      expectWholeReadSteps(events);
      // Logged as today, with no number.
      expect(skipLines(logSpy).map((l) => [l.n, l.reason, l.url])).toEqual([
        [undefined, "blocked", "https://www.scribd.com/doc/1"],
        [undefined, "empty", "https://thin.example/p"],
      ]);
      // Notes only for the numbered pages; numbers contiguous from 1 in first-read order.
      expect(notedPages(s.requests)).toEqual([1, 2]);
      expect(sourceItems(events).map((x) => [x.n, x.url])).toEqual([
        [1, "https://good.example/one"],
        [2, "https://good.example/two"],
      ]);
      expect(events.filter((e) => e.event === "source").every((e) => !JSON.parse(e.data).url.includes("scribd"))).toBe(true);
      expectCitationsResolve(events);
      expect(doneEvent(events).research.status).toBe("complete");
    } finally {
      logSpy.mockRestore();
      s.stop();
    }
  });

  it("AC2: a replacement that is itself unreadable is skipped in turn and the next unread result read", async () => {
    const s = setup({
      results: [
        { url: "https://a.example/blocked", page: CHALLENGE },
        { url: "https://b.example/good", page: good("bee") },
        { url: "https://c.example/blocked", page: CHALLENGE },
        { url: "https://d.example/good", page: good("dee") },
      ],
      pick: [1, 2],
    });
    try {
      const events = await s.run();
      expect(s.searchCalls).toEqual(["alpha"]);
      expect(s.readCalls.sort()).toEqual(
        ["https://a.example/blocked", "https://b.example/good", "https://c.example/blocked", "https://d.example/good"].sort()
      );
      expect(stepOf(events, "https://c.example/blocked")).toEqual({ statuses: ["started", "failed"], detail: "bot_check" });
      expectWholeReadSteps(events);
      expect(sourceItems(events).map((x) => [x.n, x.url])).toEqual([
        [1, "https://b.example/good"],
        [2, "https://d.example/good"],
      ]);
      expect(notedPages(s.requests)).toEqual([1, 2]);
      expectCitationsResolve(events);
    } finally {
      s.stop();
    }
  });

  it("AC2: when the results run out the sub-question ends with fewer pages and no extra search", async () => {
    const s = setup({
      results: [
        { url: "https://a.example/blocked", page: CHALLENGE },
        { url: "https://b.example/good", page: good("bee") },
        { url: "https://c.example/thin", page: THIN },
      ],
      pick: [1, 2],
    });
    try {
      const events = await s.run();
      expect(s.searchCalls).toEqual(["alpha"]);
      expect(s.requests.filter(isPick).length).toBe(1);
      expect(s.readCalls.sort()).toEqual(["https://a.example/blocked", "https://b.example/good", "https://c.example/thin"]);
      expectWholeReadSteps(events);
      expect(sourceItems(events).map((x) => [x.n, x.url])).toEqual([[1, "https://b.example/good"]]);
      expect(doneEvent(events).research.status).toBe("complete");
    } finally {
      s.stop();
    }
  });

  it("AC2: no replacement starts once the research deadline has passed", async () => {
    const budgetMs = 1200; // research time 900 ms
    const original = console.log;
    let blocked = false;
    // The research deadline passes right as the bot-check page is logged (the event loop is held, so
    // only the deadline check, not an abort signal, can stop the replacement).
    const logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      const line = String(args[0]);
      if (!blocked && line.includes('"event":"deep_research_page_skipped"')) {
        blocked = true;
        const until = Date.now() + budgetMs;
        while (Date.now() < until) {
          // hold the event loop past the research deadline
        }
      }
      original(...args);
    });
    const s = setup({
      results: [
        { url: "https://a.example/blocked", page: CHALLENGE },
        { url: "https://b.example/good", page: good("bee") },
      ],
      pick: [1],
      research: { pagesPerSubQuestion: 1, budgetMs },
    });
    try {
      const events = await s.run();
      expect(blocked).toBe(true);
      expect(s.readCalls).toEqual(["https://a.example/blocked"]);
      expect(readSteps(events).some((x) => x.url === "https://b.example/good")).toBe(false);
      expectWholeReadSteps(events);
      expect(sourceItems(events)).toEqual([]);
    } finally {
      logSpy.mockRestore();
      s.stop();
    }
  });

  it("AC2: a run where every opened page is unreadable ends failed with the plain sentence", async () => {
    const s = setup({
      results: [
        { url: "https://a.example/blocked", page: CHALLENGE },
        { url: "https://b.example/thin", page: THIN },
        { url: "https://c.example/blocked", page: CHALLENGE },
      ],
      pick: [1, 2],
    });
    try {
      const events = await s.run();
      expect(s.readCalls.sort()).toEqual(["https://a.example/blocked", "https://b.example/thin", "https://c.example/blocked"]);
      expect(s.requests.filter(isNotes).length).toBe(0);
      expect(doneEvent(events).research.status).toBe("failed");
      expect(report(events)).toBe(COULD_NOT_READ_NOTE);
      expect(sourceItems(events)).toEqual([]);
    } finally {
      s.stop();
    }
  });

  it("AC2: a site with a bot check on one page and real content on another has the real page read, numbered and listed", async () => {
    const s = setup({
      results: [
        { url: "https://site.example/challenge", page: CHALLENGE },
        { url: "https://site.example/article", page: good("site") },
      ],
      pick: [1],
      research: { pagesPerSubQuestion: 1 },
    });
    try {
      const events = await s.run();
      expect(s.searchCalls).toEqual(["alpha"]);
      expect(s.readCalls).toEqual(["https://site.example/challenge", "https://site.example/article"]);
      expect(stepOf(events, "https://site.example/challenge").statuses).toEqual(["started", "failed"]);
      expect(stepOf(events, "https://site.example/article").statuses).toEqual(["started", "done"]);
      expect(sourceItems(events).map((x) => [x.n, x.url])).toEqual([[1, "https://site.example/article"]]);
      expect(notedPages(s.requests)).toEqual([1]);
    } finally {
      s.stop();
    }
  });
});
