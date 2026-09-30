#!/usr/bin/env bun
/**
 * Live proof for M10 (FR18, FR22; M10-AC1..AC4): the data path under the phone's
 * web search switch, driven through the app's own modules -- client, conversation
 * store (on a file-backed storage), conversation session, and the view-models --
 * against the real server and the real Ollama. The screen parts (visible switch,
 * collapse, opening a source in Safari) are proven separately on the phone.
 *
 * Checks (each prints PASS/FAIL; the script exits non-zero if any FAIL):
 *   1. Switch persistence (AC1): off by default, legacy chats load as off, on/off
 *      survive a fresh store instance over the same file.
 *   2. Off sends no web (AC1): zero step/sources events, none stored.
 *   3. Capability gate (AC2): webSwitchState on the live models, plus a tools:false model.
 *   4. Next-prompt semantics (AC2): flipping off mid-reply leaves that reply on the
 *      web; the next prompt has no web. (Shares check 5's reply, as the task allows.)
 *   5. Live steps and sources (AC3/AC4): step ordering and timing, labels, sources,
 *      persisted steps/sources, and the chat items the screen would render.
 *
 * Env: SERVER_URL, PHONE_MODELS_TOKEN_FILE (default ~/.phone-models/token). The
 * token is never printed.
 */

import type { StreamEvent } from "@/api/client";
import type { Model, ResidentModel, StepEventData } from "@shared/api";

const SERVER_URL = process.env.SERVER_URL || "https://ryans-mac-studio.tailc3648a.ts.net:8443";
const TOKEN_FILE = process.env.PHONE_MODELS_TOKEN_FILE || `${process.env.HOME}/.phone-models/token`;
const LOAD_UNLOAD_MAX_WAIT_MS = 180_000;
const CHAT_TIMEOUT_MS = 300_000;

let failures = 0;
function check(ok: boolean, message: string): boolean {
  console.log(`${ok ? "PASS" : "FAIL"}: ${message}`);
  if (!ok) failures++;
  return ok;
}
function die(message: string): never {
  console.log(`FAIL: ${message}`);
  process.exit(1);
}

interface Timed {
  event: StreamEvent;
  at: number;
}

