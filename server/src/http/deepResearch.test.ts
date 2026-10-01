import { describe, it, expect } from "bun:test";
import { createServer, setValidToken, type OllamaStateClient } from "./server";
import type { OllamaChatResponse } from "../ollama/client";
import { GenerationManager, type GenerationWebTools } from "../generations/manager";
import type { ResearchWebTools } from "../generations/research";
import type { WebEvent } from "../web/tools";

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

function setup() {
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
  const web: GenerationWebTools & ResearchWebTools = {
    tools: () => [],
    systemNote: () => "SYSTEM NOTE",
    execute: async () => ({ toolResult: "", events: [] }),
    ...research,
  };
  setValidToken(TOKEN);
  const server = createServer({ ollama: client, manager: new GenerationManager(client, web), port: 0 });
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
});
