#!/usr/bin/env bun
/**
 * Live proof: conversation context, attribution across a model switch, blocked
 * send with no resident model, and persistence across store restart -- all
 * against the real server over the tailnet and the real Ollama on the Mac.
 *
 * Demonstrates:
 * - M3-AC2: A follow-up prompt in the same conversation demonstrably uses
 *   context from an earlier turn (a made-up secret code word).
 * - M3-AC3: Each assistant reply displays the model name that produced it,
 *   including after a mid-conversation model switch.
 * - M3-AC4: Sending with no model resident is blocked with a prompt to load one.
 * - M3-AC5 (proxy): Force-quitting and reopening (via a fresh store over the same
 *   StoragePort, using a temp file) shows the same conversations and messages.
 *   The on-device force-quit check is a separate human step.
 *
 * Uses the app's own client (src/api/client.ts), conversation store
 * (src/store/conversationStore.ts), and conversation session module
 * (src/chat/conversationSession.ts) -- the same code paths the phone app
 * itself uses.
 *
 * A and B are the two smallest installed models, derived from /api/tags (no
 * hardcoded model names). Ollama's /api/ps is fetched directly (not through
 * the server) at each checkpoint to independently verify what is actually
 * resident.
 *
 * Model replies are nondeterministic. The secret code word prompts are kept
 * short and explicit; if turn 2 ignores the instruction once, one retry is
 * acceptable and must be reported in the output.
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

const SERVER_URL = process.env.SERVER_URL || "https://ryans-mac-studio.tailc3648a.ts.net:8443";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const TOKEN_FILE = process.env.PHONE_MODELS_TOKEN_FILE || `${process.env.HOME}/.phone-models/token`;
const OLLAMA_FETCH_TIMEOUT_MS = 30_000;
const LOAD_UNLOAD_MAX_WAIT_MS = 180_000;
const CHAT_TIMEOUT_MS = 180_000;

// Use a temp file for storage persistence testing
const TEMP_DIR = "/private/tmp";
const STORAGE_FILE = `${TEMP_DIR}/conversation-proof-storage-${Date.now()}.jsonl`;

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

async function getOllamaPs(): Promise<OllamaPsResponse> {
  const response = await fetchWithTimeout(`${OLLAMA_URL}/api/ps`, OLLAMA_FETCH_TIMEOUT_MS);
  if (!response.ok) fail(`fetching Ollama /api/ps: HTTP ${response.status}`);
  return response.json();
}

function randomCodeWord(): string {
  const words = ["elephant", "pyramid", "cascade", "horizon", "quantum", "phoenix", "nebula"];
  return words[Math.floor(Math.random() * words.length)];
}

async function main() {
  const tokenBuffer = await Bun.file(TOKEN_FILE).bytes();
  const token = new TextDecoder().decode(tokenBuffer).trim();
  if (!token) fail("token file is empty");

  const { createAPIClient } = await import("../src/api/client");
  const { runModelAction } = await import("../src/ui/modelActions");
  const { toModelListView } = await import("../src/ui/modelList");
  const { sendInConversation } = await import("../src/chat/conversationSession");
  const { createConversationStore } = await import("../src/store/conversationStore");
  const { createFileStorage } = await import("../src/store/fileStorage");

  const client = createAPIClient(SERVER_URL, fetch);
  client.setToken(token);

  // Tracking for assertions
  let recordingMessagesForTurn2 = false;
  let recordedTurn2Messages: Array<{ role: string; content: string }> = [];
  let chatCallCountDuringBlockedSend = 0;

  // Wrap client.chat to record messages and count calls
  const originalChat = client.chat.bind(client);
  client.chat = async function (request: any, options: any) {
    if (recordingMessagesForTurn2) {
      recordedTurn2Messages = request.messages;
    }
    chatCallCountDuringBlockedSend++;
    return originalChat(request, options);
  };

  // Derive A and B: the two smallest installed models, from /api/tags.
  const tags = await getOllamaTags();
  if (tags.models.length < 2) {
    fail(`need at least 2 installed models to prove a swap, /api/tags has ${tags.models.length}`);
  }
  const bySize = [...tags.models].sort((a, b) => a.size - b.size);
  const modelA = bySize[0].name;
  const modelB = bySize[1].name;
  console.log(`Derived from /api/tags (two smallest by size): A=${modelA}, B=${modelB}`);
  console.log("");

  // --- Step 1: load A -------------------------------------------------------
  console.log(`--- Step 1: load A (${modelA}) via app client ---`);
  const stateAfterLoadA = await runModelAction({
    getState: () => client.getState(),
    start: () => client.loadModel({ name: modelA, confirm: true }),
    maxWaitMs: LOAD_UNLOAD_MAX_WAIT_MS,
  });
  if ("cancelled" in stateAfterLoadA) {
    fail("Step 1: load A was unexpectedly cancelled");
  }
  const psAfterLoadA = await getOllamaPs();
  const loadedModels = psAfterLoadA.models.map((m) => m.name);
  if (!loadedModels.includes(modelA)) {
    fail(`Step 1: /api/ps does not show ${modelA} resident, got ${JSON.stringify(loadedModels)}`);
  }
  pass(`Step 1: ${modelA} is resident`);
  console.log("");

  // --- Step 2: create conversation and send turn 1 (context setup) --------
  console.log("--- Step 2: create conversation, send turn 1 with secret code word ---");
  const storage = createFileStorage(STORAGE_FILE);
  const store = createConversationStore(storage);
  const conversation = await store.create("Conversation proof");
  const codeWord = randomCodeWord();
  console.log(`  Secret code word: "${codeWord}"`);

  let turn1Messages: Array<{ role: string; content: string }> = [];

  await sendInConversation(
    client,
    store,
    conversation.id,
    `My secret code word is ${codeWord}. Reply with only "OK".`,
    {
      onStart: () => {},
      onEvent: () => {},
      onBlocked: (msg) => fail(`Step 2 turn 1: blocked: ${msg}`),
      onError: (err) => fail(`Step 2 turn 1: error: ${err.message}`),
      onUnauthorized: () => fail("Step 2 turn 1: unauthorized"),
      onComplete: () => {},
    }
  );
  pass("Step 2 turn 1: sent and persisted");

  let conv = await store.get(conversation.id);
  if (!conv) fail("Step 2: conversation not found after turn 1");
  if (conv.messages.length < 2) {
    fail(`Step 2: expected at least 2 messages (user + assistant), got ${conv.messages.length}`);
  }
  const turn1Reply = conv.messages[conv.messages.length - 1];
  if (turn1Reply.role !== "assistant") {
    fail("Step 2: last message is not from assistant");
  }
  if (!turn1Reply.model || turn1Reply.model !== modelA) {
    fail(`Step 2: turn 1 reply model is ${turn1Reply.model}, expected ${modelA}`);
  }
  pass(`Step 2: turn 1 reply is persisted with model ${modelA}`);
  console.log("");

  // --- Step 3: send turn 2 (context check) --------------------------------
  console.log("--- Step 3: send turn 2 asking for secret code word ---");

  let turn2Content = "";

  recordingMessagesForTurn2 = true;
  recordedTurn2Messages = [];
  await sendInConversation(
    client,
    store,
    conversation.id,
    "What is my secret code word? Reply with just the word.",
    {
      onStart: () => {},
      onEvent: (event) => {
        if (event.type === "content") {
          turn2Content += event.data.text;
        }
      },
      onBlocked: (msg) => fail(`Step 3 turn 2: blocked: ${msg}`),
      onError: (err) => fail(`Step 3 turn 2: error: ${err.message}`),
      onUnauthorized: () => fail("Step 3 turn 2: unauthorized"),
      onComplete: () => {},
    }
  );
  recordingMessagesForTurn2 = false;

  // Assert that the messages sent to client.chat include the turn-1 user and assistant messages
  if (recordedTurn2Messages.length < 3) {
    fail(
      `Step 3 (M3-AC2): expected at least 3 messages (turn-1 user, turn-1 assistant, turn-2 user), got ${recordedTurn2Messages.length}`
    );
  }
  const turn1UserMsg = recordedTurn2Messages.find(
    (m) => m.role === "user" && m.content.includes(codeWord)
  );
  if (!turn1UserMsg) {
    fail(
      `Step 3 (M3-AC2): messages sent to client did not include the turn-1 user message with the code word. Messages: ${JSON.stringify(recordedTurn2Messages)}`
    );
  }
  const turn1AssistantMsg = recordedTurn2Messages.find(
    (m) => m.role === "assistant" && m.content.toLowerCase().includes("ok")
  );
  if (!turn1AssistantMsg) {
    fail(
      `Step 3 (M3-AC2): messages sent to client did not include the turn-1 assistant reply. Messages: ${JSON.stringify(recordedTurn2Messages)}`
    );
  }
  pass(
    "Step 3 (M3-AC2): messages sent to client.chat include turn-1 user and assistant messages"
  );

  conv = await store.get(conversation.id);
  if (!conv) fail("Step 3: conversation not found after turn 2");
  const turn2Reply = conv.messages[conv.messages.length - 1];
  if (turn2Reply.role !== "assistant") {
    fail("Step 3: last message is not from assistant after turn 2");
  }

  // Check that the response contains the code word (case-insensitive)
  const codeWordLower = codeWord.toLowerCase();
  let contextCheckPassed = turn2Reply.content.toLowerCase().includes(codeWordLower);
  if (!contextCheckPassed) {
    console.log(`  Turn 2 response: "${turn2Reply.content}"`);
    console.log(`  Expected to contain: "${codeWord}"`);
    // Retry once if it failed
    console.log(`  Retrying turn 2...`);
    turn2Content = "";
    recordingMessagesForTurn2 = true;
    recordedTurn2Messages = [];
    await sendInConversation(
      client,
      store,
      conversation.id,
      "What is my secret code word? Reply with just the word.",
      {
        onStart: () => {},
        onEvent: (event) => {
          if (event.type === "content") {
            turn2Content += event.data.text;
          }
        },
        onBlocked: (msg) => fail(`Step 3 turn 2 retry: blocked: ${msg}`),
        onError: (err) => fail(`Step 3 turn 2 retry: error: ${err.message}`),
        onUnauthorized: () => fail("Step 3 turn 2 retry: unauthorized"),
        onComplete: () => {},
      }
    );
    recordingMessagesForTurn2 = false;
    conv = await store.get(conversation.id);
    if (!conv) fail("Step 3 retry: conversation not found");
    const turn2RetryReply = conv.messages[conv.messages.length - 1];
    if (!turn2RetryReply.content.toLowerCase().includes(codeWordLower)) {
      fail(
        `Step 3 (M3-AC2): context check failed. Turn 2 response does not contain "${codeWord}". Got: "${turn2RetryReply.content}"`
      );
    }
    pass("Step 3 (M3-AC2): context check passed (with one retry)");
  } else {
    pass("Step 3 (M3-AC2): context check passed");
  }
  console.log("");

  // --- Step 4: swap to model B and send turn 3 (attribution) ---------------
  console.log(`--- Step 4: swap to model B (${modelB}) ---`);
  const stateAfterLoadB = await runModelAction({
    getState: () => client.getState(),
    start: () => client.loadModel({ name: modelB, confirm: true }),
    maxWaitMs: LOAD_UNLOAD_MAX_WAIT_MS,
  });
  if ("cancelled" in stateAfterLoadB) {
    fail("Step 4: load B was unexpectedly cancelled");
  }
  const psAfterLoadB = await getOllamaPs();
  const modelsAfterSwap = psAfterLoadB.models.map((m) => m.name);
  if (!modelsAfterSwap.includes(modelB)) {
    fail(`Step 4: /api/ps does not show ${modelB} resident, got ${JSON.stringify(modelsAfterSwap)}`);
  }
  pass(`Step 4: swapped to ${modelB}`);

  console.log(`--- Step 5: send turn 3 with model B ---`);
  // Count assistant messages before sending turn 3
  const assistantCountBeforeTurn3 = conv.messages.filter((m) => m.role === "assistant").length;

  await sendInConversation(
    client,
    store,
    conversation.id,
    "Reply with OK.",
    {
      onStart: () => {},
      onEvent: () => {},
      onBlocked: (msg) => fail(`Step 5: blocked: ${msg}`),
      onError: (err) => fail(`Step 5: error: ${err.message}`),
      onUnauthorized: () => fail("Step 5: unauthorized"),
      onComplete: () => {},
    }
  );

  conv = await store.get(conversation.id);
  if (!conv) fail("Step 5: conversation not found");
  const assistantMessages = conv.messages.filter((m) => m.role === "assistant");
  if (assistantMessages.length < assistantCountBeforeTurn3 + 1) {
    fail(
      `Step 5: expected at least ${assistantCountBeforeTurn3 + 1} assistant messages, got ${assistantMessages.length}`
    );
  }

  // The first assistant message should be from model A
  const turn1Msg = assistantMessages[0];
  if (turn1Msg.model !== modelA) {
    fail(`Step 5 (M3-AC3): turn 1 reply model is ${turn1Msg.model}, expected ${modelA}`);
  }

  // The last assistant message should be from model B (the turn 3 reply sent after swap)
  const turn3Msg = assistantMessages[assistantMessages.length - 1];
  if (turn3Msg.model !== modelB) {
    fail(`Step 5 (M3-AC3): turn 3 reply model is ${turn3Msg.model}, expected ${modelB}`);
  }
  pass(`Step 5 (M3-AC3): turn 1 has model ${modelA}, turn 3 (after swap) has model ${modelB}`);
  console.log("");

  // --- Step 6: unload and test blocked send (M3-AC4) ----------------------
  console.log("--- Step 6: unload model and test blocked send ---");
  const stateAfterUnload = await runModelAction({
    getState: () => client.getState(),
    start: () => client.unloadModel({ confirm: true }),
    maxWaitMs: LOAD_UNLOAD_MAX_WAIT_MS,
  });
  if ("cancelled" in stateAfterUnload) {
    fail("Step 6: unload was unexpectedly cancelled");
  }

  const psAfterUnload = await getOllamaPs();
  if (psAfterUnload.models.length !== 0) {
    fail(
      `Step 6: expected /api/ps to be empty after unload, got ${psAfterUnload.models.length} models`
    );
  }
  pass("Step 6: unload successful, /api/ps is empty");

  let blockedCalled = false;
  let blockedMessage = "";
  chatCallCountDuringBlockedSend = 0;
  await sendInConversation(
    client,
    store,
    conversation.id,
    "Test blocked send.",
    {
      onStart: () => {},
      onEvent: () => {},
      onBlocked: (msg) => {
        blockedCalled = true;
        blockedMessage = msg;
      },
      onError: (err) => fail(`Step 6 blocked test: error (should be blocked): ${err.message}`),
      onUnauthorized: () => fail("Step 6 blocked test: unauthorized"),
      onComplete: () => {},
    }
  );

  if (!blockedCalled) {
    fail("Step 6 (M3-AC4): send was not blocked when no model resident");
  }
  if (!blockedMessage.toLowerCase().includes("load")) {
    fail(`Step 6 (M3-AC4): blocked message should mention loading a model, got: "${blockedMessage}"`);
  }
  pass(`Step 6 (M3-AC4): send correctly blocked with message: "${blockedMessage}"`);

  // Count POST /v1/chat requests and assert none were made
  if (chatCallCountDuringBlockedSend !== 0) {
    fail(
      `Step 6 (M3-AC4): expected 0 POST /v1/chat calls during blocked send, but client.chat was called ${chatCallCountDuringBlockedSend} times`
    );
  }
  pass("Step 6 (M3-AC4): no POST /v1/chat was made (client.chat not called)");

  // Verify no assistant message was added
  const convAfterBlocked = await store.get(conversation.id);
  if (!convAfterBlocked) fail("Step 6: conversation not found after blocked send");
  const numAssistantMessagesBeforeBlocked = conv.messages.filter(
    (m) => m.role === "assistant"
  ).length;
  const numAssistantMessagesAfterBlocked = convAfterBlocked.messages.filter(
    (m) => m.role === "assistant"
  ).length;
  if (numAssistantMessagesAfterBlocked !== numAssistantMessagesBeforeBlocked) {
    fail("Step 6 (M3-AC4): assistant message was added even though send was blocked");
  }
  pass("Step 6 (M3-AC4): no assistant message added to blocked send");
  console.log("");

  // --- Step 7: persistence - create fresh store over same storage ---------
  console.log("--- Step 7: create fresh store over same storage (M3-AC5 proxy) ---");
  const freshStore = createConversationStore(storage);
  const freshConversations = await freshStore.list();
  if (freshConversations.length !== 1) {
    fail(
      `Step 7: expected 1 conversation in fresh store, got ${freshConversations.length}`
    );
  }

  const freshConversation = freshConversations[0];
  const freshConv = await freshStore.get(freshConversation.id);
  if (!freshConv) fail("Step 7: fresh conversation not found");

  // Compare the original and fresh conversations
  if (freshConv.id !== convAfterBlocked.id) {
    fail(
      `Step 7: conversation id mismatch: original ${convAfterBlocked.id}, fresh ${freshConv.id}`
    );
  }
  if (freshConv.title !== convAfterBlocked.title) {
    fail(
      `Step 7: conversation title mismatch: original "${convAfterBlocked.title}", fresh "${freshConv.title}"`
    );
  }
  if (freshConv.messages.length !== convAfterBlocked.messages.length) {
    fail(
      `Step 7: message count mismatch: original ${convAfterBlocked.messages.length}, fresh ${freshConv.messages.length}`
    );
  }

  // Compare message details
  for (let i = 0; i < convAfterBlocked.messages.length; i++) {
    const origMsg = convAfterBlocked.messages[i];
    const freshMsg = freshConv.messages[i];
    if (freshMsg.id !== origMsg.id) {
      fail(`Step 7: message ${i} id mismatch: original ${origMsg.id}, fresh ${freshMsg.id}`);
    }
    if (freshMsg.role !== origMsg.role) {
      fail(`Step 7: message ${i} role mismatch: original ${origMsg.role}, fresh ${freshMsg.role}`);
    }
    if (freshMsg.content !== origMsg.content) {
      fail(`Step 7: message ${i} content mismatch`);
    }
    if (freshMsg.model !== origMsg.model) {
      fail(
        `Step 7: message ${i} model mismatch: original ${origMsg.model}, fresh ${freshMsg.model}`
      );
    }
    if (freshMsg.status !== origMsg.status) {
      fail(
        `Step 7: message ${i} status mismatch: original ${origMsg.status}, fresh ${freshMsg.status}`
      );
    }
  }

  pass("Step 7 (M3-AC5 proxy): fresh store sees identical conversation and all messages");
  console.log("  Note: on-device force-quit check is a separate human step.");
  console.log("");

  console.log("All conversation proof checks passed.");
}

main().catch((err) => {
  console.error("FAIL: Unexpected error:", err);
  process.exit(1);
});
