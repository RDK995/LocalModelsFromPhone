import { describe, it, expect } from "bun:test";
import { createServer, setValidToken, type OllamaStateClient } from "./server";
import type { OllamaChatResponse } from "../ollama/client";
import { GenerationManager, type GenerationWebTools } from "../generations/manager";
import { COULD_NOT_SEARCH_NOTE, NO_REPORT_NOTE, type ResearchSettings, type ResearchWebTools } from "../generations/research";
import type { WebEvent } from "../web/tools";

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

function parseSSE(text: string): Array<{ id: string; event: string; data: string }> {
  return text
    .split("\n\n")
    .map((b) => b.split("\n").filter((l) => !l.startsWith(":")).join("\n"))
    .filter((b) => b.trim().length > 0)
    .map((b) => {
      const lines = b.split("\n");
      return {
        id: lines.find((l) => l.startsWith("id: "))?.slice(4) ?? "",
        event: lines.find((l) => l.startsWith("event: "))?.slice(7) ?? "",
        data: lines.find((l) => l.startsWith("data: "))?.slice(6) ?? "",
      };
    });
}

const REPORT = "Cats sleep a lot [1] and purr [2]. Also see [99] and https://typed.example/x for more.";
const CLEANED = "Cats sleep a lot [1] and purr [2]. Also see and for more.";

function replyFor(format: any, userText: string): unknown {
  const keys = Object.keys(format?.properties ?? {});
  if (keys.includes("brief")) return { brief: "About cats" };
  if (keys.includes("sub_questions")) return { sub_questions: ["sq one", "sq two"] };
  if (keys.includes("queries")) return { queries: ["alpha", "beta", "gamma"] };
  if (keys.includes("pages")) return { pages: [1, 2] };
  if (keys.includes("notes")) {
    const m = userText.match(/Fact for (\S+?)\./);
    return { notes: m ? [{ quote: `Fact for ${m[1]}`, claim: `claim ${m[1]}` }] : [] };
  }
  if (keys.includes("enough")) return { enough: true };
  if (keys.includes("report")) return { report: REPORT };
  throw new Error("unknown step");
}

interface SetupOptions {
  research?: Partial<ResearchSettings>;
  /** Replaces the fake search (receives the default implementation). */
  search?: (query: string, signal: AbortSignal, normal: ResearchWebTools["search"]) => ReturnType<ResearchWebTools["search"]>;
  read?: (url: string, signal: AbortSignal, normal: ResearchWebTools["read"], numberPage: (u: string) => number) => ReturnType<ResearchWebTools["read"]>;
  /** Replaces the fake model stream for a request; return undefined for the normal reply. */
  chat?: (request: any, signal: AbortSignal | undefined) => AsyncGenerator<OllamaChatResponse> | undefined;
}

