#!/usr/bin/env bun
/**
 * Live proof: connection dropped mid-reply, reconnected via Last-Event-ID,
 * yields complete reply with no gaps and no duplicated text (M4-AC2).
 *
 * Demonstrates:
 * - M4-AC2: Killing the connection mid-reply and reconnecting yields the
 *   complete reply with no gaps and no duplicated text.
 *
 * Uses the app's own client (src/api/client.ts), conversation store
 * (src/store/conversationStore.ts), and conversation session module
 * (src/chat/conversationSession.ts) -- the same code paths the phone app
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
}

import type { StreamEvent, FetchImpl } from "@/api/client";

const SERVER_URL = process.env.SERVER_URL || "https://ryans-mac-studio.tailc3648a.ts.net:8443";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const TOKEN_FILE = process.env.PHONE_MODELS_TOKEN_FILE || `${process.env.HOME}/.phone-models/token`;
const OLLAMA_FETCH_TIMEOUT_MS = 30_000;
const LOAD_UNLOAD_MAX_WAIT_MS = 180_000;
const CHAT_TIMEOUT_MS = 180_000;
const K = 5; // Kill after K content events

// Use a temp file for storage persistence testing
const TEMP_DIR = "/private/tmp";
const STORAGE_FILE = `${TEMP_DIR}/resume-proof-storage-${Date.now()}.jsonl`;

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
 * Wraps a real fetch with connection drop simulation after K content events
 * on the FIRST POST /v1/chat only.
 */
