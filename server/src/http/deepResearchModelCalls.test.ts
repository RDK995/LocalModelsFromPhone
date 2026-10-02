import { describe, it, expect, spyOn } from "bun:test";
import { createServer, setValidToken, type OllamaStateClient } from "./server";
import type { OllamaChatResponse } from "../ollama/client";
import { GenerationManager, type GenerationWebTools } from "../generations/manager";
import { DEFAULT_RESEARCH_SETTINGS, type ModelCallLog, type ResearchSettings, type ResearchWebTools } from "../generations/research";
import type { WebEvent } from "../web/tools";

/** FR43 skip rules off: tiny fixture pages; these tests are not about passage selection. */
const NO_SKIP = { noteMinWords: 0, noteMinRelevance: -1 };

const TOKEN = "test-token";
const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` });

function chunk(content: string, done: boolean, thinking?: string): OllamaChatResponse {
  return {
    model: "fake-model",
    created_at: "",
    message: { role: "assistant", content, ...(thinking ? { thinking } : {}) },
    done,
    total_duration: 0,
    load_duration: done ? 11 : 0,
    prompt_eval_count: done ? 22 : 0,
    prompt_eval_duration: done ? 33 : 0,
    eval_count: done ? 44 : 0,
    eval_duration: done ? 55 : 0,
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
  const loads: Array<{ name: string; options?: { num_ctx?: number } }> = [];
  const logs: ModelCallLog[] = [];
  let resident = ["fake-model"];
  const client: OllamaStateClient = {
    tags: async () => ({
      models: [
        { name: "fake-model", modified_at: "", size: 1, digest: "d" },
        { name: "other-model", modified_at: "", size: 1, digest: "d" },
      ],
    }),
    ps: async () =>
      ({
        models: resident.map((name) => ({
          name, model: name, size: 1, digest: "d", details: { family: "", parameter_size: "", quantization_level: "" }, expires_at: "", size_vram: 0,
        })),
      }) as any,
    show: async () => ({ capabilities: ["completion", "tools"] }),
    load: async (name: string, options?: { num_ctx?: number }) => {
      loads.push({ name, options });
      if (!resident.includes(name)) resident.push(name);
    },
    unload: async (name: string) => {
      resident = resident.filter((n) => n !== name);
    },
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
  const server = createServer({ ollama: client, manager: new GenerationManager(client, web, { ...NO_SKIP, ...opts.research }, (line) => logs.push(line)), port: 0, researchModel: "fake-model" });
  const base = `http://127.0.0.1:${server.port}`;
  const post = (body: unknown) => fetch(`${base}/v1/chat`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  return { requests, reads, loads, logs, server, base, post };
}

const deepBody = { model: "fake-model", messages: [{ role: "user", content: "cats?" }], web: true, deep_research: true };
const STEP_FOR_KEY: Record<string, string> = {
  brief: "brief",
  sub_questions: "plan",
  queries: "queries",
  pages: "pages",
  notes: "notes",
  enough: "gap",
  report: "write",
};
const stepOf = (request: any): string => STEP_FOR_KEY[Object.keys(request.format.properties)[0]!]!;

