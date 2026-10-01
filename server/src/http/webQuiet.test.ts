import { describe, it, expect } from "bun:test";
import { createServer, setValidToken, type OllamaStateClient } from "./server";
import type { OllamaChatResponse } from "../ollama/client";
import { GenerationManager, type GenerationWebTools } from "../generations/manager";

const TOKEN = "test-token";
const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` });
const NOTE = "No answer was produced — the model stopped without answering. Try asking again.";

function chunk(content: string, done: boolean, thinking?: string): OllamaChatResponse {
  return {
    model: "fake-model",
    created_at: new Date().toISOString(),
    message: { role: "assistant", content, ...(thinking ? { thinking } : {}) },
    done,
    total_duration: 0,
    load_duration: 0,
    prompt_eval_count: 0,
    prompt_eval_duration: 0,
    eval_count: done ? 1 : 0,
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

/** A round: "quiet" (thinking only), "blank" (whitespace content), "tool", or answer text. */
type Round = "quiet" | "blank" | "tool" | { answer: string } | "hang";

function roundChunks(r: Round): OllamaChatResponse[] {
  if (r === "quiet") return [chunk("", false, "hmm"), chunk("", true)];
  if (r === "blank") return [chunk("  \n", false), chunk("", true)];
  if (r === "tool")
    return [
      { ...chunk("", false), toolCalls: [{ function: { name: "web_search", arguments: { query: "q" } } }] } as any,
      chunk("", true),
    ];
  if (r === "hang") return [];
  return [chunk(r.answer, false), chunk("", true)];
}

const fakeWeb: GenerationWebTools = {
  tools: () => [{ type: "function", function: { name: "web_search", description: "d", parameters: {} } }] as any,
  systemNote: () => "SYSTEM NOTE",
  execute: async (call) => ({
    toolResult: "result",
    events: [
      { type: "step", data: { step_id: crypto.randomUUID(), kind: "search", status: "started", query: "q" } },
      { type: "step", data: { step_id: "x", kind: "search", status: "done", query: "q" } },
      { type: "source", data: { title: "T", url: "http://example.com/a" } },
    ] as any,
  }),
};

async function setup(rounds: Round[], hangSignal?: { onHang: () => void }) {
  const requests: any[] = [];
  let i = 0;
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
    chat: ((request: any, signal?: AbortSignal, tools?: unknown) => {
      requests.push({ ...JSON.parse(JSON.stringify(request)), tools: tools ? "yes" : undefined });
      const r = rounds[i++] ?? { answer: "(script exhausted)" };
      return (async function* () {
        if (r === "hang") {
          hangSignal?.onHang();
          await new Promise(() => {});
        }
        for (const c of roundChunks(r)) yield c;
      })();
    }) as never,
  };
  setValidToken(TOKEN);
  const server = createServer({ ollama: client, manager: new GenerationManager(client, fakeWeb), port: 0 });
  const base = `http://127.0.0.1:${server.port}`;
  const post = (path: string, body?: unknown) =>
    fetch(`${base}${path}`, { method: "POST", headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) });
  return { requests, server, base, post };
}

const contentOf = (events: ReturnType<typeof parseSSE>) =>
  events
    .filter((e) => e.event === "content")
    .map((e) => JSON.parse(e.data).text)
    .join("");

async function run(rounds: Round[], web = true) {
  const s = await setup(rounds);
  try {
    const chat = await s.post("/v1/chat", { model: "fake-model", messages: [{ role: "user", content: "hello" }], web });
    const genId = chat.headers.get("x-generation-id")!;
    const events = parseSSE(await chat.text());
    const replay = parseSSE(await (await fetch(`${s.base}/v1/generations/${genId}/events`, { headers: headers() })).text());
    return { ...s, events, replay, genId, done: JSON.parse(events[events.length - 1].data) };
  } finally {
    s.server.stop(true);
  }
}

const steps = (events: ReturnType<typeof parseSSE>) => events.filter((e) => e.event === "step").map((e) => JSON.parse(e.data));
const lastMsg = (req: any) => req.messages[req.messages.length - 1];