async function main() {
  const { mkdtempSync, rmSync } = await import("fs");
  const { tmpdir } = await import("os");
  const { join } = await import("path");

  const token = (await Bun.file(TOKEN_FILE).text()).trim();
  if (!token) die("token file is empty");

  const { createAPIClient } = await import("../src/api/client");
  const { runModelAction } = await import("../src/ui/modelActions");
  const { sendInConversation } = await import("../src/chat/conversationSession");
  const { createConversationStore } = await import("../src/store/conversationStore");
  const { createFileStorage } = await import("../src/store/fileStorage");
  const { webSwitchState } = await import("../src/ui/webSwitch");
  const { buildChatItems, stepLabel, stepsToggleLabel, sourceLabel } = await import("../src/ui/chatItems");

  const client = createAPIClient(SERVER_URL, fetch);
  client.setToken(token);

  const dir = mkdtempSync(join(tmpdir(), "web-switch-proof-"));
  const file = join(dir, "storage.jsonl");
  const store = createConversationStore(createFileStorage(file));

  async function send(
    conversationId: string,
    prompt: string,
    onEvent: (e: StreamEvent) => void
  ): Promise<void> {
    await sendInConversation(client, store, conversationId, prompt, {
      onEvent,
      onBlocked: (m) => die(`send blocked: ${m}`),
      onError: (e) => die(`send error: ${e.message}`),
      onUnauthorized: () => die("send unauthorized"),
      onComplete: () => {},
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
  }

  async function run() {
    // --- Choose the model: the resident one if it has tools, else load the smallest tools model ---
    console.log("--- Setup: choosing a tools-capable model ---");
    let state = await client.getState();
    console.log(`Installed: ${state.models.map((m) => `${m.name} (tools=${m.tools})`).join(", ")}`);
    console.log(`Resident: ${state.resident ? state.resident.name : "(none)"}`);
    const residentName = state.resident?.name;
    let toolsModel: Model | undefined = state.models.find((m) => m.name === residentName && m.tools);
    if (!toolsModel) {
      toolsModel = [...state.models].filter((m) => m.tools).sort((a, b) => a.size_bytes - b.size_bytes)[0];
      if (!toolsModel) die("Setup: no installed model has tools: true");
      const target = toolsModel.name;
      console.log(`Loading ${target} (resident model has no tools)...`);
      const loaded = await runModelAction({
        getState: () => client.getState(),
        start: () => client.loadModel({ name: target, confirm: true }),
        maxWaitMs: LOAD_UNLOAD_MAX_WAIT_MS,
      });
      if ("cancelled" in loaded) die("Setup: load was unexpectedly cancelled");
      state = await client.getState();
    }
    if (!state.resident || state.resident.name !== toolsModel.name) {
      die(`Setup: expected ${toolsModel.name} resident, got ${state.resident?.name ?? "(none)"}`);
    }
    console.log(`Using tools model: ${toolsModel.name}`);
    console.log("");

    // --- Check 1: switch persistence (AC1) ---
    console.log("--- Check 1: switch persistence (AC1) ---");
    const convA = await store.create("Switch persistence");
    check(convA.web_search === false, "Check 1: a new conversation has web_search off");

    const INDEX_KEY = "phone-models:v1:conversations-index";
    const legacyId = "legacy-no-switch";
    const legacyKey = `phone-models:v1:conversation:${legacyId}`;
    const rawStorage = createFileStorage(file);
    const legacy = {
      id: legacyId,
      title: "Legacy chat",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      messages: [{ id: "m1", role: "user", content: "hi", status: "complete" }],
    };
    await rawStorage.setItem(legacyKey, JSON.stringify(legacy));
    const index: string[] = JSON.parse((await rawStorage.getItem(INDEX_KEY)) ?? "[]");
    await rawStorage.setItem(INDEX_KEY, JSON.stringify([...index, legacyId]));
    const rawLegacy = JSON.parse((await rawStorage.getItem(legacyKey))!);
    check(!("web_search" in rawLegacy), "Check 1: the legacy conversation JSON has no web_search key");
    const legacyLoaded = await store.get(legacyId);
    check(legacyLoaded !== null && legacyLoaded.web_search !== true, "Check 1: the legacy conversation loads as off");

    await store.setWebSearch(convA.id, true);
    const storeOn = createConversationStore(createFileStorage(file));
    check((await storeOn.get(convA.id))?.web_search === true, "Check 1: a NEW store instance over the same file reads on");
    await storeOn.setWebSearch(convA.id, false);
    const storeOff = createConversationStore(createFileStorage(file));
    check((await storeOff.get(convA.id))?.web_search === false, "Check 1: a NEW store instance reads off after setting it back");
    console.log("");

    // --- Check 2: switch off sends no web ---
    console.log("--- Check 2: switch off sends no web (AC1/FR18) ---");
    const offEvents: StreamEvent[] = [];
    await send(convA.id, "Reply with just OK.", (e) => offEvents.push(e));
    const offSteps = offEvents.filter((e) => e.type === "step").length;
    const offSources = offEvents.filter((e) => e.type === "sources").length;
    check(offEvents.some((e) => e.type === "done"), "Check 2: the reply finished (done event)");
    check(offSteps === 0, `Check 2: zero step events with the switch off (got ${offSteps})`);
    check(offSources === 0, `Check 2: zero sources events with the switch off (got ${offSources})`);
    const offReply = (await store.get(convA.id))?.messages.find((m) => m.role === "assistant");
    check(!!offReply, "Check 2: an assistant message was persisted");
    check(!!offReply && !("steps" in offReply) && !("sources" in offReply), "Check 2: the persisted reply has no steps/sources keys");
    console.log("");

    // --- Check 3: capability gate (AC2) ---
    console.log("--- Check 3: capability gate (AC2) ---");
    const liveState = await client.getState();
    const liveResult = webSwitchState(liveState.models, liveState.resident);
    console.log(`webSwitchState(live models, resident ${liveState.resident?.name}) = ${JSON.stringify(liveResult)}`);
    check(liveResult.enabled === true && liveResult.explanation === null, "Check 3: the resident tools model yields an enabled switch");
    const noTools = liveState.models.find((m) => !m.tools);
    let gateModels: Model[];
    let gateResident: ResidentModel;
    if (noTools) {
      console.log(`Installed model without tools: ${noTools.name} (live, not stubbed)`);
      gateModels = liveState.models;
      gateResident = { name: noTools.name, loaded_by_server: false };
    } else {
      const stub: Model = { name: "stub-no-tools", size_bytes: 0, tools: false };
      console.log("Every installed model has tools; using a STUBBED model { name: stub-no-tools, size_bytes: 0, tools: false }");
      gateModels = [...liveState.models, stub];
      gateResident = { name: stub.name, loaded_by_server: false };
    }
    const gate = webSwitchState(gateModels, gateResident);
    console.log(`webSwitchState(no-tools model resident) = ${JSON.stringify(gate)}`);
    check(gate.enabled === false && !!gate.explanation && gate.explanation.length > 0, "Check 3: a resident model without tools disables the switch with an explanation");
    console.log("");

    // --- Checks 4 + 5: live web reply, switch flipped off mid-reply, then a next prompt ---
    console.log("--- Checks 4+5: live steps and sources; switch flipped off during the reply ---");
    const convB = await store.create("Web proof");
    await store.setWebSearch(convB.id, true);
    const timed: Timed[] = [];
    const t0 = performance.now();
    let flip: Promise<unknown> | null = null;
    await send(convB.id, "What are today's top news headlines? Use web search.", (e) => {
      timed.push({ event: e, at: performance.now() - t0 });
      if (flip === null) flip = store.setWebSearch(convB.id, false);
    });
    await flip;

    for (const { event, at } of timed) {
      if (event.type === "step") {
        console.log(`  +${at.toFixed(0)}ms step ${event.data.step_id} ${event.data.status}: ${stepLabel(event.data)}`);
      } else if (event.type === "sources") {
        console.log(`  +${at.toFixed(0)}ms sources (${event.data.items.length})`);
      } else if (event.type === "done") {
        console.log(`  +${at.toFixed(0)}ms done (${event.data.status})`);
      }
    }
    const stepData: Array<{ idx: number; data: StepEventData }> = [];
    timed.forEach((x, i) => {
      if (x.event.type === "step") stepData.push({ idx: i, data: x.event.data });
    });
    const doneIdx = timed.findIndex((x) => x.event.type === "done");
    let lastContentIdx = -1;
    timed.forEach((x, i) => {
      if (x.event.type === "content") lastContentIdx = i;
    });
    const firstStepIdx = stepData.length > 0 ? stepData[0].idx : -1;

    if (stepData.length === 0) {
      console.log("NOTE: no step events arrived; the live web search may be unavailable on this Mac.");
    }
    check(stepData.some((s) => s.data.kind === "search"), "Check 5: at least one search step arrived");
    check(doneIdx >= 0 && firstStepIdx >= 0 && firstStepIdx < doneIdx, "Check 5: a step event arrived before the done event");
    check(firstStepIdx >= 0 && (lastContentIdx < 0 || firstStepIdx < lastContentIdx), "Check 5: a step event arrived before the last content token");

    const byId = new Map<string, StepEventData["status"][]>();
    for (const s of stepData) byId.set(s.data.step_id, [...(byId.get(s.data.step_id) ?? []), s.data.status]);
    let orderOk = byId.size > 0;
    for (const [id, statuses] of byId) {
      if (statuses[0] !== "started") {
        orderOk = false;
        console.log(`  step ${id} statuses in arrival order: ${statuses.join(",")}`);
      }
    }
    check(orderOk, "Check 5: for every step_id, `started` arrived before its final status");

    const items: Array<{ title: string; url: string }> = [];
    for (const x of timed) if (x.event.type === "sources") items.push(...x.event.data.items);
    check(items.length >= 1 && items.every((i) => /^https?:\/\//.test(i.url)), `Check 5: a sources event with >= 1 item, each with an http(s) URL (got ${items.length})`);

    const convBAfter = await store.get(convB.id);
    check(convBAfter?.web_search === false, "Check 4: the switch is off after being flipped mid-reply (not clobbered by the reply's save)");
    check(stepData.length >= 1, "Check 4: the in-flight request still carried web (it produced step events) after the switch was flipped off");
    const webReply = convBAfter?.messages.find((m) => m.role === "assistant");
    check(!!webReply, "Check 5: an assistant message was persisted");
    const storedSteps = webReply?.steps ?? [];
    const storedIds = storedSteps.map((s) => s.step_id);
    check(storedSteps.length > 0 && new Set(storedIds).size === storedIds.length, `Check 5: the persisted reply holds steps with no duplicate step_id (${storedSteps.length})`);
    check(storedSteps.every((s) => s.status !== "started"), "Check 5: persisted steps carry final statuses");
    check((webReply?.sources?.length ?? 0) >= 1, `Check 5: the persisted reply holds sources (${webReply?.sources?.length ?? 0})`);

    if (convBAfter) {
      const chatItems = buildChatItems(convBAfter.messages, null);
      const item = chatItems.find((c) => c.role === "assistant");
      const n = item?.steps?.length ?? 0;
      console.log(`buildChatItems: assistant item has ${n} step(s); toggle label = "${stepsToggleLabel(false, n)}"`);
      for (const s of item?.steps ?? []) console.log(`  step: ${stepLabel(s)}`);
      for (const s of item?.sources ?? []) console.log(`  source: ${sourceLabel(s)} <${s.url}>`);
      check(!!item && n > 0 && (item.sources?.length ?? 0) > 0, "Check 5: buildChatItems carries the steps and sources for the reply");
    }

    // Check 4, second half: the next prompt in the same conversation carries no web.
    const nextEvents: StreamEvent[] = [];
    await send(convB.id, "Reply with just OK.", (e) => nextEvents.push(e));
    const nextSteps = nextEvents.filter((e) => e.type === "step").length;
    check(nextEvents.some((e) => e.type === "done"), "Check 4: the next prompt's reply finished");
    check(nextSteps === 0, `Check 4: the next prompt (after the flip) produced zero step events (got ${nextSteps})`);
    console.log("");

    console.log(failures === 0 ? "All web switch proof checks passed." : `${failures} check(s) FAILED.`);
  }

  try {
    await run();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(failures === 0 ? 0 : 1))
  .catch((err) => {
    console.error("FAIL: Unexpected error:", err);
    process.exit(1);
  });
