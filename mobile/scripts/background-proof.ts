#!/usr/bin/env bun
/**
 * Live proof: app backgrounded mid-reply, returns to foreground,
 * resumes the same reply to terminal state; only Stop cancels (M4-AC3).
 *
 * Demonstrates:
 * - M4-AC3: Backgrounding the app mid-reply and returning to foreground
 *   resumes the same reply and receives its terminal state, with only
 *   an explicit Stop cancelling generation.
 *
 * Uses the app's own client (src/api/client.ts), conversation store
 * (src/store/conversationStore.ts), conversation session module
 * (src/chat/conversationSession.ts), and chat controller
 * (src/chat/chatController.ts) -- the same code paths the phone app
 * itself uses.
 *
 * N is the smallest installed model derived from /api/show capabilities
 * (completion, not thinking). Ollama's /api/ps is fetched directly at each
 * checkpoint to independently verify what is actually resident.
 *
 * Env:
 *   SERVER_URL   default https://ryans-mac-studio.tailc3648a.ts.net:8443
 *   OLLAMA_URL   default http://127.0.0.1:11434
 *   PHONE_MODELS_TOKEN_FILE   default ~/.phone-models/token
 */

interface OllamaTagsModel {
  name: string;
  size: number;
}

interface OllamaTagsResponse {
  models: OllamaTagsModel[];
}

interface OllamaShowResponse {
  capabilities?: string[];
  [key: string]: any;
}

interface OllamaPsModel {
  name: string;
}

interface OllamaPsResponse {
  models: OllamaPsModel[];
}

interface RequestRecord {
  method: string;
  url: string;
  lastEventId?: string;
  timestamp: number;
}

import type { StreamEvent, FetchImpl, ClientLifecycle } from "@/api/client";

const SERVER_URL = process.env.SERVER_URL || "https://ryans-mac-studio.tailc3648a.ts.net:8443";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const TOKEN_FILE = process.env.PHONE_MODELS_TOKEN_FILE || `${process.env.HOME}/.phone-models/token`;
const OLLAMA_FETCH_TIMEOUT_MS = 30_000;
const LOAD_UNLOAD_MAX_WAIT_MS = 180_000;
const CHAT_TIMEOUT_MS = 180_000;
const K = 5; // Background after K content events
const STOP_AFTER_RESUME_K = 5; // Scenario B: call stopGeneration after this many content events post-foreground (packet: "at least 5")

// Use a temp file for storage persistence testing
const TEMP_DIR = "/private/tmp";
const STORAGE_FILE_A = `${TEMP_DIR}/background-proof-storage-a-${Date.now()}.jsonl`;
const STORAGE_FILE_B = `${TEMP_DIR}/background-proof-storage-b-${Date.now()}.jsonl`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pass(message: string): void {
  console.log(`PASS: ${message}`);
}

function fail(message: string): never {
  console.log(`FAIL: ${message}`);
  process.exit(1);
}

/**
 * Diagnostic timing log: wall-clock time plus elapsed ms since `t0` (the
 * scenario's chat-start timestamp), so a real timeline can be reconstructed
 * after the fact instead of relying on console.log ordering alone.
 */
function logTiming(label: string, t0: number | null): void {
  const now = Date.now();
  const elapsed = t0 === null ? "n/a" : `${now - t0}ms`;
  console.log(`[TIMING] ${label}: t=${new Date(now).toISOString()} elapsedSinceChatStart=${elapsed}`);
}

/** `t - t0` in ms, or "n/a" if either endpoint was never recorded. */
function diffMs(t0: number | null, t: number | null): string {
  if (t0 === null || t === null) return "n/a";
  return `${t - t0}ms`;
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getOllamaTags(): Promise<OllamaTagsResponse> {
  const response = await fetchWithTimeout(`${OLLAMA_URL}/api/tags`, OLLAMA_FETCH_TIMEOUT_MS);
  if (!response.ok) fail(`fetching Ollama /api/tags: HTTP ${response.status}`);
  return response.json();
}

async function getOllamaShow(model: string): Promise<OllamaShowResponse> {
  const response = await fetchWithTimeout(
    `${OLLAMA_URL}/api/show`,
    OLLAMA_FETCH_TIMEOUT_MS,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    }
  );
  if (!response.ok) fail(`fetching Ollama /api/show for ${model}: HTTP ${response.status}`);
  return response.json();
}

async function getOllamaPs(): Promise<OllamaPsResponse> {
  const response = await fetchWithTimeout(`${OLLAMA_URL}/api/ps`, OLLAMA_FETCH_TIMEOUT_MS);
  if (!response.ok) fail(`fetching Ollama /api/ps: HTTP ${response.status}`);
  return response.json();
}

/**
 * Simulated lifecycle object that tracks foreground state and notifies listeners
 * when the app returns to foreground.
 */
