import { describe, it, expect } from "bun:test";
import { createServer, setValidToken, type OllamaStateClient } from "./server";
import type { OllamaChatResponse } from "../ollama/client";
import { GenerationManager, type GenerationWebTools } from "../generations/manager";
import {
  COULD_NOT_READ_NOTE,
  COULD_NOT_SEARCH_NOTE,
  RAN_OUT_OF_TIME_NOTE,
  type ResearchSettings,
  type ResearchWebTools,
} from "../generations/research";
import type { WebEvent } from "../web/tools";

/** Tiny fixture pages: the M19c skip rules are off, these tests are not about passage selection. */
const NO_SKIP = { noteMinWords: 0, noteMinRelevance: -1 };
const TOKEN = "test-token";
const BUDGET = 800;
const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` });
const body = { model: "fake-model", messages: [{ role: "user", content: "cats?" }], web: true, deep_research: true };

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

const stepKeys = (format: any) => Object.keys(format?.properties ?? {});
const isNotes = (request: any) => stepKeys(request.format).includes("notes");
const isWrite = (request: any) => stepKeys(request.format).includes("report");

function replyFor(format: any): unknown {
  const keys = stepKeys(format);
  if (keys.includes("brief")) return { brief: "About cats" };
  if (keys.includes("sub_questions")) return { sub_questions: ["sq one"] };
  if (keys.includes("queries")) return { queries: ["alpha", "beta"] };
  if (keys.includes("pages")) return { pages: [1] };
  if (keys.includes("notes")) return { notes: [] };
  if (keys.includes("enough")) return { enough: true };
  if (keys.includes("report")) return { report: "Cats sleep a lot [1]." };
  throw new Error("unknown step");
}

const PAGE_TEXT = "Cats sleep for most of the day. Cats purr when content.";
const untilAborted = (signal: AbortSignal | undefined) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) resolve();
    else signal?.addEventListener("abort", () => resolve(), { once: true });
  });
const failedSearch = (query: string) => ({
  results: [],
  events: [
    { type: "step", data: { step_id: `f-${query}`, kind: "search", status: "started", query } },
    { type: "step", data: { step_id: `f-${query}`, kind: "search", status: "unavailable", query } },
  ] as WebEvent[],
});

function setup(opts: {
  research?: Partial<ResearchSettings>;
  search?: ResearchWebTools["search"];
  /** Streams for a notes request; undefined gives the normal (empty notes) reply. */
  notes?: (signal: AbortSignal | undefined) => AsyncGenerator<OllamaChatResponse> | undefined;
}) {
  const requests: any[] = [];
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
    chat: ((request: any, signal?: AbortSignal) => {
      requests.push(JSON.parse(JSON.stringify(request)));
      if (isNotes(request)) {
        const custom = opts.notes?.(signal);
        if (custom) return custom;
      }
      const content = JSON.stringify(replyFor(request.format));
      return (async function* () {
        yield chunk(content, false);
        yield chunk("", true);
      })();
    }) as never,
  };
  let id = 0;
  const research: ResearchWebTools = {
    search:
      opts.search ??
      (async (query) => {
        const results = [1, 2].map((i) => ({ title: `T ${query} ${i}`, url: `https://${query}.example/${i}`, snippet: "s" }));
        const step_id = `s${++id}`;
        return {
          results,
          events: [
            { type: "step", data: { step_id, kind: "search", status: "started", query } },
            { type: "step", data: { step_id, kind: "search", status: "done", query } },
          ] as WebEvent[],
        };
      }),
    async read(url, _signal, numberPage) {
      const n = numberPage(url);
      const step_id = `r${++id}`;
      return {
        page: { n, title: `Title ${url}`, url, text: PAGE_TEXT, truncated: false },
        events: [
          { type: "step", data: { step_id, kind: "read", status: "started", url } },
          { type: "step", data: { step_id, kind: "read", status: "done", url } },
          { type: "source", data: { title: `Title ${url}`, url, n } },
        ] as WebEvent[],
      };
    },
  };
  const web: GenerationWebTools & ResearchWebTools = {
    tools: () => [],
    systemNote: () => "SYSTEM NOTE",
    execute: async () => ({ toolResult: "", events: [] }),
    ...research,
  };
  setValidToken(TOKEN);
  const server = createServer({ ollama: client, manager: new GenerationManager(client, web, { ...NO_SKIP, ...opts.research }), port: 0, researchModel: "fake-model" });
  const post = () => fetch(`http://127.0.0.1:${server.port}/v1/chat`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  return { requests, server, post };
}