function setup(opts: SetupOptions = {}) {
  const requests: any[] = [];
  const reads: string[] = [];
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
    chat: ((request: any, _signal?: AbortSignal, tools?: unknown) => {
      requests.push({ ...JSON.parse(JSON.stringify(request)), tools });
      const custom = opts.chat?.(request, _signal);
      if (custom) return custom;
      const userText = request.messages.map((m: any) => m.content).join("\n");
      const content = JSON.stringify(replyFor(request.format, userText));
      return (async function* () {
        yield chunk(content, false);
        yield chunk("", true);
      })();
    }) as never,
  };
  let id = 0;
  const normalResearch: ResearchWebTools = {
    async search(query) {
      const results = [1, 2, 3].map((i) => ({ title: `T ${query} ${i}`, url: `https://${query}.example/${i}`, snippet: "s" }));
      const step_id = `s${++id}`;
      const events: WebEvent[] = [
        { type: "step", data: { step_id, kind: "search", status: "started", query } },
        { type: "step", data: { step_id, kind: "search", status: "done", query } },
      ];
      return { results, events };
    },
    async read(url, _signal, numberPage) {
      reads.push(url);
      const n = numberPage(url);
      const step_id = `r${++id}`;
      const events: WebEvent[] = [
        { type: "step", data: { step_id, kind: "read", status: "started", url } },
        { type: "step", data: { step_id, kind: "read", status: "done", url } },
        { type: "source", data: { title: `Title ${url}`, url, n } },
      ];
      return { page: { n, title: `Title ${url}`, url, text: `Fact for ${url}. More words.`, truncated: false }, events };
    },
  };
  const research: ResearchWebTools = {
    search: (query, signal) =>
      opts.search ? opts.search(query, signal, normalResearch.search) : normalResearch.search(query, signal),
    read: (url, signal, numberPage) =>
      opts.read ? opts.read(url, signal, normalResearch.read, numberPage) : normalResearch.read(url, signal, numberPage),
  };
  const web: GenerationWebTools & ResearchWebTools = {
    tools: () => [],
    systemNote: () => "SYSTEM NOTE",
    execute: async () => ({ toolResult: "", events: [] }),
    ...research,
  };
  setValidToken(TOKEN);
  const server = createServer({ ollama: client, manager: new GenerationManager(client, web, { ...NO_SKIP, ...opts.research }), port: 0, researchModel: "fake-model" });
  const base = `http://127.0.0.1:${server.port}`;
  const post = (body: unknown) => fetch(`${base}/v1/chat`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  return { requests, reads, server, base, post };
}

