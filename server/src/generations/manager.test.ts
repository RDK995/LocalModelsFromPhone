import { describe, it, expect } from "bun:test";
import { GenerationManager, type GenerationWebTools, type OllamaChatClient } from "./manager";
import type { OllamaChatRequest, OllamaChatResponse, OllamaToolCall, OllamaTool } from "../ollama/client";
import type { WebEvent, WebToolCall } from "../web/tools";
import { OllamaClient } from "../ollama/client";
import type { ResearchWebTools } from "./research";

describe("GenerationManager", () => {
  it("should create an instance", () => {
    const client = new OllamaClient();
    const manager = new GenerationManager(client);
    expect(manager).toBeDefined();
  });

  it("should track active generation", async () => {
    const client = new OllamaClient();
    const manager = new GenerationManager(client);

    expect(manager.getActiveGenId()).toBeNull();
    expect(manager.isGenerationActive("gen-1")).toBe(false);
  });

  it("should check if event log exists", () => {
    const client = new OllamaClient();
    const manager = new GenerationManager(client);

    expect(manager.hasEventLog("gen-1")).toBe(false);
  });

  it("should get empty event log for non-existent generation", () => {
    const client = new OllamaClient();
    const manager = new GenerationManager(client);

    const log = manager.getEventLog("gen-1");
    expect(log).toEqual([]);
  });

  it("should cancel a non-existent generation gracefully", () => {
    const client = new OllamaClient();
    const manager = new GenerationManager(client);

    const result = manager.cancelGeneration("gen-1");
    expect(result).toBe(false);
  });

  it("should prevent concurrent generations", () => {
    // A fake that never finishes, so no request reaches a real Ollama.
    const client: OllamaChatClient = {
      async *chat(_request, signal) {
        await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve()));
      },
    };
    const manager = new GenerationManager(client);

    const request = {
      model: "test",
      messages: [{ role: "user" as const, content: "hello" }],
    };

    // Start first generation
    const gen1 = manager.startGeneration("gen-1", request);

    // Immediately try to start another (synchronously, before first connects)
    // This should throw an error
    let caughtError: Error | null = null;
    try {
      const gen2 = manager.startGeneration("gen-2", request);
    } catch (e) {
      caughtError = e as Error;
    }

    expect(caughtError).toBeDefined();
    expect(caughtError?.message.includes("Generation already in progress")).toBe(true);
    manager.cancelGeneration("gen-1");
  });

  function doneChunk(content: string, done: boolean): OllamaChatResponse {
    return {
      model: "test",
      created_at: "",
      message: { role: "assistant", content },
      done,
      total_duration: 0,
      load_duration: 0,
      prompt_eval_count: 0,
      prompt_eval_duration: 0,
      eval_count: 7,
      eval_duration: 500_000_000,
    };
  }

  function thinkingChunk(thinking: string, content: string, done: boolean): OllamaChatResponse {
    return {
      ...doneChunk(content, done),
      message: { role: "assistant", content, thinking },
    };
  }

  it("runs a generation to completion with no subscriber and releases the active slot", async () => {
    let seenRequest: unknown;
    const client: OllamaChatClient = {
      async *chat(request) {
        seenRequest = request;
        yield doneChunk("a", false);
        yield doneChunk("", true);
      },
    };
    const manager = new GenerationManager(client);
    manager.startGeneration("gen-1", {
      model: "test",
      messages: [{ role: "user", content: "hello", extra: 1 } as never],
    });
    expect(manager.getActiveGeneration()).toEqual({ id: "gen-1", model: "test" });

    const events = [];
    for await (const e of manager.subscribe("gen-1")) events.push(e);

    expect(seenRequest).toEqual({ model: "test", messages: [{ role: "user", content: "hello" }] });
    expect(events.map((e) => e.type)).toEqual(["content", "done"]);
    expect(JSON.parse(events[1].data)).toEqual({
      status: "complete",
      model: "test",
      eval_count: 7,
      tokens_per_second: 14,
    });
    expect(manager.getActiveGenId()).toBeNull();
    expect(manager.cancelGeneration("gen-1")).toBe(false);
  });

  it("emits a thinking event before content for a chunk carrying both, replayable with correct seqs", async () => {
    const client: OllamaChatClient = {
      async *chat() {
        yield thinkingChunk("pondering", "", false);
        yield thinkingChunk("more thought", "hello", false);
        yield doneChunk("", true);
      },
    };
    const manager = new GenerationManager(client);
    manager.startGeneration("gen-1", { model: "test", messages: [] });

    const events = [];
    for await (const e of manager.subscribe("gen-1")) events.push(e);

    expect(events.map((e) => e.type)).toEqual(["thinking", "thinking", "content", "done"]);
    expect(events.map((e) => e.seq)).toEqual([0, 1, 2, 3]);
    expect(JSON.parse(events[0].data)).toEqual({ text: "pondering" });
    expect(JSON.parse(events[1].data)).toEqual({ text: "more thought" });
    expect(JSON.parse(events[2].data)).toEqual({ text: "hello" });
    // eval_count comes from the final chunk's eval_count (7), unaffected by
    // thinking chunks; only one chunk carried content.
    expect(JSON.parse(events[3].data)).toEqual({
      status: "complete",
      model: "test",
      eval_count: 7,
      tokens_per_second: 14,
    });

    // Replay from a middle seq returns exactly the events at/after it, with
    // their original seqs intact.
    const replay = manager.getEventLog("gen-1", 2);
    expect(replay.map((e) => ({ seq: e.seq, type: e.type }))).toEqual([
      { seq: 2, type: "content" },
      { seq: 3, type: "done" },
    ]);
  });

  it("cancel stops a generation whose chat stream ignores the abort signal", async () => {
    const client: OllamaChatClient = {
      async *chat() {
        yield doneChunk("a", false);
        await new Promise(() => {});
      },
    };
    const manager = new GenerationManager(client);
    manager.startGeneration("gen-1", { model: "test", messages: [] });

    const events = [];
    for await (const e of manager.subscribe("gen-1")) {
      events.push(e);
      if (e.type === "content") expect(manager.cancelGeneration("gen-1")).toBe(true);
    }

    expect(events.map((e) => e.type)).toEqual(["content", "done"]);
    expect(JSON.parse(events[1].data).status).toBe("cancelled");
    expect(manager.getActiveGenId()).toBeNull();
  });

  it("cancelActive cancels the active generation, and returns false when none is active", async () => {
    const client: OllamaChatClient = {
      async *chat() {
        yield doneChunk("a", false);
        await new Promise(() => {});
      },
    };
    const manager = new GenerationManager(client);
    expect(manager.cancelActive()).toBe(false);

    manager.startGeneration("gen-1", { model: "test", messages: [] });
    const events = [];
    for await (const e of manager.subscribe("gen-1")) {
      events.push(e);
      if (e.type === "content") expect(manager.cancelActive()).toBe(true);
    }

    expect(JSON.parse(events[events.length - 1].data).status).toBe("cancelled");
    expect(manager.getActiveGeneration()).toBeNull();
    expect(manager.cancelActive()).toBe(false);
  });

  describe("web tool loop (M9)", () => {
    const TOOLS: OllamaTool[] = [
      { type: "function", function: { name: "web_search", description: "d", parameters: {} } },
    ];

    function call(name: string, args: Record<string, unknown> = { query: "q" }): OllamaToolCall {
      return { function: { name, arguments: args } };
    }

    function callChunk(calls: OllamaToolCall[], content = ""): OllamaChatResponse & { toolCalls: OllamaToolCall[] } {
      return {
        ...doneChunk(content, false),
        message: { role: "assistant", content, tool_calls: calls },
        toolCalls: calls,
      };
    }

    class FakeWebTools implements GenerationWebTools {
      toolsCalls = 0;
      noteCalls = 0;
      executed: WebToolCall[] = [];
      /** Overridable per test. */
      onExecute: (c: WebToolCall, n: number, signal: AbortSignal) => Promise<{ toolResult: string; events: WebEvent[] }> =
        async (_c, n) => ({
          toolResult: `result-${n}`,
          events: [
            { type: "step", data: { step_id: `s${n}`, kind: "search", status: "started", query: "q" } },
            { type: "step", data: { step_id: `s${n}`, kind: "search", status: "done", query: "q" } },
            { type: "source", data: { title: `T${n}`, url: `http://x/${n}` } },
          ],
        });
      tools(): OllamaTool[] {
        this.toolsCalls++;
        return TOOLS;
      }
      systemNote(_now: Date): string {
        this.noteCalls++;
        return "NOTE: today is a date";
      }
      execute(c: WebToolCall, signal: AbortSignal) {
        this.executed.push(c);
        return this.onExecute(c, this.executed.length, signal);
      }
      get totalCalls(): number {
        return this.toolsCalls + this.noteCalls + this.executed.length;
      }
    }

    type Seen = { request: OllamaChatRequest; tools: OllamaTool[] | undefined };

    function scripted(
      rounds: (round: number, tools: OllamaTool[] | undefined) => OllamaChatResponse[]
    ): { client: OllamaChatClient; seen: Seen[] } {
      const seen: Seen[] = [];
      const client: OllamaChatClient = {
        async *chat(request, _signal, tools) {
          // Snapshot: the manager keeps appending to its messages array.
          seen.push({ request: { ...request, messages: request.messages.map((m) => ({ ...m })) }, tools });
          for (const c of rounds(seen.length - 1, tools)) yield c;
        },
      };
      return { client, seen };
    }

    async function collect(manager: GenerationManager, id = "gen-1") {
      const events = [];
      for await (const e of manager.subscribe(id)) events.push(e);
      return events;
    }

    const userMessages = [{ role: "user" as const, content: "hello" }];

    it("web absent or false: no tools argument, no system message, web tools never called", async () => {
      for (const web of [undefined, false]) {
        const { client, seen } = scripted(() => [doneChunk("hi", false), doneChunk("", true)]);
        const web_ = new FakeWebTools();
        const manager = new GenerationManager(client, web_);
        manager.startGeneration("gen-1", { model: "test", messages: userMessages, ...(web === undefined ? {} : { web }) });
        const events = await collect(manager);

        expect(seen).toHaveLength(1);
        expect(seen[0].tools).toBeUndefined();
        expect(seen[0].request).toEqual({ model: "test", messages: [{ role: "user", content: "hello" }] });
        expect(web_.totalCalls).toBe(0);
        expect(events.map((e) => e.type)).toEqual(["content", "done"]);
      }
    });

    it("web:true, one search then an answer: note first, tools offered, step events, sources before done", async () => {
      const { client, seen } = scripted((round) =>
        round === 0
          ? [callChunk([call("web_search")], "let me look"), doneChunk("", true)]
          : [doneChunk("the answer", false), doneChunk("", true)]
      );
      const web_ = new FakeWebTools();
      const manager = new GenerationManager(client, web_);
      manager.startGeneration("gen-1", { model: "test", messages: userMessages, web: true });
      const events = await collect(manager);

      expect(seen).toHaveLength(2);
      expect(seen[0].request.messages).toEqual([
        { role: "system", content: "NOTE: today is a date" },
        { role: "user", content: "hello" },
      ]);
      expect(seen[0].tools).toEqual(TOOLS);
      const second = seen[1].request.messages;
      expect(second[2]).toEqual({ role: "assistant", content: "let me look", tool_calls: [call("web_search")] });
      expect(second[3]).toEqual({ role: "tool", tool_name: "web_search", content: "result-1" });

      expect(events.map((e) => e.type)).toEqual(["content", "step", "step", "content", "sources", "done"]);
      const steps = events.filter((e) => e.type === "step").map((e) => JSON.parse(e.data));
      expect(steps[0].status).toBe("started");
      expect(steps[1].status).toBe("done");
      expect(steps[0].step_id).toBe(steps[1].step_id);
      expect(JSON.parse(events[3].data)).toEqual({ text: "the answer" });
      expect(JSON.parse(events[4].data)).toEqual({ items: [{ title: "T1", url: "http://x/1" }] });
      expect(JSON.parse(events[5].data).status).toBe("complete");
      expect(manager.getActiveGenId()).toBeNull();
    });

    it("caps a reply at 10 tool calls and withdraws the tools for the answer", async () => {
      const { client, seen } = scripted((_round, tools) =>
        tools ? [callChunk([call("web_search")]), doneChunk("", true)] : [doneChunk("final", false), doneChunk("", true)]
      );
      const web_ = new FakeWebTools();
      const manager = new GenerationManager(client, web_);
      manager.startGeneration("gen-1", { model: "test", messages: userMessages, web: true });
      const events = await collect(manager);

      expect(web_.executed).toHaveLength(10);
      expect(seen).toHaveLength(11);
      expect(seen[10].tools).toBeUndefined();
      expect(seen.slice(0, 10).every((s) => s.tools !== undefined)).toBe(true);
      const contents = events.filter((e) => e.type === "content").map((e) => JSON.parse(e.data).text);
      expect(contents).toEqual(["final"]);
      expect(events[events.length - 2].type).toBe("sources");
      expect(JSON.parse(events[events.length - 1].data).status).toBe("complete");
    });

    it("executes only the calls within the budget in one round; the surplus gets the limit message", async () => {
      const { client, seen } = scripted((round, tools) => {
        if (round === 0) return [callChunk(Array.from({ length: 12 }, () => call("web_search"))), doneChunk("", true)];
        return tools ? [doneChunk("x", false), doneChunk("", true)] : [doneChunk("final", false), doneChunk("", true)];
      });
      const web_ = new FakeWebTools();
      const manager = new GenerationManager(client, web_);
      manager.startGeneration("gen-1", { model: "test", messages: userMessages, web: true });
      const events = await collect(manager);

      expect(web_.executed).toHaveLength(10);
      expect(events.filter((e) => e.type === "step")).toHaveLength(20);
      const msgs = seen[1].request.messages;
      const tools = msgs.filter((m) => m.role === "tool");
      expect(tools).toHaveLength(12);
      expect(tools[9].content).toBe("result-10");
      expect(tools[10].content.toLowerCase()).toContain("limit");
      expect(tools[11].content.toLowerCase()).toContain("limit");
      expect(seen[1].tools).toBeUndefined();
      expect(JSON.parse(events[events.length - 1].data).status).toBe("complete");
    });

    it("deduplicates sources by url in first-occurrence order", async () => {
      const { client } = scripted((round) =>
        round === 0
          ? [callChunk([call("web_search"), call("web_search")]), doneChunk("", true)]
          : [doneChunk("a", false), doneChunk("", true)]
      );
      const web_ = new FakeWebTools();
      web_.onExecute = async (_c, n) => ({
        toolResult: "r",
        events: [
          { type: "source", data: { title: "B", url: "http://b" } },
          { type: "source", data: { title: n === 1 ? "A" : "A2", url: "http://a" } },
          { type: "source", data: { title: "B again", url: "http://b" } },
        ],
      });
      const manager = new GenerationManager(client, web_);
      manager.startGeneration("gen-1", { model: "test", messages: userMessages, web: true });
      const events = await collect(manager);
      const sources = events.find((e) => e.type === "sources")!;
      expect(JSON.parse(sources.data)).toEqual({
        items: [
          { title: "B", url: "http://b" },
          { title: "A", url: "http://a" },
        ],
      });
    });

    it("numbers each distinct page read in first-read order and carries n on sources (FR31)", async () => {
      const { client, seen } = scripted((round) =>
        round === 0
          ? [callChunk([call("web_search"), call("read_page", { url: "http://r/x" }), call("read_page", { url: "http://r/x" }), call("read_page", { url: "http://r/redir" }), call("read_page", { url: "http://b" })])]
          : [doneChunk("ok", false), doneChunk("", true)]
      );
      const web_ = new FakeWebTools();
      web_.execute = (c: WebToolCall, signal: AbortSignal, numberPage?: (u: string) => number) => {
        web_.executed.push(c);
        const args = c.function.arguments as { url?: string };
        if (c.function.name === "web_search") {
          return Promise.resolve({
            toolResult: "1. A\n   http://b",
            events: [
              { type: "source", data: { title: "B", url: "http://b" } },
              { type: "source", data: { title: "S", url: "http://s" } },
            ] as WebEvent[],
          });
        }
        const finalUrl = args.url === "http://r/redir" ? "http://r/final" : args.url!;
        const n = numberPage!(finalUrl);
        return Promise.resolve({
          toolResult: `Page [${n}]\nURL: ${finalUrl}`,
          events: [{ type: "source", data: { title: `T ${finalUrl}`, url: finalUrl, n } }] as WebEvent[],
        });
      };
      const manager = new GenerationManager(client, web_);
      manager.startGeneration("gen-1", { model: "test", messages: userMessages, web: true });
      const events = await collect(manager);
      const sources = JSON.parse(events.find((e) => e.type === "sources")!.data);
      expect(sources.items).toEqual([
        { title: "B", url: "http://b", n: 3 },
        { title: "S", url: "http://s" },
        { title: "T http://r/x", url: "http://r/x", n: 1 },
        { title: "T http://r/final", url: "http://r/final", n: 2 },
      ]);
      const toolMsgs = seen[1].request.messages.filter((m) => m.role === "tool").map((m) => m.content);
      expect(toolMsgs[1]).toContain("[1]");
      expect(toolMsgs[2]).toContain("[1]");
      expect(toolMsgs[3]).toContain("[2]");
      expect(toolMsgs[4]).toContain("[3]");
    });

    it("web:true with no tool call emits no sources event", async () => {
      const { client } = scripted(() => [doneChunk("plain", false), doneChunk("", true)]);
      const manager = new GenerationManager(client, new FakeWebTools());
      manager.startGeneration("gen-1", { model: "test", messages: userMessages, web: true });
      const events = await collect(manager);
      expect(events.map((e) => e.type)).toEqual(["content", "done"]);
    });

    it("cancel during execute ends in done cancelled and releases the slot", async () => {
      const { client } = scripted(() => [callChunk([call("web_search")]), doneChunk("", true)]);
      const web_ = new FakeWebTools();
      let started!: () => void;
      const executing = new Promise<void>((r) => (started = r));
      web_.onExecute = (_c, _n, signal) =>
        new Promise((_resolve, reject) => {
          started();
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        });
      const manager = new GenerationManager(client, web_);
      manager.startGeneration("gen-1", { model: "test", messages: userMessages, web: true });
      await executing;
      expect(manager.cancelGeneration("gen-1")).toBe(true);
      const events = await collect(manager);

      expect(events[events.length - 1].type).toBe("done");
      expect(JSON.parse(events[events.length - 1].data).status).toBe("cancelled");
      expect(manager.getActiveGenId()).toBeNull();
    });

    it("an execute failure that is not an abort ends in error with no sources", async () => {
      const { client } = scripted(() => [callChunk([call("web_search")]), doneChunk("", true)]);
      const web_ = new FakeWebTools();
      web_.onExecute = async () => {
        throw new Error("boom");
      };
      const manager = new GenerationManager(client, web_);
      manager.startGeneration("gen-1", { model: "test", messages: userMessages, web: true });
      const events = await collect(manager);
      expect(events.map((e) => e.type)).toEqual(["error"]);
    });
  });
});

