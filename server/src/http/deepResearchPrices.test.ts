import { describe, it, expect } from "bun:test";
import { createServer, setValidToken, type OllamaStateClient } from "./server";
import type { OllamaChatResponse } from "../ollama/client";
import { GenerationManager, type GenerationWebTools } from "../generations/manager";
import type { ResearchWebTools } from "../generations/research";
import {
  PLAN_PRICES_RULE,
  WRITE_DATE_RULE,
  WRITE_SUM_RULE,
  WRITE_NO_PRICE_RULE,
} from "../generations/research";
import { todayLine, type WebEvent } from "../web/tools";

/** M19i FR46(b)(c)(d): deep research plan and write steps carry FR46 pricing rules. */
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

function replyFor(format: any, userText: string): unknown {
  const keys = Object.keys(format?.properties ?? {});
  if (keys.includes("brief")) return { brief: "About costs" };
  if (keys.includes("sub_questions")) return { sub_questions: ["sq one", "sq two"] };
  if (keys.includes("queries")) return { queries: ["alpha", "beta", "gamma"] };
  if (keys.includes("pages")) return { pages: [1, 2] };
  if (keys.includes("notes")) {
    const m = userText.match(/Fact for (\S+?)\./);
    return { notes: m ? [{ quote: `Fact for ${m[1]}`, claim: `claim ${m[1]}` }] : [] };
  }
  if (keys.includes("enough")) return { enough: true };
  if (keys.includes("report")) return { report: "Costs are about £100 [1]." };
  throw new Error("unknown step");
}

