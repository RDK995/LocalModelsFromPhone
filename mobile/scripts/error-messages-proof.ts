#!/usr/bin/env bun
/**
 * Live proof for M5b-T2 (FR16 / M5-AC3): each of the six failure modes,
 * induced for real against the live Mac Studio server (over the tailnet)
 * and the live Ollama, maps through the app's own client
 * (src/api/client.ts) and plain-language mapping (src/api/errorMessages.ts
 * `describeError` -- and, for the load-failed case, src/ui/modelList.ts
 * `toModelListView(...).failureMessage`) to its own distinct sentence.
 *
 * Run by error-messages-proof.sh, which performs every OS-level action a
 * scenario needs (stopping/starting Ollama, bootout/bootstrap of the server
 * LaunchAgent, `ollama cp`/`rm`, building the failed-load probe) around one
 * call to this script per scenario, selected by the first CLI argument, and
 * restores the Mac afterwards via a trap. This script itself only talks to
 * the server (over the tailnet, through the app's own client) and to
 * Ollama's HTTP API directly (to read ground truth, e.g. what is resident);
 * it never changes what OS-level services are running.
 *
 * Usage: bun scripts/error-messages-proof.ts <scenario> [args...]
 *   unauthorized
 *   not-installed-listed <probeName>
 *   not-installed-load <probeName>
 *   failed-load <probeName>
 *   reply-in-progress
 *   ollama-down
 *   mac-unreachable
 *
 * Each of the six scenarios that ends in one of the app's plain-language
 * sentences prints exactly one line `PASS <label>: <sentence>` on success
 * (the wrapper collects these to check they are pairwise distinct); any
 * failed assertion prints `FAIL: <reason>` and the process exits 1.
 *
 * Env:
 *   SERVER_URL  default https://ryans-mac-studio.tailc3648a.ts.net:8443
 *   OLLAMA_URL  default http://127.0.0.1:11434
 *   PHONE_MODELS_TOKEN_FILE  default ~/.phone-models/token
 */

import { createAPIClient, ServerError, UnauthorizedError, UnreachableError } from "../src/api/client";
import {
  describeError,
  UNAUTHORIZED_MESSAGE,
  OLLAMA_DOWN_MESSAGE,
  UNREACHABLE_MESSAGE,
  REPLY_IN_PROGRESS_MESSAGE,
  notInstalledMessage,
  loadFailedMessage,
} from "../src/api/errorMessages";
import { runModelAction } from "../src/ui/modelActions";
import { toModelListView } from "../src/ui/modelList";

const SERVER_URL = process.env.SERVER_URL || "https://ryans-mac-studio.tailc3648a.ts.net:8443";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const TOKEN_FILE = process.env.PHONE_MODELS_TOKEN_FILE || `${process.env.HOME}/.phone-models/token`;
const OLLAMA_FETCH_TIMEOUT_MS = 30_000;
const LOAD_MAX_WAIT_MS = 300_000;
const CHAT_START_TIMEOUT_MS = 30_000;
const CANCEL_SETTLE_TIMEOUT_MS = 60_000;
const LONG_PROMPT =
  "Write a long, detailed short story, at least 500 words, about a slow journey across a mountain range. Take your time and describe the scenery.";
const BOGUS_TOKEN = "m5b-t2-bogus-token-does-not-exist";

interface OllamaTagsModel {
  name: string;
  size: number;
}
interface OllamaTagsResponse {
  models: OllamaTagsModel[];
}

function fail(message: string): never {
  console.log(`FAIL: ${message}`);
  process.exit(1);
}

function reportPass(label: string, sentence: string): void {
  console.log(`PASS ${label}: ${sentence}`);
}

async function readToken(): Promise<string> {
  const token = (await Bun.file(TOKEN_FILE).text()).trim();
  if (!token) {
    fail("token file is empty");
  }
  return token;
}

function makeClient(token?: string) {
  const client = createAPIClient(SERVER_URL, fetch);
  if (token) {
    client.setToken(token);
  }
  return client;
}

async function ollamaTags(): Promise<OllamaTagsResponse> {
  const response = await fetch(`${OLLAMA_URL}/api/tags`, {
    signal: AbortSignal.timeout(OLLAMA_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    fail(`Ollama /api/tags HTTP ${response.status}`);
  }
  return (await response.json()) as OllamaTagsResponse;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  what: string
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      fail(`timed out waiting for ${what}`);
    }
    await sleep(50);
  }
}