describe("POST /v1/chat with deep_research (M15 FR35, FR37)", () => {
  it("runs the research module and streams steps, sources, report and done", async () => {
    const s = setup();
    try {
      const chat = await s.post({ model: "fake-model", messages: [{ role: "user", content: "cats?" }], web: true, deep_research: true });
      expect(chat.status).toBe(200);
      const events = parseSSE(await chat.text());

      const steps = events.filter((e) => e.event === "step").map((e) => JSON.parse(e.data));
      const kinds = steps.map((x) => x.kind);
      const firstOf = (k: string) => kinds.indexOf(k);
      const lastOf = (k: string) => kinds.lastIndexOf(k);
      expect(kinds[0]).toBe("plan");
      expect(firstOf("search")).toBeGreaterThan(lastOf("plan") - 1);
      expect(firstOf("read")).toBeGreaterThan(firstOf("search"));
      expect(lastOf("search")).toBeGreaterThan(firstOf("read") - 1);
      expect(kinds[kinds.length - 1]).toBe("write");
      expect(kinds.lastIndexOf("read")).toBeLessThan(firstOf("write"));
      expect(kinds.filter((k) => k === "plan").length).toBe(2);
      expect(kinds.filter((k) => k === "write").length).toBe(2);
      expect(steps[steps.length - 1].status).toBe("done");

      const sourcesEvents = events.filter((e) => e.event === "sources");
      expect(sourcesEvents.length).toBe(1);
      const items = JSON.parse(sourcesEvents[0].data).items as Array<{ url: string; n: number }>;
      expect(items.map((i) => i.n)).toEqual(items.map((_, i) => i + 1));
      expect(items.map((i) => i.url)).toEqual(s.reads);

      const content = events.filter((e) => e.event === "content").map((e) => JSON.parse(e.data).text).join("");
      expect(content).toBe(CLEANED);
      expect(content).not.toContain("[99]");
      expect(content).not.toContain("http");

      const last = events[events.length - 1];
      expect(last.event).toBe("done");
      expect(JSON.parse(last.data).status).toBe("complete");

      expect(s.requests.length).toBeGreaterThan(0);
      const numCtx = s.requests[0].options?.num_ctx;
      expect(typeof numCtx).toBe("number");
      for (const r of s.requests) {
        expect(r.format).toBeDefined();
        expect(r.options.num_ctx).toBe(numCtx);
        expect(r.tools).toBeUndefined();
      }
    } finally {
      s.server.stop(true);
    }
  });

  it("rejects a non-boolean deep_research", async () => {
    const s = setup();
    try {
      const chat = await s.post({ model: "fake-model", messages: [{ role: "user", content: "x" }], web: true, deep_research: "yes" });
      expect(chat.status).toBe(400);
    } finally {
      s.server.stop(true);
    }
  });

  describe("time budget (M17 FR36)", () => {
    const body = { model: "fake-model", messages: [{ role: "user", content: "cats?" }], web: true, deep_research: true };
    const BUDGET = 800;

    /** Sends the chat and returns its events and the ms from send to the terminal done event. */
    async function run(s: ReturnType<typeof setup>) {
      const sent = Date.now();
      const chat = await s.post(body);
      const events = parseSSE(await chat.text());
      const wall = Date.now() - sent;
      return { events, wall };
    }
    const doneOf = (events: ReturnType<typeof parseSSE>) => {
      const last = events[events.length - 1];
      expect(last.event).toBe("done");
      return JSON.parse(last.data);
    };
    const contentOf = (events: ReturnType<typeof parseSSE>) =>
      events.filter((e) => e.event === "content").map((e) => JSON.parse(e.data).text).join("");
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    /** A promise that settles with `value` once the signal aborts (never earlier). */
    const untilAborted = <T>(signal: AbortSignal | undefined, value: T) =>
      new Promise<T>((resolve) => {
        if (signal?.aborted) resolve(value);
        else signal?.addEventListener("abort", () => resolve(value), { once: true });
      });
    const failedSearch = (query: string, status: "failed" | "unavailable" = "unavailable") => ({
      results: [],
      events: [
        { type: "step", data: { step_id: `f-${query}`, kind: "search", status: "started", query } },
        { type: "step", data: { step_id: `f-${query}`, kind: "search", status, query } },
      ] as WebEvent[],
    });

    it("AC1: a slow step uses up research time, the run writes, ends partial, and every step carries elapsed/budget", async () => {
      let searchCalls = 0;
      const s = setup({
        research: { budgetMs: BUDGET },
        search: async (query, signal, normal) => {
          // The first sub-question runs at full speed so a note is gathered (FR36: no note = failed);
          // later searches are slow (finite, ignore the signal) and use up the research time.
          if (++searchCalls > 2) await sleep(350);
          return normal(query, signal);
        },
      });
      try {
        const { events, wall } = await run(s);
        const steps = events.filter((e) => e.event === "step").map((e) => JSON.parse(e.data));
        expect(steps.some((x) => x.kind === "write")).toBe(true);
        for (const x of steps) {
          expect(typeof x.elapsed_ms).toBe("number");
          expect(x.budget_ms).toBe(BUDGET);
        }
        const done = doneOf(events);
        expect(done.status).toBe("complete");
        expect(done.research.status).toBe("partial");
        expect(typeof done.research.elapsed_ms).toBe("number");
        expect(done.research.budget_ms).toBe(BUDGET);
        expect(wall).toBeLessThan(BUDGET + 500);
      } finally {
        s.server.stop(true);
      }
    });

    it("AC2: every search failing ends within budget with failed and the could-not-search note", async () => {
      const s = setup({ research: { budgetMs: BUDGET }, search: async (query) => failedSearch(query) });
      try {
        const { events, wall } = await run(s);
        const done = doneOf(events);
        expect(done.research.status).toBe("failed");
        expect(contentOf(events)).toBe(COULD_NOT_SEARCH_NOTE);
        const steps = events.filter((e) => e.event === "step").map((e) => JSON.parse(e.data));
        expect(steps.some((x) => x.kind === "search" && x.status === "unavailable")).toBe(true);
        expect(wall).toBeLessThan(BUDGET + 500);
      } finally {
        s.server.stop(true);
      }
    });

    it("AC3a: an in-flight search receives an aborted signal at the deadline and the stream ends in time", async () => {
      const seen: boolean[] = [];
      const s = setup({
        research: { budgetMs: BUDGET },
        search: async (query, signal) => {
          const result = await untilAborted(signal, failedSearch(query));
          seen.push(signal.aborted);
          return result;
        },
      });
      try {
        const { events, wall } = await run(s);
        expect(seen.length).toBeGreaterThan(0);
        expect(seen.every((aborted) => aborted)).toBe(true);
        expect(doneOf(events).research.status).toBe("failed");
        expect(wall).toBeLessThan(BUDGET + 500);
      } finally {
        s.server.stop(true);
      }
    });

    it("AC3a: an in-flight read receives an aborted signal at the deadline and the stream ends in time", async () => {
      const seen: boolean[] = [];
      let readCalls = 0;
      const s = setup({
        research: { budgetMs: BUDGET },
        read: async (url, signal, normal, numberPage) => {
          // The first read succeeds so a note is gathered (FR36: no note = failed); later reads hang.
          if (++readCalls === 1) return normal(url, signal, numberPage);
          const result = await untilAborted(signal, {
            page: null,
            events: [{ type: "step", data: { step_id: "rx", kind: "read", status: "failed", url } }] as WebEvent[],
          });
          seen.push(signal.aborted);
          return result;
        },
      });
      try {
        const { events, wall } = await run(s);
        expect(seen.length).toBeGreaterThan(0);
        expect(seen.every((aborted) => aborted)).toBe(true);
        expect(doneOf(events).research.status).toBe("partial");
        expect(wall).toBeLessThan(BUDGET + 500);
      } finally {
        s.server.stop(true);
      }
    });

    it("AC3a: an in-flight model request receives an aborted signal at the deadline and the stream ends in time", async () => {
      const seen: boolean[] = [];
      let hung = false;
      const s = setup({
        research: { budgetMs: BUDGET },
        chat: (_request, signal) => {
          if (hung) return undefined; // only the first request hangs
          hung = true;
          return (async function* () {
            await untilAborted(signal, undefined);
            seen.push(signal?.aborted === true);
            throw new DOMException("aborted", "AbortError");
          })();
        },
      });
      try {
        const { events, wall } = await run(s);
        expect(seen).toEqual([true]);
        expect(doneOf(events).research.status).toBe("partial");
        expect(wall).toBeLessThan(BUDGET + 500);
      } finally {
        s.server.stop(true);
      }
    });

    it("AC3b: a hanging write request ends partial within budget with non-empty content", async () => {
      const seen: boolean[] = [];
      const s = setup({
        research: { budgetMs: BUDGET },
        chat: (request, signal) => {
          if (!Object.keys(request.format?.properties ?? {}).includes("report")) return undefined;
          return (async function* () {
            await untilAborted(signal, undefined);
            seen.push(signal?.aborted === true);
            throw new DOMException("aborted", "AbortError");
          })();
        },
      });
      try {
        const { events, wall } = await run(s);
        expect(seen.length).toBeGreaterThan(0);
        expect(seen.every((aborted) => aborted)).toBe(true);
        const done = doneOf(events);
        expect(done.research.status).toBe("partial");
        const content = contentOf(events);
        expect(content.length).toBeGreaterThan(0);
        expect(content === NO_REPORT_NOTE || content.includes("Notes gathered")).toBe(true);
        expect(wall).toBeLessThan(BUDGET + 500);
      } finally {
        s.server.stop(true);
      }
    });

    it("a thrown error inside the run ends with a content sentence and failed research, never an error event", async () => {
      const s = setup({
        research: { budgetMs: BUDGET },
        search: async () => {
          throw new Error("backend exploded");
        },
      });
      try {
        const { events } = await run(s);
        expect(events.some((e) => e.event === "error")).toBe(false);
        expect(contentOf(events).length).toBeGreaterThan(0);
        const done = doneOf(events);
        expect(done.status).toBe("complete");
        expect(done.research.status).toBe("failed");
        expect(done.research.budget_ms).toBe(BUDGET);
        expect(typeof done.research.elapsed_ms).toBe("number");
      } finally {
        s.server.stop(true);
      }
    });
  });
});
