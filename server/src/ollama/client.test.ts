import { describe, it, expect } from "bun:test";
import { OllamaClient, OllamaError } from "./client";

/** A fake Ollama HTTP server on port 0 driven by `handler`. */
function fakeOllamaHttp(handler: (req: Request) => Promise<Response> | Response) {
  return Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });
}

describe("OllamaClient", () => {
  it("should be instantiable with default URL", () => {
    const client = new OllamaClient();
    expect(client).toBeDefined();
  });

  it("should be instantiable with custom URL", () => {
    const client = new OllamaClient("http://localhost:11434");
    expect(client).toBeDefined();
  });

  it("should have tags method", () => {
    const client = new OllamaClient();
    expect(typeof client.tags).toBe("function");
  });

  it("should have ps method", () => {
    const client = new OllamaClient();
    expect(typeof client.ps).toBe("function");
  });

  it("should have generate method", () => {
    const client = new OllamaClient();
    expect(typeof client.generate).toBe("function");
  });

  it("should have chat method", () => {
    const client = new OllamaClient();
    expect(typeof client.chat).toBe("function");
  });

  it("chat should be an async generator", async () => {
    const client = new OllamaClient();
    const chatGenerator = client.chat({
      model: "test",
      messages: [{ role: "user", content: "test" }],
    });
    expect(Symbol.asyncIterator in Object(chatGenerator)).toBe(true);
  });
});

describe("OllamaClient load/unload", () => {
  it("load() sends POST /api/generate {model, keep_alive:-1}", async () => {
    const bodies: unknown[] = [];
    const server = fakeOllamaHttp(async (req) => {
      bodies.push(await req.json());
      return new Response("{}", { headers: { "Content-Type": "application/json" } });
    });
    try {
      const client = new OllamaClient(`http://127.0.0.1:${server.port}`);
      await client.load("llama3");
      expect(bodies).toEqual([{ model: "llama3", keep_alive: -1 }]);
    } finally {
      server.stop(true);
    }
  });

  it("unload() sends POST /api/generate {model, keep_alive:0}", async () => {
    const bodies: unknown[] = [];
    const server = fakeOllamaHttp(async (req) => {
      bodies.push(await req.json());
      return new Response("{}", { headers: { "Content-Type": "application/json" } });
    });
    try {
      const client = new OllamaClient(`http://127.0.0.1:${server.port}`);
      await client.unload("llama3");
      expect(bodies).toEqual([{ model: "llama3", keep_alive: 0 }]);
    } finally {
      server.stop(true);
    }
  });

  it("throws OllamaError carrying the status and Ollama's error text for a JSON error body", async () => {
    const server = fakeOllamaHttp(
      () =>
        new Response(
          JSON.stringify({
            error: "model requires more system memory (8.0 GiB) than is available (4.0 GiB)",
          }),
          { status: 500 }
        )
    );
    try {
      const client = new OllamaClient(`http://127.0.0.1:${server.port}`);
      try {
        await client.load("llama3");
        throw new Error("expected load() to reject");
      } catch (error) {
        expect(error).toBeInstanceOf(OllamaError);
        expect((error as OllamaError).status).toBe(500);
        expect((error as OllamaError).message).toContain("more system memory");
      }
    } finally {
      server.stop(true);
    }
  });

  it("falls back to the response's status text when the error body is not JSON with an error field", async () => {
    const server = fakeOllamaHttp(
      () => new Response("not json", { status: 404, statusText: "Not Found" })
    );
    try {
      const client = new OllamaClient(`http://127.0.0.1:${server.port}`);
      try {
        await client.unload("llama3");
        throw new Error("expected unload() to reject");
      } catch (error) {
        expect(error).toBeInstanceOf(OllamaError);
        expect((error as OllamaError).status).toBe(404);
        expect((error as OllamaError).message.length).toBeGreaterThan(0);
      }
    } finally {
      server.stop(true);
    }
  });
});

/** Helper to consume an async generator */
async function drain(gen: AsyncGenerator<unknown, void, unknown>): Promise<void> {
  for await (const _ of gen) {
    // consume
  }
}