describe("deep research model-call logging and load num_ctx (M19b FR41)", () => {
  it("writes exactly one log line per model request, with every field", async () => {
    const s = setup({
      chat: (request) => {
        // Thinking text on one chunk of the first request only.
        if (s.requests.length !== 1) return undefined;
        const content = JSON.stringify(replyFor(request.format, ""));
        return (async function* () {
          yield chunk("", false, "hello");
          yield chunk(content, false);
          yield chunk("", true);
        })();
      },
    });
    try {
      const chat = await s.post(deepBody);
      expect(chat.status).toBe(200);
      await chat.text();
      expect(s.requests.length).toBeGreaterThan(5);
      expect(s.logs.length).toBe(s.requests.length);
      expect(s.logs.map((l) => l.step as string)).toEqual(s.requests.map(stepOf));
      expect(s.logs[0]!.step).toBe("brief");
      expect(s.logs[s.logs.length - 1]!.step).toBe("write");
      for (const [i, line] of s.logs.entries()) {
        expect(line.think).toBe(s.requests[i].think);
        expect(line.attempt).toBe(1);
        expect(line.outcome).toBe("ok");
        expect(typeof line.wall_ms).toBe("number");
        expect(line.load_duration).toBe(11);
        expect(line.prompt_eval_count).toBe(22);
        expect(line.prompt_eval_duration).toBe(33);
        expect(line.eval_count).toBe(44);
        expect(line.eval_duration).toBe(55);
        expect(line.thinking_chars).toBe(i === 0 ? 5 : 0);
      }
    } finally {
      s.server.stop(true);
    }
  });

  it("logs an invalid first reply as attempt 1 'invalid' and the retry as attempt 2 'ok'", async () => {
    const s = setup({
      chat: () => {
        if (s.requests.length !== 1) return undefined;
        return (async function* () {
          yield chunk("not json {", false);
          yield chunk("", true);
        })();
      },
    });
    try {
      await (await s.post(deepBody)).text();
      expect(s.logs.length).toBe(s.requests.length);
      expect(s.logs[0]).toMatchObject({ step: "brief", attempt: 1, outcome: "invalid" });
      expect(s.logs[1]).toMatchObject({ step: "brief", attempt: 2, outcome: "ok" });
    } finally {
      s.server.stop(true);
    }
  });

  it("logs a stream error as 'error' with null stats and no done chunk", async () => {
    const s = setup({
      chat: () => {
        if (s.requests.length !== 1) return undefined;
        return (async function* () {
          yield chunk("", false, "abc");
          throw new Error("boom");
        })();
      },
    });
    try {
      await (await s.post(deepBody)).text();
      expect(s.logs[0]).toMatchObject({ step: "brief", attempt: 1, outcome: "error", eval_count: null, load_duration: null, thinking_chars: 3 });
      expect(s.logs[1]).toMatchObject({ step: "brief", attempt: 2, outcome: "ok" });
    } finally {
      s.server.stop(true);
    }
  });

  it("thinking-off steps send think:false, the num_predict cap and non-thinking sampling; plan and write think with only num_ctx", async () => {
    // M19d FR44: a used page quota ends a sub-question without a gap check; quota 3 keeps every step in the run.
    const s = setup({ research: { numCtx: 7777, pagesPerSubQuestion: 3 } });
    try {
      await (await s.post(deepBody)).text();
      const seen = new Set<string>();
      for (const r of s.requests) {
        const step = stepOf(r);
        seen.add(step);
        expect(typeof r.format).toBe("object");
        expect(r.options.num_ctx).toBe(7777);
        expect(r.keep_alive).toBe(-1);
        if (step === "plan" || step === "write") {
          expect(r.think).toBe(true);
          expect("num_predict" in r.options).toBe(false);
          expect(Object.keys(r.options)).toEqual(["num_ctx"]);
        } else {
          expect(r.think).toBe(false);
          expect(r.options.num_predict).toBe(step === "notes" ? 800 : 200);
          expect(r.options.temperature).toBe(0.7);
          expect(r.options.top_p).toBe(0.8);
          expect(r.options.top_k).toBe(20);
        }
      }
      expect([...seen].sort()).toEqual(["brief", "gap", "notes", "pages", "plan", "queries", "write"]);
    } finally {
      s.server.stop(true);
    }
  });

  it("routineNumPredict and notesNumPredict are settings", async () => {
    const s = setup({ research: { routineNumPredict: 123, notesNumPredict: 456 } });
    try {
      await (await s.post(deepBody)).text();
      for (const r of s.requests) {
        const step = stepOf(r);
        if (step === "plan" || step === "write") expect("num_predict" in r.options).toBe(false);
        else expect(r.options.num_predict).toBe(step === "notes" ? 456 : 123);
      }
    } finally {
      s.server.stop(true);
    }
  });

  it("a thinking-off reply that also carries thinking text is detected, logged and still used when its content is valid", async () => {
    const s = setup({
      chat: (request) => {
        if (s.requests.length !== 1) return undefined;
        const content = JSON.stringify(replyFor(request.format, ""));
        return (async function* () {
          yield chunk("", false, "let me think");
          yield chunk(content, false);
          yield chunk("", true);
        })();
      },
    });
    try {
      await (await s.post(deepBody)).text();
      expect(s.logs.length).toBe(s.requests.length);
      expect(s.logs[0]).toMatchObject({ step: "brief", think: false, attempt: 1, outcome: "ok", thinking_detected: true });
      expect(s.logs[0]!.thinking_chars).toBeGreaterThan(0);
      expect(s.logs[1]!.step).toBe("plan");
      for (const l of s.logs.slice(1)) expect(l.thinking_detected).toBe(false);
    } finally {
      s.server.stop(true);
    }
  });

  it("a thinking-off reply with the JSON only in thinking is not used: invalid, thinking detected, step retried", async () => {
    const s = setup({
      chat: (request) => {
        if (s.requests.length !== 1) return undefined;
        const json = JSON.stringify(replyFor(request.format, ""));
        return (async function* () {
          yield chunk("", false, json);
          yield chunk("", true);
        })();
      },
    });
    try {
      await (await s.post(deepBody)).text();
      expect(s.logs[0]).toMatchObject({ step: "brief", attempt: 1, outcome: "invalid", thinking_detected: true });
      expect(s.logs[0]!.thinking_chars).toBeGreaterThan(0);
      expect(s.logs[1]).toMatchObject({ step: "brief", attempt: 2, outcome: "ok", thinking_detected: false });
    } finally {
      s.server.stop(true);
    }
  });

  async function loadModel(s: ReturnType<typeof setup>, name: string) {
    const res = await fetch(`${s.base}/v1/models/load`, { method: "POST", headers: headers(), body: JSON.stringify({ name, confirm: true }) });
    expect(res.status).toBeLessThan(300);
    for (let i = 0; i < 100 && !s.loads.some((l) => l.name === name); i++) await Bun.sleep(20);
  }

  it("loading the deep-research model sends the research num_ctx; another model sends no options", async () => {
    const s = setup({ research: { numCtx: 12345 } });
    try {
      await loadModel(s, "fake-model");
      expect(s.loads).toEqual([{ name: "fake-model", options: { num_ctx: 12345 } }]);
      // Wait for the first load to finish before the second claims the manager.
      for (let i = 0; i < 100; i++) {
        const state = (await (await fetch(`${s.base}/v1/state`, { headers: headers() })).json()) as any;
        if (state.operation?.kind === "idle") break;
        await Bun.sleep(20);
      }
      await loadModel(s, "other-model");
      expect(s.loads[1]).toEqual({ name: "other-model", options: undefined });
      expect(s.requests.length).toBe(0);
    } finally {
      s.server.stop(true);
    }
  });

  it("ordinary web and switch-off replies send no new request fields and write no research log line", async () => {
    const consoleLog = spyOn(console, "log");
    const s = setup();
    try {
      for (const extra of [{ web: true, deep_research: false }, { web: false }]) {
        const before = s.requests.length;
        const chat = await s.post({ model: "fake-model", messages: [{ role: "user", content: "hi" }], ...extra });
        expect(chat.status).toBe(200);
        await chat.text();
        expect(s.requests.length).toBeGreaterThan(before);
        for (const r of s.requests.slice(before)) {
          expect(r.num_predict).toBeUndefined();
          expect(r.options).toBeUndefined();
          expect(r.think).toBeUndefined();
          expect(r.format).toBeUndefined();
          expect(Object.keys(r).filter((k) => !["model", "messages", "tools"].includes(k))).toEqual([]);
        }
      }
      expect(s.logs.length).toBe(0);
      expect(consoleLog.mock.calls.some((c) => String(c[0]).includes("deep_research_model_call"))).toBe(false);
    } finally {
      consoleLog.mockRestore();
      s.server.stop(true);
    }
  });
});