async function run(s: ReturnType<typeof setup>) {
  const events = parseSSE(await (await s.post()).text());
  const done = JSON.parse(events[events.length - 1]!.data);
  const content = events.filter((e) => e.event === "content").map((e) => JSON.parse(e.data).text).join("");
  return { events, done, content };
}

/** A notes stream that sends `partial`, then hangs until its signal aborts (the deadline). */
const hangAfter = (partial: string) => (signal: AbortSignal | undefined) =>
  (async function* () {
    if (partial) yield chunk(partial, false);
    await untilAborted(signal);
    throw new DOMException("aborted", "AbortError");
  })();

describe("deep research keeps complete notes of a deadline-cut note call (M19d FR44)", () => {
  it("AC3a: complete notes with a verified quote reach the write; bad quote and incomplete note do not", async () => {
    let hung = false;
    const partial =
      '{"notes":[{"quote":"Cats sleep for most of the day","claim":"VALIDCLAIM cats sleep"},' +
      '{"quote":"Cats fly at night","claim":"BADQUOTECLAIM cats fly"},{"quote":"Cats purr","claim":"INCOMPLETECLAIM';
    const s = setup({
      research: { budgetMs: BUDGET },
      notes: (signal) => {
        if (hung) return undefined;
        hung = true;
        return hangAfter(partial)(signal);
      },
    });
    try {
      const { done, content } = await run(s);
      const write = s.requests.find(isWrite);
      expect(write).toBeDefined();
      const writeText = write.messages.map((m: any) => m.content).join("\n");
      expect(writeText).toContain("VALIDCLAIM cats sleep");
      expect(writeText).not.toContain("BADQUOTECLAIM");
      expect(writeText).not.toContain("INCOMPLETECLAIM");
      expect(content).toContain("[1]");
      expect(done.status).toBe("complete");
      expect(done.research.status).toBe("partial");
    } finally {
      s.server.stop(true);
    }
  });

  it("AC3b: research time running out before any note is kept ends failed with the ran-out-of-time sentence", async () => {
    let hung = false;
    const s = setup({
      research: { budgetMs: BUDGET },
      notes: (signal) => {
        if (hung) return undefined;
        hung = true;
        return hangAfter("")(signal);
      },
    });
    try {
      const { done, content } = await run(s);
      expect(done.research.status).toBe("failed");
      expect(content).toBe(RAN_OUT_OF_TIME_NOTE);
      expect(content).toBe("The research ran out of time before it could take notes.");
      expect(content).not.toContain(COULD_NOT_READ_NOTE);
    } finally {
      s.server.stop(true);
    }
  });

  it("AC3c: pages read without the deadline but no surviving note still ends failed with the could-not-read sentence", async () => {
    const s = setup({ research: { budgetMs: 20_000 } });
    try {
      const { done, content } = await run(s);
      expect(done.research.status).toBe("failed");
      expect(content).toBe(COULD_NOT_READ_NOTE);
    } finally {
      s.server.stop(true);
    }
  });

  it("AC3c: every search failing still gets the could-not-search sentence", async () => {
    const s = setup({ research: { budgetMs: BUDGET }, search: async (query) => failedSearch(query) });
    try {
      const { done, content } = await run(s);
      expect(done.research.status).toBe("failed");
      expect(content).toBe(COULD_NOT_SEARCH_NOTE);
    } finally {
      s.server.stop(true);
    }
  });
});
