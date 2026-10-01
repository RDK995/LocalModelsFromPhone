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

describe("Stop during an in-flight web tool call (M12 FR23)", () => {
  for (const tool of ["web_search", "read_page"] as const) {
    it(`aborts the search-service request and ends the reply (${tool})`, async () => {
      const client: OllamaStateClient = {
        tags: async () => ({ models: [{ name: "fake-model", modified_at: "", size: 1, digest: "d" }] }),
        ps: async () => resident("fake-model"),
        show: async () => ({ capabilities: ["completion", "tools"] }),
        load: async () => {},
        unload: async () => {},
        chat: (() => {
          let round = 0;
          return (() => {
            const r = round++;
            return (async function* () {
              if (r === 0) {
                const args = tool === "web_search" ? { query: "q" } : { url: "http://example.com/page" };
                yield { ...chunk("", false), toolCalls: [{ function: { name: tool, arguments: args } }] };
                yield chunk("", true);
              } else {
                yield chunk("late answer", false);
                yield chunk("", true);
              }
            })();
          }) as never;
        })() as never,
      };

      // Fake search service: a real HTTP server that holds the request open and
      // records when the server aborts it.
      let entered = false;
      let aborted = false;
      const search = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req) {
          entered = true;
          return new Promise<Response>(() => {
            req.signal.addEventListener("abort", () => (aborted = true));
          });
        },
      });

      // Client timeout far above the test's bound, so it cannot be what ends the call.
      const web = createWebTools({ baseUrl: `http://127.0.0.1:${search.port}`, timeoutMs: 120000 });
      setValidToken(TOKEN);
      const server = createServer({ ollama: client, manager: new GenerationManager(client, web), port: 0 });
      const base = `http://127.0.0.1:${server.port}`;
      const post = (path: string, body?: unknown) =>
        fetch(`${base}${path}`, { method: "POST", headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) });
      const chatBody = { model: "fake-model", messages: [{ role: "user", content: "hello" }], web: true };

      try {
        const chat = await post("/v1/chat", chatBody);
        expect(chat.status).toBe(200);
        const genId = chat.headers.get("x-generation-id")!;
        const chatText = chat.text();

        expect(await waitFor(() => entered, 2000)).toBe(true);
        expect(aborted).toBe(false);

        const cancel = await post(`/v1/generations/${genId}/cancel`);
        expect(cancel.status).toBe(200);
        expect(await cancel.json()).toEqual({ status: "cancelled" });
        const cancelledAt = Date.now();

        // The search-service request is aborted well within the bound.
        expect(await waitFor(() => aborted, 2000)).toBe(true);
        expect(Date.now() - cancelledAt).toBeLessThan(2000);

        // The stream terminates as cancelled, with nothing before or after it.
        const streamed = parseSSE(await Promise.race([chatText, sleep(2000).then(() => "TIMEOUT")]));
        expect(streamed.map((e) => e.event)).toEqual(["done"]);
        expect(JSON.parse(streamed[0].data).status).toBe("cancelled");

        const readLog = async () =>
          parseSSE(await (await fetch(`${base}/v1/generations/${genId}/events`, { headers: headers() })).text());
        const events = await readLog();
        expect(events.map((e) => e.event)).toEqual(["done"]);
        expect(JSON.parse(events[0].data).status).toBe("cancelled");

        // No further events appear later, and a new chat is admitted.
        await sleep(200);
        expect(await readLog()).toEqual(events);
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
