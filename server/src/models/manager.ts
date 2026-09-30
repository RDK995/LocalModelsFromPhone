/**
 * Model manager (C5, I6) - reports installed and resident Ollama models, and
 * performs swap-load and unload (FR3-FR6) as asynchronous background
 * operations tracked in `state().operation`. Enforces the busy-confirmation
 * rule (FR6): a load/unload is refused unless confirmed while a reply is in
 * progress or the resident model was not loaded by this server.
 */

import { OllamaError } from "../ollama/client";
import type { OllamaTagsResponse, OllamaPsResponse } from "../ollama/client";
import type {
  StateResponse,
  Generation,
  Operation,
  ConfirmationRequiredError as ConfirmationRequiredBody,
} from "@shared/api";

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
  show(name: string): Promise<{ capabilities?: string[] }>;
}

/**
 * The subset of GenerationManager that ModelManager depends on (I8): the
 * active generation, for the state response and the confirmation rule, and
 * cancelling it for a confirmed load/unload.
 */
export interface ModelManagerGenerations {
  getActiveGeneration(): Generation | null;
  /** Cancel the active generation, if any. Its slot releases asynchronously. */
  cancelActive(): boolean;
}

/** `confirm` must be exactly `true` to confirm; anything else is unconfirmed. */
export interface ModelOperationOptions {
  confirm?: boolean;
}

export type ConfirmationReason = ConfirmationRequiredBody["reasons"][number];

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

const REASON_SENTENCES: Record<ConfirmationReason, string> = {
  reply_in_progress: "A reply is still being written, and continuing will stop it.",
  not_loaded_by_server:
    "The loaded model was not loaded by this app, so another tool on this Mac may be using it.",
};

/**
 * A load/unload needs explicit confirmation (FR6). `reasons` lists every
 * reason that applies, in the order reply_in_progress, not_loaded_by_server.
 */
