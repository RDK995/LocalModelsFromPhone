import { describe, it, expect } from "bun:test";
import { createServer, setValidToken, type OllamaStateClient } from "./server";
import type { OllamaChatResponse } from "../ollama/client";
import { GenerationManager } from "../generations/manager";
import { createWebTools } from "../web/tools";
import { DEFAULT_RESEARCH_MODEL } from "../index";

const TOKEN = "test-token";
const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` });
const CONFIGURED = "research-model:1b";

function setup(opts: { resident: string; researchModel?: string }) {
  const chatCalls: any[] = [];
  const client: OllamaStateClient = {
    tags: async () => ({ models: [{ name: opts.resident, modified_at: "", size: 1, digest: "d" }] }),
    ps: async () =>
      ({
        models: [
          { name: opts.resident, model: opts.resident, size: 1, digest: "d", details: { family: "", parameter_size: "", quantization_level: "" }, expires_at: "", size_vram: 0 },
        ],
      }) as any,
    show: async () => ({ capabilities: ["completion", "tools"] }),
    load: async () => {},
    unload: async () => {},
    chat: ((request: any, _signal?: AbortSignal, tools?: unknown) => {
      chatCalls.push({ ...JSON.parse(JSON.stringify(request)), tools });
      return (async function* () {
        yield { model: opts.resident, created_at: "", message: { role: "assistant", content: "hi" }, done: true, eval_count: 1 } as unknown as OllamaChatResponse;
      })();
    }) as never,
  };
  setValidToken(TOKEN);
  const web = createWebTools({ baseUrl: "http://127.0.0.1:1" });
  const server = createServer({
    ollama: client,
    manager: new GenerationManager(client, web),
    port: 0,
    ...(opts.researchModel === undefined ? {} : { researchModel: opts.researchModel }),
  });
  const base = `http://127.0.0.1:${server.port}`;
  const post = (body: unknown) => fetch(`${base}/v1/chat`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  const state = async () => (await fetch(`${base}/v1/state`, { headers: headers() })).json() as Promise<any>;
  return { server, post, state, chatCalls };
}

const msg = [{ role: "user", content: "x" }];

describe("deep research gate (M18 FR34)", () => {
  it("GET /v1/state reports the configured deep-research model", async () => {
    const s = setup({ resident: CONFIGURED, researchModel: CONFIGURED });
    try {
      expect((await s.state()).deep_research_model).toBe(CONFIGURED);
    } finally {
      s.server.stop(true);
    }
  });

  it("GET /v1/state reports the default when none is configured", async () => {
    const s = setup({ resident: CONFIGURED });
    try {
      expect((await s.state()).deep_research_model).toBe(DEFAULT_RESEARCH_MODEL);
    } finally {
      s.server.stop(true);
    }
  });

  it("refuses deep research with web off and starts nothing", async () => {
    const s = setup({ resident: CONFIGURED, researchModel: CONFIGURED });
    try {
      for (const web of [undefined, false]) {
        const res = await s.post({ model: CONFIGURED, messages: msg, deep_research: true, ...(web === undefined ? {} : { web }) });
        expect([400, 409]).toContain(res.status);
        const body = (await res.json()) as any;
        expect(body.error).toBe("deep_research_needs_web");
        expect(body.message).toBe("Deep research needs web search to be on");
      }
      expect((await s.state()).generation).toBeNull();
      expect(s.chatCalls.length).toBe(0);
    } finally {
      s.server.stop(true);
    }
  });

  it("refuses deep research when the resident model is not the configured one", async () => {
    const s = setup({ resident: "other-model", researchModel: CONFIGURED });
    try {
      const res = await s.post({ model: "other-model", messages: msg, web: true, deep_research: true });
      expect(res.status).toBe(409);
      const body = (await res.json()) as any;
      expect(body.error).toBe("deep_research_model_not_loaded");
      expect(body.message).toBe(`Load ${CONFIGURED} to use deep research`);
      expect((await s.state()).generation).toBeNull();
      expect(s.chatCalls.length).toBe(0);
    } finally {
      s.server.stop(true);
    }
  });

  it("never offers the chat model a deep_research tool", async () => {
    const names = createWebTools().tools().map((t) => t.function.name);
    expect(names).not.toContain("deep_research");

    const s = setup({ resident: "other-model", researchModel: CONFIGURED });
    try {
      const res = await s.post({ model: "other-model", messages: msg, web: true });
      expect(res.status).toBe(200);
      await res.text();
      expect(s.chatCalls.length).toBeGreaterThan(0);
      const offered = (s.chatCalls[0].tools as Array<{ function: { name: string } }>).map((t) => t.function.name);
      expect(offered.length).toBeGreaterThan(0);
      expect(offered).not.toContain("deep_research");
    } finally {
      s.server.stop(true);
    }
  });
});