function createKillingFetch(realFetch: typeof fetch, token: string) {
  let firstChatSeen = false;
  const requestRecords: RequestRecord[] = [];
  let contentEventCount = 0;
  let killFired = false;
  let killAbortController: AbortController | null = null;

  const wrappingFetch: FetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method || "GET";
    const lastEventIdHeader = init?.headers && typeof init.headers === "object" && !Array.isArray(init.headers) ? (init.headers as Record<string, string>)["Last-Event-ID"] : undefined;

    requestRecords.push({
      method,
      url,
      ...(lastEventIdHeader ? { lastEventId: lastEventIdHeader } : {}),
    });

    // For the FIRST POST /v1/chat only, kill after K content events
    if (method === "POST" && url.includes("/v1/chat") && !firstChatSeen) {
      firstChatSeen = true;

      // Create our own AbortController for the real request
      killAbortController = new AbortController();
      const originalSignal = init?.signal;

      // If the caller's signal aborts, also abort our request
      if (originalSignal) {
        originalSignal.addEventListener("abort", () => killAbortController?.abort());
      }

      try {
        // Make the real request with our abort controller
        const realResponse = await realFetch(url, {
          ...init,
          signal: killAbortController.signal,
        });

        // Get the headers we need to return
        const status = realResponse.status;
        const headers = new Headers(realResponse.headers);
        const generationId = headers.get("x-generation-id");
        const contentType = headers.get("content-type");

        if (!realResponse.body) {
          return realResponse;
        }

        // Create a custom ReadableStream that will count content events
        // and kill after K
        let killTriggered = false;
        let buffer = "";

        const readableStream = new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              const reader = realResponse.body!.getReader();

              while (!killTriggered) {
                try {
                  const { done, value } = await reader.read();

                  if (done) {
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

                    // Check if this is a content event
                    if (line.startsWith("event: content")) {
                      contentEventCount += 1;

                      if (contentEventCount >= K) {
                        // Kill after K content events
                        killTriggered = true;
                        killFired = true;
                        reader.cancel().catch(() => {});
                        controller.error(new TypeError("simulated network drop"));
                        killAbortController?.abort();
                        return;
                      }
                    }

                    // Forward the line if we haven't killed yet
                    controller.enqueue(new TextEncoder().encode(line + "\n"));
                  }
                } catch (e) {
                  if (!killTriggered) {
                    controller.error(e);
                  }
                  return;
                }
              }
            } catch (e) {
              if (!killTriggered) {
                controller.error(e);
              }
            }
          },
        });

        // Return a new Response with the custom readable stream
        return new Response(readableStream, {
          status,
          statusText: realResponse.statusText,
          headers,
        });
      } catch (error) {
        throw error;
      }
    }

    // For all other requests, just pass through
    return realFetch(url, init);
  };

  return {
    fetch: wrappingFetch,
    getRequestRecords: () => requestRecords,
    getContentEventCount: () => contentEventCount,
    didKillFire: () => killFired,
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

  const { createAPIClient } = await import("../src/api/client");
  const { runModelAction } = await import("../src/ui/modelActions");
  const { sendInConversation } = await import("../src/chat/conversationSession");
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

  // Create the wrapping fetch that will kill the connection
  const { fetch: wrappingFetch, getRequestRecords, getContentEventCount, didKillFire } =
    createKillingFetch(fetch, token);

  const client = createAPIClient(SERVER_URL, wrappingFetch);
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

  // --- Check 3: Send message with connection kill ---
  console.log("--- Check 3: Sending message with connection kill ---");
  const storage = createFileStorage(STORAGE_FILE);
  const store = createConversationStore(storage);
  const conversation = await store.create("Resume proof");

  // Track stream events
  const recordedEvents: StreamEvent[] = [];
  let recordedGenerationId: string | null = null;

  await sendInConversation(
    client,
    store,
    conversation.id,
    "Count from 1 to 80 as digits separated by commas and spaces. Output only the numbers.",
    {
      onStart: (generationId: string) => {
        recordedGenerationId = generationId;
      },
      onEvent: (event: StreamEvent) => {
        recordedEvents.push(event);
      },
      onBlocked: (msg) => fail(`Check 3: blocked: ${msg}`),
      onError: (err) => fail(`Check 3: error: ${err.message}`),
      onUnauthorized: () => fail("Check 3: unauthorized"),
      onComplete: () => {},
    }
  );

  // --- Assertion 3a: Kill happened ---
  console.log("--- Assertion 3a: Kill happened ---");
  const contentEventsForwarded = getContentEventCount();
  if (contentEventsForwarded !== K) {
    fail(
      `Assertion 3a: expected exactly ${K} content events forwarded before kill, got ${contentEventsForwarded}`
    );
  }
  pass(`Assertion 3a: exactly ${K} content events forwarded before kill`);

  // Check that the kill actually happened
  if (!didKillFire()) {
    fail("Assertion 3a: kill did not fire");
  }
  pass("Assertion 3a: kill fired");

  // --- Assertion 3b: Resume requests were made ---
  console.log("--- Assertion 3b: Resume requests made ---");
  const requests = getRequestRecords();
  const resumeRequests = requests.filter(
    (r) =>
      r.method === "GET" &&
      r.url.includes("/v1/generations/") &&
      r.url.includes("/events")
  );
  if (resumeRequests.length === 0) {
    fail("Assertion 3b: no resume requests (GET /v1/generations/<genId>/events) made");
  }
  pass(`Assertion 3b: ${resumeRequests.length} resume request(s) made`);

  // Check Last-Event-ID header format
  let validLastEventIdFound = false;
  for (const req of resumeRequests) {
    if (req.lastEventId && recordedGenerationId) {
      const expectedPrefix = recordedGenerationId + "-";
      if (req.lastEventId.startsWith(expectedPrefix)) {
        const seqPart = req.lastEventId.substring(expectedPrefix.length);
        if (/^\d+$/.test(seqPart)) {
          validLastEventIdFound = true;
          break;
        }
      }
    }
  }
  if (!validLastEventIdFound) {
    fail("Assertion 3b: no valid Last-Event-ID header found in resume requests");
  }
  pass("Assertion 3b: valid Last-Event-ID header found in resume requests");

  // --- Assertion 3c: Exactly one done event with status complete ---
  console.log("--- Assertion 3c: Done event validation ---");
  const allDoneEvents = recordedEvents.filter((e) => e.type === "done");
  if (allDoneEvents.length !== 1) {
    fail(
      `Assertion 3c: expected exactly 1 done event, got ${allDoneEvents.length}`
    );
  }
  pass("Assertion 3c: exactly 1 done event");

  const doneEvent = allDoneEvents[0];
  if (doneEvent.data.status !== "complete") {
    fail(
      `Assertion 3c: done event status is "${doneEvent.data.status}", expected "complete"`
    );
  }
  pass("Assertion 3c: done event status is complete");

  // --- Assertion 3d: Oracle check ---
  console.log("--- Assertion 3d: Oracle check ---");
  if (!recordedGenerationId) {
    fail("Assertion 3d: no generation ID recorded");
  }

  const oracleEvents = await fetchOracleEvents(recordedGenerationId, token);
  const oracleContentEvents = oracleEvents.filter((e) => e.type === "content");
  const oracleExpected = oracleContentEvents.map((e) => e.data.text).join("");

  const recordedContentEvents = recordedEvents.filter((e) => e.type === "content");
  const recordedContent = recordedContentEvents.map((e) => e.data.text).join("");

  if (recordedContent !== oracleExpected) {
    fail(
      `Assertion 3d: content mismatch. Recorded: "${recordedContent.substring(0, 100)}...", Oracle: "${oracleExpected.substring(0, 100)}..."`
    );
  }
  pass("Assertion 3d: recorded content matches oracle");

  if (recordedContentEvents.length !== oracleContentEvents.length) {
    fail(
      `Assertion 3d: content event count mismatch. Recorded: ${recordedContentEvents.length}, Oracle: ${oracleContentEvents.length}`
    );
  }
  pass(
    `Assertion 3d: content event count matches (${recordedContentEvents.length})`
  );

  // --- Assertion 3e: Stored conversation ---
  console.log("--- Assertion 3e: Stored conversation validation ---");
  const conv = await store.get(conversation.id);
  if (!conv) {
    fail("Assertion 3e: conversation not found after send");
  }

  const assistantMsg = conv.messages.find((m) => m.role === "assistant");
  if (!assistantMsg) {
    fail("Assertion 3e: no assistant message in conversation");
  }

  if (assistantMsg.status !== "complete") {
    fail(
      `Assertion 3e: assistant message status is "${assistantMsg.status}", expected "complete"`
    );
  }
  pass("Assertion 3e: assistant message status is complete");

  if (assistantMsg.content !== recordedContent) {
    fail("Assertion 3e: stored message content does not match recorded content");
  }
  pass("Assertion 3e: stored message content matches recorded content");

  // --- Assertion 3f: Response contains "80" ---
  console.log("--- Assertion 3f: Response contains 80 ---");
  if (!assistantMsg.content.includes("80")) {
    fail(`Assertion 3f: response does not contain "80". Got: "${assistantMsg.content}"`);
  }
  pass("Assertion 3f: response contains 80");

  console.log("");
  console.log(`Response (first 200 chars): ${assistantMsg.content.substring(0, 200)}`);
  console.log(`Content event count: ${recordedContentEvents.length}`);
  console.log("");
  console.log("All resume proof checks passed.");
}

main().catch((err) => {
  console.error("FAIL: Unexpected error:", err);
  process.exit(1);
});
