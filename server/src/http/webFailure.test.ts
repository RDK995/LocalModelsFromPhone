import { describe, it, expect } from "bun:test";
import { createServer, setValidToken, type OllamaStateClient } from "./server";
import type { OllamaChatResponse, OllamaPsResponse } from "../ollama/client";
import { GenerationManager } from "../generations/manager";
import { createWebTools } from "../web/tools";

const TOKEN = "test-token";
const headers = (extra: Record<string, string> = {}) => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${TOKEN}`,
  ...extra,
});

function resident(name: string): OllamaPsResponse {
  return {
    models: [
      {
        name,
        model: name,
        size: 1,
        digest: "d",
        details: { family: "", parameter_size: "", quantization_level: "" },
        expires_at: "",
        size_vram: 0,
      },
    ],
  };
}

function chunk(content: string, done: boolean): OllamaChatResponse {
  return {
    model: "fake-model",
    created_at: new Date().toISOString(),
    message: { role: "assistant", content },
    done,
    total_duration: 0,
    load_duration: 0,
    prompt_eval_count: 0,
    prompt_eval_duration: 0,
    eval_count: done ? 1 : 0,
    eval_duration: 0,
  };
}

function parseSSE(text: string): Array<{ id: string; event: string; data: string }> {
  return text
    .split("\n\n")
    .map((block) =>
      block
        .split("\n")
        .filter((line) => !line.startsWith(":"))
        .join("\n")
    )
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      const lines = block.split("\n");
      return {
        id: lines.find((l) => l.startsWith("id: "))?.slice(4) ?? "",
        event: lines.find((l) => l.startsWith("event: "))?.slice(7) ?? "",
        data: lines.find((l) => l.startsWith("data: "))?.slice(6) ?? "",
      };
    });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait for a flag set by another task, bounded; returns its final value. */
async function waitFor(cond: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await sleep(10);
  }
  return cond();
}

type Case = {
  name: string;
  tool: "web_search" | "read_page";
  path: "/v1/search" | "/v1/read";
  handler: (req: Request) => Response | Promise<Response>;
  timeoutMs: number;
  kind: "search" | "read";
  status: "unavailable" | "failed";
  detail: string;
  toolText: RegExp;
};

const hang = () => new Promise<Response>(() => {});

const cases: Case[] = [
  {
    name: "(a) both backends failed: 503 search_unavailable",
    tool: "web_search",
    path: "/v1/search",
    handler: () => Response.json({ error: "search_unavailable" }, { status: 503 }),
    timeoutMs: 120000,
    kind: "search",
    status: "unavailable",
    detail: "search_unavailable",
    toolText: /unavailable/i,
  },
  {
    name: "(b) search held past the client time limit",
    tool: "web_search",
    path: "/v1/search",
    handler: hang,
    timeoutMs: 400,
    kind: "search",
    status: "failed",
    detail: "timeout",
    toolText: /search failed/i,
  },
  {
    name: "(c) page read held past the client time limit",
    tool: "read_page",
    path: "/v1/read",
    handler: hang,
    timeoutMs: 400,
    kind: "read",
    status: "failed",
    detail: "timeout",
    toolText: /could not be read/i,
  },
  {
    name: "(d) search service answers 504 timeout",
    tool: "web_search",
    path: "/v1/search",
    handler: () => Response.json({ error: "timeout" }, { status: 504 }),
    timeoutMs: 120000,
    kind: "search",
    status: "failed",
    detail: "timeout",
    toolText: /search failed/i,
  },
];

describe("Web failures and time limits never hang the reply (M13 FR24, AC16)", () => {
  for (const c of cases) {
    it(c.name, async () => {
      const requests: any[] = [];
      let round = 0;
      const client: OllamaStateClient = {
        tags: async () => ({ models: [{ name: "fake-model", modified_at: "", size: 1, digest: "d" }] }),
        ps: async () => resident("fake-model"),
        show: async () => ({ capabilities: ["completion", "tools"] }),
        load: async () => {},
        unload: async () => {},
        chat: ((request: unknown) => {
          requests.push(JSON.parse(JSON.stringify(request)));
          const r = round++;
          return (async function* () {
            if (r === 0) {
              const args = c.tool === "web_search" ? { query: "q" } : { url: "http://example.com/page" };
              yield { ...chunk("", false), toolCalls: [{ function: { name: c.tool, arguments: args } }] };
              yield chunk("", true);
            } else {
              yield chunk("final answer", false);
              yield chunk("", true);
            }
          })();
        }) as never,
      };

      const search = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req) {
          return new URL(req.url).pathname === c.path ? c.handler(req) : new Response("nope", { status: 404 });
        },
      });
      const web = createWebTools({ baseUrl: `http://127.0.0.1:${search.port}`, timeoutMs: c.timeoutMs });
      setValidToken(TOKEN);
      const server = createServer({ ollama: client, manager: new GenerationManager(client, web), port: 0 });
      const base = `http://127.0.0.1:${server.port}`;
      const post = (path: string, body?: unknown) =>
        fetch(`${base}${path}`, { method: "POST", headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) });

      try {
        const started = Date.now();
        const chat = await post("/v1/chat", {
          model: "fake-model",
          messages: [{ role: "user", content: "hello" }],
          web: true,
        });
        expect(chat.status).toBe(200);
        const genId = chat.headers.get("x-generation-id")!;
        const text = await Promise.race([chat.text(), sleep(5000).then(() => "TIMEOUT")]);
        expect(Date.now() - started).toBeLessThan(5000);
        expect(text).not.toBe("TIMEOUT");

        const events = parseSSE(text);
        const steps = events.filter((e) => e.event === "step").map((e) => JSON.parse(e.data));
        expect(steps.map((s) => s.status)).toEqual(["started", c.status]);
        expect(steps[1].kind).toBe(c.kind);
        expect(steps[1].detail).toBe(c.detail);

        const done = events[events.length - 1];
        expect(done.event).toBe("done");
        const doneData = JSON.parse(done.data);
        expect(doneData.status).not.toBe("error");
        expect(doneData.status).not.toBe("cancelled");
        const content = events
          .filter((e) => e.event === "content")
          .map((e) => JSON.parse(e.data))
          .map((d) => (typeof d === "string" ? d : d.text ?? d.content ?? ""))
          .join("");
        expect(content).toContain("final answer");

        // The model's next request carries a tool message about the failure.
        expect(requests.length).toBe(2);
        const toolMsgs = requests[1].messages.filter((m: any) => m.role === "tool");
        expect(toolMsgs.length).toBe(1);
        expect(toolMsgs[0].content).toMatch(c.toolText);

        // The event log agrees, and the generation is no longer running.
        const log = parseSSE(await (await fetch(`${base}/v1/generations/${genId}/events`, { headers: headers() })).text());
        expect(log.map((e) => e.event)).toEqual(events.map((e) => e.event));
        const next = await post("/v1/chat", { model: "fake-model", messages: [{ role: "user", content: "again" }] });
        expect(next.status).toBe(200);
        await next.text();
      } finally {
        server.stop(true);
        search.stop(true);
      }
    });
  }
});