/** Whatever model is resident, or the smallest installed model loaded fresh. */
async function ensureResidentModel(
  client: ReturnType<typeof makeClient>
): Promise<string> {
  const state = await client.getState();
  if (state.resident) {
    console.log(`Reusing already-resident model ${state.resident.name}`);
    return state.resident.name;
  }

  const tags = await ollamaTags();
  if (tags.models.length === 0) {
    fail("no models installed in Ollama");
  }
  const smallest = [...tags.models].sort((a, b) => a.size - b.size)[0].name;
  const final = await runModelAction({
    getState: () => client.getState(),
    start: (confirm) => client.loadModel({ name: smallest, confirm }),
    confirm: async () => true,
    maxWaitMs: LOAD_MAX_WAIT_MS,
  });
  if ("cancelled" in final) {
    fail(`load of ${smallest} was unexpectedly cancelled`);
  }
  if (!final.resident) {
    fail(`no model resident after loading ${smallest} (operation: ${JSON.stringify(final.operation)})`);
  }
  console.log(`Loaded ${final.resident.name} so a reply can be started`);
  return final.resident.name;
}

// --- scenarios ---

async function scenarioUnauthorized(): Promise<void> {
  const client = makeClient(BOGUS_TOKEN);
  try {
    await client.getState();
    fail("getState() with a bogus token succeeded (expected 401)");
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) {
      fail(`getState() threw ${String(error)}, expected UnauthorizedError`);
    }
    const message = describeError(error);
    if (message !== UNAUTHORIZED_MESSAGE) {
      fail(`describeError returned "${message}", expected "${UNAUTHORIZED_MESSAGE}"`);
    }
    reportPass("wrong password", message);
  }
}

async function scenarioNotInstalledListed(probeName: string): Promise<void> {
  const token = await readToken();
  const client = makeClient(token);
  const state = await client.getState();
  const listed = state.models.find(
    (m) => m.name === probeName || m.name.startsWith(`${probeName}:`)
  );
  if (!listed) {
    fail(`${probeName} is not listed in /v1/state models after ollama cp`);
  }
  console.log(`probe ${probeName} is listed in /v1/state models as ${listed.name}`);
}

async function scenarioNotInstalledLoad(probeName: string): Promise<void> {
  const token = await readToken();
  const client = makeClient(token);
  let thrown: unknown = null;
  try {
    await client.loadModel({ name: probeName, confirm: true });
    fail(`loadModel(${probeName}) succeeded after ollama rm (expected unknown_model failure)`);
  } catch (error) {
    thrown = error;
  }
  if (!(thrown instanceof ServerError) || thrown.code !== "unknown_model") {
    fail(
      `loadModel(${probeName}) after ollama rm threw ${String(thrown)}, expected ServerError("unknown_model")`
    );
  }
  const expected = notInstalledMessage(probeName);
  const message = describeError(thrown, probeName);
  if (message !== expected) {
    fail(`describeError returned "${message}", expected "${expected}"`);
  }
  reportPass("model no longer installed", message);
}

async function scenarioFailedLoad(probeName: string): Promise<void> {
  const token = await readToken();
  const client = makeClient(token);
  const before = await client.getState();
  const probe = before.models.find(
    (m) => m.name === probeName || m.name.startsWith(`${probeName}:`)
  );
  if (!probe) {
    fail(`${probeName} not listed in /v1/state models`);
  }

  const final = await runModelAction({
    getState: () => client.getState(),
    start: () => client.loadModel({ name: probe.name, confirm: true }),
    maxWaitMs: LOAD_MAX_WAIT_MS,
  });
  if ("cancelled" in final) {
    fail("load was unexpectedly cancelled (confirm: true should bypass FR6)");
  }

  if (final.operation.kind !== "idle") {
    fail(`operation.kind is "${final.operation.kind}", expected "idle"`);
  }
  if (final.operation.error_code !== "load_failed") {
    fail(`operation.error_code is "${String(final.operation.error_code)}", expected "load_failed"`);
  }
  const view = toModelListView(final);
  const expected = loadFailedMessage(probe.name);
  if (view.failureMessage !== expected) {
    fail(`view.failureMessage is "${String(view.failureMessage)}", expected "${expected}"`);
  }
  reportPass("model failed to load", view.failureMessage);
}

