import { describe, it, expect } from "bun:test";
import { createServer, setValidToken, type OllamaStateClient } from "./server";
import type { OllamaChatResponse } from "../ollama/client";
import { GenerationManager, type GenerationWebTools } from "../generations/manager";
import type { ResearchWebTools } from "../generations/research";
import type { WebEvent } from "../web/tools";

// FR38: the two-stage Stop of a deep research run, over HTTP.

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

const REPORT = "Cats sleep a lot [1].";

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

const untilAborted = (signal: AbortSignal | undefined) =>
  new Promise<never>((_, reject) => {
    const fail = () => reject(signal?.reason ?? new DOMException("aborted", "AbortError"));
    if (!signal || signal.aborted) fail();
    else signal.addEventListener("abort", fail, { once: true });
  });

function setup(opts: { hangWrite?: boolean; stopWriteMs?: number } = {}) {
  let searchCalls = 0;
  let resolveSearchHang!: () => void;
  const searchHanging = new Promise<void>((r) => (resolveSearchHang = r));
  let resolveWriteHang!: () => void;
  const writeHanging = new Promise<void>((r) => (resolveWriteHang = r));
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
      const keys = Object.keys(request.format?.properties ?? {});
      if (opts.hangWrite && keys.includes("report")) {
        resolveWriteHang();
        return (async function* () {
          await untilAborted(signal);
        })();
      }
      const userText = request.messages.map((m: any) => m.content).join("\n");
      const content = JSON.stringify(replyFor(request.format, userText));
      return (async function* () {
        yield chunk(content, false);
        yield chunk("", true);
      })();
    }) as never,
  };
  let id = 0;
  const research: ResearchWebTools = {
    async search(query, signal) {
      // The third search (second sub-question) hangs until it is cancelled.
      if (++searchCalls === 3) {
        resolveSearchHang();
        await untilAborted(signal);
      }
      const results = [1, 2, 3].map((i) => ({ title: `T ${query} ${i}`, url: `https://${query}.example/${i}`, snippet: "s" }));
      const step_id = `s${++id}`;
      const events: WebEvent[] = [
        { type: "step", data: { step_id, kind: "search", status: "started", query } },
        { type: "step", data: { step_id, kind: "search", status: "done", query } },
      ];
      return { results, events };
    },
    async read(url, _signal, numberPage) {
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
  const web: GenerationWebTools & ResearchWebTools = {
    tools: () => [],
    systemNote: () => "SYSTEM NOTE",
    execute: async () => ({ toolResult: "", events: [] }),
    ...research,
  };
  setValidToken(TOKEN);
  const manager = new GenerationManager(client, web, { ...NO_SKIP, stopWriteMs: opts.stopWriteMs ?? 5000 });
  const server = createServer({ ollama: client, manager, port: 0, researchModel: "fake-model" });
  const base = `http://127.0.0.1:${server.port}`;
  const start = async () => {
    const chat = await fetch(`${base}/v1/chat`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ model: "fake-model", messages: [{ role: "user", content: "cats?" }], web: true, deep_research: true }),
    });
    const genId = chat.headers.get("x-generation-id")!;
    return { genId, body: chat.text() };
  };
  const cancel = async (genId: string) => {
    const r = await fetch(`${base}/v1/generations/${genId}/cancel`, { method: "POST", headers: headers() });
    return { status: r.status, json: (await r.json()) as { status: string } };
  };
  const events = async (genId: string) =>
    parseSSE(await (await fetch(`${base}/v1/generations/${genId}/events`, { headers: headers() })).text());
  return { server, start, cancel, events, searchHanging, writeHanging };
}

describe("deep research two-stage Stop over HTTP (M19 FR38)", () => {
  it("one Stop: the stream ends with a write step, one report content event and done research partial", async () => {
    const s = setup();
    try {
      const { genId, body } = await s.start();
      await s.searchHanging;
      const r = await s.cancel(genId);
      expect(r.status).toBe(200);
      expect(r.json.status).toBe("cancelled");
      const events = parseSSE(await body);
      const again = await s.events(genId);
      expect(again.map((e) => e.event)).toEqual(events.map((e) => e.event));

      const steps = events.filter((e) => e.event === "step").map((e) => JSON.parse(e.data));
      expect(steps.filter((x) => x.kind === "write").length).toBe(2);
      expect(steps[steps.length - 1]).toMatchObject({ kind: "write", status: "done" });
      const content = events.filter((e) => e.event === "content");
      expect(content.length).toBe(1);
      expect(JSON.parse(content[0]!.data).text).toBe(REPORT);
      const last = events[events.length - 1]!;
      expect(last.event).toBe("done");
      const done = JSON.parse(last.data);
      expect(done.status).toBe("complete");
      expect(done.research.status).toBe("partial");
    } finally {
      s.server.stop(true);
    }
  });

  it("two Stops (second during the write-up): the stream ends cancelled with steps and sources but no report", async () => {
    const s = setup({ hangWrite: true });
    try {
      const { genId, body } = await s.start();
      await s.searchHanging;
      expect((await s.cancel(genId)).json.status).toBe("cancelled");
      await s.writeHanging;
      const second = await s.cancel(genId);
      expect(second.status).toBe(200);
      expect(second.json.status).toBe("cancelled");
      const events = parseSSE(await body);

      const last = events[events.length - 1]!;
      expect(last.event).toBe("done");
      expect(JSON.parse(last.data).status).toBe("cancelled");
      expect(events.some((e) => e.event === "content")).toBe(false);
      const kinds = events.filter((e) => e.event === "step").map((e) => JSON.parse(e.data).kind);
      expect(kinds).toContain("search");
      expect(kinds).toContain("read");
      expect(kinds).toContain("write");
      const sources = events.find((e) => e.event === "sources");
      expect(sources).toBeDefined();
      expect(JSON.parse(sources!.data).items.length).toBeGreaterThan(0);

      // Once ended, a further Stop is already_complete.
      expect((await s.cancel(genId)).json.status).toBe("already_complete");
    } finally {
      s.server.stop(true);
    }
  });
});