function createSimulatedLifecycle(): {
  lifecycle: ClientLifecycle;
  setForeground: (isForeground: boolean) => void;
  setBackground: () => void;
} {
  let isForeground = true;
  const listeners: Array<() => void> = [];

  return {
    lifecycle: {
      isForeground: () => isForeground,
      onForeground: (listener: () => void) => {
        listeners.push(listener);
        console.log(
          `[DIAG] onForeground listener registered: t=${new Date().toISOString()} count=${listeners.length}`
        );
        return () => {
          const idx = listeners.indexOf(listener);
          if (idx >= 0) listeners.splice(idx, 1);
          console.log(
            `[DIAG] onForeground listener unsubscribed: t=${new Date().toISOString()} count=${listeners.length}`
          );
        };
      },
    },
    setForeground: (fg: boolean) => {
      if (fg && !isForeground) {
        isForeground = true;
        console.log(
          `[DIAG] setForeground(true): t=${new Date().toISOString()} notifying ${listeners.length} listener(s)`
        );
        // Call all listeners asynchronously
        for (const listener of listeners) {
          Promise.resolve().then(() => listener());
        }
      } else {
        isForeground = fg;
      }
    },
    setBackground: () => {
      isForeground = false;
      console.log(`[DIAG] setBackground(): t=${new Date().toISOString()}`);
    },
  };
}

/**
 * Wraps a real fetch with backgrounding simulation:
 * - On the FIRST POST /v1/chat only, forward K content events, then stall
 *   (don't forward more bytes, don't error) while `isForeground` is false.
 * - On foreground, resume forwarding.
 * - Returns a promise that resolves when the stream has stalled (after K events)
 */
interface CancelInfo {
  sentAt: number;
  respondedAt: number;
  status: number;
  body: string;
}

