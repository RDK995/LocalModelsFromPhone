/**
 * API client for communicating with the Phone Models server.
 * Streaming fetch support (via `expo/fetch`, which supports reading a
 * streaming response body in the Expo Go runtime) and typed error mapping.
 *
 * This module deliberately does not import "expo/fetch" itself: that import
 * pulls in react-native's Flow-typed sources, which bun's test runner cannot
 * parse. The default fetch implementation is wired in from
 * `./expoFetchClient`, which the app uses; tests inject a fake `FetchImpl`
 * directly via the constructor.
 */

import type {
  StateResponse,
  LoadRequest,
  UnloadRequest,
  ChatRequest,
  OperationResponse,
  ThinkingEvent,
  ContentEvent,
  DoneEvent,
  ErrorEvent,
  StepEventData,
  SourcesEvent,
  ConfirmationRequiredError as ConfirmationRequiredBody,
} from "@shared/api";
import { resumeDelayMs, RESUME_BUDGET_MS } from "./resume";

export type StreamEvent =
  | { type: "thinking"; data: ThinkingEvent }
  | { type: "content"; data: ContentEvent }
  | { type: "done"; data: DoneEvent }
  | { type: "error"; data: ErrorEvent }
  | { type: "step"; data: StepEventData }
  | { type: "sources"; data: SourcesEvent };

type SSEEventName =
  | "thinking"
  | "content"
  | "done"
  | "error"
  | "step"
  | "sources";

const STEP_KINDS = ["search", "read", "continue", "answer_now"];
const STEP_STATUSES = ["started", "done", "failed", "unavailable"];

interface StreamOptions {
  /**
   * Called with the `x-generation-id` response header as soon as it
   * arrives, before the body is read. This lets a caller record the
   * generation id (so Stop can cancel it) without waiting for the stream to
   * finish.
   */
  onStart?: (generationId: string) => void;
  onEvent: (event: StreamEvent) => void;
  onError: (error: Error) => void;
  onComplete: () => void;
  signal?: AbortSignal;
}

/**
 * Minimal fetch shape the client depends on, so a fake implementation can be
 * injected in tests without a real network stack. `expo/fetch`'s `fetch`
 * satisfies this (its `FetchResponse` implements the standard `Response`
 * interface), as does the global `fetch`.
 */
export type FetchImpl = (
  url: string,
  init?: RequestInit
) => Promise<Response>;

/**
 * App-lifecycle hook the resume loop (`chat()`) uses to react to the app
 * returning to the foreground (FR11, AC M4-AC3): a reply mid-flight abandons
 * its current transport and re-attaches at once instead of waiting out a
 * backoff delay or the resume budget. Injectable via the constructor so
 * tests can drive it directly; the app wires the real React Native
 * `AppState` in via `./expoFetchClient`. `client.ts` itself never imports
 * react-native.
 */
export interface ClientLifecycle {
  /** Whether the app is currently in the foreground. */
  isForeground(): boolean;
  /**
   * Register `listener` to be called on every foreground transition (the app
   * moving from background/inactive to active). Returns an unsubscribe
   * function.
   */
  onForeground(listener: () => void): () => void;
}

/** Default lifecycle when none is injected: always foreground, never fires
 * (M4b behaviour -- no foreground handling at all). */
const defaultLifecycle: ClientLifecycle = {
  isForeground: () => true,
  onForeground: () => () => {},
};

/**
 * Timer functions the resume loop (`chat()`) drives its backoff waits and
 * budget tracking through, injectable via the constructor so tests can make
 * a `RESUME_BUDGET_MS`-long loop run instantly and deterministically. Default
 * to real timers / `Date.now` for production use.
 */
export interface ClientClock {
  /**
   * Wait `ms` milliseconds, resolving early (without rejecting) if `signal`
   * aborts first -- the caller is responsible for checking
   * `signal?.aborted` afterwards to tell a timeout from an abort.
   */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  /** App-lifecycle hook for foreground resume (see `ClientLifecycle`).
   * Defaults to always-foreground/never-fires when absent. */
  lifecycle?: ClientLifecycle;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      resolve();
    };
    function cleanup(): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    signal?.addEventListener("abort", onAbort);
  });
}

