import { describe, it, expect } from "bun:test";
import { GenerationManager, type OllamaChatClient } from "./manager";
import type { OllamaChatResponse } from "../ollama/client";
import { OllamaClient } from "../ollama/client";

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
});
