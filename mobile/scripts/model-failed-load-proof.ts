#!/usr/bin/env bun
/**
 * Live proof for M2-AC5: a load that genuinely fails in Ollama leaves nothing
 * resident, and the app's view shows the failure reason.
 *
 * Run by model-failed-load-proof.sh, which has already created the probe
 * model PROBE_NAME (a real model whose load the Ollama runner rejects) and
 * which restores the Mac afterwards via a trap.
 *
 * Uses the app's own client (src/api/client.ts), poll-until-idle helper
 * (src/ui/modelActions.ts) and view-model (src/ui/modelList.ts) -- the same
 * code paths the phone app uses -- against the real server over the tailnet.
 * Ollama's /api/ps and /api/generate are called directly (not through the
 * server) to independently check what is resident and what Ollama's own
 * error text is.
 *
 * Env:
 *   PROBE_NAME  required (set by the wrapper)
 *   SERVER_URL  default https://ryans-mac-studio.tailc3648a.ts.net:8443
 *   OLLAMA_URL  default http://127.0.0.1:11434
 */

interface OllamaPsResponse {
  models: { name: string }[];
}

const SERVER_URL = process.env.SERVER_URL || "https://ryans-mac-studio.tailc3648a.ts.net:8443";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const TOKEN_FILE = process.env.PHONE_MODELS_TOKEN_FILE || `${process.env.HOME}/.phone-models/token`;
const PROBE_NAME = process.env.PROBE_NAME || "";
const OLLAMA_FETCH_TIMEOUT_MS = 30_000;
const OLLAMA_LOAD_TIMEOUT_MS = 300_000;
const LOAD_MAX_WAIT_MS = 300_000;

let failed = 0;

function pass(message: string): void {
  console.log(`PASS: ${message}`);
}

function fail(message: string): void {
  console.log(`FAIL: ${message}`);
  failed++;
}

async function ollamaPs(): Promise<OllamaPsResponse> {
  const response = await fetch(`${OLLAMA_URL}/api/ps`, {
    signal: AbortSignal.timeout(OLLAMA_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Ollama /api/ps HTTP ${response.status}`);
  }
  return (await response.json()) as OllamaPsResponse;
}

async function main(): Promise<void> {
  if (!PROBE_NAME) {
    console.error("FAIL: PROBE_NAME is not set (run via model-failed-load-proof.sh)");
    process.exit(1);
  }

  const token = (await Bun.file(TOKEN_FILE).text()).trim();
  if (!token) {
    console.error("FAIL: token file is empty");
    process.exit(1);
  }

  const { createAPIClient } = await import("../src/api/client");
  const { runModelAction } = await import("../src/ui/modelActions");
  const { toModelListView } = await import("../src/ui/modelList");

  const client = createAPIClient(SERVER_URL, fetch);
  client.setToken(token);

  // The probe must be listed by the server before it can be loaded.
  const before = await client.getState();
  const probe = before.models.find(
    (m) => m.name === PROBE_NAME || m.name.startsWith(`${PROBE_NAME}:`)
  );
  if (!probe) {
    console.error(`FAIL: ${PROBE_NAME} not listed in /v1/state models`);
    process.exit(1);
  }
  pass(`probe listed in /v1/state models as ${probe.name}`);
  console.log(`Resident before load (server view): ${before.resident?.name ?? "(none)"}`);

  // Load the probe through the app's client and poll helper, as the phone does.
  const started = Date.now();
  let polls = 0;
  const final = await runModelAction({
    getState: () => client.getState(),
    // confirm: true -- this is a deliberate failed-load proof, not a UI
    // confirmation-flow test, so it bypasses the busy-warning gate (FR6) to
    // actually attempt the load (e.g. a model resident since before a
    // server restart would otherwise be refused unconfirmed).
    start: () => client.loadModel({ name: probe.name, confirm: true }),
    onPoll: () => {
      polls++;
    },
    maxWaitMs: LOAD_MAX_WAIT_MS,
  });
  if ("cancelled" in final) {
    console.log("FAIL: load was unexpectedly cancelled (confirm: true should bypass FR6)");
    process.exit(1);
  }
  console.log(`Load finished after ${Date.now() - started} ms (${polls} polls)`);
  console.log(`Final operation: ${JSON.stringify(final.operation)}`);
  console.log(`Final resident: ${JSON.stringify(final.resident)}`);

  if (final.operation.kind === "idle") {
    pass(`operation.kind is "idle"`);
  } else {
    fail(`operation.kind is "${final.operation.kind}", expected "idle"`);
  }
  const serverError = final.operation.error ?? "";
  if (serverError.length > 0) {
    pass(`operation.error is non-empty: ${serverError}`);
  } else {
    fail("operation.error is empty (load did not fail)");
  }
  if (final.operation.model === probe.name) {
    pass(`operation.model is ${probe.name}`);
  } else {
    fail(`operation.model is ${String(final.operation.model)}, expected ${probe.name}`);
  }
  if (final.resident === null) {
    pass("state.resident is null");
  } else {
    fail(`state.resident is ${JSON.stringify(final.resident)}, expected null`);
  }

  const psAfterServerLoad = await ollamaPs();
  console.log(`Ollama /api/ps after failed load: ${JSON.stringify(psAfterServerLoad)}`);
  if (psAfterServerLoad.models.length === 0) {
    pass("Ollama /api/ps is empty");
  } else {
    fail(`Ollama /api/ps lists ${psAfterServerLoad.models.map((m) => m.name).join(", ")}`);
  }

  const view = toModelListView(final);
  if (view.residentLabel === "Nothing loaded") {
    pass(`view residentLabel is "Nothing loaded"`);
  } else {
    fail(`view residentLabel is "${view.residentLabel}", expected "Nothing loaded"`);
  }
  if (view.busyLabel === null) {
    pass("view busyLabel is null");
  } else {
    fail(`view busyLabel is "${view.busyLabel}", expected null`);
  }

  // Ollama's own reason, fetched directly with the same request the server
  // sends to load a model, so the view's message can be checked against it.
  const direct = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: probe.name, keep_alive: -1 }),
    signal: AbortSignal.timeout(OLLAMA_LOAD_TIMEOUT_MS),
  });
  const directBody = (await direct.json()) as { error?: string };
  console.log(`Ollama direct load: HTTP ${direct.status} ${JSON.stringify(directBody)}`);
  const ollamaReason = directBody.error ?? "";
  if (ollamaReason.length > 0) {
    pass(`Ollama itself rejects the load: ${ollamaReason}`);
  } else {
    fail("Ollama loaded the probe directly (no error) -- the failure is not genuine");
  }

  const message = view.failureMessage ?? "";
  console.log(`App view failureMessage: ${message}`);
  if (message.length > 0) {
    pass("view failureMessage is non-empty");
  } else {
    fail("view failureMessage is empty");
  }
  if (ollamaReason.length > 0 && message.includes(ollamaReason)) {
    pass("view failureMessage contains Ollama's reason");
  } else {
    fail(`view failureMessage does not contain Ollama's reason "${ollamaReason}"`);
  }

  const psAfterDirect = await ollamaPs();
  if (psAfterDirect.models.length === 0) {
    pass("Ollama /api/ps still empty after the direct attempt");
  } else {
    fail(`Ollama /api/ps lists ${psAfterDirect.models.map((m) => m.name).join(", ")} after the direct attempt`);
  }

  console.log("");
  if (failed > 0) {
    console.log(`${failed} assertion(s) failed`);
    process.exit(1);
  }
  console.log("All failed-load assertions passed");
}

main().catch((err) => {
  console.error("FAIL: Fatal error", err);
  process.exit(1);
});
