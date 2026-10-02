import { describe, it, expect } from "bun:test";
import { createServer, setValidToken, DEFAULT_KEEP_ALIVE_MS, type OllamaStateClient } from "./server";
import type { OllamaChatResponse } from "../ollama/client";
import { GenerationManager, type GenerationWebTools } from "../generations/manager";
import type { ResearchWebTools } from "../generations/research";
import type { WebEvent } from "../web/tools";

// M19e-AC2 / FR45: an open reply stream carries an SSE comment keep-alive at
// least every keepAliveMs, whatever kind of reply it is.

const NO_SKIP = { noteMinWords: 0, noteMinRelevance: -1 };
const TOKEN = "test-token";
const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` });
const KA = 61; // a distinctive interval so the test can find the server's timer
const TOLERANCE = 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

/** Comment blocks (blocks made only of ": ..." lines) other than the initial connected one. */
const keepAlives = (text: string) =>
  text
    .split("\n\n")
    .filter((b) => b.trim().length > 0 && b.split("\n").every((l) => l.startsWith(":")) && !b.includes("connected"));

function replyFor(format: any, userText: string): unknown {
  const keys = Object.keys(format?.properties ?? {});
  if (keys.includes("brief")) return { brief: "About cats" };
  if (keys.includes("sub_questions")) return { sub_questions: ["sq one"] };
  if (keys.includes("queries")) return { queries: ["alpha"] };
  if (keys.includes("pages")) return { pages: [1] };
  if (keys.includes("notes")) {
    const m = userText.match(/Fact for (\S+?)\./);
    return { notes: m ? [{ quote: `Fact for ${m[1]}`, claim: `claim ${m[1]}` }] : [] };
  }
  if (keys.includes("enough")) return { enough: true };
  if (keys.includes("report")) return { report: "Cats sleep a lot [1]." };
  throw new Error("unknown step");
}

type Mode = "research" | "web" | "off";

function setup() {
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  let holdDone = false;
  let mode: Mode = "research";
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
      if (mode === "research") {
        const userText = request.messages.map((m: any) => m.content).join("\n");
        const content = JSON.stringify(replyFor(request.format, userText));
        return (async function* () {
          yield chunk(content, false);
          yield chunk("", true);
        })();
      }
      // Ordinary reply: a first token, then held open, then the rest.
      return (async function* () {
        yield chunk("one ", false);
        await released;
        yield chunk("two", false);
        yield chunk("", true);
      })();
    }) as never,
  };
  let id = 0;
  const research: ResearchWebTools = {
    async search(query) {
      const results = [1, 2].map((i) => ({ title: `T ${query} ${i}`, url: `https://${query}.example/${i}`, snippet: "s" }));
      const step_id = `s${++id}`;
      const events: WebEvent[] = [
        { type: "step", data: { step_id, kind: "search", status: "started", query } },
        { type: "step", data: { step_id, kind: "search", status: "done", query } },
      ];
      return { results, events };
    },
    async read(url, _signal, numberPage) {
      if (!holdDone) {
        holdDone = true;
        await released;
      }
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
  const manager = new GenerationManager(client, web, { ...NO_SKIP, stopWriteMs: 5000 });
  const server = createServer({ ollama: client, manager, port: 0, researchModel: "fake-model", keepAliveMs: KA });
  const base = `http://127.0.0.1:${server.port}`;
  const open = (m: Mode) => {
    mode = m;
    const body =
      m === "research"
        ? { model: "fake-model", messages: [{ role: "user", content: "cats?" }], web: true, deep_research: true }
        : { model: "fake-model", messages: [{ role: "user", content: "cats?" }], web: m === "web" };
    return fetch(`${base}/v1/chat`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  };
  const events = (genId: string, extra: Record<string, string> = {}) =>
    fetch(`${base}/v1/generations/${genId}/events`, { headers: { ...headers(), ...extra } });
  return { server, manager, open, events, release };
}

/** Read the reply, releasing the held call after holdMs; return the text and the chunk arrival times. */
async function readTimed(res: Response, release: () => void, holdMs: number) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const times: number[] = [];
  let text = "";
  const t0 = Date.now();
  times.push(t0);
  const timer = setTimeout(release, holdMs);
  try {
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      times.push(Date.now());
      text += decoder.decode(r.value);
    }
  } finally {
    clearTimeout(timer);
  }
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  return { text, maxGap: Math.max(...gaps) };
}