function createBackgroundingFetch(realFetch: typeof fetch, token: string, simulatedLifecycle: ClientLifecycle) {
  let firstChatSeen = false;
  const requestRecords: RequestRecord[] = [];
  let contentEventCount = 0;
  let isStalled = false;
  let stalledPromise: Promise<void> | null = null;
  let stalledResolve: (() => void) | null = null;
  let cancelInfo: CancelInfo | null = null;

  const wrappingFetch: FetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method || "GET";
    const lastEventIdHeader = init?.headers && typeof init.headers === "object" && !Array.isArray(init.headers) ? (init.headers as Record<string, string>)["Last-Event-ID"] : undefined;

    const seenAt = Date.now();
    requestRecords.push({
      method,
      url,
      timestamp: seenAt,
      ...(lastEventIdHeader ? { lastEventId: lastEventIdHeader } : {}),
    });

    // Diagnostic only (does not affect behaviour): for a resume GET
    // (/v1/generations/<id>/events with a Last-Event-ID), log exactly when
    // the wrapper sees the request sent and when the real server responds
    // with headers, so a slow/late resume can be told apart from a slow
    // model. This is the request client.ts's resume loop issues after a
    // foreground-triggered abort.
    if (method === "GET" && url.includes("/v1/generations/") && url.includes("/events") && lastEventIdHeader) {
      console.log(`[DIAG] resume GET sent: t=${new Date(seenAt).toISOString()} lastEventId=${lastEventIdHeader}`);
      const realResponse = await realFetch(url, init);
      const headersAt = Date.now();
      console.log(
        `[DIAG] resume GET headers received: t=${new Date(headersAt).toISOString()} ` +
          `roundTrip=${headersAt - seenAt}ms status=${realResponse.status}`
      );
      return realResponse;
    }

    // For the FIRST POST /v1/chat only, implement backgrounding stall
    if (method === "POST" && url.includes("/v1/chat") && !firstChatSeen) {
      firstChatSeen = true;

      try {
        const realResponse = await realFetch(url, init);

        const status = realResponse.status;
        const headers = new Headers(realResponse.headers);
        const generationId = headers.get("x-generation-id");
        const contentType = headers.get("content-type");

        if (!realResponse.body) {
          return realResponse;
        }

        // Create a custom ReadableStream that stalls on background. Per the
        // packet, "background" must look like a suspended iOS socket: stop
        // forwarding bytes, raise no error. The stall only ends when the
        // real app code decides to abandon the transport -- i.e. when
        // `init.signal` (the client's own per-transport AbortController,
        // aborted by its onForeground listener) fires. A real fetch body's
        // reader rejects with an AbortError when its signal aborts even
        // after headers were received; this wrapper must be faithful to
        // that, since the app's resume logic only reacts to a dropped
        // transport (an error/close), not to some side-channel lifecycle
        // flag the wrapper happens to share for scheduling purposes.
        let buffer = "";
        let paused = false;
        let shouldStallAfterThisEvent = false;
        let aborted = false;
        const reader = realResponse.body!.getReader();

        const onAbort = () => {
          if (aborted) return;
          aborted = true;
          console.log(
            `[DIAG] init.signal aborted, ending stalled stream: t=${new Date().toISOString()}`
          );
          try {
            controller_.error(new DOMException("Aborted", "AbortError"));
          } catch {
            // Stream may already be closed/errored; ignore.
          }
          reader.cancel().catch(() => {});
        };

        // `controller_` is assigned once `start()` runs (below); `onAbort`
        // needs to reach it from this outer scope so `cancel()` (called if
        // the *consumer* -- client.ts's reader -- cancels) can also tear
        // down the abort listener.
        let controller_!: ReadableStreamDefaultController<Uint8Array>;

        if (init?.signal) {
          if (init.signal.aborted) {
            aborted = true;
          } else {
            init.signal.addEventListener("abort", onAbort, { once: true });
          }
        }

        const readableStream = new ReadableStream<Uint8Array>({
          async start(controller) {
            controller_ = controller;
            if (aborted) {
              controller.error(new DOMException("Aborted", "AbortError"));
              return;
            }
            try {
              while (true) {
                try {
                  // If stalled, wait for foreground -- but bail immediately
                  // if the app aborted this transport in the meantime
                  // (onAbort already errored the controller).
                  while (paused && !simulatedLifecycle.isForeground() && !aborted) {
                    await sleep(20);
                  }
                  if (aborted) return;
                  paused = false;

                  const { done, value } = await reader.read();
                  if (aborted) return;

                  if (done) {
                    init?.signal?.removeEventListener("abort", onAbort);
                    controller.close();
                    return;
                  }

                  if (!value) continue;

                  // Accumulate bytes in the buffer and parse lines
                  buffer += new TextDecoder().decode(value);
                  const lines = buffer.split("\n");

                  // Keep the last incomplete line in the buffer
                  buffer = lines[lines.length - 1];

                  for (let i = 0; i < lines.length - 1; i++) {
                    const line = lines[i];

                    // When we see a new event line, check if we should stall after the previous event
                    if (line.startsWith("event: ")) {
                      if (shouldStallAfterThisEvent) {
                        isStalled = true;
                        paused = true;
                        shouldStallAfterThisEvent = false;
                        // Resolve the stalled promise
                        if (stalledResolve) {
                          stalledResolve();
                          stalledResolve = null;
                        }
                      }

                      // Check if this is a content event
                      if (line.startsWith("event: content")) {
                        contentEventCount += 1;

                        if (contentEventCount >= K) {
                          // Mark to stall after this event completes
                          shouldStallAfterThisEvent = true;
                        }
                      }
                    }

                    // Forward the line if we're not stalled yet
                    if (!isStalled) {
                      controller.enqueue(new TextEncoder().encode(line + "\n"));
                    }
                  }
                } catch (e) {
                  // Diagnostic only: reveals whether/when the real
                  // underlying reader (tied to the chat POST's own
                  // AbortController) actually threw when the client
                  // aborted it on foreground -- vs. never throwing at all,
                  // which would mean this wrapper's stall loop is not
                  // observing the abort.
                  console.log(
                    `[DIAG] real reader.read() threw: t=${new Date().toISOString()} ` +
                      `name=${(e as any)?.name} message=${(e as any)?.message}`
                  );
                  controller.error(e);
                  return;
                }
              }
            } catch (e) {
              console.log(
                `[DIAG] stall loop outer catch: t=${new Date().toISOString()} ` +
                  `name=${(e as any)?.name} message=${(e as any)?.message}`
              );
              controller.error(e);
            }
          },
          cancel(reason) {
            // The consumer (client.ts's own reader) cancelled us directly
            // (e.g. reader.cancel() on a terminal "done"); tear down the
            // abort listener and release the real underlying reader too.
            aborted = true;
            init?.signal?.removeEventListener("abort", onAbort);
            reader.cancel(reason).catch(() => {});
          },
        });

        // Return a new Response with the custom readable stream
        return new Response(readableStream, {
          status,
          statusText: realResponse.statusText,
          headers,
        });
      } catch (error) {
        console.log(
          `[DIAG] initial realFetch(/v1/chat) threw: t=${new Date().toISOString()} ` +
            `name=${(error as any)?.name} message=${(error as any)?.message}`
        );
        throw error;
      }
    }

    // For the cancel POST, record send time, response status, and response
    // body (without consuming it for the real caller) so the actual server
    // decision ({status:"cancelled"} vs "already_complete") and its timing
    // relative to the rest of the timeline can be inspected after the run.
    if (method === "POST" && url.includes("/cancel")) {
      const sentAt = Date.now();
      const response = await realFetch(url, init);
      const respondedAt = Date.now();
      let bodyText = "";
      try {
        bodyText = await response.clone().text();
      } catch {
        // Best-effort only; do not affect the real response.
      }
      cancelInfo = { sentAt, respondedAt, status: response.status, body: bodyText };
      return response;
    }

    // For all other requests, just pass through
    return realFetch(url, init);
  };

  return {
    fetch: wrappingFetch,
    getRequestRecords: () => requestRecords,
    getContentEventCount: () => contentEventCount,
    isStalled: () => isStalled,
    getCancelInfo: () => cancelInfo,
    getStalledPromise: () => {
      // Create a new promise for stalling if needed
      if (!stalledPromise) {
        stalledPromise = new Promise<void>((resolve) => {
          stalledResolve = resolve;
        });
      }
      return stalledPromise;
    },
  };
}