describe("GenerationManager deep research Stop (M19 FR38)", () => {
  function hangingResearch() {
    const client: OllamaChatClient = {
      async *chat(_request, signal) {
        await new Promise<void>((_, reject) => {
          const fail = () => reject(signal?.reason ?? new DOMException("aborted", "AbortError"));
          if (signal?.aborted) fail();
          else signal?.addEventListener("abort", fail, { once: true });
        });
      },
    };
    const web: GenerationWebTools & Partial<ResearchWebTools> = {
      tools: () => [],
      systemNote: () => "",
      execute: async () => ({ toolResult: "", events: [] }),
      search: async () => ({ results: [], events: [] }),
      read: async () => ({ page: null, events: [] }),
    };
    return new GenerationManager(client, web, { stopWriteMs: 60_000 });
  }

  it("cancelActive aborts a deep research run hard at once, ending it cancelled", async () => {
    const manager = hangingResearch();
    manager.startGeneration("gen-r", { model: "test", messages: [{ role: "user", content: "q" }], web: true, deep_research: true } as any);
    await new Promise((r) => setTimeout(r, 20));
    const t0 = Date.now();
    expect(manager.cancelActive()).toBe(true);
    const events = [];
    for await (const e of manager.subscribe("gen-r")) events.push(e);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(JSON.parse(events[events.length - 1].data).status).toBe("cancelled");
    expect(events.some((e) => e.type === "content")).toBe(false);
    expect(manager.getActiveGeneration()).toBeNull();
  });

  it("cancelGeneration on a deep research run: the first call is the wrap-up Stop (run ends partial, not cancelled)", async () => {
    const manager = hangingResearch();
    manager.startGeneration("gen-r", { model: "test", messages: [{ role: "user", content: "q" }], web: true, deep_research: true } as any);
    await new Promise((r) => setTimeout(r, 20));
    expect(manager.cancelGeneration("gen-r")).toBe(true);
    const events = [];
    for await (const e of manager.subscribe("gen-r")) events.push(e);
    const done = JSON.parse(events[events.length - 1].data);
    expect(done.status).toBe("complete");
    expect(done.research.status).toBe("partial");
    expect(manager.cancelGeneration("gen-r")).toBe(false);
  });
});
