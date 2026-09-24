import { describe, it, expect } from "bun:test";
import { GenerationManager } from "./manager";
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
    const client = new OllamaClient();
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
  });
});