async function expectKeepAlives(mode: Mode) {
  const s = setup();
  try {
    const res = await s.open(mode);
    expect(res.status).toBe(200);
    const { text, maxGap } = await readTimed(res, s.release, KA * 8);
    expect(keepAlives(text).length).toBeGreaterThanOrEqual(4);
    expect(maxGap).toBeLessThanOrEqual(KA + TOLERANCE);
    expect(parseSSE(text).some((e) => e.event === "done")).toBe(true);
  } finally {
    s.server.stop(true);
  }
}

describe("Open reply streams carry a keep-alive comment (M19e-AC2, FR45)", () => {
  it("default keep-alive interval is at most 15 s", () => {
    expect(DEFAULT_KEEP_ALIVE_MS).toBeLessThanOrEqual(15000);
    expect(DEFAULT_KEEP_ALIVE_MS).toBeGreaterThan(0);
  });

  it("KA1: a deep research stream gets keep-alives while a call is held", async () => {
    await expectKeepAlives("research");
  });

  it("KA2: an ordinary web stream gets keep-alives while a call is held", async () => {
    await expectKeepAlives("web");
  });

  it("KA3: a switch-off stream gets keep-alives while a call is held", async () => {
    await expectKeepAlives("off");
  });

  it("KA4: resume across keep-alives has every seq exactly once and keep-alives carry no id", async () => {
    const s = setup();
    try {
      const res = await s.open("off");
      const genId = res.headers.get("x-generation-id")!;
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let first = "";
      // Read until at least one event and two keep-alives have arrived, then drop.
      for (;;) {
        const r = await reader.read();
        if (r.done) throw new Error("ended early");
        first += decoder.decode(r.value);
        const complete = first.slice(0, first.lastIndexOf("\n\n") + 2);
        if (parseSSE(complete).length >= 1 && keepAlives(complete).length >= 2) {
          first = complete;
          break;
        }
      }
      await reader.cancel();
      const firstEvents = parseSSE(first);
      const lastId = firstEvents[firstEvents.length - 1].id;
      const lastSeq = Number(lastId.slice(lastId.lastIndexOf("-") + 1));

      const resumedRes = await s.events(genId, { "Last-Event-ID": lastId });
      const { text } = await readTimed(resumedRes, s.release, KA * 4);
      const resumed = parseSSE(text);
      expect(keepAlives(text).length).toBeGreaterThanOrEqual(1);

      const all = [...firstEvents, ...resumed];
      const seqs = all.map((e) => Number(e.id.slice(e.id.lastIndexOf("-") + 1)));
      expect(seqs[0]).toBe(seqs[0]); // sanity: parsed
      expect(new Set(seqs).size).toBe(seqs.length);
      const lo = Math.min(...seqs);
      expect(seqs).toEqual(seqs.map((_, i) => lo + i));
      expect(resumed[0].id.endsWith(`-${lastSeq + 1}`)).toBe(true);
      expect(all[all.length - 1].event).toBe("done");

      for (const block of [...keepAlives(first), ...keepAlives(text)]) {
        expect(block).not.toMatch(/(^|\n)(id|event|data):/);
      }
    } finally {
      s.server.stop(true);
    }
  });

  it("KA5: the timer is cleared when the stream closes and when the client cancels", async () => {
    const realSet = globalThis.setInterval;
    const realClear = globalThis.clearInterval;
    const live = new Set<unknown>();
    (globalThis as any).setInterval = (fn: any, ms?: number, ...rest: any[]) => {
      const h = (realSet as any)(fn, ms, ...rest);
      if (ms === KA) live.add(h);
      return h;
    };
    (globalThis as any).clearInterval = (h: any) => {
      live.delete(h);
      return (realClear as any)(h);
    };
    const s = setup();
    try {
      // Cancel path
      const res = await s.open("off");
      const genId = res.headers.get("x-generation-id")!;
      const reader = res.body!.getReader();
      await reader.read();
      await sleep(KA * 3);
      expect(live.size).toBeGreaterThanOrEqual(1);
      await reader.cancel();
      await sleep(KA * 3);
      expect(live.size).toBe(0);

      // Close path: finish the generation, the stream ends, no timer left.
      s.release();
      await sleep(KA * 3);
      const r2 = await s.events(genId);
      const tail = await r2.text();
      expect(tail).toContain("event: done");
      const n = keepAlives(tail).length;
      await sleep(KA * 3);
      expect(keepAlives(tail).length).toBe(n);
      await sleep(KA * 3);
      expect(live.size).toBe(0);
    } finally {
      globalThis.setInterval = realSet;
      globalThis.clearInterval = realClear;
      s.server.stop(true);
    }
  });
});
