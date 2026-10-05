import { describe, it, expect } from "bun:test";
import { createServer, setValidToken, type OllamaStateClient } from "./server";
import type { OllamaChatResponse } from "../ollama/client";
import { GenerationManager, type GenerationWebTools } from "../generations/manager";
import type { ResearchWebTools } from "../generations/research";
import type { WebEvent } from "../web/tools";

/** M19j-T8 FR35: the server, not the model, sets the sub-question count (a short plan is topped up). */
const TOKEN = "test-token";
const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` });

function chunk(content: string, done: boolean): OllamaChatResponse {
  return {
    model: "fake-model", created_at: "", message: { role: "assistant", content }, done,
    total_duration: 0, load_duration: 0, prompt_eval_count: 0, prompt_eval_duration: 0, eval_count: 0, eval_duration: 0,
  } as OllamaChatResponse;
}

const STEP_FOR_KEY: Record<string, string> = {
  brief: "brief", sub_questions: "plan", queries: "queries", pages: "pages", notes: "notes", enough: "gap", report: "write",
};
const stepOf = (request: any): string => STEP_FOR_KEY[Object.keys(request.format.properties)[0]!]!;
const userOf = (request: any): string => request.messages.find((m: any) => m.role === "user").content as string;

/** planReplies: raw content for the 1st, 2nd... plan-format request (a string is sent as is). */
async function run(planReplies: unknown[]): Promise<{ requests: any[]; text: string }> {
  const requests: any[] = [];
  let planCalls = 0;
  let id = 0;
  const client: OllamaStateClient = {
    tags: async () => ({ models: [{ name: "fake-model", modified_at: "", size: 1, digest: "d" }] }),
    ps: async () => ({ models: [{ name: "fake-model", model: "fake-model", size: 1, digest: "d", details: { family: "", parameter_size: "", quantization_level: "" }, expires_at: "", size_vram: 0 }] }) as any,
    show: async () => ({ capabilities: ["completion", "tools"] }),
    load: async () => {},
    unload: async () => {},
    chat: ((request: any) => {
      requests.push(JSON.parse(JSON.stringify(request)));
      const keys = Object.keys(request.format?.properties ?? {});
      const userText = request.messages.map((m: any) => m.content).join("\n");
      let content: string;
      if (keys.includes("brief")) content = JSON.stringify({ brief: "The brief" });
      else if (keys.includes("sub_questions")) {
        const r = planReplies[Math.min(planCalls++, planReplies.length - 1)];
        content = typeof r === "string" ? r : JSON.stringify(r);
      } else if (keys.includes("queries")) content = JSON.stringify({ queries: ["alpha", "beta", "gamma"] });
      else if (keys.includes("pages")) content = JSON.stringify({ pages: [1, 2] });
      else if (keys.includes("notes")) {
        const m = userText.match(/Fact for (\S+?)\./);
        content = JSON.stringify({ notes: m ? [{ quote: `Fact for ${m[1]}`, claim: `claim ${m[1]}` }] : [] });
      } else if (keys.includes("enough")) content = JSON.stringify({ enough: true });
      else content = JSON.stringify({ report: "A report [1]." });
      return (async function* () {
        yield chunk(content, false);
        yield chunk("", true);
      })();
    }) as never,
  };
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
  const web_tools: GenerationWebTools & ResearchWebTools = {
    tools: () => [],
    systemNote: () => "SYSTEM NOTE",
    execute: async () => ({ toolResult: "", events: [] }),
    ...research,
  };
  setValidToken(TOKEN);
  const manager = new GenerationManager(
    client, web_tools, { noteMinWords: 0, noteMinRelevance: -1, pagesPerSubQuestion: 3 }, () => {}, () => new Date(2026, 9, 3, 12)
  );
  const server = createServer({ ollama: client, manager, port: 0, researchModel: "fake-model" });
  let text = "";
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/v1/chat`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ model: "fake-model", messages: [{ role: "user", content: "The question" }], web: true, deep_research: true }),
    });
    expect(res.status).toBe(200);
    text = await res.text();
  } finally {
    server.stop(true);
  }
  return { requests, text };
}

