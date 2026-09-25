/**
 * Model manager (C5, I6) - reports installed and resident Ollama models, and
 * performs swap-load and unload (FR3-FR6) as asynchronous background
 * operations tracked in `state().operation`.
 */

import { OllamaError } from "../ollama/client";
import type { OllamaTagsResponse, OllamaPsResponse } from "../ollama/client";
import type { StateResponse, Generation, Operation } from "@shared/api";

/**
 * The subset of OllamaClient that ModelManager depends on. Declared as an
 * interface (rather than importing the concrete class) so tests can inject a
 * fake without satisfying OllamaClient's private fields.
 */
export interface ModelManagerOllama {
  tags(): Promise<OllamaTagsResponse>;
  ps(): Promise<OllamaPsResponse>;
  load(name: string): Promise<void>;
  unload(name: string): Promise<void>;
}

/**
 * The subset of GenerationManager that ModelManager depends on, for the
 * `generation` field of the state response.
 */
export interface ModelManagerGenerations {
  getActiveGeneration(): Generation | null;
}

/** How ModelManager waits for a background operation without sleeping in tests. */
export interface ModelManagerTiming {
  /** How often to poll /api/ps while waiting for unloads to clear. */
  pollIntervalMs: number;
  /** Maximum time to wait for unloads to clear before giving up. */
  maxWaitMs: number;
}

const DEFAULT_TIMING: ModelManagerTiming = {
  pollIntervalMs: 500,
  maxWaitMs: 30_000,
};

/** Ollama's /api/tags or /api/ps was unreachable or errored. */
export class OllamaDownError extends Error {
  constructor(message: string = "Unable to reach Ollama") {
    super(message);
    this.name = "OllamaDownError";
  }
}

/** `load(name)` was called with a name that /api/tags does not list. */
export class UnknownModelError extends Error {
  constructor(name: string) {
    super(`Unknown model: ${name}`);
    this.name = "UnknownModelError";
  }
}

/** A load or unload was requested while one was already running. */
export class OperationInProgressError extends Error {
  constructor(message: string = "A model operation is already in progress") {
    super(message);
    this.name = "OperationInProgressError";
  }
}

/** Waiting for /api/ps to report resident models cleared timed out. */
class WaitTimeoutError extends Error {}

/**
 * Map a failure from the background load/unload loop to the plain-language
 * reason that ends up in `operation.error`:
 * - a network failure (fetch rejecting; not an OllamaError) -> "Ollama unreachable"
 * - an OllamaError with status 404 or an "not found" message -> "Model not found: <name>"
 * - an OllamaError whose message mentions memory (case-insensitive) -> a memory reason
 * - anything else -> "<elseVerb> failed: <message>"
 */
function reasonForError(error: unknown, name: string, elseVerb: "Load" | "Unload"): string {
  if (error instanceof OllamaError) {
    if (error.status === 404 || /not found/i.test(error.message)) {
      return `Model not found: ${name}`;
    }
    if (/memory/i.test(error.message)) {
      return `Not enough memory to load ${name}: ${error.message}`;
    }
    return `${elseVerb} failed: ${error.message}`;
  }
  if (error instanceof WaitTimeoutError) {
    return `${elseVerb} failed: ${error.message}`;
  }
  return "Ollama unreachable";
}

export class ModelManager {
  private operation: Operation = { kind: "idle" };
  private loadedByServer: string | null = null;
  private readonly timing: ModelManagerTiming;

  constructor(
    private ollama: ModelManagerOllama,
    private generations: ModelManagerGenerations,
    timing: Partial<ModelManagerTiming> = {}
  ) {
    this.timing = { ...DEFAULT_TIMING, ...timing };
  }

  /** Whether a load or unload is currently running. */
  isBusy(): boolean {
    return this.operation.kind !== "idle";
  }

  /**
   * Every model installed in Ollama (from /api/tags, in order, real name and
   * size), the true resident model from /api/ps (or null when nothing is
   * loaded), the current load/unload operation, and the active generation.
   * `resident.loaded_by_server` is true exactly when the resident name
   * equals the model this manager itself last loaded.
   */
  async state(): Promise<StateResponse> {
    let tags: OllamaTagsResponse;
    let ps: OllamaPsResponse;
    try {
      tags = await this.ollama.tags();
      ps = await this.ollama.ps();
    } catch {
      throw new OllamaDownError();
    }

    const models = tags.models.map((m) => ({ name: m.name, size_bytes: m.size }));
    const resident =
      ps.models.length > 0
        ? { name: ps.models[0].name, loaded_by_server: ps.models[0].name === this.loadedByServer }
        : null;

    return {
      models,
      resident,
      operation: this.operation,
      generation: this.generations.getActiveGeneration(),
    };
  }

