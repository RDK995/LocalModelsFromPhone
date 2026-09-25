import { describe, it, expect } from "bun:test";
import { ModelManager, OllamaDownError, type ModelManagerOllama, type ModelManagerGenerations } from "./manager";
import type { OllamaTagsResponse, OllamaPsResponse, OllamaModel, OllamaPsProcess } from "../ollama/client";
import type { Generation } from "@shared/api";

/** Builds an /api/tags model entry with arbitrary, made-up fields. */
function tagModel(name: string, size: number): OllamaModel {
  return { name, modified_at: "2024-01-01T00:00:00Z", size, digest: `digest-${name}` };
}

/** Builds an /api/ps process entry reporting `name` as resident. */
function psProcess(name: string): OllamaPsProcess {
  return {
    name,
    model: name,
    size: 1,
    digest: `digest-${name}`,
    details: { family: "", parameter_size: "", quantization_level: "" },
    expires_at: "",
    size_vram: 0,
  };
}

class FakeOllama implements ModelManagerOllama {
  constructor(
    private tagsResult: OllamaTagsResponse | Error,
    private psResult: OllamaPsResponse | Error
  ) {}

  async tags(): Promise<OllamaTagsResponse> {
    if (this.tagsResult instanceof Error) throw this.tagsResult;
    return this.tagsResult;
  }

  async ps(): Promise<OllamaPsResponse> {
    if (this.psResult instanceof Error) throw this.psResult;
    return this.psResult;
  }
}

class FakeGenerations implements ModelManagerGenerations {
  constructor(private active: Generation | null) {}

  getActiveGeneration(): Generation | null {
    return this.active;
  }
}

describe("ModelManager", () => {
  it("maps state().models verbatim from an arbitrary tags list, in order", async () => {
    const ollama = new FakeOllama(
      { models: [tagModel("quirky-llama-9000", 123456), tagModel("another-oddball-model", 42)] },
      { models: [] }
    );
    const manager = new ModelManager(ollama, new FakeGenerations(null));

    const state = await manager.state();

    expect(state.models).toEqual([
      { name: "quirky-llama-9000", size_bytes: 123456 },
      { name: "another-oddball-model", size_bytes: 42 },
    ]);
  });

  it("reports resident with loaded_by_server:false for a model the server never loaded", async () => {
    const ollama = new FakeOllama({ models: [] }, { models: [psProcess("someone-elses-model")] });
    const manager = new ModelManager(ollama, new FakeGenerations(null));

    const state = await manager.state();

    expect(state.resident).toEqual({ name: "someone-elses-model", loaded_by_server: false });
  });

  it("reports resident:null when ps() lists nothing", async () => {
    const ollama = new FakeOllama({ models: [] }, { models: [] });
    const manager = new ModelManager(ollama, new FakeGenerations(null));

    const state = await manager.state();

    expect(state.resident).toBeNull();
  });

  it("rejects with OllamaDownError when tags() throws", async () => {
    const ollama = new FakeOllama(new Error("tags failed"), { models: [] });
    const manager = new ModelManager(ollama, new FakeGenerations(null));

    await expect(manager.state()).rejects.toBeInstanceOf(OllamaDownError);
  });

  it("rejects with OllamaDownError when ps() throws", async () => {
    const ollama = new FakeOllama({ models: [] }, new Error("ps failed"));
    const manager = new ModelManager(ollama, new FakeGenerations(null));

    await expect(manager.state()).rejects.toBeInstanceOf(OllamaDownError);
  });

  it("passes through the generation manager's active generation", async () => {
    const ollama = new FakeOllama({ models: [] }, { models: [] });
    const active: Generation = { id: "gen-1", model: "quirky-llama-9000" };
    const manager = new ModelManager(ollama, new FakeGenerations(active));

    const state = await manager.state();

    expect(state.generation).toEqual(active);
  });

  it("passes through null when there is no active generation", async () => {
    const ollama = new FakeOllama({ models: [] }, { models: [] });
    const manager = new ModelManager(ollama, new FakeGenerations(null));

    const state = await manager.state();

    expect(state.generation).toBeNull();
  });

  it("always reports operation as idle", async () => {
    const ollama = new FakeOllama({ models: [] }, { models: [] });
    const manager = new ModelManager(ollama, new FakeGenerations(null));

    const state = await manager.state();

    expect(state.operation).toEqual({ kind: "idle" });
  });
});
