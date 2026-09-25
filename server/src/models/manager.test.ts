import { describe, it, expect } from "bun:test";
import {
  ModelManager,
  OllamaDownError,
  UnknownModelError,
  OperationInProgressError,
  type ModelManagerOllama,
  type ModelManagerGenerations,
} from "./manager";
import { OllamaError } from "../ollama/client";
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

/**
 * A fake Ollama dependency for ModelManager. `ps` is mutable and updated by
 * `load`/`unload` (mirroring real Ollama) so tests can assert on the
 * resulting resident set. `loadImpl`/`unloadImpl` let a test hold or fail an
 * in-flight load/unload; `calls` records the order of load/unload requests.
 */
class FakeOllama implements ModelManagerOllama {
  psModels: OllamaPsProcess[] = [];
  calls: Array<{ op: "load" | "unload"; name: string }> = [];
  loadImpl: (name: string) => Promise<void> = async () => {};
  unloadImpl: (name: string) => Promise<void> = async () => {};
  /** Injected latency so `tags()`/`ps()` really await, letting overlapping calls interleave. */
  tagsDelayMs = 0;
  psDelayMs = 0;

  constructor(
    private tagsResult: OllamaTagsResponse | Error,
    private psResult: OllamaPsResponse | Error
  ) {
    if (!(psResult instanceof Error)) {
      this.psModels = [...psResult.models];
    }
  }

  async tags(): Promise<OllamaTagsResponse> {
    if (this.tagsDelayMs > 0) await Bun.sleep(this.tagsDelayMs);
    if (this.tagsResult instanceof Error) throw this.tagsResult;
    return this.tagsResult;
  }

  async ps(): Promise<OllamaPsResponse> {
    if (this.psDelayMs > 0) await Bun.sleep(this.psDelayMs);
    if (this.psResult instanceof Error) throw this.psResult;
    return { models: [...this.psModels] };
  }

  async load(name: string): Promise<void> {
    this.calls.push({ op: "load", name });
    await this.loadImpl(name);
    if (!this.psModels.some((m) => m.name === name)) {
      this.psModels.push(psProcess(name));
    }
  }

  async unload(name: string): Promise<void> {
    this.calls.push({ op: "unload", name });
    await this.unloadImpl(name);
    this.psModels = this.psModels.filter((m) => m.name !== name);
  }
}

class FakeGenerations implements ModelManagerGenerations {
  constructor(private active: Generation | null) {}

  getActiveGeneration(): Generation | null {
    return this.active;
  }
}

/** Resolves once released; lets a test hold a background load/unload mid-flight. */
function makeGate(): { wait: Promise<void>; release: () => void } {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}

/** Fast timing so tests never sleep for real. */
const FAST_TIMING = { pollIntervalMs: 1, maxWaitMs: 200 };

