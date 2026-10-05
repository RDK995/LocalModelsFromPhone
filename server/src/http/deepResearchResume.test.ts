import { describe, it, expect } from "bun:test";
import { createServer, setValidToken, type OllamaStateClient } from "./server";
import type { OllamaChatResponse } from "../ollama/client";
import { GenerationManager, type GenerationWebTools } from "../generations/manager";
import type { ResearchWebTools } from "../generations/research";
import type { WebEvent } from "../web/tools";

// M19-AC2: a deep research run survives a dropped connection, refuses a new
// message, and a confirmed unload ends it without hanging.

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

function setup() {
  const calls: string[] = [];
  let entered!: () => void;
  const held = new Promise<void>((r) => (entered = r));
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  let holdDone = false;
  let resident = true;
  const client: OllamaStateClient = {
    tags: async () => ({ models: [{ name: "fake-model", modified_at: "", size: 1, digest: "d" }] }),
    ps: async () =>
      ({
        models: resident ? [
          { name: "fake-model", model: "fake-model", size: 1, digest: "d", details: { family: "", parameter_size: "", quantization_level: "" }, expires_at: "", size_vram: 0 },
        ] : [],
      }) as any,
    show: async () => ({ capabilities: ["completion", "tools"] }),
    load: async (name) => void calls.push(`load:${name}`),
    unload: async (name) => {
      calls.push(`unload:${name}`);
      resident = false;
    },
    chat: ((request: any) => {
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
    async search(query, _signal) {
      const results = [1, 2, 3].map((i) => ({ title: `T ${query} ${i}`, url: `https://${query}.example/${i}`, snippet: "s" }));
      const step_id = `s${++id}`;
      const events: WebEvent[] = [
        { type: "step", data: { step_id, kind: "search", status: "started", query } },
        { type: "step", data: { step_id, kind: "search", status: "done", query } },
      ];
      return { results, events };
    },
    async read(url, signal, numberPage) {
      // The first read is held open until released, or until its signal aborts.
      if (!holdDone) {
        holdDone = true;
        entered();
        await Promise.race([released, untilAborted(signal)]);
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
  const server = createServer({ ollama: client, manager, port: 0, researchModel: "fake-model" });
  const base = `http://127.0.0.1:${server.port}`;
  const post = (path: string, body?: unknown) =>
    fetch(`${base}${path}`, { method: "POST", headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) });
  const start = async () => {
    const chat = await post("/v1/chat", { model: "fake-model", messages: [{ role: "user", content: "cats?" }], web: true, deep_research: true });
    expect(chat.status).toBe(200);
    return { genId: chat.headers.get("x-generation-id")!, body: chat.text() };
  };
  const events = (genId: string, extra: Record<string, string> = {}) =>
    fetch(`${base}/v1/generations/${genId}/events`, { headers: { ...headers(), ...extra } });
  return { server, manager, calls, base, start, events, post, held, release };
}

describe("Deep research dropped connection, reply in progress, and unload (M19-AC2)", () => {
  it("dropped connection: the run keeps going and a Last-Event-ID reconnect resumes with no gap or duplicate", async () => {
    const s = setup();
    try {
      const { genId } = await s.start();
      await s.held;

      // Read the live stream only until some steps are in, then drop it.
      const res = await s.events(genId);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let firstText = "";
      for (;;) {
        const r = await reader.read();
        if (r.done) throw new Error("stream ended before the run was held");
        firstText += decoder.decode(r.value);
        const complete = firstText.slice(0, firstText.lastIndexOf("\n\n") + 2);
        if (parseSSE(complete).filter((e) => e.event === "step").length >= 3) {
          firstText = complete;
          break;
        }
      }
      await reader.cancel();
      const first = parseSSE(firstText);
      const k = first[first.length - 1]!.id;

      // The drop does not stop the run.
      await new Promise((r) => setTimeout(r, 50));
      expect(s.manager.getActiveGeneration()?.id).toBe(genId);

      // Reconnect with Last-Event-ID, let the run finish, read to the end.
      const resumedRes = await s.events(genId, { "Last-Event-ID": k });
      expect(resumedRes.status).toBe(200);
      const resumedText = resumedRes.text();
      s.release();
      const resumed = parseSSE(await resumedText);

      const full = parseSSE(await (await s.events(genId)).text());
      const seqOf = (e: { id: string }) => Number(e.id.slice(genId.length + 1));
      const joined = [...first, ...resumed];
      // Deep equality covers identical ids, order, and every step's elapsed_ms / budget_ms.
      expect(joined).toEqual(full);
      expect(joined.map(seqOf)).toEqual(joined.map((_, i) => i));
      expect(new Set(joined.map((e) => e.id)).size).toBe(joined.length);
      expect(resumed.length).toBeGreaterThan(0);

      for (const e of joined.filter((e) => e.event === "step")) {
        const d = JSON.parse(e.data);
        expect(typeof d.elapsed_ms).toBe("number");
        expect(typeof d.budget_ms).toBe("number");
      }
      const contents = joined.filter((e) => e.event === "content");
      expect(contents.length).toBe(1);
      expect(JSON.parse(contents[0]!.data).text).toBe(REPORT);
      const last = joined[joined.length - 1]!;
      expect(last.event).toBe("done");
      expect(joined.filter((e) => e.event === "done").length).toBe(1);
      expect(JSON.parse(last.data).research.status).toBe("complete");
    } finally {
      s.release();
      s.server.stop(true);
    }
  });

  it("reply in progress: a new message during the run is refused with 409 generation_in_flight and starts nothing", async () => {
    const s = setup();
    try {
      const { genId, body } = await s.start();
      await s.held;

      const second = await s.post("/v1/chat", { model: "fake-model", messages: [{ role: "user", content: "dogs?" }] });
      expect(second.status).toBe(409);
      expect(((await second.json()) as { error: string }).error).toBe("generation_in_flight");
      expect(s.manager.getActiveGeneration()?.id).toBe(genId);

      s.release();
      await body;
      expect(s.manager.getActiveGeneration()).toBeNull();
    } finally {
      s.release();
      s.server.stop(true);
    }
  });

  it("unload mid-run: unconfirmed is refused and the run goes on; confirmed ends the run, unloads and frees the slot", async () => {
    const s = setup();
    try {
      const { genId, body } = await s.start();
      await s.held;

      const refused = await s.post("/v1/models/unload", {});
      expect(refused.status).toBe(409);
      const json = (await refused.json()) as { error: string; reasons: string[] };
      expect(json.error).toBe("confirmation_required");
      expect(json.reasons).toContain("reply_in_progress");
      expect(s.manager.getActiveGeneration()?.id).toBe(genId);
      expect(s.calls).toEqual([]);

      const t0 = Date.now();
      const ok = await s.post("/v1/models/unload", { confirm: true });
      expect(ok.status).toBe(202);

      const evs = parseSSE(await body);
      expect(Date.now() - t0).toBeLessThan(2000);
      const last = evs[evs.length - 1]!;
      expect(last.event).toBe("done");
      const done = JSON.parse(last.data);
      expect(done.status === "cancelled" || done.research?.status === "partial").toBe(true);

      // The unload completes against the fake Ollama and the slot is free.
      for (let i = 0; i < 100 && !s.calls.includes("unload:fake-model"); i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(s.calls).toContain("unload:fake-model");
      expect(s.manager.getActiveGeneration()).toBeNull();
      let kind = "unloading";
      for (let i = 0; i < 100 && kind === "unloading"; i++) {
        const stateRes = await fetch(`${s.base}/v1/state`, { headers: headers() });
        kind = ((await stateRes.json()) as { operation: { kind: string } }).operation.kind;
        if (kind === "unloading") await new Promise((r) => setTimeout(r, 20));
      }
      expect(kind).not.toBe("unloading");
    } finally {
      s.release();
      s.server.stop(true);
    }
  });
});