/**
 * Tracks the SSE `id:` field (`<generationId>-<seq>`) of the last event
 * delivered to `onEvent` for one `chat()` call, so a resume request can
 * carry `Last-Event-ID` and duplicate events (already-delivered seqs
 * replayed by a resume) can be dropped.
 */
interface ResumeCursor {
  lastId: string | null;
  lastSeq: number | null;
}

/** Result of reading one SSE response body to completion or a drop. */
type StreamOutcome = "terminal" | "aborted" | "drop";

/** Result of driving the resume retry loop after a drop. */
type ResumeOutcome =
  | { outcome: "response"; response: Response; firstDropAt: number }
  | { outcome: "aborted" }
  | { outcome: "error"; error: Error };

/**
 * Mutable state shared between `chat()`'s main loop and `resumeStream()` so a
 * foreground event (AC3) can interrupt whichever phase -- reading a stream,
 * a backoff wait, or nothing (a resume fetch already in flight, or the reply
 * already settled) -- is currently active, without either side needing to
 * know about the other's internals.
 */
interface ForegroundHandle {
  /** Set once the reply has settled (terminal/aborted/error): a foreground
   * event after this point does nothing (AC3d). */
  settled: boolean;
  /** True while a resume GET is in flight (issued, not yet returned): a
   * foreground event during this phase is ignored, so at most one transport
   * is ever in flight (AC3c). */
  fetchInFlight: boolean;
  /** The internal `AbortController` for whichever interruptible phase
   * (reading the current response, or a backoff wait) is currently active.
   * The foreground listener aborts this directly. */
  activeController: AbortController;
}

/**
 * Thrown when the server rejects a request with 401 Unauthorized (missing or
 * invalid bearer token).
 */
export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized: invalid or missing bearer token") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Thrown when a fetch to the server rejects for a network reason (the Mac is
 * off, unreachable over Tailscale, DNS/connection failure, etc.) rather than
 * the caller's own AbortSignal firing. Covers the initial request of
 * `getState`, `loadModel`, `unloadModel`, `chat` and `cancelGeneration`; the
 * streaming reader's own drop/resume handling (FR11) is unrelated and unaffected.
 */
export class UnreachableError extends Error {
  constructor(message = "Can't reach the Mac") {
    super(message);
    this.name = "UnreachableError";
  }
}

/**
 * Thrown when the server rejects `POST /v1/chat` with 409
 * `{error:"model_not_resident"}` -- the model that was resident when we
 * checked `GET /v1/state` was unloaded before the chat request landed.
 * Callers should treat this the same as no resident model at all (F2).
 */
export class ModelNotResidentError extends Error {
  constructor(message = "No model loaded") {
    super(message);
    this.name = "ModelNotResidentError";
  }
}

/**
 * Thrown by `loadModel`/`unloadModel` for a non-OK, non-401 response, built
 * from the server's `{error, message}` body (e.g. 404 `unknown_model`, 409
 * `operation_in_progress`, 503 `ollama_down`) so callers can show the
 * server's own failure reason instead of a generic message.
 */
export class ServerError extends Error {
  /** The response body's `error` code, e.g. "unknown_model". */
  code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "ServerError";
    this.code = code;
  }
}

/**
 * The set of reasons the server can give for `confirmation_required` (FR6):
 * a reply from this app is still being generated, or the resident model was
 * not loaded by this server so another tool on the Mac may be using it.
 */
export type ConfirmationReason = ConfirmationRequiredBody["reasons"][number];

/**
 * Thrown by `loadModel`/`unloadModel` for a 409 `{error:
 * "confirmation_required", message, reasons}` response: the server needs the
 * caller to warn the user and retry with `confirm: true` before it proceeds
 * (FR6). Extends `ServerError` (code `"confirmation_required"`) so existing
 * `instanceof ServerError` handling still applies.
 */
export class ConfirmationRequiredError extends ServerError {
  /** Why confirmation is required; non-empty, may hold more than one reason. */
  reasons: ConfirmationReason[];