async function scenarioReplyInProgress(): Promise<void> {
  const token = await readToken();
  const client = makeClient(token);
  const resident = await ensureResidentModel(client);

  let generationId: string | null = null;
  let firstSettled = false;
  const firstPromise = client
    .chat(
      { model: resident, messages: [{ role: "user", content: LONG_PROMPT }] },
      {
        onStart: (id) => {
          generationId = id;
        },
        onEvent: () => {},
        onError: () => {
          firstSettled = true;
        },
        onComplete: () => {
          firstSettled = true;
        },
      }
    )
    .catch(() => {
      firstSettled = true;
    });

  await waitFor(() => generationId !== null, CHAT_START_TIMEOUT_MS, "the first reply to start");

  let secondError: unknown = null;
  try {
    await client.chat(
      { model: resident, messages: [{ role: "user", content: "Hello" }] },
      {
        onStart: () => {},
        onEvent: () => {},
        onError: () => {},
        onComplete: () => {},
      }
    );
    fail("second chat() succeeded while the first was still streaming (expected generation_in_flight)");
  } catch (error) {
    secondError = error;
  }

  if (!(secondError instanceof ServerError) || secondError.code !== "generation_in_flight") {
    fail(
      `second chat() threw ${String(secondError)}, expected ServerError("generation_in_flight")`
    );
  }
  const message = describeError(secondError);
  if (message !== REPLY_IN_PROGRESS_MESSAGE) {
    fail(`describeError returned "${message}", expected "${REPLY_IN_PROGRESS_MESSAGE}"`);
  }
  reportPass("reply already in progress", message);

  if (!generationId) {
    fail("first chat never started (no generation id)");
  }
  await client.cancelGeneration(generationId);
  await Promise.race([firstPromise, sleep(CANCEL_SETTLE_TIMEOUT_MS)]);
  if (!firstSettled) {
    fail("first generation did not settle after being cancelled");
  }
  console.log("First generation cancelled and settled");
}

async function scenarioOllamaDown(): Promise<void> {
  const token = await readToken();
  const client = makeClient(token);
  try {
    await client.getState();
    fail("getState() succeeded while Ollama is stopped (expected ollama_down)");
  } catch (error) {
    if (!(error instanceof ServerError) || error.code !== "ollama_down") {
      fail(`getState() threw ${String(error)}, expected ServerError("ollama_down")`);
    }
    const message = describeError(error);
    if (message !== OLLAMA_DOWN_MESSAGE) {
      fail(`describeError returned "${message}", expected "${OLLAMA_DOWN_MESSAGE}"`);
    }
    reportPass("ollama down", message);
  }
}

async function scenarioMacUnreachable(): Promise<void> {
  const token = await readToken();
  const client = makeClient(token);
  try {
    await client.getState();
    fail("getState() succeeded while the server is stopped (expected UnreachableError)");
  } catch (error) {
    if (!(error instanceof UnreachableError)) {
      fail(`getState() threw ${String(error)}, expected UnreachableError`);
    }
    const message = describeError(error);
    if (message !== UNREACHABLE_MESSAGE) {
      fail(`describeError returned "${message}", expected "${UNREACHABLE_MESSAGE}"`);
    }
    reportPass("mac unreachable", message);
  }
}

async function main(): Promise<void> {
  const [scenario, ...args] = process.argv.slice(2);
  switch (scenario) {
    case "unauthorized":
      return scenarioUnauthorized();
    case "not-installed-listed":
      return scenarioNotInstalledListed(args[0]!);
    case "not-installed-load":
      return scenarioNotInstalledLoad(args[0]!);
    case "failed-load":
      return scenarioFailedLoad(args[0]!);
    case "reply-in-progress":
      return scenarioReplyInProgress();
    case "ollama-down":
      return scenarioOllamaDown();
    case "mac-unreachable":
      return scenarioMacUnreachable();
    default:
      fail(`unknown scenario "${String(scenario)}"`);
  }
}

main().catch((err) => {
  console.error("FAIL: Fatal error", err);
  process.exit(1);
});