async function runOn(day: Date, question: string, web: boolean, deep_research: boolean): Promise<any[]> {
  const requests: any[] = [];
  let id = 0;
  const client: OllamaStateClient = {
    tags: async () => ({ models: [{ name: "fake-model", modified_at: "", size: 1, digest: "d" }] }),
    ps: async () => ({ models: [{ name: "fake-model", model: "fake-model", size: 1, digest: "d", details: { family: "", parameter_size: "", quantization_level: "" }, expires_at: "", size_vram: 0 }] }) as any,
    show: async () => ({ capabilities: ["completion", "tools"] }),
    load: async () => {},
    unload: async () => {},
    chat: ((request: any) => {
      requests.push(JSON.parse(JSON.stringify(request)));
      const userText = request.messages.map((m: any) => m.content).join("\n");
      const content = JSON.stringify(replyFor(request.format, userText));
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
    client, web_tools, { noteMinWords: 0, noteMinRelevance: -1, pagesPerSubQuestion: 3 }, () => {}, () => day
  );
  const server = createServer({ ollama: client, manager, port: 0, researchModel: "fake-model" });
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/v1/chat`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ model: "fake-model", messages: [{ role: "user", content: question }], web, deep_research }),
    });
    expect(res.status).toBe(200);
    await res.text();
  } finally {
    server.stop(true);
  }
  return requests;
}

describe("deep research pricing rules (M19i AC2, AC3, AC4)", () => {
  it("AC2: plan request contains PLAN_PRICES_RULE with 'current unit prices' phrase for cost questions", async () => {
    const day = new Date(2026, 9, 3, 12);
    const requests = await runOn(day, "How much does it cost to run a heat pump in the UK?", true, true);

    const planRequests = requests.filter((r) => stepOf(r) === "plan");
    expect(planRequests.length).toBeGreaterThanOrEqual(1);

    const planRequest = planRequests[0];
    const userMsg = planRequest.messages.find((m: any) => m.role === "user").content as string;

    // Should contain the exact PLAN_PRICES_RULE
    expect(userMsg).toContain("If the question asks about costs, prices, bills or running costs");
    expect(userMsg).toContain("current unit prices");
  });

  it("AC2: plan request contains PLAN_PRICES_RULE even for non-cost questions (proves no server classifier)", async () => {
    const day = new Date(2026, 9, 3, 12);
    const requests = await runOn(day, "Why do cats purr?", true, true);

    const planRequests = requests.filter((r) => stepOf(r) === "plan");
    expect(planRequests.length).toBeGreaterThanOrEqual(1);

    const planRequest = planRequests[0];
    const userMsg = planRequest.messages.find((m: any) => m.role === "user").content as string;

    // Should still contain PLAN_PRICES_RULE unconditionally
    expect(userMsg).toContain("If the question asks about costs, prices, bills or running costs");
    expect(userMsg).toContain("current unit prices");
  });

  it("AC3: write request contains all three WRITE_* rules and citation instruction, with expected fragments", async () => {
    const day = new Date(2026, 9, 3, 12);
    const requests = await runOn(day, "How much does it cost to run a heat pump in the UK?", true, true);

    const writeRequests = requests.filter((r) => stepOf(r) === "write");
    expect(writeRequests.length).toBeGreaterThanOrEqual(1);

    const writeRequest = writeRequests[0];
    const userMsg = writeRequest.messages.find((m: any) => m.role === "user").content as string;

    // Should contain existing citation instruction
    expect(userMsg).toContain("every sentence that");
    expect(userMsg).toContain("must end with that note's page number in square brackets");

    // Should contain WRITE_DATE_RULE with "early 2024" fragment
    expect(userMsg).toContain("Never call a price or period");
    expect(userMsg).toContain("current");
    expect(userMsg).toContain("today's");
    expect(userMsg).toContain("early 2024");

    // Should contain WRITE_SUM_RULE with "sum shown" fragment
    expect(userMsg).toContain("quantity");
    expect(userMsg).toContain("unit price");
    expect(userMsg).toContain("sum shown");

    // Should contain WRITE_NO_PRICE_RULE with "no current price was found" fragment
    expect(userMsg).toContain("no current price was found");
  });

  it("AC3: non-write requests do not contain WRITE_* rules", async () => {
    const day = new Date(2026, 9, 3, 12);
    const requests = await runOn(day, "How much does it cost to run a heat pump in the UK?", true, true);

    const nonWriteRequests = requests.filter((r) => stepOf(r) !== "write");

    for (const request of nonWriteRequests) {
      const userMsg = request.messages.find((m: any) => m.role === "user").content as string;
      // These fragments should only be in write requests
      expect(userMsg).not.toContain("sum shown");
      expect(userMsg).not.toContain("no current price was found");
    }
  });

  it("AC3: non-plan requests do not contain PLAN_PRICES_RULE", async () => {
    const day = new Date(2026, 9, 3, 12);
    const requests = await runOn(day, "How much does it cost to run a heat pump in the UK?", true, true);

    const nonPlanRequests = requests.filter((r) => stepOf(r) !== "plan");

    for (const request of nonPlanRequests) {
      const userMsg = request.messages.find((m: any) => m.role === "user").content as string;
      // PLAN_PRICES_RULE should only be in plan requests
      expect(userMsg).not.toContain("If the question asks about costs, prices, bills or running costs");
    }
  });

  it("AC4: ordinary web reply (no deep_research) does not contain FR46 rules", async () => {
    const day = new Date(2026, 9, 3, 12);
    const requests = await runOn(day, "How much does it cost?", true, false);

    // Should make exactly one model request
    expect(requests.length).toBe(1);
    const request = requests[0]!;

    // Messages should be [{role:"system", content:"SYSTEM NOTE"}, {role:"user", content:"How much does it cost?"}]
    expect(request.messages.length).toBe(2);
    expect(request.messages[0]).toEqual({ role: "system", content: "SYSTEM NOTE" });
    expect(request.messages[1]).toEqual({ role: "user", content: "How much does it cost?" });

    // No message should contain any of the four FR46 rule constants
    for (const message of request.messages) {
      expect(message.content).not.toContain(PLAN_PRICES_RULE);
      expect(message.content).not.toContain(WRITE_DATE_RULE);
      expect(message.content).not.toContain(WRITE_SUM_RULE);
      expect(message.content).not.toContain(WRITE_NO_PRICE_RULE);
    }
  });

  it("AC4: switch-off reply (no web, no deep_research) does not contain FR46 rules", async () => {
    const day = new Date(2026, 9, 3, 12);
    const requests = await runOn(day, "How much does it cost?", false, false);

    // Should make exactly one model request
    expect(requests.length).toBe(1);
    const request = requests[0]!;

    // Messages should be [{role:"user", content:"How much does it cost?"}]
    expect(request.messages).toEqual([{ role: "user", content: "How much does it cost?" }]);

    // No message should contain any of the four FR46 rule constants
    for (const message of request.messages) {
      expect(message.content).not.toContain(PLAN_PRICES_RULE);
      expect(message.content).not.toContain(WRITE_DATE_RULE);
      expect(message.content).not.toContain(WRITE_SUM_RULE);
      expect(message.content).not.toContain(WRITE_NO_PRICE_RULE);
    }
  });

  it("M19j-T7: write request for cost questions contains strengthened WRITE_SUM_RULE with running-cost money figure requirement", async () => {
    const day = new Date(2026, 10, 3, 12);
    const requests = await runOn(day, "How much does it cost to run a heat pump in the UK?", true, true);

    const writeRequests = requests.filter((r) => stepOf(r) === "write");
    expect(writeRequests.length).toBeGreaterThanOrEqual(1);

    const writeRequest = writeRequests[0];
    const userMsg = writeRequest.messages.find((m: any) => m.role === "user").content as string;

    // Should contain the new required fragments from strengthened WRITE_SUM_RULE
    expect(userMsg).toContain("must give at least one running-cost money figure");
    expect(userMsg).toContain("for each option the question compares");
    expect(userMsg).toContain("use a typical quantity a note gives");
    expect(userMsg).toContain("Never give a unit price alone");

    // Should still contain existing rule fragments
    expect(userMsg).toContain("sum shown");
    expect(userMsg).toContain(WRITE_NO_PRICE_RULE);
    expect(userMsg).toContain(WRITE_DATE_RULE);

    // No non-write request should contain "running-cost money figure"
    const nonWriteRequests = requests.filter((r) => stepOf(r) !== "write");
    for (const request of nonWriteRequests) {
      const msg = request.messages.find((m: any) => m.role === "user").content as string;
      expect(msg).not.toContain("running-cost money figure");
    }
  });
});