  constructor(message: string | undefined, reasons: ConfirmationReason[]) {
    super("confirmation_required", message);
    this.name = "ConfirmationRequiredError";
    this.reasons = reasons;
  }
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64 without `Buffer`/`btoa` (neither is guaranteed in React Native). */
function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? B64[n & 63] : "=";
  }
  return out;
}

export class APIClient {
  private baseUrl: string;
  private token: string = "";
  private fetchImpl: FetchImpl;
  private sleepImpl: (ms: number, signal?: AbortSignal) => Promise<void>;
  private nowImpl: () => number;
  private lifecycleImpl: ClientLifecycle;

  constructor(baseUrl: string, fetchImpl: FetchImpl, clock: ClientClock = {}) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
    this.sleepImpl = clock.sleep ?? defaultSleep;
    this.nowImpl = clock.now ?? Date.now;
    this.lifecycleImpl = clock.lifecycle ?? defaultLifecycle;
  }

  setToken(token: string): void {
    this.token = token;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    return headers;
  }

  /**
   * Called from each method's own `catch` around its initial `fetchImpl`
   * call (not a wrapping async helper: an extra `await` hop here would shift
   * the microtask timing the resume/foreground tests in client.test.ts
   * depend on). Rethrows `error` unchanged if `init.signal` is already
   * aborted -- the rejection is the caller's own cancellation (e.g. Stop
   * pressed before the initial POST lands), not a network failure -- and as
   * `UnreachableError` otherwise.
   */
  private rethrowFetchFailure(error: unknown, signal?: AbortSignal): never {
    if (signal?.aborted) {
      throw error;
    }
    throw new UnreachableError();
  }

  /**
   * Throw a typed error for a non-OK response: `UnauthorizedError` for 401,
   * a generic `Error` otherwise.
   */
  private assertOk(response: Response, action: string): void {
    if (response.status === 401) {
      throw new UnauthorizedError();
    }
    if (!response.ok) {
      throw new Error(`Failed to ${action}: ${response.statusText}`);
    }
  }

  /**
   * True for the three statuses a proxy in front of the server (e.g.
   * Tailscale's TLS-terminating gateway) uses to report that the server it
   * forwards to is unreachable, rather than a failure the server itself
   * generated.
   */
  private isGatewayStatus(status: number): boolean {
    return status === 502 || status === 503 || status === 504;
  }

  /**
   * Throw a typed error for a non-OK response from load/unload:
   * `UnauthorizedError` for 401, `ConfirmationRequiredError` for a 409
   * `{error:"confirmation_required"}` body, `ServerError` built from the
   * response body's `{error, message}` when the body carries one, otherwise
   * `UnreachableError` for a gateway status (502/503/504) with no body --
   * this is what a proxy in front of the server (e.g. Tailscale) answers
   * when the server behind it is down -- falling back to a generic `Error`
   * for any other bodiless non-OK response.
   */
  private async assertLoadUnloadOk(
    response: Response,
    action: string
  ): Promise<void> {
    if (response.status === 401) {
      throw new UnauthorizedError();
    }
    if (!response.ok) {
      const body = await this.parseErrorBody<{
        error?: string;
        message?: string;
        reasons?: ConfirmationReason[];
      }>(response);
      if (body.error === "confirmation_required") {
        throw new ConfirmationRequiredError(body.message, body.reasons ?? []);
      }
      if (body.error) {
        throw new ServerError(body.error, body.message);
      }
      if (this.isGatewayStatus(response.status)) {
        throw new UnreachableError();
      }
      throw new Error(`Failed to ${action}: ${response.statusText}`);
    }
  }

  async getState(): Promise<StateResponse> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/state`, {
        method: "GET",
        headers: this.getHeaders(),
      });
    } catch (error) {
      this.rethrowFetchFailure(error);
    }

    if (response.status === 401) {
      throw new UnauthorizedError();
    }
    if (!response.ok) {
      const body = await this.parseErrorBody(response);
      if (body.error) {
        throw new ServerError(body.error, body.message);
      }
      if (this.isGatewayStatus(response.status)) {
        throw new UnreachableError();
      }
      throw new Error(`Failed to get state: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Ask the Mac for a site's logo (FR27) as a data URI. Only ever contacts
   * `this.baseUrl`. Returns null on any failure; never throws.
   */
  async siteIcon(host: string): Promise<string | null> {
    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/v1/icon?host=${encodeURIComponent(host)}`,
        { method: "GET", headers: this.getHeaders() },
      );
      if (response.status !== 200) return null;
      const type = (response.headers.get("content-type") ?? "").split(";")[0].trim();
      if (!type.toLowerCase().startsWith("image/")) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      return `data:${type};base64,${bytesToBase64(bytes)}`;
    } catch {
      return null;
    }
  }

  async loadModel(request: LoadRequest): Promise<OperationResponse> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/models/load`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(request),
      });
    } catch (error) {
      this.rethrowFetchFailure(error);
    }

    await this.assertLoadUnloadOk(response, "load model");

    return response.json();
  }

  async unloadModel(request: UnloadRequest): Promise<OperationResponse> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/models/unload`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(request),
      });
    } catch (error) {
      this.rethrowFetchFailure(error);
    }

    await this.assertLoadUnloadOk(response, "unload model");

    return response.json();
  }

  async chat(request: ChatRequest, options: StreamOptions): Promise<string> {
    const initialController = this.linkSignal(options.signal);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/chat`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(request),
        signal: initialController.signal,
      });
    } catch (error) {
      this.rethrowFetchFailure(error, initialController.signal);
    }

    if (!response.ok) {
      if (response.status === 401) {
        throw new UnauthorizedError();
      }
      const body = await this.parseErrorBody(response);
      if (response.status === 409 && body.error === "model_not_resident") {
        // The model resident when we checked GET /v1/state may have been
        // unloaded before this request landed; distinguish that from other
        // non-OK responses (e.g. a generation already in flight, or Ollama
        // down) by the error code.
        throw new ModelNotResidentError(body.message);
      }
      if (body.error) {
        throw new ServerError(body.error, body.message);
      }
      if (this.isGatewayStatus(response.status)) {
        throw new UnreachableError();
      }
      throw new Error(`Failed to start chat: ${response.statusText}`);
    }

    const generationId = response.headers.get("x-generation-id");
    if (!generationId) {
      throw new Error("No generation ID returned from server");
    }

    options.onStart?.(generationId);

    const cursor: ResumeCursor = { lastId: null, lastSeq: null };
    const lifecycle = this.lifecycleImpl;

    // Foreground handling (FR11, AC M4-AC3): a foreground event mid-reply
    // abandons the current transport (whichever is currently active) and
    // re-attaches at once, without waiting out a backoff delay. `handle` is
    // the shared mutable link between this loop/resumeStream and the
    // listener below; backgrounding itself never touches any of this --
    // nothing here reacts to a background transition (AC5).
    const handle: ForegroundHandle = {
      settled: false,
      fetchInFlight: false,
      activeController: initialController,
    };
    const unsubscribe = lifecycle.onForeground(() => {
      if (handle.settled || handle.fetchInFlight) {
        // (c) a resume fetch is already in flight: at most one transport at
        // a time, so this event does nothing. (d) already settled: nothing
        // to abandon either.
        return;
      }
      handle.activeController.abort();
    });

    try {
      let currentResponse: Response = response;
      let firstDropAt: number | null = null;

      for (;;) {
        const outcome = await this.readSSEStream(
          currentResponse,
          options,
          cursor
        );

        if (outcome === "terminal" || outcome === "aborted") {
          // "aborted" is normal cancellation (Stop): the caller's signal was
          // aborted, so it sees the same completion it would without resume.
          handle.settled = true;
          unsubscribe();
          options.onComplete();
          return generationId;
        }

        // outcome === "drop": either a genuine transport failure, or a
        // foreground event aborted `handle.activeController` (the controller
        // behind `currentResponse`) while this read was pending (AC3a) --
        // distinguished by whether that specific controller (not the
        // caller's own signal) is the one that aborted.
        const foregroundDrop =
          handle.activeController.signal.aborted && !options.signal?.aborted;

        if (firstDropAt === null || foregroundDrop) {
          firstDropAt = this.nowImpl();
        }

        const resumed = await this.resumeStream(
          generationId,
          options,
          cursor,
          firstDropAt,
          handle,
          foregroundDrop,
          lifecycle
        );

        if (resumed.outcome === "aborted") {
          handle.settled = true;
          unsubscribe();
          options.onComplete();
          return generationId;
        }
        if (resumed.outcome === "error") {
          handle.settled = true;
          unsubscribe();
          options.onError(resumed.error);
          return generationId;
        }

        currentResponse = resumed.response;
        firstDropAt = resumed.firstDropAt;
      }
    } catch (error) {
      // Not a transport drop: most likely the caller's own onEvent threw
      // (conversationSession.ts does this to route an `error` SSE event to
      // onError). No resume is attempted for this.
      handle.settled = true;
      unsubscribe();
      options.onError(
        error instanceof Error ? error : new Error(String(error))
      );
      return generationId;
    }
  }

  /**
   * Create a fresh internal `AbortController` for one transport request,
   * wired so that aborting `signal` (the caller's own `options.signal`, e.g.
   * Stop) aborts it too -- this keeps the caller's cancellation semantics
   * unchanged (AC2) while giving the resume loop its own controller it can
   * abort for a foreground reason without ever touching the caller's signal.
   */
  private linkSignal(signal?: AbortSignal): AbortController {
    const controller = new AbortController();
    if (!signal) {
      return controller;
    }
    if (signal.aborted) {
      controller.abort();
      return controller;
    }
    const onAbort = () => controller.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    controller.signal.addEventListener(
      "abort",
      () => signal.removeEventListener("abort", onAbort),
      { once: true }
    );
    return controller;
  }

  /**
   * Wait until either the next foreground event or the caller's `signal`
   * aborts, whichever comes first (AC4: the resume budget is exhausted while
   * backgrounded). No request is made while waiting.
   */
  private waitForForegroundOrAbort(
    lifecycle: ClientLifecycle,
    signal?: AbortSignal
  ): Promise<void> {
    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      const onAbort = () => {
        unsubscribeForeground();
        resolve();
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      const unsubscribeForeground = lifecycle.onForeground(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      });
    });
  }

  /**
   * Read one SSE response body, delivering each new event to `options.onEvent`
   * and updating `cursor` with the last `id:` seen, until either a `done`
   * event is delivered (returns "terminal", after cancelling the reader), the
   * body ends without ever delivering `done`/`error` (returns "drop"), or
   * `reader.read()` rejects (returns "aborted" if `options.signal` is already
   * aborted, "drop" otherwise -- including an AbortError whose origin is not
   * the caller's own signal).
   *
   * An exception thrown by `options.onEvent` itself is not caught here: it
   * propagates to the caller, which is `chat()`'s own try/catch (AC8 -- that
   * is not a drop and must not trigger a resume).
   */
  private async readSSEStream(
    response: Response,
    options: StreamOptions,
    cursor: ResumeCursor
  ): Promise<StreamOutcome> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Response body is not readable");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let terminalSeen = false;

    for (;;) {
      let readResult: Awaited<ReturnType<typeof reader.read>>;
      try {
        readResult = await reader.read();
      } catch {
        if (options.signal?.aborted) {
          return "aborted";
        }
        return "drop";
      }

      const { done, value } = readResult;

      if (done) {
        return terminalSeen ? "terminal" : "drop";
      }

      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line; keep the trailing
      // incomplete event in the buffer
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || "";

      for (const block of blocks) {
        let eventType = "";
        let idLine: string | null = null;
        const dataLines: string[] = [];
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith("event:")) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).replace(/^ /, ""));
          } else if (line.startsWith("id:")) {
            idLine = line.slice(3).trim();
          }
        }

        let seq: number | null = null;
        if (idLine) {
          const match = idLine.match(/-(\d+)$/);
          if (match) {
            seq = Number(match[1]);
          }
        }

        // Already delivered by an earlier attempt at this generation.
        if (seq !== null && cursor.lastSeq !== null && seq <= cursor.lastSeq) {
          continue;
        }

        if (!eventType || dataLines.length === 0) {
          if (seq !== null) {
            cursor.lastId = idLine;
            cursor.lastSeq = seq;
          }
          continue;
        }

        const event = this.parseSSEEvent(
          eventType as SSEEventName,
          dataLines.join("\n")
        );

        if (seq !== null) {
          cursor.lastId = idLine;
          cursor.lastSeq = seq;
        }

        if (!event) {
          continue;
        }

        if (event.type === "done" || event.type === "error") {
          terminalSeen = true;
        }

        options.onEvent(event);

        if (event.type === "done") {
          await reader.cancel().catch(() => {});
          return "terminal";
        }
      }
    }
  }

  /**
   * Drive the resume retry loop after a drop (FR11): wait
   * `resumeDelayMs(attempt)`, then `GET
   * {baseUrl}/v1/generations/{generationId}/events` with `Last-Event-ID` set
   * from `cursor.lastId` (omitted if none yet), via an internal
   * `AbortController` linked to `options.signal` (AC2). A network error or
   * 502/503/504 counts as a failed attempt and retries (with the attempt
   * counter incrementing); any other non-200 status ends the loop with a
   * terminal error. Stops early, without a further request, if
   * `options.signal` aborts (during the wait or the fetch).
   *
   * If the resume budget since `firstDropAt` is exhausted while the app is
   * backgrounded (`lifecycle.isForeground()` is false), the loop does not
   * error out; instead it waits, without making any request, for the next
   * foreground event (AC4), then resumes immediately as though that event
   * had interrupted a backoff wait (AC3b). `skipInitialDelay` (set when the
   * drop that led here was itself caused by a foreground event, AC3a) makes
   * the very first attempt fire with no backoff wait. Either way, resuming
   * after a foreground event resets the attempt counter to 1 and restarts
   * the budget clock from `now()` (AC3).
   */
  private async resumeStream(
    generationId: string,
    options: StreamOptions,
    cursor: ResumeCursor,
    firstDropAt: number,
    handle: ForegroundHandle,
    skipInitialDelay: boolean,
    lifecycle: ClientLifecycle
  ): Promise<ResumeOutcome> {
    let attempt = 1;
    let skipWait = skipInitialDelay;

    for (;;) {
      if (options.signal?.aborted) {
        return { outcome: "aborted" };
      }

      if (this.nowImpl() - firstDropAt > RESUME_BUDGET_MS) {
        if (!lifecycle.isForeground()) {
          // AC4: do not give up while backgrounded; wait (no requests) for
          // the next foreground event instead. No interruptible transport is
          // active during this wait, so gate the shared foreground listener
          // the same way an in-flight fetch does (AC3c) -- this dedicated
          // wait is what actually resumes it.
          handle.fetchInFlight = true;
          await this.waitForForegroundOrAbort(lifecycle, options.signal);
          handle.fetchInFlight = false;

          if (options.signal?.aborted) {
            return { outcome: "aborted" };
          }

          attempt = 1;
          firstDropAt = this.nowImpl();
          skipWait = true;
          continue;
        }

        return {
          outcome: "error",
          error: new Error(
            "The connection to the Mac was lost and could not be restored."
          ),
        };
      }

      if (!skipWait) {
        const waitController = this.linkSignal(options.signal);
        handle.activeController = waitController;

        await this.sleepImpl(resumeDelayMs(attempt), waitController.signal);

        if (options.signal?.aborted) {
          return { outcome: "aborted" };
        }

        if (waitController.signal.aborted) {
          // A foreground event ended the wait early (AC3b): resume at once,
          // with no further delay.
          attempt = 1;
          firstDropAt = this.nowImpl();
        }
      }
      skipWait = false;

      const headers = this.getHeaders();
      if (cursor.lastId) {
        headers["Last-Event-ID"] = cursor.lastId;
      }

      handle.fetchInFlight = true;
      const fetchController = this.linkSignal(options.signal);
      handle.activeController = fetchController;

      let response: Response;
      try {
        response = await this.fetchImpl(
          `${this.baseUrl}/v1/generations/${generationId}/events`,
          { method: "GET", headers, signal: fetchController.signal }
        );
      } catch {
        handle.fetchInFlight = false;
        if (options.signal?.aborted) {
          return { outcome: "aborted" };
        }
        attempt += 1;
        continue;
      }
      handle.fetchInFlight = false;

      if (response.status === 200) {
        return { outcome: "response", response, firstDropAt };
      }

      if (response.status === 401) {
        return { outcome: "error", error: new UnauthorizedError() };
      }

      if (response.status === 404) {
        const body = await this.parseErrorBody(response);
        return {
          outcome: "error",
          error: new ServerError(
            "unknown_generation",
            body.message ?? "No such generation"
          ),
        };
      }

      if (
        response.status === 502 ||
        response.status === 503 ||
        response.status === 504
      ) {
        attempt += 1;
        continue;
      }

      const body = await this.parseErrorBody(response);
      return {
        outcome: "error",
        error: new ServerError(body.error ?? "unknown_error", body.message),
      };
    }
  }

  /**
   * Best-effort parse of a non-OK response's `{error, message}` JSON body.
   * Treats a null, non-object, empty or unparseable body as `{}` rather than
   * throwing -- a bodiless gateway response (e.g. Tailscale's proxy
   * answering 502 for a downed server) can have `.json()` reject (empty
   * body) or, in some runtimes, resolve to `null` outright.
   */
  private async parseErrorBody<
    T extends object = { error?: string; message?: string },
  >(response: Response): Promise<Partial<T>> {
    try {
      const body: unknown = await response.json();
      if (body && typeof body === "object") {
        return body as Partial<T>;
      }
      return {};
    } catch {
      return {};
    }
  }

  private parseSSEEvent(
    type: SSEEventName,
    data: string
  ): StreamEvent | null {
    try {
      const parsed = JSON.parse(data);

      switch (type) {
        case "thinking":
          return {
            type: "thinking",
            data: { text: parsed.text || "" } as ThinkingEvent,
          };
        case "content":
          return {
            type: "content",
            data: { text: parsed.text || "" } as ContentEvent,
          };
        case "done":
          return {
            type: "done",
            data: {
              status: parsed.status || "complete",
              model: parsed.model || "",
              eval_count: parsed.eval_count || 0,
              tokens_per_second: parsed.tokens_per_second || 0,
            } as DoneEvent,
          };
        case "error":
          return {
            type: "error",
            data: {
              code: parsed.code || "unknown",
              message: parsed.message || "",
            } as ErrorEvent,
          };
        case "step": {
          if (
            !parsed ||
            typeof parsed.step_id !== "string" ||
            !STEP_KINDS.includes(parsed.kind) ||
            !STEP_STATUSES.includes(parsed.status)
          ) {
            return null;
          }
          const step: StepEventData = {
            step_id: parsed.step_id,
            kind: parsed.kind,
            status: parsed.status,
          };
          if (typeof parsed.query === "string") step.query = parsed.query;
          if (typeof parsed.url === "string") step.url = parsed.url;
          if (typeof parsed.detail === "string") step.detail = parsed.detail;
          return { type: "step", data: step };
        }
        case "sources": {
          const items: SourcesEvent["items"] = Array.isArray(parsed?.items)
            ? parsed.items
                .filter(
                  (i: unknown) =>
                    !!i &&
                    typeof (i as { title?: unknown }).title === "string" &&
                    typeof (i as { url?: unknown }).url === "string"
                )
                .map((i: { title: string; url: string; n?: unknown }) => ({
                  title: i.title,
                  url: i.url,
                  ...(typeof i.n === "number" && Number.isInteger(i.n) && i.n > 0
                    ? { n: i.n }
                    : {}),
                }))
            : [];
          return { type: "sources", data: { items } };
        }
        default:
          return null;
      }
    } catch (error) {
      console.error("Failed to parse SSE event:", error);
      return null;
    }
  }

  async cancelGeneration(generationId: string): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.baseUrl}/v1/generations/${generationId}/cancel`,
        {
          method: "POST",
          headers: this.getHeaders(),
        }
      );
    } catch (error) {
      this.rethrowFetchFailure(error);
    }

    this.assertOk(response, "cancel generation");
  }
}

export function createAPIClient(
  baseUrl: string,
  fetchImpl: FetchImpl
): APIClient {
  return new APIClient(baseUrl, fetchImpl);
}