  /**
   * Start a swap-load of `name`: validate it, then (synchronously) mark the
   * operation as loading and return it. In the background: unload every
   * resident model other than `name`, wait for them to clear /api/ps, then
   * load `name` with keep_alive:-1. Never rejects after it returns; failures
   * land in `operation.error`.
   */
  async load(name: string): Promise<Operation> {
    let tags: OllamaTagsResponse;
    try {
      tags = await this.ollama.tags();
    } catch {
      throw new OllamaDownError();
    }
    if (!tags.models.some((m) => m.name === name)) {
      throw new UnknownModelError(name);
    }
    if (this.isBusy()) {
      throw new OperationInProgressError();
    }

    this.operation = { kind: "loading", model: name };
    const started = this.operation;
    void this.runLoad(name);
    return started;
  }

  private async runLoad(name: string): Promise<void> {
    try {
      let ps: OllamaPsResponse;
      try {
        ps = await this.ollama.ps();
      } catch {
        throw new OllamaDownError();
      }

      const toUnload = ps.models.map((m) => m.name).filter((n) => n !== name);
      for (const residentName of toUnload) {
        await this.ollama.unload(residentName);
      }
      if (toUnload.length > 0) {
        await this.waitUntilCleared(toUnload);
      }

      await this.ollama.load(name);
      this.loadedByServer = name;
      this.operation = { kind: "idle" };
    } catch (error) {
      this.loadedByServer = null;
      await this.bestEffortUnload(name);
      this.operation = { kind: "idle", model: name, error: reasonForError(error, name, "Load") };
    }
  }

  /**
   * Start an unload of every resident model. Synchronously marks the
   * operation as unloading (with the current resident's name, if any known)
   * and returns it; the background sweep never rejects after that.
   */
  async unload(): Promise<Operation> {
    if (this.isBusy()) {
      throw new OperationInProgressError();
    }

    // Claim the operation synchronously, in the same tick as the isBusy()
    // check above, before any await. Otherwise a second call arriving
    // during the ps() lookup below would also pass isBusy() and be
    // accepted (review finding F1).
    this.operation = { kind: "unloading" };

    let residentName: string | undefined;
    try {
      const ps = await this.ollama.ps();
      residentName = ps.models[0]?.name;
    } catch {
      residentName = undefined;
    }

    this.operation =
      residentName !== undefined ? { kind: "unloading", model: residentName } : { kind: "unloading" };
    const started = this.operation;
    void this.runUnload();
    return started;
  }

  private async runUnload(): Promise<void> {
    let currentName: string | undefined;
    try {
      let ps: OllamaPsResponse;
      try {
        ps = await this.ollama.ps();
      } catch {
        throw new OllamaDownError();
      }

      const names = ps.models.map((m) => m.name);
      for (const name of names) {
        currentName = name;
        await this.ollama.unload(name);
      }
      if (names.length > 0) {
        await this.waitUntilCleared(names);
      }

      this.loadedByServer = null;
      this.operation = { kind: "idle" };
    } catch (error) {
      this.operation = { kind: "idle", error: reasonForError(error, currentName ?? "model", "Unload") };
    }
  }

  /**
   * Best-effort unload of `name` if /api/ps still lists it, after a failed
   * load. Never throws: the original failure is what gets reported.
   */
  private async bestEffortUnload(name: string): Promise<void> {
    try {
      const ps = await this.ollama.ps();
      if (ps.models.some((m) => m.name === name)) {
        await this.ollama.unload(name);
      }
    } catch {
      // Best effort only.
    }
  }

  /** Poll /api/ps until none of `names` is listed, bounded by maxWaitMs. */
  private async waitUntilCleared(names: string[]): Promise<void> {
    const deadline = Date.now() + this.timing.maxWaitMs;
    for (;;) {
      const ps = await this.ollama.ps();
      if (!ps.models.some((m) => names.includes(m.name))) {
        return;
      }
      if (Date.now() >= deadline) {
        throw new WaitTimeoutError(`Timed out waiting for ${names.join(", ")} to unload`);
      }
      await this.sleep(this.timing.pollIntervalMs);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      (timer as unknown as { unref?: () => void }).unref?.();
    });
  }
}