describe("OllamaClient chat think capability", () => {
  const CHAT_LINE =
    JSON.stringify({
      model: "m",
      created_at: "",
      message: { role: "assistant", content: "" },
      done: true,
      total_duration: 0,
      load_duration: 0,
      prompt_eval_count: 0,
      prompt_eval_duration: 0,
      eval_count: 0,
      eval_duration: 0,
    }) + "\n";

  /** A fake Ollama serving both /api/show and /api/chat, recording each body seen. */
  function fakeOllamaWithShow(showCapabilities: string[] | undefined, showStatus = 200) {
    const showBodies: unknown[] = [];
    const chatBodies: unknown[] = [];
    const server = fakeOllamaHttp(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/api/show") {
        showBodies.push(await req.json());
        if (showStatus !== 200) {
          return new Response("show failed", { status: showStatus });
        }
        return new Response(JSON.stringify({ capabilities: showCapabilities }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.pathname === "/api/chat") {
        chatBodies.push(await req.json());
        return new Response(CHAT_LINE, { headers: { "Content-Type": "application/x-ndjson" } });
      }
      return new Response("not found", { status: 404 });
    });
    return { server, showBodies, chatBodies };
  }

  it("sends think:true when /api/show capabilities include 'thinking'", async () => {
    const { server, chatBodies } = fakeOllamaWithShow(["completion", "thinking"]);
    try {
      const client = new OllamaClient(`http://127.0.0.1:${server.port}`);
      await drain(client.chat({ model: "thinker", messages: [{ role: "user", content: "hi" }] }));
      expect(chatBodies).toEqual([
        {
          model: "thinker",
          messages: [{ role: "user", content: "hi" }],
          keep_alive: -1,
          stream: true,
          think: true,
        },
      ]);
    } finally {
      server.stop(true);
    }
  });

  it("sends no think key when /api/show capabilities do not include 'thinking'", async () => {
    const { server, chatBodies } = fakeOllamaWithShow(["completion"]);
    try {
      const client = new OllamaClient(`http://127.0.0.1:${server.port}`);
      await drain(client.chat({ model: "plain", messages: [{ role: "user", content: "hi" }] }));
      expect(chatBodies).toEqual([
        {
          model: "plain",
          messages: [{ role: "user", content: "hi" }],
          keep_alive: -1,
          stream: true,
        },
      ]);
    } finally {
      server.stop(true);
    }
  });

  it("sends no think key and still chats when /api/show fails", async () => {
    const { server, chatBodies } = fakeOllamaWithShow(undefined, 500);
    try {
      const client = new OllamaClient(`http://127.0.0.1:${server.port}`);
      await drain(client.chat({ model: "broken-show", messages: [{ role: "user", content: "hi" }] }));
      expect(chatBodies).toEqual([
        {
          model: "broken-show",
          messages: [{ role: "user", content: "hi" }],
          keep_alive: -1,
          stream: true,
        },
      ]);
    } finally {
      server.stop(true);
    }
  });

  it("sends no think key when /api/show succeeds but has no capabilities field", async () => {
    const { server, chatBodies } = fakeOllamaWithShow(undefined, 200);
    try {
      const client = new OllamaClient(`http://127.0.0.1:${server.port}`);
      await drain(client.chat({ model: "no-caps", messages: [{ role: "user", content: "hi" }] }));
      expect(chatBodies).toEqual([
        {
          model: "no-caps",
          messages: [{ role: "user", content: "hi" }],
          keep_alive: -1,
          stream: true,
        },
      ]);
    } finally {
      server.stop(true);
    }
  });

  it("calls /api/show once per model across two chats (cached)", async () => {
    const { server, showBodies, chatBodies } = fakeOllamaWithShow(["thinking"]);
    try {
      const client = new OllamaClient(`http://127.0.0.1:${server.port}`);
      await drain(client.chat({ model: "cached", messages: [{ role: "user", content: "one" }] }));
      await drain(client.chat({ model: "cached", messages: [{ role: "user", content: "two" }] }));
      expect(showBodies).toEqual([{ model: "cached" }]);
      expect(chatBodies.length).toBe(2);
      expect((chatBodies[0] as { think?: boolean }).think).toBe(true);
      expect((chatBodies[1] as { think?: boolean }).think).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  it("sends think:false when request.think is explicitly false (thinking-capable model)", async () => {
    const { server, chatBodies } = fakeOllamaWithShow(["completion", "thinking"]);
    try {
      const client = new OllamaClient(`http://127.0.0.1:${server.port}`);
      await drain(
        client.chat({ model: "thinker", messages: [{ role: "user", content: "hi" }], think: false })
      );
      expect(chatBodies).toEqual([
        {
          model: "thinker",
          messages: [{ role: "user", content: "hi" }],
          keep_alive: -1,
          stream: true,
          think: false,
        },
      ]);
    } finally {
      server.stop(true);
    }
  });

  it("sends think:false when request.think is explicitly false (non-thinking model)", async () => {
    const { server, chatBodies } = fakeOllamaWithShow(["completion"]);
    try {
      const client = new OllamaClient(`http://127.0.0.1:${server.port}`);
      await drain(
        client.chat({ model: "plain", messages: [{ role: "user", content: "hi" }], think: false })
      );
      expect(chatBodies).toEqual([
        {
          model: "plain",
          messages: [{ role: "user", content: "hi" }],
          keep_alive: -1,
          stream: true,
          think: false,
        },
      ]);
    } finally {
      server.stop(true);
    }
  });
});

describe("OllamaClient chat optional fields", () => {
  it("sends format, options, think, and keep_alive when all provided in request", async () => {
    const bodies: unknown[] = [];
    const server = fakeOllamaHttp(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/api/chat") {
        bodies.push(await req.json());
        return new Response(
          JSON.stringify({
            model: "m",
            created_at: "",
            message: { role: "assistant", content: "" },
            done: true,
            total_duration: 0,
            load_duration: 0,
            prompt_eval_count: 0,
            prompt_eval_duration: 0,
            eval_count: 0,
            eval_duration: 0,
          }) + "\n",
          { headers: { "Content-Type": "application/x-ndjson" } }
        );
      }
      if (url.pathname === "/api/show") {
        return new Response(JSON.stringify({ capabilities: [] }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    try {
      const client = new OllamaClient(`http://127.0.0.1:${server.port}`);
      await drain(
        client.chat({
          model: "m",
          messages: [{ role: "user", content: "hi" }],
          format: "json",
          options: { num_ctx: 4096 },
          think: true,
          keep_alive: 300,
        })
      );
      expect(bodies.length).toBe(1);
      expect(bodies[0]).toEqual({
        model: "m",
        messages: [{ role: "user", content: "hi" }],
        keep_alive: 300,
        stream: true,
        think: true,
        format: "json",
        options: { num_ctx: 4096 },
      });
    } finally {
      server.stop(true);
    }
  });

  it("omits format, options, think, and keep_alive when not provided (backward compatibility)", async () => {
    const bodies: unknown[] = [];
    const server = fakeOllamaHttp(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/api/chat") {
        bodies.push(await req.json());
        return new Response(
          JSON.stringify({
            model: "m",
            created_at: "",
            message: { role: "assistant", content: "" },
            done: true,
            total_duration: 0,
            load_duration: 0,
            prompt_eval_count: 0,
            prompt_eval_duration: 0,
            eval_count: 0,
            eval_duration: 0,
          }) + "\n",
          { headers: { "Content-Type": "application/x-ndjson" } }
        );
      }
      if (url.pathname === "/api/show") {
        return new Response(JSON.stringify({ capabilities: [] }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    try {
      const client = new OllamaClient(`http://127.0.0.1:${server.port}`);
      await drain(client.chat({ model: "m", messages: [{ role: "user", content: "hi" }] }));
      expect(bodies.length).toBe(1);
      expect(bodies[0]).toEqual({
        model: "m",
        messages: [{ role: "user", content: "hi" }],
        keep_alive: -1,
        stream: true,
      });
    } finally {
      server.stop(true);
    }
  });
});

describe("OllamaClient chat tools", () => {
  it("includes tools in body when passed and non-empty", async () => {
    const bodies: unknown[] = [];
    const server = fakeOllamaHttp(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/api/chat") {
        bodies.push(await req.json());
        return new Response(
          JSON.stringify({
            model: "m",
            created_at: "",
            message: { role: "assistant", content: "" },
            done: true,
            total_duration: 0,
            load_duration: 0,
            prompt_eval_count: 0,
            prompt_eval_duration: 0,
            eval_count: 0,
            eval_duration: 0,
          }) + "\n",
          { headers: { "Content-Type": "application/x-ndjson" } }
        );
      }
      if (url.pathname === "/api/show") {
        return new Response(JSON.stringify({ capabilities: [] }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    try {
      const client = new OllamaClient(`http://127.0.0.1:${server.port}`);
      const tools = [
        { type: "function" as const, function: { name: "search", description: "Search the web", parameters: {} } },
      ];
      await drain(
        client.chat({ model: "m", messages: [{ role: "user", content: "hi" }] }, undefined, tools)
      );
      expect(bodies.length).toBe(1);
      expect((bodies[0] as { tools?: unknown }).tools).toEqual(tools);
    } finally {
      server.stop(true);
    }
  });

  it("omits tools key when tools omitted", async () => {
    const bodies: unknown[] = [];
    const server = fakeOllamaHttp(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/api/chat") {
        bodies.push(await req.json());
        return new Response(
          JSON.stringify({
            model: "m",
            created_at: "",
            message: { role: "assistant", content: "" },
            done: true,
            total_duration: 0,
            load_duration: 0,
            prompt_eval_count: 0,
            prompt_eval_duration: 0,
            eval_count: 0,
            eval_duration: 0,
          }) + "\n",
          { headers: { "Content-Type": "application/x-ndjson" } }
        );
      }
      if (url.pathname === "/api/show") {
        return new Response(JSON.stringify({ capabilities: [] }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    try {
      const client = new OllamaClient(`http://127.0.0.1:${server.port}`);
      await drain(client.chat({ model: "m", messages: [{ role: "user", content: "hi" }] }));
      expect(bodies.length).toBe(1);
      expect("tools" in (bodies[0] as Record<string, unknown>)).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  it("omits tools key when tools is empty array", async () => {
    const bodies: unknown[] = [];
    const server = fakeOllamaHttp(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/api/chat") {
        bodies.push(await req.json());
        return new Response(
          JSON.stringify({
            model: "m",
            created_at: "",
            message: { role: "assistant", content: "" },
            done: true,
            total_duration: 0,
            load_duration: 0,
            prompt_eval_count: 0,
            prompt_eval_duration: 0,
            eval_count: 0,
            eval_duration: 0,
          }) + "\n",
          { headers: { "Content-Type": "application/x-ndjson" } }
        );
      }
      if (url.pathname === "/api/show") {
        return new Response(JSON.stringify({ capabilities: [] }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    try {
      const client = new OllamaClient(`http://127.0.0.1:${server.port}`);
      await drain(client.chat({ model: "m", messages: [{ role: "user", content: "hi" }] }, undefined, []));
      expect(bodies.length).toBe(1);
      expect("tools" in (bodies[0] as Record<string, unknown>)).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  it("yields tool_calls from streamed message chunks", async () => {
    const server = fakeOllamaHttp(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/api/chat") {
        return new Response(
          JSON.stringify({
            model: "m",
            created_at: "",
            message: { role: "assistant", content: "", tool_calls: [{ function: { name: "search", arguments: { q: "test" } } }] },
            done: false,
            total_duration: 0,
            load_duration: 0,
            prompt_eval_count: 0,
            prompt_eval_duration: 0,
            eval_count: 0,
            eval_duration: 0,
          }) + "\n",
          { headers: { "Content-Type": "application/x-ndjson" } }
        );
      }
      if (url.pathname === "/api/show") {
        return new Response(JSON.stringify({ capabilities: [] }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    try {
      const client = new OllamaClient(`http://127.0.0.1:${server.port}`);
      const chunks: unknown[] = [];
      for await (const chunk of client.chat({ model: "m", messages: [{ role: "user", content: "hi" }] })) {
        chunks.push(chunk);
      }
      expect(chunks.length).toBe(1);
      expect((chunks[0] as { toolCalls?: unknown }).toolCalls).toEqual([{ function: { name: "search", arguments: { q: "test" } } }]);
    } finally {
      server.stop(true);
    }
  });

  it("sends messages with role tool and tool_calls verbatim", async () => {
    const bodies: unknown[] = [];
    const server = fakeOllamaHttp(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/api/chat") {
        bodies.push(await req.json());
        return new Response(
          JSON.stringify({
            model: "m",
            created_at: "",
            message: { role: "assistant", content: "" },
            done: true,
            total_duration: 0,
            load_duration: 0,
            prompt_eval_count: 0,
            prompt_eval_duration: 0,
            eval_count: 0,
            eval_duration: 0,
          }) + "\n",
          { headers: { "Content-Type": "application/x-ndjson" } }
        );
      }
      if (url.pathname === "/api/show") {
        return new Response(JSON.stringify({ capabilities: [] }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    try {
      const client = new OllamaClient(`http://127.0.0.1:${server.port}`);
      const toolResult = { role: "tool" as const, tool_name: "search", content: "found something" };
      const assistantMsg = { role: "assistant" as const, content: "", tool_calls: [{ function: { name: "search", arguments: { q: "test" } } }] };
      await drain(
        client.chat({
          model: "m",
          messages: [
            { role: "user", content: "hi" },
            assistantMsg,
            toolResult,
          ],
        })
      );
      expect(bodies.length).toBe(1);
      expect((bodies[0] as { messages?: unknown[] }).messages).toEqual([
        { role: "user", content: "hi" },
        { role: "assistant", content: "", tool_calls: [{ function: { name: "search", arguments: { q: "test" } } }] },
        { role: "tool", tool_name: "search", content: "found something" },
      ]);
    } finally {
      server.stop(true);
    }
  });
});
