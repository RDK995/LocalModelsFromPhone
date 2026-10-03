import { describe, it, expect } from "bun:test";
import { createServer, setValidToken, type OllamaStateClient } from "./server";
import type { OllamaChatResponse } from "../ollama/client";
import { GenerationManager, type GenerationWebTools } from "../generations/manager";
import type { ResearchWebTools } from "../generations/research";
import { todayLine, type WebEvent } from "../web/tools";

/** M19i FR46(a): every deep research model request carries today's date in its USER message. */
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
  if (keys.includes("brief")) return { brief: "About cats" };
  if (keys.includes("sub_questions")) return { sub_questions: ["sq one", "sq two"] };
  if (keys.includes("queries")) return { queries: ["alpha", "beta", "gamma"] };
  if (keys.includes("pages")) return { pages: [1, 2] };
  if (keys.includes("notes")) {
    const m = userText.match(/Fact for (\S+?)\./);
    return { notes: m ? [{ quote: `Fact for ${m[1]}`, claim: `claim ${m[1]}` }] : [] };
  }
  if (keys.includes("enough")) return { enough: true };
  if (keys.includes("report")) return { report: "Cats sleep a lot [1] and purr [2]." };
  throw new Error("unknown step");
}

async function runOn(day: Date): Promise<any[]> {
  const requests: any[] = [];
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
  // Quota 3 with two pages chosen keeps the gap step in the run; no skip rules (tiny fixture pages).
  const manager = new GenerationManager(
    client, web, { noteMinWords: 0, noteMinRelevance: -1, pagesPerSubQuestion: 3 }, () => {}, () => day
  );
  const server = createServer({ ollama: client, manager, port: 0, researchModel: "fake-model" });
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/v1/chat`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ model: "fake-model", messages: [{ role: "user", content: "cats?" }], web: true, deep_research: true }),
    });
    expect(res.status).toBe(200);
    await res.text();
  } finally {
    server.stop(true);
  }
  return requests;
}

describe("deep research requests carry today's date (M19i FR46a, AC34)", () => {
  it("puts the date in every user message, never the system message, and keeps the system message byte-stable across steps and days", async () => {
    const day1 = new Date(2026, 9, 3, 12);
    const day2 = new Date(2026, 11, 25, 12);
    const one = await runOn(day1);
    const two = await runOn(day2);

    expect(todayLine(day1)).toBe("Today's date is Saturday, October 3, 2026 (2026-10-03).");
    expect(todayLine(day2)).toBe("Today's date is Friday, December 25, 2026 (2026-12-25).");

    for (const [requests, day, literal, iso] of [
      [one, day1, "Today's date is Saturday, October 3, 2026 (2026-10-03).", "2026-10-03"],
      [two, day2, "Today's date is Friday, December 25, 2026 (2026-12-25).", "2026-12-25"],
    ] as const) {
      expect([...new Set(requests.map(stepOf))].sort()).toEqual(["brief", "gap", "notes", "pages", "plan", "queries", "write"]);
      for (const r of requests) {
        const system = r.messages.find((m: any) => m.role === "system").content as string;
        const user = r.messages.find((m: any) => m.role === "user").content as string;
        expect(user).toContain(todayLine(day));
        expect(user).toContain(literal);
        // FR43: step content first, then the date line, then the task last.
        expect(user).toContain(`${literal}\n\nTask: `);
        expect(user.indexOf(literal)).toBeGreaterThan(0);
        expect(user.lastIndexOf("\n\nTask: ")).toBeGreaterThan(user.indexOf(literal));
        expect(user.startsWith(literal)).toBe(false);
        expect(system).not.toContain("Today's date");
        expect(system).not.toContain(iso);
      }
      const systems = new Set(requests.map((r) => r.messages.find((m: any) => m.role === "system").content));
      expect(systems.size).toBe(1);
    }
    expect(one[0].messages.find((m: any) => m.role === "system").content).toBe(
      two[0].messages.find((m: any) => m.role === "system").content
    );
  });
});
