import { describe, it, expect } from "bun:test";
import { createServer, setValidToken, type OllamaStateClient } from "./server";
import type { OllamaChatResponse, OllamaPsResponse } from "../ollama/client";
import { GenerationManager } from "../generations/manager";

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

const step = (id: string, status: "started" | "done") => ({
  type: "step" as const,
  data: { step_id: id, kind: "search" as const, status, query: "q" },
});

describe("A web reply that is searching (M11 FR23)", () => {
  it("counts as a reply in progress, and a reconnect with Last-Event-ID resumes with no gap or duplicate", async () => {
    const calls: string[] = [];
    const client: OllamaStateClient = {
      tags: async () => ({
        models: [
          { name: "fake-model", modified_at: "", size: 1, digest: "d" },
          { name: "other-model", modified_at: "", size: 1, digest: "d" },
        ],
      }),
      ps: async () => resident("fake-model"),
      show: async () => ({ capabilities: ["completion", "tools"] }),
      load: async (name) => void calls.push(`load:${name}`),
      unload: async (name) => void calls.push(`unload:${name}`),
      chat: (() => {
        let round = 0;
        return (() => {
          const r = round++;
          return (async function* () {
            if (r === 0) {
              const call = (q: string) => ({ function: { name: "web_search", arguments: { query: q } } });
              yield { ...chunk("", false), toolCalls: [call("a"), call("b")] };
              yield chunk("", true);
            } else {
              yield chunk("answer", false);
              yield chunk("", true);
            }
          })();
        }) as never;
      })() as never,
    };

    // First tool call returns at once (step s1 reaches the log); the second is
    // held on a promise so the reply stays in its searching stage.
    let executed = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let secondEntered!: () => void;
    const secondEnteredP = new Promise<void>((resolve) => (secondEntered = resolve));
    const fakeWeb = {
      tools: () => [],
      systemNote: () => "note",
      execute: async () => {
        if (executed++ === 0) {
          return { toolResult: "r1", events: [step("s1", "started"), step("s1", "done")] };
        }
        secondEntered();
        await held;
        return {
          toolResult: "r2",
          events: [
            step("s2", "started"),
            step("s2", "done"),
            { type: "source" as const, data: { title: "T", url: "http://x" } },
          ],
        };
      },
    };

    setValidToken(TOKEN);
    const server = createServer({ ollama: client, manager: new GenerationManager(client, fakeWeb), port: 0 });
    const base = `http://127.0.0.1:${server.port}`;
    const post = (path: string, body?: unknown) =>
      fetch(`${base}${path}`, { method: "POST", headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) });
    const chatBody = { model: "fake-model", messages: [{ role: "user", content: "hello" }], web: true };

    try {
      const chat = await post("/v1/chat", chatBody);
      expect(chat.status).toBe(200);
      const genId = chat.headers.get("x-generation-id")!;
      const chatText = chat.text();
      await secondEnteredP;

      // 1. Sending another prompt while searching is refused as a reply in progress.
      const second = await post("/v1/chat", chatBody);
      expect(second.status).toBe(409);
      expect(((await second.json()) as { error: string }).error).toBe("generation_in_flight");

      // 2. Swap and unload need the busy confirmation.
      for (const [path, body] of [
        ["/v1/models/load", { name: "other-model" }],
        ["/v1/models/unload", {}],
      ] as const) {
        const res = await post(path, body);
        expect(res.status).toBe(409);
        const json = (await res.json()) as { error: string; reasons: string[] };
        expect(json.error).toBe("confirmation_required");
        expect(json.reasons).toContain("reply_in_progress");
      }
      expect(calls).toEqual([]);

      // 3. Reconnect after the first step event, while still searching, then release.
      const eventsLog = await fetch(`${base}/v1/generations/${genId}/events`, { headers: headers() });
      const resumed = await fetch(`${base}/v1/generations/${genId}/events`, {
        headers: headers({ "Last-Event-ID": `${genId}-0` }),
      });
      expect(resumed.status).toBe(200);
      const resumedText = resumed.text();
      release();
      await chatText;

      const full = parseSSE(await eventsLog.text());
      const tail = parseSSE(await resumedText);
      const seqOf = (e: { id: string }) => Number(e.id.slice(genId.length + 1));
      expect(full.map(seqOf)).toEqual(full.map((_, i) => i));
      expect(full.map((e) => e.event)).toEqual(["step", "step", "step", "step", "content", "sources", "done"]);
      expect(full.filter((e) => e.event === "sources").length).toBe(1);
      expect(full.filter((e) => e.event === "done").length).toBe(1);

      // Resumed events are exactly the log entries after seq 0, once each.
      expect(tail.map(seqOf)).toEqual(full.slice(1).map(seqOf));
      expect(tail).toEqual(full.slice(1));
      expect([full[0], ...tail]).toEqual(full);

      // A fresh reconnect after the end replays the same tail.
      const again = await fetch(`${base}/v1/generations/${genId}/events`, {
        headers: headers({ "Last-Event-ID": `${genId}-0` }),
      });
      expect(parseSSE(await again.text())).toEqual(full.slice(1));
    } finally {
      release();
      server.stop(true);
    }
  });
});
