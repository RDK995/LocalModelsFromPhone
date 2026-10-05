import { describe, it, expect } from "bun:test";
import { createServer, setValidToken, type OllamaStateClient } from "./server";
import type { OllamaChatResponse } from "../ollama/client";
import { GenerationManager } from "../generations/manager";
import { createWebTools } from "../web/tools";

const TOKEN = "test-token";
const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` });

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

/** A scripted model round: read one page, stay quiet (thinking only), or answer. */
type Round = { read: string } | "quiet" | { answer: string };

const PAGES: Record<string, { title: string; markdown: string }> = {
  "https://blocked.example/p": { title: "Client Challenge", markdown: "Please wait while we check your browser." },
  "https://empty.example/p": { title: "Stub", markdown: "Just a few words here." },
  "https://good.example/p": {
    title: "Good Page",
    markdown: "Zebras migrate along rivers. " + Array.from({ length: 50 }, (_, i) => `fact${i}`).join(" "),
  },
};

async function run(rounds: Round[]) {
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
    chat: ((request: any) => {
      requests.push(JSON.parse(JSON.stringify(request)));
      const r = rounds[i++] ?? { answer: "(script exhausted)" };
      return (async function* () {
        if (r === "quiet") {
          yield chunk("", false, "hmm");
        } else if ("read" in r) {
          yield { ...chunk("", false), toolCalls: [{ function: { name: "read_page", arguments: { url: r.read } } }] } as any;
        } else {
          yield chunk(r.answer, false);
        }
        yield chunk("", true);
      })();
    }) as never,
  };
  const search = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const body: any = await req.json().catch(() => ({}));
      const page = PAGES[body.url];
      if (new URL(req.url).pathname !== "/v1/read" || !page) return new Response("nope", { status: 404 });
      return Response.json({ url: body.url, final_url: body.url, title: page.title, markdown: page.markdown, truncated: false });
    },
  });
  const web = createWebTools({ baseUrl: `http://127.0.0.1:${search.port}` });
  setValidToken(TOKEN);
  const server = createServer({ ollama: client, manager: new GenerationManager(client, web), port: 0 });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    const chat = await fetch(`${base}/v1/chat`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ model: "fake-model", messages: [{ role: "user", content: "hello" }], web: true }),
    });
    const events = parseSSE(await chat.text());
    const genId = chat.headers.get("x-generation-id")!;
    const replay = parseSSE(await (await fetch(`${base}/v1/generations/${genId}/events`, { headers: headers() })).text());
    return { requests, events, replay };
  } finally {
    server.stop(true);
    search.stop(true);
  }
}

const toolText = (req: any): string => req.messages.filter((m: any) => m.role === "tool").map((m: any) => m.content).join("\n");
const readSteps = (events: ReturnType<typeof parseSSE>) =>
  events.filter((e) => e.event === "step").map((e) => JSON.parse(e.data)).filter((s) => s.kind === "read");
const sourceItems = (events: ReturnType<typeof parseSSE>): Array<{ url: string; n?: number }> => {
  const saved = events.filter((e) => e.event === "sources");
  return saved.length ? JSON.parse(saved[saved.length - 1]!.data).items : [];
};

describe("Unreadable pages are dropped by read_page (M22 FR47)", () => {
  it("AC3 (a)+(b): a bot-check page is not numbered or a source; a later readable page is [1] and the only source", async () => {
    const r = await run([
      { read: "https://blocked.example/p" },
      { read: "https://good.example/p" },
      { answer: "done" },
    ]);
    expect(r.requests.length).toBe(3);
    const first = toolText(r.requests[1]);
    expect(first).toBe(
      "The page at https://blocked.example/p could not be read: it showed a bot check instead of its content. It has no page number and must not be cited. You may read another result or search again.",
    );
    expect(first).not.toContain("Please wait while we check your browser");

    const reads = readSteps(r.events);
    expect(reads.map((s) => [s.url, s.status, s.detail])).toEqual([
      ["https://blocked.example/p", "started", undefined],
      ["https://blocked.example/p", "failed", "bot_check"],
      ["https://good.example/p", "started", undefined],
      ["https://good.example/p", "done", undefined],
    ]);

    const second = toolText(r.requests[2]);
    expect(second).toContain("Page [1] - cite this page as [1]");
    expect(sourceItems(r.events).map((s) => [s.url, s.n])).toEqual([["https://good.example/p", 1]]);
    expect(sourceItems(r.replay).map((s) => s.url)).toEqual(["https://good.example/p"]);
    expect(JSON.parse(r.events[r.events.length - 1]!.data).status).toBe("complete");
  });

  it("AC3 (c): a near-empty page gets the almost-no-text statement and no source", async () => {
    const r = await run([{ read: "https://empty.example/p" }, { answer: "done" }]);
    expect(toolText(r.requests[1])).toBe(
      "The page at https://empty.example/p could not be read: it had almost no text. It has no page number and must not be cited. You may read another result or search again.",
    );
    expect(readSteps(r.events).map((s) => [s.status, s.detail])).toEqual([["started", undefined], ["failed", "no_content"]]);
    expect(r.events.some((e) => e.event === "source")).toBe(false);
    expect(sourceItems(r.events)).toEqual([]);
  });

  it("AC3 (d): FR33 quiet-round handling is unchanged after an unreadable read", async () => {
    const r = await run([{ read: "https://blocked.example/p" }, "quiet", { answer: "the answer" }]);
    expect(r.requests.length).toBe(3);
    const last = r.requests[2].messages[r.requests[2].messages.length - 1];
    expect(last.role).toBe("user");
    expect(last.content).toMatch(/no answer/i);
    const content = r.events.filter((e) => e.event === "content").map((e) => JSON.parse(e.data).text).join("");
    expect(content).toBe("the answer");
  });
});