/** A stream that sends nothing (or one thinking chunk) and then waits until its signal aborts. */
function hangUntilAbort(signal: AbortSignal | undefined, thinking: boolean, record: (abortedAt: number) => void) {
  return (async function* (): AsyncGenerator<OllamaChatResponse> {
    if (thinking) yield chunk("", false, "still thinking");
    await new Promise<never>((_, reject) => {
      const fail = () => {
        record(Date.now());
        reject(signal!.reason ?? new DOMException("aborted", "AbortError"));
      };
      if (signal?.aborted) fail();
      else signal?.addEventListener("abort", fail, { once: true });
    });
  })();
}

async function runToDone(s: ReturnType<typeof setup>) {
  const chat = await s.post(deepBody);
  expect(chat.status).toBe(200);
  const events = parseSSE(await chat.text());
  const last = events[events.length - 1]!;
  expect(last.event).toBe("done");
  const done = JSON.parse(last.data);
  const content = events.filter((e) => e.event === "content").map((e) => JSON.parse(e.data).text as string);
  return { events, done, content };
}

describe("deep research call time limits (M19b FR42)", () => {
  it("the default write guard fits inside the default FR36 write reserve", () => {
    const d = DEFAULT_RESEARCH_SETTINGS;
    expect(d.routineCapMs).toBe(30_000);
    expect(d.planGuardMs).toBe(30_000);
    expect(d.writeGuardMs).toBe(60_000);
    expect(d.writeGuardMs).toBeLessThan(d.budgetMs * d.writeReserveFraction);
  });

  it("AC3: a thinking-off call past its cap is aborted, logged 'timeout', retried and the run completes", async () => {
    const sent: number[] = [];
    const aborted: number[] = [];
    const s = setup({
      research: { routineCapMs: 100 },
      chat: (request, signal) => {
        if (stepOf(request) !== "queries") return undefined;
        sent.push(Date.now());
        if (sent.length !== 1) return undefined;
        return hangUntilAbort(signal, false, (t) => aborted.push(t));
      },
    });
    try {
      const { done, content } = await runToDone(s);
      expect(aborted.length).toBe(1);
      expect(aborted[0]! - sent[0]!).toBeGreaterThanOrEqual(90);
      expect(aborted[0]! - sent[0]!).toBeLessThan(2000);
      const q = s.logs.filter((l) => l.step === "queries");
      expect(q[0]).toMatchObject({ think: false, attempt: 1, outcome: "timeout" });
      expect(q[1]).toMatchObject({ think: false, attempt: 2, outcome: "ok" });
      expect(s.logs.length).toBe(s.requests.length);
      expect(done.status).toBe("complete");
      expect(done.research.status).toBe("complete");
      expect(content.length).toBe(1);
      expect(content[0]).toContain("Cats sleep a lot [1]");
    } finally {
      s.server.stop(true);
    }
  });

  it("AC3: a thinking-off step that hits its cap on every attempt is skipped after retries + 1 and the run carries on", async () => {
    let abortedCount = 0;
    const s = setup({
      // M19d FR44: quota 3 (two pages chosen) so each sub-question still reaches its gap step.
      research: { routineCapMs: 60, pagesPerSubQuestion: 3 },
      chat: (request, signal) =>
        stepOf(request) === "gap" ? hangUntilAbort(signal, false, () => abortedCount++) : undefined,
    });
    try {
      const { done, content } = await runToDone(s);
      const gapLogs = s.logs.filter((l) => l.step === "gap");
      // Two sub-questions, each with one gap step skipped after 3 timed-out attempts.
      expect(gapLogs.map((l) => l.attempt)).toEqual([1, 2, 3, 1, 2, 3]);
      for (const l of gapLogs) expect(l.outcome).toBe("timeout");
      expect(abortedCount).toBe(6);
      expect(done.status).toBe("complete");
      expect(done.research.status).toBe("complete");
      expect(content[0]).toContain("Cats sleep a lot [1]");
      expect(s.requests.filter((r) => stepOf(r) === "write").length).toBe(1);
    } finally {
      s.server.stop(true);
    }
  });

  it("AC4: plan thinking past its guard is aborted and re-issued once with think:false and no num_predict; its reply is used", async () => {
    const aborted: number[] = [];
    let plans = 0;
    const s = setup({
      research: { planGuardMs: 100 },
      chat: (request, signal) => {
        if (stepOf(request) !== "plan") return undefined;
        plans++;
        if (plans !== 1) return undefined;
        return hangUntilAbort(signal, true, (t) => aborted.push(t));
      },
    });
    try {
      const { done } = await runToDone(s);
      expect(aborted.length).toBe(1);
      const planRequests = s.requests.filter((r) => stepOf(r) === "plan");
      expect(planRequests.length).toBe(2);
      expect(planRequests[0].think).toBe(true);
      expect(planRequests[1].think).toBe(false);
      expect("num_predict" in planRequests[1].options).toBe(false);
      expect(planRequests[1].options.num_ctx).toBe(DEFAULT_RESEARCH_SETTINGS.numCtx);
      const planLogs = s.logs.filter((l) => l.step === "plan");
      expect(planLogs).toEqual([
        expect.objectContaining({ think: true, attempt: 1, outcome: "guard" }),
        expect.objectContaining({ think: false, attempt: 2, outcome: "ok" }),
      ]);
      const queryTexts = s.requests.filter((r) => stepOf(r) === "queries").map((r) => r.messages[1].content as string);
      expect(queryTexts.some((t) => t.includes("Current sub-question (1 of 2): sq one"))).toBe(true);
      expect(queryTexts.some((t) => t.includes("Current sub-question (2 of 2): sq two"))).toBe(true);
      expect(done.research.status).toBe("complete");
    } finally {
      s.server.stop(true);
    }
  });

  it("AC4: write thinking past its guard is re-issued with think:false and its valid report is the answer", async () => {
    let writes = 0;
    let aborted = 0;
    const s = setup({
      research: { writeGuardMs: 100 },
      chat: (request, signal) => {
        if (stepOf(request) !== "write") return undefined;
        writes++;
        return writes === 1 ? hangUntilAbort(signal, true, () => aborted++) : undefined;
      },
    });
    try {
      const { done, content } = await runToDone(s);
      expect(aborted).toBe(1);
      const writeRequests = s.requests.filter((r) => stepOf(r) === "write");
      expect(writeRequests.map((r) => r.think)).toEqual([true, false]);
      expect("num_predict" in writeRequests[1].options).toBe(false);
      expect(s.logs.filter((l) => l.step === "write").map((l) => [l.think, l.attempt, l.outcome])).toEqual([
        [true, 1, "guard"],
        [false, 2, "ok"],
      ]);
      expect(content).toEqual(["Cats sleep a lot [1] and purr [2]. Also see and for more."]);
      expect(done.research.status).toBe("complete");
    } finally {
      s.server.stop(true);
    }
  });

  it("AC4: write guard fires and the re-issue is invalid: exactly two write requests, run ends partial with the gathered notes", async () => {
    let writes = 0;
    const s = setup({
      research: { writeGuardMs: 100 },
      chat: (request, signal) => {
        if (stepOf(request) !== "write") return undefined;
        writes++;
        if (writes === 1) return hangUntilAbort(signal, true, () => {});
        return (async function* () {
          yield chunk("not json {", false);
          yield chunk("", true);
        })();
      },
    });
    try {
      const { done, content } = await runToDone(s);
      expect(s.requests.filter((r) => stepOf(r) === "write").length).toBe(2);
      expect(s.logs.filter((l) => l.step === "write").map((l) => [l.think, l.attempt, l.outcome])).toEqual([
        [true, 1, "guard"],
        [false, 2, "invalid"],
      ]);
      expect(done.status).toBe("complete");
      expect(done.research.status).toBe("partial");
      expect(content.length).toBe(1);
      expect(content[0]!.startsWith("The report could not be written. Notes gathered:")).toBe(true);
    } finally {
      s.server.stop(true);
    }
  });

  it("AC4: an answer that starts before the write guard and finishes after it is never cut off", async () => {
    let writeSignal: AbortSignal | undefined;
    const s = setup({
      research: { writeGuardMs: 100 },
      chat: (request, signal) => {
        if (stepOf(request) !== "write") return undefined;
        writeSignal = signal;
        const full = JSON.stringify({ report: REPORT });
        const parts = [full.slice(0, 10), full.slice(10, 30), full.slice(30)];
        return (async function* () {
          yield chunk("", false, "brief thought");
          yield chunk(parts[0]!, false);
          for (const part of parts.slice(1)) {
            await Bun.sleep(80);
            if (signal?.aborted) throw signal.reason;
            yield chunk(part, false);
          }
          yield chunk("", true);
        })();
      },
    });
    try {
      const { done, content } = await runToDone(s);
      expect(writeSignal?.aborted).toBe(false);
      expect(s.requests.filter((r) => stepOf(r) === "write").length).toBe(1);
      const w = s.logs.filter((l) => l.step === "write");
      expect(w.length).toBe(1);
      expect(w[0]).toMatchObject({ think: true, attempt: 1, outcome: "ok" });
      expect(w[0]!.wall_ms).toBeGreaterThanOrEqual(150);
      expect(content).toEqual(["Cats sleep a lot [1] and purr [2]. Also see and for more."]);
      expect(done.research.status).toBe("complete");
    } finally {
      s.server.stop(true);
    }
  });
});