describe("A quiet web round is prodded, answered-now, then given the note (M14 FR33)", () => {
  it("AC1: screenshot-shaped quiet round is prodded with tools still offered, then answered", async () => {
    const r = await run(["quiet", { answer: "the answer" }]);
    expect(r.requests.length).toBe(2);
    expect(r.requests[1].tools).toBe("yes");
    expect(lastMsg(r.requests[1]).role).toBe("user");
    expect(lastMsg(r.requests[1]).content).toMatch(/no answer/i);
    expect(r.done.status).toBe("complete");
    expect(contentOf(r.events)).toBe("the answer");
    const s = steps(r.events);
    expect(s.map((x) => [x.kind, x.status])).toEqual([["continue", "started"], ["continue", "done"]]);
    expect(s[0].step_id).toBe(s[1].step_id);
    expect(steps(r.replay)).toEqual(s);
  });

  it("AC1: whitespace-only content counts as quiet", async () => {
    const r = await run(["blank", { answer: "ok" }]);
    expect(r.requests.length).toBe(2);
    expect(contentOf(r.events)).toBe("  \nok");
    expect(steps(r.events).filter((x) => x.kind === "continue").length).toBe(2);
  });

  it("AC1: quiet, then a tool call, then answer", async () => {
    const r = await run(["quiet", "tool", { answer: "fin" }]);
    expect(r.requests.length).toBe(3);
    expect(r.requests[2].tools).toBe("yes");
    expect(r.done.status).toBe("complete");
    expect(contentOf(r.events)).toBe("fin");
    expect(r.events.some((e) => e.event === "sources")).toBe(true);
  });

  it("AC1: quiet twice, then answer; prods are in order", async () => {
    const r = await run(["quiet", "quiet", { answer: "late" }]);
    expect(r.requests.length).toBe(3);
    expect(r.requests[2].tools).toBe("yes");
    expect(contentOf(r.events)).toBe("late");
    const s = steps(r.events);
    expect(s.map((x) => x.kind)).toEqual(["continue", "continue", "continue", "continue"]);
    expect(new Set(s.map((x) => x.step_id)).size).toBe(2);
    expect(steps(r.replay)).toEqual(s);
  });

  it("AC1: prods do not count toward the 10-call cap", async () => {
    const rounds: Round[] = ["quiet", "quiet"];
    for (let i = 0; i < 10; i++) rounds.push("tool");
    rounds.push({ answer: "after cap" });
    const r = await run(rounds);
    // 2 quiet + 10 tool rounds + 1 after-cap round
    expect(r.requests.length).toBe(13);
    expect(r.requests[11].tools).toBe("yes"); // the 10th call round still offered tools
    expect(r.requests[12].tools).toBeUndefined();
    expect(contentOf(r.events)).toBe("after cap");
    expect(steps(r.events).filter((x) => x.kind === "search" && x.status === "done").length).toBe(10);
  });

  it("AC2: quiet three times -> answer-now round without tools, then answer", async () => {
    const r = await run(["quiet", "quiet", "quiet", { answer: "forced" }]);
    expect(r.requests.length).toBe(4);
    expect(r.requests[3].tools).toBeUndefined();
    expect(lastMsg(r.requests[3]).role).toBe("user");
    expect(lastMsg(r.requests[3]).content).toMatch(/answer now/i);
    expect(contentOf(r.events)).toBe("forced");
    const s = steps(r.events);
    expect(s.filter((x) => x.kind === "answer_now").map((x) => x.status)).toEqual(["started", "done"]);
    expect(s.filter((x) => x.kind === "continue").length).toBe(4);
    expect(steps(r.replay)).toEqual(s);
  });

  it("AC2: quiet after the answer-now round ends with the exact note", async () => {
    const r = await run(["quiet", "quiet", "quiet", "quiet"]);
    expect(r.requests.length).toBe(4);
    expect(r.done.status).toBe("complete");
    expect(contentOf(r.events)).toBe(NOTE);
    expect(r.events.some((e) => e.event === "sources")).toBe(false);
    expect(r.events[r.events.length - 1].event).toBe("done");
    expect(contentOf(r.replay)).toBe(NOTE);
  });

  it("AC2: quiet after the 10-call cap ends with the note, steps and sources", async () => {
    const rounds: Round[] = [];
    for (let i = 0; i < 10; i++) rounds.push("tool");
    rounds.push("quiet");
    const r = await run(rounds);
    expect(r.requests.length).toBe(11);
    expect(r.done.status).toBe("complete");
    expect(contentOf(r.events)).toBe(NOTE);
    const kinds = r.events.map((e) => e.event);
    expect(kinds.slice(-2)).toEqual(["sources", "done"]);
    expect(steps(r.events).some((x) => x.kind === "search")).toBe(true);
  });

  it("AC3: switch-off empty reply is unchanged", async () => {
    const r = await run(["quiet"], false);
    expect(r.requests.length).toBe(1);
    expect(steps(r.events)).toEqual([]);
    expect(contentOf(r.events)).toBe("");
    expect(r.done.status).toBe("complete");
  });

  it("AC3: prod text never reaches events or the next request", async () => {
    const s = await setup(["quiet", "quiet", "quiet", { answer: "a" }, { answer: "b" }]);
    try {
      const chat = await s.post("/v1/chat", { model: "fake-model", messages: [{ role: "user", content: "hello" }], web: true });
      const text = await chat.text();
      const events = parseSSE(text);
      const prod = lastMsg(s.requests[1]).content as string;
      const now = lastMsg(s.requests[3]).content as string;
      for (const e of events.filter((e) => e.event === "content" || e.event === "thinking")) {
        expect(e.data).not.toContain(prod);
        expect(e.data).not.toContain(now);
      }
      const next = await s.post("/v1/chat", { model: "fake-model", messages: [{ role: "user", content: "again" }], web: true });
      await next.text();
      const msgs = s.requests[4].messages;
      expect(msgs.map((m: any) => m.role)).toEqual(["system", "user"]);
      expect(msgs[1].content).toBe("again");
    } finally {
      s.server.stop(true);
    }
  });

  it("AC3: Stop during a prodded round ends cancelled with no note", async () => {
    let hung!: () => void;
    const hungP = new Promise<void>((r) => (hung = r));
    const s = await setup(["quiet", "hang"], { onHang: () => hung() });
    try {
      const chat = await s.post("/v1/chat", { model: "fake-model", messages: [{ role: "user", content: "hello" }], web: true });
      const genId = chat.headers.get("x-generation-id")!;
      await hungP;
      const cancel = await s.post(`/v1/generations/${genId}/cancel`);
      expect(cancel.status).toBe(200);
      const events = parseSSE(await Promise.race([chat.text(), new Promise<string>((r) => setTimeout(() => r("TIMEOUT"), 5000))]));
      const done = events[events.length - 1];
      expect(done.event).toBe("done");
      expect(JSON.parse(done.data).status).toBe("cancelled");
      expect(contentOf(events)).toBe("");
    } finally {
      s.server.stop(true);
    }
  });
});
