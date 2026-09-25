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
});