export class ConfirmationRequiredError extends Error {
  constructor(readonly reasons: ConfirmationReason[]) {
    super(`Please confirm: ${reasons.map((r) => REASON_SENTENCES[r]).join(" ")}`);
    this.name = "ConfirmationRequiredError";
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

/**
 * Map the same failure `reasonForError` describes to the machine-readable
 * `operation.error_code` a LOAD ends with: an OllamaError that is a 404 or
 * "not found" -> unknown_model; any other OllamaError or a timed-out wait ->
 * load_failed; anything else (Ollama unreachable) -> ollama_down.
 */
function errorCodeForLoadFailure(error: unknown): "ollama_down" | "unknown_model" | "load_failed" {
  if (error instanceof OllamaError) {
    if (error.status === 404 || /not found/i.test(error.message)) {
      return "unknown_model";
    }
    return "load_failed";
  }
  if (error instanceof WaitTimeoutError) {
    return "load_failed";
  }
  return "ollama_down";
}

export class ModelManager {
  private operation: Operation = { kind: "idle" };
  /**
   * True from the moment a load/unload passes the busy check until it is
   * refused or its background run ends. Kept separate from `operation` so a
   * request that is still being checked (and may yet be refused) never shows
   * in `state().operation`, yet already blocks a second load/unload and chat.
   */
  private claimed = false;
  private loadedByServer: string | null = null;
  private readonly timing: ModelManagerTiming;
  /** Successful /api/show answers for the `tools` capability, by model name. */
  private readonly toolsSupport = new Map<string, boolean>();

  constructor(
    private ollama: ModelManagerOllama,
    private generations: ModelManagerGenerations,
    timing: Partial<ModelManagerTiming> = {}
  ) {
    this.timing = { ...DEFAULT_TIMING, ...timing };
  }

  /** Whether a load or unload is currently running (or being checked). */
  isBusy(): boolean {
    return this.claimed || this.operation.kind !== "idle";
  }

  /**
   * Whether `name` has Ollama's `tools` capability, from `/api/show`'s
   * `capabilities` array. A successful answer is cached per model name for the
   * life of the manager; a failed lookup returns false and is not cached, so a
   * transient Ollama failure does not permanently disable web for the model.
   */
  async supportsTools(name: string): Promise<boolean> {
    const cached = this.toolsSupport.get(name);
    if (cached !== undefined) {
      return cached;
    }
    try {
      const info = await this.ollama.show(name);
      const supported = Array.isArray(info.capabilities) && info.capabilities.includes("tools");
      this.toolsSupport.set(name, supported);
      return supported;
    } catch {
      return false;
    }
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

    const models = await Promise.all(
      tags.models.map(async (m) => ({
        name: m.name,
        size_bytes: m.size,
        tools: await this.supportsTools(m.name),
      }))
    );
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
   * Start a swap-load of `name`: validate it, apply the confirmation rule,
   * then mark the operation as loading and return it. In the background:
   * cancel any in-flight reply and wait for its slot to release, unload every
   * resident model other than `name`, wait for them to clear /api/ps, then
   * load `name` with keep_alive:-1. Never rejects after it returns; failures
   * land in `operation.error`. Refusals, in precedence order:
   * UnknownModelError, OperationInProgressError, OllamaDownError,
   * ConfirmationRequiredError.
   */
  async load(name: string, options: ModelOperationOptions = {}): Promise<Operation> {
    let tags: OllamaTagsResponse;
    try {
      tags = await this.ollama.tags();
    } catch {
      throw new OllamaDownError();
    }
    if (!tags.models.some((m) => m.name === name)) {
      throw new UnknownModelError(name);
    }
    this.claim();
    await this.checkConfirmation(options);

    this.operation = { kind: "loading", model: name };
    const started = this.operation;
    void this.runLoad(name);
    return started;
  }

  private async runLoad(name: string): Promise<void> {
    try {
      await this.stopActiveReply();
    } catch (error) {
      // Nothing was touched yet: report the reason, leave the models as they are.
      this.finish({
        kind: "idle",
        model: name,
        error: reasonForError(error, name, "Load"),
        error_code: errorCodeForLoadFailure(error),
      });
      return;
    }

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
      this.finish({ kind: "idle" });
    } catch (error) {
      this.loadedByServer = null;
      await this.bestEffortUnload(name);
      this.finish({
        kind: "idle",
        model: name,
        error: reasonForError(error, name, "Load"),
        error_code: errorCodeForLoadFailure(error),
      });
    }
  }

  /**
   * Start an unload of every resident model: apply the confirmation rule,
   * then mark the operation as unloading (with the current resident's name,
   * if any) and return it. In the background: cancel any in-flight reply and
   * wait for its slot to release, then sweep; never rejects after it returns.
   * Refusals, in precedence order: OperationInProgressError, OllamaDownError,
   * ConfirmationRequiredError.
   */
  async unload(options: ModelOperationOptions = {}): Promise<Operation> {
    this.claim();
    const ps = await this.checkConfirmation(options);
    const residentName = ps.models[0]?.name;

    this.operation =
      residentName !== undefined ? { kind: "unloading", model: residentName } : { kind: "unloading" };
    const started = this.operation;
    void this.runUnload();
    return started;
  }

  private async runUnload(): Promise<void> {
    let currentName: string | undefined;
    try {
      await this.stopActiveReply();

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
      this.finish({ kind: "idle" });
    } catch (error) {
      this.finish({ kind: "idle", error: reasonForError(error, currentName ?? "model", "Unload") });
    }
  }

  /**
   * Refuse with OperationInProgressError if a load/unload is running or being
   * checked; otherwise claim. The check and the claim happen in the same tick
   * with no await between them, and every caller claims before its first
   * await on /api/ps. Otherwise a second request arriving during that await
   * would also pass the check and both would be accepted (review finding F1).
   */
  private claim(): void {
    if (this.isBusy()) {
      throw new OperationInProgressError();
    }
    this.claimed = true;
  }

  /**
   * With the claim held: read /api/ps and apply the confirmation rule. On a
   * refusal (OllamaDownError or ConfirmationRequiredError) the claim is
   * dropped, so `operation` and everything else stay exactly as they were.
   * Returns the /api/ps listing it read.
   *
   * Reading the active generation here, after the await, is sound: once
   * claimed, /v1/chat refuses to start a new reply (it re-checks isBusy()
   * in the same tick as starting one), so no reply can begin unseen.
   */
  private async checkConfirmation(options: ModelOperationOptions): Promise<OllamaPsResponse> {
    try {
      let ps: OllamaPsResponse;
      try {
        ps = await this.ollama.ps();
      } catch {
        throw new OllamaDownError();
      }

      const reasons: ConfirmationReason[] = [];
      if (this.generations.getActiveGeneration() !== null) {
        reasons.push("reply_in_progress");
      }
      if (ps.models.some((m) => m.name !== this.loadedByServer)) {
        reasons.push("not_loaded_by_server");
      }
      if (reasons.length > 0 && options.confirm !== true) {
        throw new ConfirmationRequiredError(reasons);
      }
      return ps;
    } catch (error) {
      this.claimed = false;
      throw error;
    }
  }

  /** End a background operation: record how it ended and drop the claim. */
  private finish(operation: Operation): void {
    this.operation = operation;
    this.claimed = false;
  }

  /**
   * Cancel the in-flight reply, if any (only a confirmed request can get here
   * with one), and poll until its generation slot is released, bounded by
   * maxWaitMs. Runs before any Ollama unload/load is issued.
   */
  private async stopActiveReply(): Promise<void> {
    if (this.generations.getActiveGeneration() === null) {
      return;
    }
    this.generations.cancelActive();
    const deadline = Date.now() + this.timing.maxWaitMs;
    for (;;) {
      if (this.generations.getActiveGeneration() === null) {
        return;
      }
      if (Date.now() >= deadline) {
        throw new WaitTimeoutError("Timed out waiting for the reply in progress to stop");
      }
      await this.sleep(this.timing.pollIntervalMs);
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
