import { describe, it, expect } from "bun:test";
import {
  ModelManager,
  OllamaDownError,
  UnknownModelError,
  OperationInProgressError,
  ConfirmationRequiredError,
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
  /** Per-model /api/show answers; a model absent here reports only "completion". */
  showResults = new Map<string, { capabilities?: string[] } | Error>();
  showCalls: string[] = [];

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

  async show(name: string): Promise<{ capabilities?: string[] }> {
    this.showCalls.push(name);
    const result = this.showResults.get(name) ?? { capabilities: ["completion"] };
    if (result instanceof Error) throw result;
    return result;
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

/**
 * A fake generation manager. `cancelActive()` records the cancel in `events`
 * (when given) and, unless `releasesOnCancel` is false, releases the active
 * slot a few milliseconds later - like the real manager, whose slot frees
 * only once its Ollama loop has noticed the abort.
 */
class FakeGenerations implements ModelManagerGenerations {
  cancelCalls = 0;
  releasesOnCancel = true;

  constructor(
    public active: Generation | null,
    private events?: string[]
  ) {}

  getActiveGeneration(): Generation | null {
    return this.active;
  }

  cancelActive(): boolean {
    if (this.active === null) return false;
    this.cancelCalls++;
    this.events?.push("cancel");
    if (this.releasesOnCancel) {
      setTimeout(() => {
        this.active = null;
        this.events?.push("released");
      }, 5);
    }
    return true;
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
      { name: "quirky-llama-9000", size_bytes: 123456, tools: false },
      { name: "another-oddball-model", size_bytes: 42, tools: false },
    ]);
  });

  describe("tools capability (M9)", () => {
    it("state() reports tools per model from /api/show capabilities", async () => {
      const ollama = new FakeOllama(
        { models: [tagModel("with-tools", 1), tagModel("without-tools", 2)] },
        { models: [] }
      );
      ollama.showResults.set("with-tools", { capabilities: ["completion", "tools"] });
      const manager = new ModelManager(ollama, new FakeGenerations(null));

      const state = await manager.state();

      expect(state.models).toEqual([
        { name: "with-tools", size_bytes: 1, tools: true },
        { name: "without-tools", size_bytes: 2, tools: false },
      ]);
    });

    it("a show failure makes only that model tools:false and state() still succeeds", async () => {
      const ollama = new FakeOllama(
        { models: [tagModel("good", 1), tagModel("broken", 2)] },
        { models: [] }
      );
      ollama.showResults.set("good", { capabilities: ["tools"] });
      ollama.showResults.set("broken", new Error("show exploded"));
      const manager = new ModelManager(ollama, new FakeGenerations(null));

      const state = await manager.state();

      expect(state.models.map((m) => [m.name, m.tools])).toEqual([
        ["good", true],
        ["broken", false],
      ]);
    });

    it("supportsTools is false when capabilities is missing", async () => {
      const ollama = new FakeOllama({ models: [] }, { models: [] });
      ollama.showResults.set("bare", {});
      const manager = new ModelManager(ollama, new FakeGenerations(null));

      expect(await manager.supportsTools("bare")).toBe(false);
    });

    it("supportsTools caches a success per model", async () => {
      const ollama = new FakeOllama({ models: [] }, { models: [] });
      ollama.showResults.set("m", { capabilities: ["tools"] });
      const manager = new ModelManager(ollama, new FakeGenerations(null));

      expect(await manager.supportsTools("m")).toBe(true);
      expect(await manager.supportsTools("m")).toBe(true);
      expect(ollama.showCalls).toEqual(["m"]);
    });

    it("supportsTools does not cache a failure", async () => {
      const ollama = new FakeOllama({ models: [] }, { models: [] });
      ollama.showResults.set("m", new Error("transient"));
      const manager = new ModelManager(ollama, new FakeGenerations(null));

      expect(await manager.supportsTools("m")).toBe(false);
      ollama.showResults.set("m", { capabilities: ["tools"] });
      expect(await manager.supportsTools("m")).toBe(true);
      expect(ollama.showCalls).toEqual(["m", "m"]);
    });
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

      const started = await manager.load("target", { confirm: true });
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

      await manager.load("target", { confirm: true });
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
      expect(state.operation.error_code).toBe("load_failed");
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
      expect(state.operation.error_code).toBe("unknown_model");
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
      expect(state.operation.error_code).toBe("ollama_down");
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
      expect(state.operation.error_code).toBe("load_failed");
      expect(ollama.calls.filter((c) => c.op === "unload" && c.name === "target").length).toBe(1);
    });
  });

  describe("unload()", () => {
    it("unloads every resident model, emptying ps", async () => {
      const ollama = new FakeOllama({ models: [] }, { models: [psProcess("model-a"), psProcess("model-b")] });
      const manager = new ModelManager(ollama, new FakeGenerations(null), FAST_TIMING);

      const started = await manager.unload({ confirm: true });
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

      await manager.unload({ confirm: true });
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

      await manager.unload({ confirm: true });
      await expect(manager.unload({ confirm: true })).rejects.toBeInstanceOf(OperationInProgressError);

      gate.release();
      await waitUntilIdle(manager);
    });

    it("two overlapping unload() calls (no await between) accept exactly one and run exactly one sweep", async () => {
      const ollama = new FakeOllama({ models: [] }, { models: [psProcess("resident-model")] });
      ollama.psDelayMs = 20;
      const manager = new ModelManager(ollama, new FakeGenerations(null), FAST_TIMING);

      const [first, second] = await Promise.allSettled([
        manager.unload({ confirm: true }),
        manager.unload({ confirm: true }),
      ]);

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

      const [loadResult, unloadResult] = await Promise.allSettled([
        manager.load("x", { confirm: true }),
        manager.unload({ confirm: true }),
      ]);

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

  describe("confirmation rule (M2c)", () => {
    const ACTIVE: Generation = { id: "gen-1", model: "model-a" };

    /** Runs `request` and returns the ConfirmationRequiredError it rejected with. */
    async function refusal(request: Promise<unknown>): Promise<ConfirmationRequiredError> {
      const result = await Promise.allSettled([request]);
      expect(result[0].status).toBe("rejected");
      const reason = (result[0] as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(ConfirmationRequiredError);
      return reason as ConfirmationRequiredError;
    }

    /** A manager that has itself loaded `name` (so it is resident and loaded_by_server). */
    async function managerThatLoaded(
      name: string,
      generations: FakeGenerations
    ): Promise<{ manager: ModelManager; ollama: FakeOllama }> {
      const ollama = new FakeOllama({ models: [tagModel(name, 1), tagModel("target", 2)] }, { models: [] });
      const manager = new ModelManager(ollama, generations, FAST_TIMING);
      await manager.load(name);
      await waitUntilIdle(manager);
      ollama.calls = [];
      return { manager, ollama };
    }

    const operations: Array<[string, (m: ModelManager, confirm?: boolean) => Promise<unknown>]> = [
      ["load", (m, confirm) => m.load("target", confirm === undefined ? undefined : { confirm })],
      ["unload", (m, confirm) => m.unload(confirm === undefined ? undefined : { confirm })],
    ];

    for (const [label, run] of operations) {
      it(`${label}: a reply in progress alone -> reasons ["reply_in_progress"], nothing changes`, async () => {
        const generations = new FakeGenerations(null);
        const { manager, ollama } = await managerThatLoaded("model-a", generations);
        generations.active = ACTIVE;

        const error = await refusal(run(manager));

        expect(error.reasons).toEqual(["reply_in_progress"]);
        expect(ollama.calls).toEqual([]);
        expect(generations.cancelCalls).toBe(0);
        expect(manager.isBusy()).toBe(false);
        const state = await manager.state();
        expect(state.operation).toEqual({ kind: "idle" });
        expect(state.resident).toEqual({ name: "model-a", loaded_by_server: true });
        expect(state.generation).toEqual(ACTIVE);
      });

      it(`${label}: a resident model not loaded by this server alone -> reasons ["not_loaded_by_server"]`, async () => {
        const ollama = new FakeOllama({ models: [tagModel("target", 1)] }, { models: [psProcess("someone-elses")] });
        const generations = new FakeGenerations(null);
        const manager = new ModelManager(ollama, generations, FAST_TIMING);

        const error = await refusal(run(manager, false));

        expect(error.reasons).toEqual(["not_loaded_by_server"]);
        expect(ollama.calls).toEqual([]);
        const state = await manager.state();
        expect(state.operation).toEqual({ kind: "idle" });
        expect(state.resident).toEqual({ name: "someone-elses", loaded_by_server: false });
      });

      it(`${label}: both situations -> both reasons, in contract order; the reply is not cancelled`, async () => {
        const ollama = new FakeOllama({ models: [tagModel("target", 1)] }, { models: [psProcess("someone-elses")] });
        const generations = new FakeGenerations(ACTIVE);
        const manager = new ModelManager(ollama, generations, FAST_TIMING);

        const error = await refusal(run(manager));

        expect(error.reasons).toEqual(["reply_in_progress", "not_loaded_by_server"]);
        expect(error.message.length).toBeGreaterThan(0);
        expect(ollama.calls).toEqual([]);
        expect(generations.cancelCalls).toBe(0);
        expect((await manager.state()).operation).toEqual({ kind: "idle" });
      });

      it(`${label}: nothing resident and no reply -> no confirmation needed`, async () => {
        const ollama = new FakeOllama({ models: [tagModel("target", 1)] }, { models: [] });
        const manager = new ModelManager(ollama, new FakeGenerations(null), FAST_TIMING);

        await run(manager);
        await waitUntilIdle(manager);
        expect((await manager.state()).operation.error).toBeUndefined();
      });

      it(`${label}: resident loaded by this server and no reply -> no confirmation needed`, async () => {
        const { manager } = await managerThatLoaded("model-a", new FakeGenerations(null));

        await run(manager);
        await waitUntilIdle(manager);
        expect((await manager.state()).operation.error).toBeUndefined();
      });

      it(`${label}: confirm:true with a reply in flight cancels it and waits for release before any Ollama unload/load`, async () => {
        const events: string[] = [];
        const ollama = new FakeOllama({ models: [tagModel("target", 1)] }, { models: [psProcess("someone-elses")] });
        ollama.loadImpl = async (name) => {
          events.push(`load:${name}`);
        };
        ollama.unloadImpl = async (name) => {
          events.push(`unload:${name}`);
        };
        const generations = new FakeGenerations(ACTIVE, events);
        const manager = new ModelManager(ollama, generations, FAST_TIMING);

        const started = await run(manager, true);
        expect((started as { kind: string }).kind).toBe(label === "load" ? "loading" : "unloading");
        await waitUntilIdle(manager);

        expect(generations.cancelCalls).toBe(1);
        expect(events.slice(0, 3)).toEqual(["cancel", "released", "unload:someone-elses"]);
        if (label === "load") {
          expect(events).toEqual(["cancel", "released", "unload:someone-elses", "load:target"]);
          expect((await manager.state()).resident).toEqual({ name: "target", loaded_by_server: true });
        } else {
          expect(events).toEqual(["cancel", "released", "unload:someone-elses"]);
          expect((await manager.state()).resident).toBeNull();
        }
        expect((await manager.state()).operation).toEqual({ kind: "idle" });
      });

      it(`${label}: while cancelling a confirmed reply the operation stays claimed`, async () => {
        const ollama = new FakeOllama({ models: [tagModel("target", 1)] }, { models: [] });
        const generations = new FakeGenerations(ACTIVE);
        generations.releasesOnCancel = false;
        const manager = new ModelManager(ollama, generations, { pollIntervalMs: 1, maxWaitMs: 60 });

        await run(manager, true);
        expect(manager.isBusy()).toBe(true);
        await expect(manager.load("target", { confirm: true })).rejects.toBeInstanceOf(OperationInProgressError);
        await expect(manager.unload({ confirm: true })).rejects.toBeInstanceOf(OperationInProgressError);

        // The slot never releases: bounded wait, then idle with a reason and no Ollama calls.
        await waitUntilIdle(manager);
        const state = await manager.state();
        expect(state.operation.kind).toBe("idle");
        expect(state.operation.error).toMatch(/reply/i);
        expect(ollama.calls).toEqual([]);
        expect(manager.isBusy()).toBe(false);
        if (label === "load") {
          expect(state.operation.error_code).toBe("load_failed");
        } else {
          expect(state.operation.error_code).toBeUndefined();
        }
      });
    }

    it("a non-true confirm (false) is unconfirmed", async () => {
      const ollama = new FakeOllama({ models: [tagModel("target", 1)] }, { models: [psProcess("someone-elses")] });
      const manager = new ModelManager(ollama, new FakeGenerations(null), FAST_TIMING);

      await refusal(manager.load("target", { confirm: false }));
      await refusal(manager.unload({ confirm: false }));
    });

    it("precedence: operation_in_progress beats confirmation_required", async () => {
      const ollama = new FakeOllama({ models: [tagModel("target", 1)] }, { models: [psProcess("someone-elses")] });
      const gate = makeGate();
      ollama.unloadImpl = async () => {
        await gate.wait;
      };
      const generations = new FakeGenerations(null);
      const manager = new ModelManager(ollama, generations, FAST_TIMING);

      await manager.unload({ confirm: true });
      generations.active = ACTIVE;
      await expect(manager.load("target")).rejects.toBeInstanceOf(OperationInProgressError);
      await expect(manager.unload()).rejects.toBeInstanceOf(OperationInProgressError);

      gate.release();
      await waitUntilIdle(manager);
    });

    it("precedence: ollama_down beats confirmation_required", async () => {
      const ollama = new FakeOllama({ models: [tagModel("target", 1)] }, new Error("ps down"));
      const manager = new ModelManager(ollama, new FakeGenerations(ACTIVE), FAST_TIMING);

      await expect(manager.load("target")).rejects.toBeInstanceOf(OllamaDownError);
      await expect(manager.unload()).rejects.toBeInstanceOf(OllamaDownError);
      expect(manager.isBusy()).toBe(false);
    });

    it("overlapping loads around the /api/ps await are never both accepted", async () => {
      const ollama = new FakeOllama({ models: [tagModel("a", 1), tagModel("b", 2)] }, { models: [] });
      ollama.psDelayMs = 20;
      const manager = new ModelManager(ollama, new FakeGenerations(null), FAST_TIMING);

      const results = await Promise.allSettled([manager.load("a"), manager.load("b")]);

      expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
      for (const r of results.filter((r) => r.status === "rejected")) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(OperationInProgressError);
      }
      await waitUntilIdle(manager);
      expect(ollama.calls.filter((c) => c.op === "load").length).toBe(1);
    });

    it("a request arriving during a refused request's /api/ps check is refused too, and the refusal leaves idle", async () => {
      const ollama = new FakeOllama({ models: [tagModel("target", 1)] }, { models: [psProcess("someone-elses")] });
      ollama.psDelayMs = 20;
      const manager = new ModelManager(ollama, new FakeGenerations(null), FAST_TIMING);

      const first = manager.load("target");
      await Bun.sleep(5);
      await expect(manager.unload({ confirm: true })).rejects.toBeInstanceOf(OperationInProgressError);
      await refusal(first);

      expect(ollama.calls).toEqual([]);
      expect(manager.isBusy()).toBe(false);
      expect((await manager.state()).operation).toEqual({ kind: "idle" });
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
