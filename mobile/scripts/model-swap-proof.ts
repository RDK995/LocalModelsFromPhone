#!/usr/bin/env bun
/**
 * Live proof: swap-load, a chat reply, a long idle, and unload against the
 * real server over the tailnet and the real Ollama on the Mac.
 *
 * Demonstrates M2-AC2 (loading model A then model B leaves only B resident
 * in /api/ps; unloading leaves nothing resident) and M2-AC3 (a model loaded
 * from the phone stays resident in /api/ps after a chat reply completes and
 * after IDLE_SECONDS of idle) using the app's own client (src/api/client.ts),
 * the poll-until-idle helper (src/ui/modelActions.ts), and the view-model
 * (src/ui/modelList.ts) -- the same code paths the phone app itself uses.
 *
 * A and B are the two smallest installed models, derived from /api/tags (no
 * hardcoded model names). Ollama's /api/ps is fetched directly (not through
 * the server) at each checkpoint to independently verify what is actually
 * resident.
 *
 * This script does NOT restore the Mac's originally resident model -- that
 * is the wrapper's job (model-swap-proof.sh), via a trap, so restoration
 * also happens when this script fails partway through.
 *
 * Env:
 *   SERVER_URL   default https://ryans-mac-studio.tailc3648a.ts.net:8443
 *   OLLAMA_URL   default http://127.0.0.1:11434
 *   IDLE_SECONDS default 600 (overridable for a quick run; the final
 *                evidence run must use the default)
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
  expires_at: string;
}

interface OllamaPsResponse {
  models: OllamaPsModel[];
}

const SERVER_URL = process.env.SERVER_URL || "https://ryans-mac-studio.tailc3648a.ts.net:8443";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const TOKEN_FILE = process.env.PHONE_MODELS_TOKEN_FILE || `${process.env.HOME}/.phone-models/token`;
const IDLE_SECONDS = Number(process.env.IDLE_SECONDS || "600");
const OLLAMA_FETCH_TIMEOUT_MS = 30_000;
const LOAD_UNLOAD_MAX_WAIT_MS = 180_000;
const CHAT_TIMEOUT_MS = 180_000;

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

function assertExactResident(psNames: string[], expected: string[], context: string): void {
  console.log(`  /api/ps: ${JSON.stringify(psNames)}`);
  const actualSorted = [...psNames].sort();
  const expectedSorted = [...expected].sort();
  const same =
    actualSorted.length === expectedSorted.length &&
    actualSorted.every((name, i) => name === expectedSorted[i]);
  if (!same) {
    fail(
      `${context}: expected /api/ps to list exactly ${JSON.stringify(expected)}, got ${JSON.stringify(psNames)}`
    );
  }
  pass(`${context}: /api/ps lists exactly ${JSON.stringify(expected)}`);
}

async function main() {
  const tokenBuffer = await Bun.file(TOKEN_FILE).bytes();
  const token = new TextDecoder().decode(tokenBuffer).trim();
  if (!token) fail("token file is empty");

  const { createAPIClient } = await import("../src/api/client");
  const { runModelAction } = await import("../src/ui/modelActions");
  const { toModelListView } = await import("../src/ui/modelList");

  const client = createAPIClient(SERVER_URL, fetch);
  client.setToken(token);

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
  console.log(`--- Step 1: load A (${modelA}) via app client, wait idle ---`);
  const stateAfterLoadA = await runModelAction({
    getState: () => client.getState(),
    // confirm: true -- this is a deliberate swap/unload proof, not a UI
    // confirmation-flow test, so it always bypasses the busy-warning gate
    // (FR6) to actually perform each step.
    start: () => client.loadModel({ name: modelA, confirm: true }),
    maxWaitMs: LOAD_UNLOAD_MAX_WAIT_MS,
  });
  if ("cancelled" in stateAfterLoadA) {
    fail("Step 1: load A was unexpectedly cancelled (confirm: true should bypass FR6)");
  }
  const viewAfterLoadA = toModelListView(stateAfterLoadA);
  console.log(`  residentLabel: "${viewAfterLoadA.residentLabel}"`);
  console.log(`  resident.loaded_by_server: ${stateAfterLoadA.resident?.loaded_by_server}`);
  const psAfterLoadA = await getOllamaPs();
  assertExactResident(psAfterLoadA.models.map((m) => m.name), [modelA], "Step 1 (load A)");
  if (viewAfterLoadA.residentLabel !== `Loaded: ${modelA}`) {
    fail(`Step 1: residentLabel expected "Loaded: ${modelA}", got "${viewAfterLoadA.residentLabel}"`);
  }
  pass(`Step 1: residentLabel is "Loaded: ${modelA}"`);
  if (stateAfterLoadA.resident?.loaded_by_server !== true) {
    fail(
      `Step 1: resident.loaded_by_server expected true, got ${stateAfterLoadA.resident?.loaded_by_server}`
    );
  }
  pass("Step 1: resident.loaded_by_server is true");
  console.log("");

  // --- Step 2: load B, swapping out A (M2-AC2) ------------------------------
  console.log(`--- Step 2: load B (${modelB}) via app client, wait idle (swap out A) ---`);
  const stateAfterLoadB = await runModelAction({
    getState: () => client.getState(),
    start: () => client.loadModel({ name: modelB, confirm: true }),
    maxWaitMs: LOAD_UNLOAD_MAX_WAIT_MS,
  });
  if ("cancelled" in stateAfterLoadB) {
    fail("Step 2: load B was unexpectedly cancelled (confirm: true should bypass FR6)");
  }
  const viewAfterLoadB = toModelListView(stateAfterLoadB);
  console.log(`  residentLabel: "${viewAfterLoadB.residentLabel}"`);
  const psAfterLoadB = await getOllamaPs();
  assertExactResident(psAfterLoadB.models.map((m) => m.name), [modelB], "Step 2 (load B, swap)");
  if (viewAfterLoadB.residentLabel !== `Loaded: ${modelB}`) {
    fail(`Step 2: residentLabel expected "Loaded: ${modelB}", got "${viewAfterLoadB.residentLabel}"`);
  }
  pass(`Step 2: residentLabel is "Loaded: ${modelB}" (M2-AC2 swap)`);
  console.log("");

  // --- Step 3: chat with B, then confirm it is still resident (M2-AC3) ------
  console.log(`--- Step 3: chat with B (${modelB}) via app client, wait for terminal done ---`);
  let sawDone = false;
  const chatController = new AbortController();
  const chatTimer = setTimeout(() => chatController.abort(), CHAT_TIMEOUT_MS);
  try {
    await client.chat(
      { model: modelB, messages: [{ role: "user", content: "Reply with only the word OK." }] },
      {
        onEvent: (event) => {
          if (event.type === "done") {
            sawDone = true;
            console.log(`  done event: status=${event.data.status}, model=${event.data.model}`);
          }
        },
        onError: (error) => fail(`Step 3: chat error: ${error.message}`),
        onComplete: () => {},
        signal: chatController.signal,
      }
    );
  } finally {
    clearTimeout(chatTimer);
  }
  if (!sawDone) fail("Step 3: chat stream ended without a terminal done event");
  pass("Step 3: chat completed with a terminal done event");

  const psAfterChat = await getOllamaPs();
  assertExactResident(psAfterChat.models.map((m) => m.name), [modelB], "Step 3 (after chat reply)");
  const expiresAtAfterChat = psAfterChat.models[0]?.expires_at;
  const yearAfterChat = expiresAtAfterChat ? new Date(expiresAtAfterChat).getUTCFullYear() : 0;
  console.log(`  expires_at: ${expiresAtAfterChat} (year ${yearAfterChat})`);
  if (yearAfterChat < 2100) {
    fail(
      `Step 3: expires_at year expected >= 2100, got ${yearAfterChat} (${expiresAtAfterChat}) -- keep_alive -1 appears to have been reset`
    );
  }
  pass(
    `Step 3: expires_at is far in the future (year ${yearAfterChat}); keep_alive -1 held (M2-AC3, after a chat reply)`
  );
  console.log("");

  // --- Step 4: idle IDLE_SECONDS, no requests to Ollama in between (M2-AC3) -
  console.log(`--- Step 4: idle ${IDLE_SECONDS}s, no requests to Ollama in between ---`);
  await sleep(IDLE_SECONDS * 1000);
  const psAfterIdle = await getOllamaPs();
  assertExactResident(
    psAfterIdle.models.map((m) => m.name),
    [modelB],
    `Step 4 (after ${IDLE_SECONDS}s idle)`
  );
  console.log("");

  // --- Step 5: unload (M2-AC2) ----------------------------------------------
  console.log("--- Step 5: unload via app client, wait idle ---");
  const stateAfterUnload = await runModelAction({
    getState: () => client.getState(),
    start: () => client.unloadModel({ confirm: true }),
    maxWaitMs: LOAD_UNLOAD_MAX_WAIT_MS,
  });
  if ("cancelled" in stateAfterUnload) {
    fail("Step 5: unload was unexpectedly cancelled (confirm: true should bypass FR6)");
  }
  const viewAfterUnload = toModelListView(stateAfterUnload);
  console.log(`  residentLabel: "${viewAfterUnload.residentLabel}"`);
  const psAfterUnload = await getOllamaPs();
  assertExactResident(psAfterUnload.models.map((m) => m.name), [], "Step 5 (unload)");
  if (viewAfterUnload.residentLabel !== "Nothing loaded") {
    fail(`Step 5: residentLabel expected "Nothing loaded", got "${viewAfterUnload.residentLabel}"`);
  }
  pass('Step 5: residentLabel is "Nothing loaded" (M2-AC2 unload)');
  console.log("");

  console.log("All swap/unload proof checks passed.");
}

main().catch((err) => {
  console.error("FAIL: Unexpected error:", err);
  process.exit(1);
});