/**
 * Fetch and parse the oracle events from the server directly.
 */
async function fetchOracleEvents(
  generationId: string,
  token: string
): Promise<Array<{ type: string; data: any }>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };

  const response = await fetchWithTimeout(
    `${SERVER_URL}/v1/generations/${generationId}/events`,
    CHAT_TIMEOUT_MS,
    {
      method: "GET",
      headers,
    }
  );

  if (!response.ok) {
    fail(`Failed to fetch oracle events: HTTP ${response.status}`);
  }

  const text = await response.text();
  const events: Array<{ type: string; data: any }> = [];

  const lines = text.split("\n");
  let currentEvent: { type?: string; data?: string } = {};

  for (const line of lines) {
    if (line.startsWith("event: ")) {
      if (currentEvent.type && currentEvent.data) {
        try {
          events.push({
            type: currentEvent.type,
            data: JSON.parse(currentEvent.data),
          });
        } catch (e) {
          // Skip malformed events
        }
      }
      currentEvent = { type: line.substring(7) };
    } else if (line.startsWith("data: ")) {
      currentEvent.data = line.substring(6);
    }
  }

  // Don't forget the last event
  if (currentEvent.type && currentEvent.data) {
    try {
      events.push({
        type: currentEvent.type,
        data: JSON.parse(currentEvent.data),
      });
    } catch (e) {
      // Skip malformed events
    }
  }

  return events;
}