const planRequests = (rs: any[]) => rs.filter((r) => stepOf(r) === "plan");
/** The sub-question label texts the queries requests were sent, in order of first appearance. */
const labels = (rs: any[]): string[] => {
  const seen: string[] = [];
  for (const r of rs.filter((x) => stepOf(x) === "queries")) {
    const m = userOf(r).match(/Current sub-question \((\d+) of (\d+)\): (.*)/);
    if (m && !seen.includes(`${m[1]}/${m[2]}:${m[3]}`)) seen.push(`${m[1]}/${m[2]}:${m[3]}`);
  }
  return seen;
};
const sameSystem = (rs: any[]) => {
  const sys = rs.map((r) => r.messages.find((m: any) => m.role === "system").content);
  expect(new Set(sys).size).toBe(1);
};
const complete = (rs: any[], text: string) => {
  expect(rs.some((r) => stepOf(r) === "write")).toBe(true);
  expect(text).toContain("A report");
};

describe("deep research plan count (M19j-T8)", () => {
  it("a: short plan, extra request gives two new distinct ones -> 3 sub-questions", async () => {
    const { requests, text } = await run([{ sub_questions: ["only one"] }, { sub_questions: ["second one", "third one"] }]);
    const plans = planRequests(requests);
    expect(plans.length).toBe(2);
    expect(plans[1].think).toBe(false);
    expect(plans[1].options).toEqual({ num_ctx: plans[1].options.num_ctx });
    const u = userOf(plans[1]);
    expect(u).toContain("1. only one");
    expect(u).toContain("Give exactly 2 further distinct sub-questions");
    expect(u).toContain("If the question asks about costs, prices, bills or running costs");
    expect(labels(requests)).toEqual(["1/3:only one", "2/3:second one", "3/3:third one"]);
    sameSystem(requests);
    complete(requests, text);
  });

  it("b: extra reply malformed -> first, then the brief, then the question", async () => {
    const { requests, text } = await run([{ sub_questions: ["only one"] }, "not json"]);
    expect(planRequests(requests).length).toBe(2);
    expect(labels(requests)).toEqual(["1/3:only one", "2/3:The brief", "3/3:The question"]);
    sameSystem(requests);
    complete(requests, text);
  });

  it("b: extra reply only case/space duplicates -> first, then the brief, then the question", async () => {
    const { requests, text } = await run([{ sub_questions: ["Only One"] }, { sub_questions: ["  only   one ", "ONLY ONE"] }]);
    expect(planRequests(requests).length).toBe(2);
    expect(labels(requests)).toEqual(["1/3:Only One", "2/3:The brief", "3/3:The question"]);
    sameSystem(requests);
    complete(requests, text);
  });

  it("c: full plan -> one plan request, 3 sub-questions", async () => {
    const { requests, text } = await run([{ sub_questions: ["one", "two", "three"] }]);
    expect(planRequests(requests).length).toBe(1);
    expect(labels(requests)).toEqual(["1/3:one", "2/3:two", "3/3:three"]);
    sameSystem(requests);
    complete(requests, text);
  });

  it("d: duplicates [A, 'a ', B] are de-duplicated to 2 and one extra request is made", async () => {
    const { requests, text } = await run([{ sub_questions: ["A", "a ", "B"] }, { sub_questions: ["C"] }]);
    const plans = planRequests(requests);
    expect(plans.length).toBe(2);
    const u = userOf(plans[1]);
    expect(u).toContain("1. A");
    expect(u).toContain("2. B");
    expect(u).toContain("Give exactly 1 further distinct sub-questions");
    expect(labels(requests)).toEqual(["1/3:A", "2/3:B", "3/3:C"]);
    sameSystem(requests);
    complete(requests, text);
  });
});