/** Polls state() until operation.kind is "idle" or `timeoutMs` elapses. */
async function waitUntilIdle(manager: ModelManager, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await manager.state();
    if (state.operation.kind === "idle") return;
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for idle; operation was ${JSON.stringify(state.operation)}`);
    }
    await Bun.sleep(5);
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

  it("reports operation as idle when nothing is running", async () => {
    const ollama = new FakeOllama({ models: [] }, { models: [] });
    const manager = new ModelManager(ollama, new FakeGenerations(null));

    const state = await manager.state();

    expect(state.operation).toEqual({ kind: "idle" });
  });

  describe("load()", () => {
    it("swaps: unloads every other resident model, in order, then loads the target", async () => {
      const ollama = new FakeOllama(
        {
          models: [tagModel("model-a", 1), tagModel("model-b", 2), tagModel("model-c", 3), tagModel("target", 4)],
        },
        { models: [psProcess("model-a"), psProcess("model-b"), psProcess("model-c")] }
      );
      const manager = new ModelManager(ollama, new FakeGenerations(null), FAST_TIMING);

      const started = await manager.load("target");
      expect(started).toEqual({ kind: "loading", model: "target" });
      await waitUntilIdle(manager);

      expect(ollama.calls).toEqual([
        { op: "unload", name: "model-a" },
        { op: "unload", name: "model-b" },
        { op: "unload", name: "model-c" },
        { op: "load", name: "target" },
      ]);

      const state = await manager.state();
      expect(state.resident).toEqual({ name: "target", loaded_by_server: true });
    });

    it("loading the already-resident model does not unload it", async () => {
      const ollama = new FakeOllama({ models: [tagModel("target", 4)] }, { models: [psProcess("target")] });
      const manager = new ModelManager(ollama, new FakeGenerations(null), FAST_TIMING);

      await manager.load("target");
      await waitUntilIdle(manager);

      expect(ollama.calls).toEqual([{ op: "load", name: "target" }]);
    });

    it("state reports operation:loading while the load is held, then idle", async () => {
      const ollama = new FakeOllama({ models: [tagModel("target", 4)] }, { models: [] });
      const gate = makeGate();
      ollama.loadImpl = async () => {
        await gate.wait;
      };
      const manager = new ModelManager(ollama, new FakeGenerations(null), FAST_TIMING);

      await manager.load("target");
      const mid = await manager.state();
      expect(mid.operation).toEqual({ kind: "loading", model: "target" });

      gate.release();
      await waitUntilIdle(manager);

      const after = await manager.state();
      expect(after.operation).toEqual({ kind: "idle" });
    });

    it("rejects with UnknownModelError for a name not in /api/tags", async () => {
      const ollama = new FakeOllama({ models: [tagModel("model-a", 1)] }, { models: [] });
      const manager = new ModelManager(ollama, new FakeGenerations(null));

      await expect(manager.load("missing-model")).rejects.toBeInstanceOf(UnknownModelError);
    });

    it("rejects with OllamaDownError when /api/tags cannot be read", async () => {
      const ollama = new FakeOllama(new Error("boom"), { models: [] });
      const manager = new ModelManager(ollama, new FakeGenerations(null));

      await expect(manager.load("anything")).rejects.toBeInstanceOf(OllamaDownError);
    });

    it("rejects a second load with OperationInProgressError while one is running", async () => {
      const ollama = new FakeOllama(
        { models: [tagModel("model-a", 1), tagModel("model-b", 2)] },
        { models: [] }
      );
      const gate = makeGate();
      ollama.loadImpl = async () => {
        await gate.wait;
      };
      const manager = new ModelManager(ollama, new FakeGenerations(null), FAST_TIMING);

      await manager.load("model-a");
      await expect(manager.load("model-b")).rejects.toBeInstanceOf(OperationInProgressError);
      await expect(manager.unload()).rejects.toBeInstanceOf(OperationInProgressError);

      gate.release();
      await waitUntilIdle(manager);
    });

    it("a failed load leaves ps empty and reports a memory reason", async () => {
      const ollama = new FakeOllama({ models: [tagModel("target", 4)] }, { models: [] });
      ollama.loadImpl = async () => {
        throw new OllamaError(500, "model requires more system memory (8.0 GiB) than is available (4.0 GiB)");
      };
      const manager = new ModelManager(ollama, new FakeGenerations(null), FAST_TIMING);

      await manager.load("target");
      await waitUntilIdle(manager);

      const state = await manager.state();
      expect(state.resident).toBeNull();
      expect(state.operation.error?.startsWith("Not enough memory to load target")).toBe(true);
    });

    it("a failed load reports a not-found reason", async () => {
      const ollama = new FakeOllama({ models: [tagModel("target", 4)] }, { models: [] });
      ollama.loadImpl = async () => {
        throw new OllamaError(404, "model 'target' not found");
      };
      const manager = new ModelManager(ollama, new FakeGenerations(null), FAST_TIMING);

      await manager.load("target");
      await waitUntilIdle(manager);

      const state = await manager.state();
      expect(state.operation.error).toBe("Model not found: target");
    });

    it("a failed load from a network failure reports Ollama is unreachable", async () => {
      const ollama = new FakeOllama({ models: [tagModel("target", 4)] }, { models: [] });
      ollama.loadImpl = async () => {
        throw new TypeError("fetch failed");
      };
      const manager = new ModelManager(ollama, new FakeGenerations(null), FAST_TIMING);

      await manager.load("target");
      await waitUntilIdle(manager);

      const state = await manager.state();
      expect(state.operation.error).toBe("Ollama unreachable");
    });

    it("best-effort unloads the target if ps lists it after a failed load", async () => {
      const ollama = new FakeOllama({ models: [tagModel("target", 4)] }, { models: [] });
      ollama.loadImpl = async () => {
        // Simulate Ollama having loaded the model moments before a later failure.
        ollama.psModels.push(psProcess("target"));
        throw new OllamaError(500, "some other failure");
      };
      const manager = new ModelManager(ollama, new FakeGenerations(null), FAST_TIMING);

      await manager.load("target");
      await waitUntilIdle(manager);

      const state = await manager.state();
      expect(state.resident).toBeNull();
      expect(state.operation.error).toBe("Load failed: some other failure");
      expect(ollama.calls.filter((c) => c.op === "unload" && c.name === "target").length).toBe(1);
    });
  });

  describe("unload()", () => {
    it("unloads every resident model, emptying ps", async () => {
      const ollama = new FakeOllama({ models: [] }, { models: [psProcess("model-a"), psProcess("model-b")] });
      const manager = new ModelManager(ollama, new FakeGenerations(null), FAST_TIMING);

      const started = await manager.unload();
      expect(started).toEqual({ kind: "unloading", model: "model-a" });
      await waitUntilIdle(manager);

      const state = await manager.state();
      expect(state.resident).toBeNull();
      expect(ollama.calls.map((c) => c.name)).toEqual(["model-a", "model-b"]);
    });

    it("state reports operation:unloading while held, then idle", async () => {
      const ollama = new FakeOllama({ models: [] }, { models: [psProcess("resident-model")] });
      const gate = makeGate();
      ollama.unloadImpl = async () => {
        await gate.wait;
      };
      const manager = new ModelManager(ollama, new FakeGenerations(null), FAST_TIMING);

      await manager.unload();
      const mid = await manager.state();
      expect(mid.operation).toEqual({ kind: "unloading", model: "resident-model" });

      gate.release();
      await waitUntilIdle(manager);

      const after = await manager.state();
      expect(after.operation).toEqual({ kind: "idle" });
    });

    it("rejects a second unload with OperationInProgressError while one is running", async () => {
      const ollama = new FakeOllama({ models: [] }, { models: [psProcess("resident-model")] });
      const gate = makeGate();
      ollama.unloadImpl = async () => {
        await gate.wait;
      };
      const manager = new ModelManager(ollama, new FakeGenerations(null), FAST_TIMING);

      await manager.unload();
      await expect(manager.unload()).rejects.toBeInstanceOf(OperationInProgressError);

      gate.release();
      await waitUntilIdle(manager);
    });

    it("two overlapping unload() calls (no await between) accept exactly one and run exactly one sweep", async () => {
      const ollama = new FakeOllama({ models: [] }, { models: [psProcess("resident-model")] });
      ollama.psDelayMs = 20;
      const manager = new ModelManager(ollama, new FakeGenerations(null), FAST_TIMING);

      const [first, second] = await Promise.allSettled([manager.unload(), manager.unload()]);

      const results = [first, second];
      expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
      const rejected = results.filter((r) => r.status === "rejected");
      expect(rejected.length).toBe(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(OperationInProgressError);

      await waitUntilIdle(manager);

      expect(ollama.calls.filter((c) => c.op === "unload").length).toBe(1);
      const state = await manager.state();
      expect(state.resident).toBeNull();
    });

    it("overlapping load(x) and unload() (no await between) accept exactly one and leave consistent state", async () => {
      const ollama = new FakeOllama({ models: [tagModel("x", 1)] }, { models: [psProcess("other-model")] });
      ollama.tagsDelayMs = 20;
      ollama.psDelayMs = 20;
      const manager = new ModelManager(ollama, new FakeGenerations(null), FAST_TIMING);

      const [loadResult, unloadResult] = await Promise.allSettled([manager.load("x"), manager.unload()]);

      const results = [loadResult, unloadResult];
      expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
      const rejected = results.filter((r) => r.status === "rejected");
      expect(rejected.length).toBe(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(OperationInProgressError);

      await waitUntilIdle(manager);
      const state = await manager.state();

      if (loadResult.status === "fulfilled") {
        expect(unloadResult.status).toBe("rejected");
        expect(state.resident).toEqual({ name: "x", loaded_by_server: true });
      } else {
        expect(unloadResult.status).toBe("fulfilled");
        expect(state.resident).toBeNull();
      }
      expect(state.operation).toEqual({ kind: "idle" });
    });
  });

  describe("isBusy()", () => {
    it("reflects whether a load or unload is currently running", async () => {
      const ollama = new FakeOllama({ models: [tagModel("target", 4)] }, { models: [] });
      const gate = makeGate();
      ollama.loadImpl = async () => {
        await gate.wait;
      };
      const manager = new ModelManager(ollama, new FakeGenerations(null), FAST_TIMING);

      expect(manager.isBusy()).toBe(false);
      await manager.load("target");
      expect(manager.isBusy()).toBe(true);

      gate.release();
      await waitUntilIdle(manager);
      expect(manager.isBusy()).toBe(false);
    });
  });
});