async function main() {
  const tokenBuffer = await Bun.file(TOKEN_FILE).bytes();
  const token = new TextDecoder().decode(tokenBuffer).trim();
  if (!token) fail("token file is empty");

  const { APIClient } = await import("../src/api/client");
  const { runModelAction } = await import("../src/ui/modelActions");
  const { sendInConversation } = await import("../src/chat/conversationSession");
  const { stopGeneration } = await import("../src/chat/chatController");
  const { createConversationStore } = await import("../src/store/conversationStore");
  const { createFileStorage } = await import("../src/store/fileStorage");

  // --- Check 1: Pick model from Ollama ---
  console.log("--- Check 1: Picking non-thinking model from Ollama ---");
  const tags = await getOllamaTags();
  if (tags.models.length === 0) {
    fail("Check 1: no models installed in Ollama");
  }

  // Sort by size to get the smallest model
  const bySize = [...tags.models].sort((a, b) => a.size - b.size);

  let nonThinkingModel: string | null = null;

  for (const modelInfo of bySize) {
    const show = await getOllamaShow(modelInfo.name);
    const capabilities = show.capabilities || [];
    if (capabilities.includes("completion") && !capabilities.includes("thinking")) {
      nonThinkingModel = modelInfo.name;
      break;
    }
  }

  if (!nonThinkingModel) {
    fail("Check 1: no non-thinking completion model installed");
  }

  console.log(`N (non-thinking): ${nonThinkingModel}`);
  console.log("");

  // --- Check 2: Load model and verify ---
  console.log(`--- Check 2: Loading and verifying model (${nonThinkingModel}) ---`);

  const simLifecycle = createSimulatedLifecycle();
  const { fetch: wrappingFetch, getRequestRecords, getContentEventCount } =
    createBackgroundingFetch(fetch, token, simLifecycle.lifecycle);

  const client = new APIClient(SERVER_URL, wrappingFetch, {
    lifecycle: simLifecycle.lifecycle,
  });
  client.setToken(token);

  // Load the model
  console.log(`Loading ${nonThinkingModel}...`);
  const stateAfterLoad = await runModelAction({
    getState: () => client.getState(),
    start: () => client.loadModel({ name: nonThinkingModel, confirm: true }),
    maxWaitMs: LOAD_UNLOAD_MAX_WAIT_MS,
  });
  if ("cancelled" in stateAfterLoad) {
    fail("Check 2: load was unexpectedly cancelled");
  }

  const psAfterLoad = await getOllamaPs();
  const loadedModels = psAfterLoad.models.map((m) => m.name);
  if (!loadedModels.includes(nonThinkingModel)) {
    fail(`Check 2: /api/ps does not show ${nonThinkingModel} resident`);
  }
  pass(`Check 2: ${nonThinkingModel} is resident`);
  console.log("");

  // --- Scenario A: Background then foreground, reply completes ---
  console.log("--- Scenario A: Background then foreground ---");
  const storage_a = createFileStorage(STORAGE_FILE_A);
  const store_a = createConversationStore(storage_a);
  const conversation_a = await store_a.create("Background proof A");

  // Reset for scenario A
  let contentEventCountA = 0;
  let backgroundedA = false;
  const recordedEventsA: StreamEvent[] = [];
  let recordedGenerationIdA: string | null = null;
  const requestRecordsA: RequestRecord[] = [];
  let tChatStartA: number | null = null;
  let tForegroundCallA: number | null = null;

  const { fetch: wrappingFetchA, getRequestRecords: getRequestRecordsA, getContentEventCount: getContentEventCountA, getStalledPromise: getStalledPromiseA } =
    createBackgroundingFetch(fetch, token, simLifecycle.lifecycle);

  const clientA = new APIClient(SERVER_URL, wrappingFetchA, {
    lifecycle: simLifecycle.lifecycle,
  });
  clientA.setToken(token);

  // Send the prompt
  const promiseA = sendInConversation(
    clientA,
    store_a,
    conversation_a.id,
    "Count from 1 to 80 as digits separated by commas and spaces. Output only the numbers.",
    {
      onStart: (generationId: string) => {
        recordedGenerationIdA = generationId;
        tChatStartA = Date.now();
        console.log(`Scenario A: Started generation ${generationId}`);
        logTiming("chat start", tChatStartA);
      },
      onEvent: (event: StreamEvent) => {
        recordedEventsA.push(event);
        if (event.type === "content") {
          contentEventCountA += 1;
          if (contentEventCountA === K && !backgroundedA) {
            console.log(`Scenario A: Received ${K} content events, backgrounding...`);
            logTiming(`${K}th content event (background trigger)`, tChatStartA);
            backgroundedA = true;
            simLifecycle.setBackground();
          }
        }
        if (event.type === "done") {
          logTiming(`done event received (status=${event.data.status})`, tChatStartA);
        }
      },
      onBlocked: (msg) => fail(`Scenario A: blocked: ${msg}`),
      onError: (err) => fail(`Scenario A: error: ${err.message}`),
      onUnauthorized: () => fail("Scenario A: unauthorized"),
      onComplete: () => {
        console.log("Scenario A: onComplete called");
      },
    }
  );

  // Wait for the stream to actually stall (after K content events forwarded)
  console.log("Scenario A: Waiting for stream to stall...");
  await getStalledPromiseA();
  console.log("Scenario A: Stream has stalled");

  // Wait 8 seconds while backgrounded
  console.log("Scenario A: Waiting 8 seconds while backgrounded...");
  await sleep(8000);

  // Restore to foreground
  console.log("Scenario A: Restoring to foreground...");
  tForegroundCallA = Date.now();
  logTiming("foreground call", tChatStartA);
  simLifecycle.setForeground(true);

  // Wait for the send to complete
  await promiseA;
  console.log("Scenario A: Send completed");
  logTiming("send completed (promiseA resolved)", tChatStartA);

  // Collect request records from this scenario
  for (const req of getRequestRecordsA()) {
    requestRecordsA.push(req);
  }

  // --- Scenario A Assertions ---
  console.log("--- Scenario A Assertions ---");

  // Assertion A-a: K content events before stall
  if (contentEventCountA < K) {
    fail(`Assertion A-a: expected at least ${K} content events before stall, got ${contentEventCountA}`);
  }
  pass(`Assertion A-a: received at least ${K} content events before stall`);

  // Assertion A-b: at least one GET /v1/generations/<genId>/events with a
  // Last-Event-ID matching /^<genId>-\d+$/ was made within 2s of the
  // foreground call (packet AC 2b) -- not just "a resume request happened
  // eventually", but specifically prompt reconnection on foreground.
  const eventIdPattern = recordedGenerationIdA
    ? new RegExp(`^${recordedGenerationIdA}-\\d+$`)
    : /$^/;
  const resumeRequestsA = requestRecordsA.filter(
    (r) =>
      r.method === "GET" &&
      r.url.includes("/v1/generations/") &&
      r.url.includes("/events") &&
      !!r.lastEventId &&
      eventIdPattern.test(r.lastEventId)
  );
  if (resumeRequestsA.length === 0) {
    fail(
      "Assertion A-b: no resume requests (GET /v1/generations/<genId>/events with matching Last-Event-ID) made"
    );
  }
  for (const r of resumeRequestsA) {
    logTiming(`resume GET sent (Last-Event-ID=${r.lastEventId})`, tChatStartA);
  }
  const promptResumeA = resumeRequestsA.some(
    (r) => tForegroundCallA !== null && r.timestamp - tForegroundCallA <= 2000
  );
  if (!promptResumeA) {
    const offsets = resumeRequestsA
      .map((r) => (tForegroundCallA === null ? "n/a" : `${r.timestamp - tForegroundCallA}ms`))
      .join(", ");
    fail(
      `Assertion A-b: no resume request was made within 2s of the foreground call (offsets: ${offsets})`
    );
  }
  pass(`Assertion A-b: ${resumeRequestsA.length} resume request(s) made, at least one within 2s of foreground`);

  // Assertion A-c: No cancel requests in scenario A
  const cancelRequestsA = requestRecordsA.filter((r) => r.url.includes("/cancel"));
  if (cancelRequestsA.length > 0) {
    fail(`Assertion A-c: ${cancelRequestsA.length} cancel request(s) found, expected 0`);
  }
  pass("Assertion A-c: no cancel requests in scenario A");

  // Assertion A-d: Exactly one done event, status complete
  const allDoneEventsA = recordedEventsA.filter((e) => e.type === "done");
  if (allDoneEventsA.length !== 1) {
    fail(`Assertion A-d: expected exactly 1 done event, got ${allDoneEventsA.length}`);
  }
  pass("Assertion A-d: exactly 1 done event");

  const doneEventA = allDoneEventsA[0];
  if (doneEventA.data.status !== "complete") {
    fail(`Assertion A-d: done event status is "${doneEventA.data.status}", expected "complete"`);
  }
  pass("Assertion A-d: done event status is complete");

  // Assertion A-e: Oracle check
  if (!recordedGenerationIdA) {
    fail("Assertion A-e: no generation ID recorded");
  }

  const oracleEventsA = await fetchOracleEvents(recordedGenerationIdA, token);
  const oracleContentEventsA = oracleEventsA.filter((e) => e.type === "content");
  const oracleExpectedA = oracleContentEventsA.map((e) => e.data.text).join("");

  const recordedContentEventsA = recordedEventsA.filter((e) => e.type === "content");
  const recordedContentA = recordedContentEventsA.map((e) => e.data.text).join("");

  if (recordedContentA !== oracleExpectedA) {
    fail(
      `Assertion A-e: content mismatch. Recorded: "${recordedContentA.substring(0, 100)}...", Oracle: "${oracleExpectedA.substring(0, 100)}..."`
    );
  }
  pass("Assertion A-e: recorded content matches oracle");

  if (recordedContentEventsA.length !== oracleContentEventsA.length) {
    fail(
      `Assertion A-e: content event count mismatch. Recorded: ${recordedContentEventsA.length}, Oracle: ${oracleContentEventsA.length}`
    );
  }
  pass(`Assertion A-e: content event count matches (${recordedContentEventsA.length})`);

  // Assertion A-f: Stored conversation and expected text
  const convA = await store_a.get(conversation_a.id);
  if (!convA) {
    fail("Assertion A-f: conversation not found after send");
  }

  const assistantMsgA = convA.messages.find((m) => m.role === "assistant");
  if (!assistantMsgA) {
    fail("Assertion A-f: no assistant message in conversation");
  }

  if (assistantMsgA.status !== "complete") {
    fail(`Assertion A-f: assistant message status is "${assistantMsgA.status}", expected "complete"`);
  }
  pass("Assertion A-f: assistant message status is complete");

  if (assistantMsgA.content !== recordedContentA) {
    fail("Assertion A-f: stored message content does not match recorded content");
  }
  pass("Assertion A-f: stored message content matches recorded content");

  if (!assistantMsgA.content.includes("80")) {
    fail(`Assertion A-f: response does not contain "80". Got: "${assistantMsgA.content}"`);
  }
  pass("Assertion A-f: response contains 80");

  console.log("");
  console.log(`Scenario A response (first 200 chars): ${assistantMsgA.content.substring(0, 200)}`);
  console.log(`Scenario A content event count: ${recordedContentEventsA.length}`);
  console.log("");

  // --- Scenario B: Background, foreground, then Stop cancels ---
  console.log("--- Scenario B: Background, foreground, then Stop ---");
  const storage_b = createFileStorage(STORAGE_FILE_B);
  const store_b = createConversationStore(storage_b);
  const conversation_b = await store_b.create("Background proof B");

  // Reset for scenario B
  let contentEventCountB = 0;
  const recordedEventsB: StreamEvent[] = [];
  let recordedGenerationIdB: string | null = null;
  const requestRecordsB: RequestRecord[] = [];
  let contentEventsSinceResume = 0;
  let stopGenerationPromise: Promise<void> | null = null;

  const {
    fetch: wrappingFetchB,
    getRequestRecords: getRequestRecordsB,
    getStalledPromise: getStalledPromiseB,
    getCancelInfo: getCancelInfoB,
  } = createBackgroundingFetch(fetch, token, simLifecycle.lifecycle);

  const clientB = new APIClient(SERVER_URL, wrappingFetchB, {
    lifecycle: simLifecycle.lifecycle,
  });
  clientB.setToken(token);

  // Reset lifecycle to foreground
  simLifecycle.setForeground(true);

  // Send the prompt
  let backgroundedB = false;
  let foregrounded = false;
  let stopGenerationTriggered = false;

  // Diagnostic timeline (wall-clock ms since chat start). See the escalated
  // task packet: log every checkpoint so a real timeline can be reconstructed
  // instead of relying on FAIL/PASS assumptions.
  let tChatStartB: number | null = null;
  let t5thContentB: number | null = null;
  let tForegroundCallB: number | null = null;
  let tFirstResumedEventB: number | null = null;
  let tStopTriggerB: number | null = null;
  let tDoneB: number | null = null;

  const promiseB = sendInConversation(
    clientB,
    store_b,
    conversation_b.id,
    "Count from 1 to 400 as digits separated by commas and spaces. Output only the numbers.",
    {
      onStart: (generationId: string) => {
        recordedGenerationIdB = generationId;
        tChatStartB = Date.now();
        console.log(`Scenario B: Started generation ${generationId}`);
        logTiming("chat start", tChatStartB);
      },
      onEvent: (event: StreamEvent) => {
        recordedEventsB.push(event);
        if (event.type === "content") {
          contentEventCountB += 1;
          if (!backgroundedB) {
            if (contentEventCountB === K) {
              console.log(`Scenario B: Received ${K} content events, backgrounding...`);
              t5thContentB = Date.now();
              logTiming("5th content event (background trigger)", tChatStartB);
              backgroundedB = true;
              simLifecycle.setBackground();
            }
          } else if (!foregrounded) {
            // Backgrounded and waiting to resume
          } else if (!stopGenerationTriggered) {
            if (tFirstResumedEventB === null) {
              tFirstResumedEventB = Date.now();
              logTiming("first content event after foreground", tChatStartB);
            }
            contentEventsSinceResume += 1;
            if (contentEventsSinceResume === STOP_AFTER_RESUME_K) {
              console.log(
                `Scenario B: Received ${STOP_AFTER_RESUME_K} content events after resume, calling stopGeneration...`
              );
              tStopTriggerB = Date.now();
              logTiming("stop trigger", tChatStartB);
              stopGenerationTriggered = true;
              // Call stopGeneration, which is async
              stopGenerationPromise = stopGeneration(clientB, recordedGenerationIdB!).catch((err) => {
                console.error("stopGeneration error:", err);
              });
            }
          }
        }
        if (event.type === "done") {
          tDoneB = Date.now();
          logTiming(`done event received (status=${event.data.status})`, tChatStartB);
        }
      },
      onBlocked: (msg) => fail(`Scenario B: blocked: ${msg}`),
      onError: (err) => fail(`Scenario B: error: ${err.message}`),
      onUnauthorized: () => fail("Scenario B: unauthorized"),
      onComplete: () => {
        console.log("Scenario B: onComplete called");
        logTiming("onComplete", tChatStartB);
      },
    }
  );

  // Wait for the stream to actually stall (after K content events forwarded)
  console.log("Scenario B: Waiting for stream to stall...");
  await getStalledPromiseB();
  console.log("Scenario B: Stream has stalled");
  logTiming("stream stalled (confirmed)", tChatStartB);

  // Wait 3 seconds while backgrounded
  console.log("Scenario B: Waiting 3 seconds while backgrounded...");
  await sleep(3000);

  // Restore to foreground
  console.log("Scenario B: Restoring to foreground...");
  tForegroundCallB = Date.now();
  logTiming("foreground call", tChatStartB);
  foregrounded = true;
  simLifecycle.setForeground(true);

  // Wait for the send to complete
  await promiseB;
  console.log("Scenario B: Send completed");
  logTiming("send completed (promiseB resolved)", tChatStartB);

  // Wait for stopGeneration to complete if it was called
  if (stopGenerationPromise) {
    await stopGenerationPromise;
    console.log("Scenario B: stopGeneration completed");
    logTiming("stopGeneration() call returned", tChatStartB);
  }

  // Collect request records from this scenario
  for (const req of getRequestRecordsB()) {
    requestRecordsB.push(req);
  }

  // Print the cancel POST's own send/response timing and body, independent
  // of request-record bookkeeping above -- this is the ground truth for
  // whether the server said "cancelled" or "already_complete", and when.
  const cancelInfoB = getCancelInfoB();
  if (cancelInfoB) {
    console.log(
      `[TIMING] cancel POST sent: t=${new Date(cancelInfoB.sentAt).toISOString()} ` +
        `elapsedSinceChatStart=${tChatStartB === null ? "n/a" : `${cancelInfoB.sentAt - tChatStartB}ms`}`
    );
    console.log(
      `[TIMING] cancel POST response: t=${new Date(cancelInfoB.respondedAt).toISOString()} ` +
        `elapsedSinceChatStart=${tChatStartB === null ? "n/a" : `${cancelInfoB.respondedAt - tChatStartB}ms`} ` +
        `roundTrip=${cancelInfoB.respondedAt - cancelInfoB.sentAt}ms status=${cancelInfoB.status} body=${cancelInfoB.body}`
    );
  } else {
    console.log("[TIMING] cancel POST: none observed");
  }

  console.log(
    `[TIMING] summary (ms since chat start): 5th-content=${diffMs(tChatStartB, t5thContentB)} ` +
      `first-resumed-event=${diffMs(tChatStartB, tFirstResumedEventB)} ` +
      `stop-trigger=${diffMs(tChatStartB, tStopTriggerB)} ` +
      `cancel-sent=${diffMs(tChatStartB, cancelInfoB?.sentAt ?? null)} ` +
      `cancel-responded=${diffMs(tChatStartB, cancelInfoB?.respondedAt ?? null)} ` +
      `done=${diffMs(tChatStartB, tDoneB)}`
  );

  // --- Scenario B Assertions ---
  console.log("--- Scenario B Assertions ---");

  // Assertion B-a: Exactly one cancel request
  const cancelRequestsB = requestRecordsB.filter((r) => r.url.includes("/cancel"));
  if (cancelRequestsB.length !== 1) {
    fail(`Assertion B-a: expected exactly 1 cancel request, got ${cancelRequestsB.length}`);
  }
  pass("Assertion B-a: exactly 1 cancel request");

  // Debug: print some request info
  const resumeRequestsB = requestRecordsB.filter(
    (r) =>
      r.method === "GET" &&
      r.url.includes("/v1/generations/") &&
      r.url.includes("/events")
  );
  console.log(`Debug: Resume requests in B: ${resumeRequestsB.length}`);
  for (const r of resumeRequestsB) {
    logTiming(`resume GET seen by wrapper (Last-Event-ID=${r.lastEventId})`, tChatStartB);
    console.log(
      `[DIAG] resume GET offset from foreground call: ${diffMs(tForegroundCallB, r.timestamp)}`
    );
  }

  // Assertion B-b: Exactly one done event with status cancelled
  const allDoneEventsB = recordedEventsB.filter((e) => e.type === "done");
  if (allDoneEventsB.length !== 1) {
    fail(`Assertion B-b: expected exactly 1 done event, got ${allDoneEventsB.length}`);
  }
  pass("Assertion B-b: exactly 1 done event");

  const doneEventB = allDoneEventsB[0];

  // Check oracle for comparison
  if (!recordedGenerationIdB) {
    fail("Assertion B-d: no generation ID recorded");
  }

  const oracleEventsB = await fetchOracleEvents(recordedGenerationIdB, token);
  const oracleDoneB = oracleEventsB.filter((e) => e.type === "done");
  const oracleContentEventsB = oracleEventsB.filter((e) => e.type === "content");

  console.log(`Debug: Oracle done events in B: ${oracleDoneB.length}`);
  if (oracleDoneB.length > 0) {
    console.log(`Debug: Oracle done status: ${oracleDoneB[0].data.status}`);
  }
  console.log(`Debug: Oracle content events in B: ${oracleContentEventsB.length}`);
  console.log(`Debug: Stream done status: ${doneEventB.data.status}`);
  console.log(`Debug: Stream content events: ${recordedEventsB.filter((e) => e.type === "content").length}`);

  if (doneEventB.data.status !== "cancelled") {
    fail(`Assertion B-b: done event status is "${doneEventB.data.status}", expected "cancelled"`);
  }
  pass("Assertion B-b: done event status is cancelled");

  // Assertion B-c: Stored conversation with stopped status
  const convB = await store_b.get(conversation_b.id);
  if (!convB) {
    fail("Assertion B-c: conversation not found after send");
  }

  const assistantMsgB = convB.messages.find((m) => m.role === "assistant");
  if (!assistantMsgB) {
    fail("Assertion B-c: no assistant message in conversation");
  }

  if (assistantMsgB.status !== "stopped") {
    fail(`Assertion B-c: assistant message status is "${assistantMsgB.status}", expected "stopped"`);
  }
  pass("Assertion B-c: assistant message status is stopped");

  // Assertion B-d: Oracle check
  if (oracleDoneB.length !== 1) {
    fail(`Assertion B-d: oracle should have exactly 1 done event, got ${oracleDoneB.length}`);
  }
  if (oracleDoneB[0].data.status !== "cancelled") {
    fail(`Assertion B-d: oracle done event status is "${oracleDoneB[0].data.status}", expected "cancelled"`);
  }
  pass("Assertion B-d: oracle shows generation was cancelled");

  console.log("");
  console.log("All background proof checks passed.");
}

main().catch((err) => {
  console.error("FAIL: Unexpected error:", err);
  process.exit(1);
});
