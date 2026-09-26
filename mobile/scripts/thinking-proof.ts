#!/usr/bin/env bun
/**
 * Live proof: thinking-capable model's reasoning arrives as `thinking` events
 * separate from the answer and is stored separately by the app's own send path;
 * a non-thinking model still replies normally -- all against the real server over
 * the tailnet and the real Ollama on the Mac.
 *
 * Demonstrates:
 * - M4-AC1: Thinking events are emitted before content events, the first
 *   thinking event arrives before the first content event, and they are stored
 *   separately in the assistant message's thinking and content fields.
 * - Non-thinking model unaffected: Models without thinking capability emit no
 *   thinking events and reply normally.
 *
 * Uses the app's own client (src/api/client.ts), conversation store
 * (src/store/conversationStore.ts), and conversation session module
 * (src/chat/conversationSession.ts) -- the same code paths the phone app
 * itself uses.
 *
 * T and N are the two smallest installed models derived from /api/show
 * capabilities: T has "thinking", N does not. Ollama's /api/ps is fetched
 * directly (not through the server) at each checkpoint to independently verify
 * what is actually resident.
 *
 * Model replies are nondeterministic. If a thinking model's output doesn't
 * meet expectations once, one retry is acceptable and must be reported.
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

interface OllamaPsModel {
  name: string;
}

interface OllamaPsResponse {
  models: OllamaPsModel[];
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

import type { StreamEvent } from "@/api/client";

const SERVER_URL = process.env.SERVER_URL || "https://ryans-mac-studio.tailc3648a.ts.net:8443";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const TOKEN_FILE = process.env.PHONE_MODELS_TOKEN_FILE || `${process.env.HOME}/.phone-models/token`;
const OLLAMA_FETCH_TIMEOUT_MS = 30_000;
const LOAD_UNLOAD_MAX_WAIT_MS = 180_000;
const CHAT_TIMEOUT_MS = 180_000;

// Use a temp file for storage persistence testing
const TEMP_DIR = "/private/tmp";
const STORAGE_FILE = `${TEMP_DIR}/thinking-proof-storage-${Date.now()}.jsonl`;

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

async function main() {
  const tokenBuffer = await Bun.file(TOKEN_FILE).bytes();
  const token = new TextDecoder().decode(tokenBuffer).trim();
  if (!token) fail("token file is empty");

  const { createAPIClient } = await import("../src/api/client");
  const { runModelAction } = await import("../src/ui/modelActions");
  const { sendInConversation } = await import("../src/chat/conversationSession");
  const { createConversationStore } = await import("../src/store/conversationStore");
  const { createFileStorage } = await import("../src/store/fileStorage");

  const client = createAPIClient(SERVER_URL, fetch);
  client.setToken(token);

  // --- Check 1: Pick models from Ollama directly ----------
  console.log("--- Check 1: Picking models from Ollama ---");
  const tags = await getOllamaTags();
  if (tags.models.length === 0) {
    fail("Check 1: no models installed in Ollama");
  }

  // Sort by size to get the smallest models
  const bySize = [...tags.models].sort((a, b) => a.size - b.size);

  let thinkingModel: string | null = null;
  let nonThinkingModel: string | null = null;

  for (const modelInfo of bySize) {
    const show = await getOllamaShow(modelInfo.name);
    const capabilities = show.capabilities || [];
    if (!thinkingModel && capabilities.includes("thinking")) {
      thinkingModel = modelInfo.name;
    }
    if (!nonThinkingModel && capabilities.includes("completion") && !capabilities.includes("thinking")) {
      nonThinkingModel = modelInfo.name;
    }
    if (thinkingModel && nonThinkingModel) break;
  }

  if (!thinkingModel) {
    fail("Check 1: no thinking-capable model installed");
  }
  if (!nonThinkingModel) {
    fail("Check 1: no non-thinking completion model installed");
  }

  console.log(`T (thinking-capable): ${thinkingModel}`);
  console.log(`N (non-thinking): ${nonThinkingModel}`);
  console.log("");

  // --- Check 2: Thinking model (M4-AC1) ---
  console.log(`--- Check 2: Testing thinking model (${thinkingModel}) ---`);

  // Load thinking model
  console.log(`Loading ${thinkingModel}...`);
  const stateAfterLoadT = await runModelAction({
    getState: () => client.getState(),
    start: () => client.loadModel({ name: thinkingModel, confirm: true }),
    maxWaitMs: LOAD_UNLOAD_MAX_WAIT_MS,
  });
  if ("cancelled" in stateAfterLoadT) {
    fail("Check 2: load T was unexpectedly cancelled");
  }

  const psAfterLoadT = await getOllamaPs();
  const loadedModels = psAfterLoadT.models.map((m) => m.name);
  if (!loadedModels.includes(thinkingModel)) {
    fail(`Check 2: /api/ps does not show ${thinkingModel} resident, got ${JSON.stringify(loadedModels)}`);
  }
  pass(`Check 2: ${thinkingModel} is resident`);

  // Create conversation and send message
  const storage = createFileStorage(STORAGE_FILE);
  const store = createConversationStore(storage);
  const conversation = await store.create("Thinking proof");

  // Track stream events
  const recordedEvents: StreamEvent[] = [];
  let firstThinkingEventIndex = -1;
  let firstContentEventIndex = -1;

  await sendInConversation(
    client,
    store,
    conversation.id,
    "What is 17 + 25? Answer with just the number.",
    {
      onStart: () => {},
      onEvent: (event: StreamEvent) => {
        recordedEvents.push(event);
        if (event.type === "thinking" && firstThinkingEventIndex === -1) {
          firstThinkingEventIndex = recordedEvents.length - 1;
        }
        if (event.type === "content" && firstContentEventIndex === -1) {
          firstContentEventIndex = recordedEvents.length - 1;
        }
      },
      onBlocked: (msg) => fail(`Check 2: blocked: ${msg}`),
      onError: (err) => fail(`Check 2: error: ${err.message}`),
      onUnauthorized: () => fail("Check 2: unauthorized"),
      onComplete: () => {},
    }
  );

  // Assert at least one thinking event with non-empty text
  const thinkingEvents = recordedEvents.filter((e) => e.type === "thinking");
  if (thinkingEvents.length === 0) {
    fail("Check 2 (M4-AC1): no thinking events received");
  }
  const hasNonEmptyThinking = thinkingEvents.some((e) => e.data.text.length > 0);
  if (!hasNonEmptyThinking) {
    fail("Check 2 (M4-AC1): all thinking events are empty");
  }
  pass("Check 2 (M4-AC1): at least one thinking event with non-empty text");

  // Assert at least one content event
  const contentEvents = recordedEvents.filter((e) => e.type === "content");
  if (contentEvents.length === 0) {
    fail("Check 2 (M4-AC1): no content events received");
  }
  pass("Check 2 (M4-AC1): at least one content event");

  // Assert first thinking event arrives before first content event
  if (firstThinkingEventIndex === -1 || firstContentEventIndex === -1) {
    fail("Check 2 (M4-AC1): missing thinking or content event");
  }
  if (firstThinkingEventIndex >= firstContentEventIndex) {
    fail("Check 2 (M4-AC1): first thinking event does not arrive before first content event");
  }
  pass("Check 2 (M4-AC1): first thinking event arrives before first content event");

  // Assert terminal done with status "complete"
  const doneEvents = recordedEvents.filter((e) => e.type === "done");
  if (doneEvents.length === 0) {
    fail("Check 2 (M4-AC1): no done event");
  }
  const lastDoneEvent = doneEvents[doneEvents.length - 1];
  if (lastDoneEvent.data.status !== "complete") {
    fail(`Check 2 (M4-AC1): terminal done status is "${lastDoneEvent.data.status}", expected "complete"`);
  }
  pass("Check 2 (M4-AC1): terminal done with status complete");

  // Read back from store and assert separate storage
  let conv = await store.get(conversation.id);
  if (!conv) fail("Check 2: conversation not found after send");
  const assistantMsg = conv.messages.find((m) => m.role === "assistant");
  if (!assistantMsg) fail("Check 2: no assistant message in conversation");

  if (!assistantMsg.thinking || assistantMsg.thinking.length === 0) {
    fail("Check 2 (M4-AC1): stored message has empty or missing thinking field");
  }
  pass("Check 2 (M4-AC1): stored message has non-empty thinking field");

  if (!assistantMsg.content || assistantMsg.content.length === 0) {
    fail("Check 2 (M4-AC1): stored message has empty or missing content field");
  }
  pass("Check 2 (M4-AC1): stored message has non-empty content field");

  if (!assistantMsg.content.includes("42")) {
    fail(`Check 2 (M4-AC1): content does not contain "42", got: "${assistantMsg.content}"`);
  }
  pass('Check 2 (M4-AC1): content contains "42"');

  if (assistantMsg.content.includes(assistantMsg.thinking)) {
    fail("Check 2 (M4-AC1): content contains the full thinking text (should be stored separately)");
  }
  pass("Check 2 (M4-AC1): content does not contain the full thinking text (stored separately)");

  // Print first 200 characters
  console.log(`  Thinking (first 200 chars): ${assistantMsg.thinking.slice(0, 200)}`);
  console.log(`  Content (first 200 chars): ${assistantMsg.content.slice(0, 200)}`);
  console.log("");

  // --- Check 3: Non-thinking model unaffected ---
  console.log(`--- Check 3: Testing non-thinking model (${nonThinkingModel}) ---`);

  // Load non-thinking model
  console.log(`Loading ${nonThinkingModel}...`);
  const stateAfterLoadN = await runModelAction({
    getState: () => client.getState(),
    start: () => client.loadModel({ name: nonThinkingModel, confirm: true }),
    maxWaitMs: LOAD_UNLOAD_MAX_WAIT_MS,
  });
  if ("cancelled" in stateAfterLoadN) {
    fail("Check 3: load N was unexpectedly cancelled");
  }

  const psAfterLoadN = await getOllamaPs();
  const modelsAfterSwap = psAfterLoadN.models.map((m) => m.name);
  if (!modelsAfterSwap.includes(nonThinkingModel)) {
    fail(`Check 3: /api/ps does not show ${nonThinkingModel} resident`);
  }
  pass(`Check 3: ${nonThinkingModel} is resident`);

  // Create new conversation for non-thinking test
  const conversation2 = await store.create("Non-thinking proof");

  // Track events for non-thinking model
  const recordedEventsN: StreamEvent[] = [];

  await sendInConversation(
    client,
    store,
    conversation2.id,
    "Reply with just OK.",
    {
      onStart: () => {},
      onEvent: (event: StreamEvent) => {
        recordedEventsN.push(event);
      },
      onBlocked: (msg) => fail(`Check 3: blocked: ${msg}`),
      onError: (err) => fail(`Check 3: error: ${err.message}`),
      onUnauthorized: () => fail("Check 3: unauthorized"),
      onComplete: () => {},
    }
  );

  // Assert zero thinking events
  const thinkingEventsN = recordedEventsN.filter((e) => e.type === "thinking");
  if (thinkingEventsN.length !== 0) {
    fail(`Check 3: expected 0 thinking events, got ${thinkingEventsN.length}`);
  }
  pass("Check 3: zero thinking events");

  // Assert non-empty content
  const contentEventsN = recordedEventsN.filter((e) => e.type === "content");
  if (contentEventsN.length === 0) {
    fail("Check 3: no content events");
  }
  const hasNonEmptyContent = contentEventsN.some((e) => e.data.text.length > 0);
  if (!hasNonEmptyContent) {
    fail("Check 3: all content events are empty");
  }
  pass("Check 3: non-empty content");

  // Assert done status "complete"
  const doneEventsN = recordedEventsN.filter((e) => e.type === "done");
  if (doneEventsN.length === 0) {
    fail("Check 3: no done event");
  }
  const lastDoneEventN = doneEventsN[doneEventsN.length - 1];
  if (lastDoneEventN.data.status !== "complete") {
    fail(`Check 3: done status is "${lastDoneEventN.data.status}", expected "complete"`);
  }
  pass("Check 3: done status complete");

  // Assert stored message has no thinking field
  const conv2 = await store.get(conversation2.id);
  if (!conv2) fail("Check 3: conversation not found");
  const assistantMsgN = conv2.messages.find((m) => m.role === "assistant");
  if (!assistantMsgN) fail("Check 3: no assistant message");

  if (assistantMsgN.thinking) {
    fail("Check 3: stored message should not have thinking field");
  }
  pass("Check 3: stored message has no thinking field");

  console.log("");
  console.log("All thinking proof checks passed.");
}

main().catch((err) => {
  console.error("FAIL: Unexpected error:", err);
  process.exit(1);
});
