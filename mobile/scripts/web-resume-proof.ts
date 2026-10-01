#!/usr/bin/env bun
/**
 * Live proof for M11 (FR23; M11-AC1..AC3): a web reply survives a dropped
 * connection and is saved and re-sent compactly, against the real server, the
 * real Ollama and the real search service, using the phone app's own modules --
 * client, conversation store (file-backed), and conversationSession.
 *
 * Checks (each prints PASS/FAIL; the script exits non-zero if any FAIL):
 *   A. While a web reply is searching (AC3): another chat is refused 409
 *      generation_in_flight; an unload (and a swap, if a second model is
 *      installed) without confirm gets the busy confirmation incl. reply_in_progress.
 *      Nothing is confirmed.
 *   B. Drop and resume (AC1): the stream is killed after the first step event and
 *      before done; the app client resumes via Last-Event-ID. The dropped prefix
 *      plus the resumed events equal a full replay from seq 0 (contiguous seqs, no
 *      gap, no duplicate; steps folded by step_id equal; content equal), and what
 *      the app received equals the replay too.
 *   C. Persistence (AC2): a web reply driven through conversationSession persists
 *      steps and sources, only the allowed message keys, and no `tool` messages.
 *   D. Follow-up (AC2): the outgoing body carries the prior answer with its
 *      "Sources:" block and every URL, only user/assistant roles, and no page text
 *      (body size bounded by answer + sources + prompts + a small margin).
 *
 * Env: SERVER_URL, PHONE_MODELS_TOKEN_FILE (default ~/.phone-models/token). The
 * token is never printed.
 */

import type { StreamEvent, FetchImpl } from "@/api/client";
import type { Model, StepEventData } from "@shared/api";

const SERVER_URL = process.env.SERVER_URL || "https://ryans-mac-studio.tailc3648a.ts.net:8443";
const TOKEN_FILE = process.env.PHONE_MODELS_TOKEN_FILE || `${process.env.HOME}/.phone-models/token`;
const LOAD_UNLOAD_MAX_WAIT_MS = 180_000;
const CHAT_TIMEOUT_MS = 300_000;
const WEB_PROMPT = "Use web search once for today's top news headlines, then answer in at most three short sentences. Keep your reasoning brief.";

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
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface RawEvent {
  id: string;
  seq: number;
  type: string;
  data: any;
}

/** Parse SSE text (complete blocks only) into events. */
function parseSSE(text: string): RawEvent[] {
  const out: RawEvent[] = [];
  for (const block of text.split("\n\n")) {
    let id = "";
    let type = "";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("id: ")) id = line.slice(4);
      else if (line.startsWith("event: ")) type = line.slice(7);
      else if (line.startsWith("data: ")) data += line.slice(6);
    }
    if (!type || !data) continue;
    const m = id.match(/-(\d+)$/);
    if (!m) continue;
    out.push({ id, seq: Number(m[1]), type, data: JSON.parse(data) });
  }
  return out;
}

function foldSteps(events: Array<{ type: string; data: any }>): Map<string, StepEventData> {
  const m = new Map<string, StepEventData>();
  for (const e of events) {
    if (e.type === "step") m.set(e.data.step_id, { ...(m.get(e.data.step_id) ?? {}), ...e.data });
  }
  return m;
}
function contentOf(events: Array<{ type: string; data: any }>): string {
  return events.filter((e) => e.type === "content").map((e) => e.data.text ?? e.data.content ?? "").join("");
}

async function main() {
  const { mkdtempSync, rmSync } = await import("fs");
  const { tmpdir } = await import("os");
  const { join } = await import("path");

  const token = (await Bun.file(TOKEN_FILE).text()).trim();
  if (!token) die("token file is empty");

  const { createAPIClient, ConfirmationRequiredError } = await import("../src/api/client");
  const { runModelAction } = await import("../src/ui/modelActions");
  const { sendInConversation, historyContent } = await import("../src/chat/conversationSession");
  const { createConversationStore } = await import("../src/store/conversationStore");
  const { createFileStorage } = await import("../src/store/fileStorage");

  const authHeaders = { Authorization: `Bearer ${token}` };

  // --- Instrumented fetch: records chat bodies and every SSE response's events ---
  const chatBodies: any[] = [];
  const sseRecords: Array<{ label: string; lastEventId?: string; events: RawEvent[] }> = [];
  let dropArmed: null | { onFirstStep: () => Promise<void> } = null;
  let dropFired = false;

  const instrumentedFetch: FetchImpl = async (url, init) => {
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const isChat = method === "POST" && url.endsWith("/v1/chat");
    const isEvents = method === "GET" && /\/v1\/generations\/[^/]+\/events/.test(url);
    if (isChat && typeof init?.body === "string") chatBodies.push(JSON.parse(init.body));
    if (!isChat && !isEvents) return fetch(url, init);

    const killCtl = new AbortController();
    init?.signal?.addEventListener("abort", () => killCtl.abort());
    const real = await fetch(url, { ...init, signal: killCtl.signal });
    if (!real.ok || !real.body) return real;

    const record = { label: isChat ? "chat" : "resume", lastEventId: headers["Last-Event-ID"], events: [] as RawEvent[] };
    sseRecords.push(record);
    const armed = isChat && dropArmed && !dropFired ? dropArmed : null;
    if (armed) dropFired = true;

    const reader = real.body.getReader();
    const dec = new TextDecoder();
    let buffer = "";
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
              return;
            }
            buffer += dec.decode(value, { stream: true });
            const cut = buffer.lastIndexOf("\n\n");
            if (cut < 0) continue;
            const complete = buffer.slice(0, cut + 2);
            buffer = buffer.slice(cut + 2);
            const parsed = parseSSE(complete);
            record.events.push(...parsed);
            controller.enqueue(new TextEncoder().encode(complete));
            if (armed && parsed.some((e) => e.type === "step")) {
              await armed.onFirstStep();
              await sleep(300); // let the app read what was forwarded before the drop
              reader.cancel().catch(() => {});
              controller.error(new TypeError("simulated network drop"));
              killCtl.abort();
              return;
            }
          }
        } catch (e) {
          controller.error(e);
        }
      },
    });
    return new Response(stream, { status: real.status, statusText: real.statusText, headers: new Headers(real.headers) });
  };

  const client = createAPIClient(SERVER_URL, instrumentedFetch);
  client.setToken(token);

  const dir = mkdtempSync(join(tmpdir(), "web-resume-proof-"));
  const file = join(dir, "storage.jsonl");

  async function run() {
    // --- Setup: a tools-capable resident model ---
    console.log("--- Setup: choosing a tools-capable model ---");
    let state = await client.getState();
    console.log(`Installed: ${state.models.map((m) => `${m.name} (tools=${m.tools})`).join(", ")}`);
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
    const model = toolsModel.name;
    const otherModel = state.models.find((m) => m.name !== model);
    console.log(`Model used: ${model}; second installed model for swap check: ${otherModel?.name ?? "(none)"}`);
    console.log("");

    // =====================================================================
    // Checks A + B: reply in progress (AC3) and drop/resume (AC1)
    // =====================================================================
    console.log("--- Checks A+B: web reply; busy checks while searching; drop and resume ---");
    const received: StreamEvent[] = [];
    let generationId = "";
    let busyDone = false;
    const tStart = performance.now();

    dropArmed = {
      onFirstStep: async () => {
        console.log(`  +${(performance.now() - tStart).toFixed(0)}ms first step arrived; reply is still searching (no done yet)`);
        check(!received.some((e) => e.type === "done"), "Check A: no done event yet when the busy checks run");

        // A1: another chat is refused as a reply in progress.
        const res = await fetch(`${SERVER_URL}/v1/chat`, {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply with just OK." }] }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        check(res.status === 409 && body.error === "generation_in_flight", `Check A: second chat refused with 409 generation_in_flight (got ${res.status} ${body.error})`);

        // A2: unload without confirm -> busy confirmation.
        try {
          await client.unloadModel({});
          check(false, "Check A: unload without confirm should not have been accepted");
        } catch (e) {
          const ok = e instanceof ConfirmationRequiredError && e.reasons.includes("reply_in_progress");
          check(ok, `Check A: unload without confirm needs confirmation incl. reply_in_progress (${e instanceof ConfirmationRequiredError ? e.reasons.join(",") : String(e)})`);
        }
        // A3: swap without confirm -> busy confirmation.
        if (otherModel) {
          try {
            await client.loadModel({ name: otherModel.name });
            check(false, "Check A: swap without confirm should not have been accepted");
          } catch (e) {
            const ok = e instanceof ConfirmationRequiredError && e.reasons.includes("reply_in_progress");
            check(ok, `Check A: swap to ${otherModel.name} without confirm needs confirmation incl. reply_in_progress (${e instanceof ConfirmationRequiredError ? e.reasons.join(",") : String(e)})`);
          }
        } else {
          console.log("NOTE: only one model installed; swap busy check not applicable (unload covers the same gate)");
        }
        const st = await client.getState();
        check(st.resident?.name === model, "Check A: the resident model is unchanged after the refused requests");
        busyDone = true;
        console.log(`  +${(performance.now() - tStart).toFixed(0)}ms dropping the connection now`);
      },
    };

    await new Promise<void>((resolve) => {
      client
        .chat(
          { model, messages: [{ role: "user", content: WEB_PROMPT }], web: true },
          {
            onStart: (id) => {
              generationId = id;
            },
            onEvent: (e) => received.push(e),
            onError: (e) => die(`chat error: ${e.message}`),
            onComplete: () => resolve(),
            signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
          }
        )
        .catch((e) => die(`chat threw: ${e instanceof Error ? e.message : String(e)}`));
    });
    dropArmed = null;
    const tDone = performance.now() - tStart;
    check(busyDone, "Check A: the busy checks ran during the reply");
    check(dropFired, "Check B: the connection was dropped mid-reply");

    const first = sseRecords.find((r) => r.label === "chat");
    const resumes = sseRecords.filter((r) => r.label === "resume");
    check(!!first && first.events.some((e) => e.type === "step") && !first.events.some((e) => e.type === "done"), "Check B: the dropped prefix has step event(s) and no done");
    check(resumes.length >= 1 && !!resumes[0].lastEventId && resumes[0].lastEventId.startsWith(generationId), `Check B: the app resumed via Last-Event-ID (${resumes[0]?.lastEventId ?? "none"})`);

    // Full replay from seq 0.
    const replayRes = await fetch(`${SERVER_URL}/v1/generations/${generationId}/events`, { headers: authHeaders });
    if (!replayRes.ok) die(`full replay failed: HTTP ${replayRes.status}`);
    const replay = parseSSE(await replayRes.text());
    const combined = [...(first?.events ?? []), ...resumes.flatMap((r) => r.events)];
    const replaySeqs = replay.map((e) => e.seq);
    const combinedSeqs = combined.map((e) => e.seq);
    check(replay.length > 0 && replay[0].seq === 0, "Check B: the full replay starts at seq 0");
    check(replaySeqs.every((s, i) => s === i), "Check B: the full replay is contiguous (0..n-1)");
    check(JSON.stringify(combinedSeqs) === JSON.stringify(replaySeqs), `Check B: prefix + resumed seqs equal the full replay's seqs, no gap, no duplicate (${combinedSeqs.length} vs ${replaySeqs.length})`);
    check(JSON.stringify(combined.map((e) => [e.type, e.data])) === JSON.stringify(replay.map((e) => [e.type, e.data])), "Check B: prefix + resumed events equal the full replay event by event");
    const foldedCombined = [...foldSteps(combined).entries()];
    const foldedReplay = [...foldSteps(replay).entries()];
    check(JSON.stringify(foldedCombined) === JSON.stringify(foldedReplay) && foldedReplay.length > 0, `Check B: steps folded by step_id are equal (${foldedReplay.length} steps)`);
    check(contentOf(combined) === contentOf(replay) && contentOf(replay).length > 0, `Check B: content is equal (${contentOf(replay).length} chars)`);
    check(replay.filter((e) => e.type === "done").length === 1 && combined.filter((e) => e.type === "done").length === 1, "Check B: exactly one done event");
    const receivedTD = received.map((e) => [e.type, e.data]);
    const replayTD = replay.map((e) => [e.type, e.data]);
    check(JSON.stringify(receivedTD) === JSON.stringify(replayTD), `Check B: what the app's onEvent received equals the full replay (${received.length} events)`);
    const srcEvents = replay.filter((e) => e.type === "sources");
    console.log(`Generation ${generationId}: ${replay.length} events, ${foldedReplay.length} steps, ${srcEvents.reduce((n, e) => n + e.data.items.length, 0)} sources, prefix ${first?.events.length ?? 0} events, resumed ${resumes.reduce((n, r) => n + r.events.length, 0)} events, ${tDone.toFixed(0)}ms total`);
    console.log("");

    // =====================================================================
    // Check C: persistence through conversationSession (AC2)
    // =====================================================================
    console.log("--- Check C: persisted web reply ---");
    const store = createConversationStore(createFileStorage(file));
    const conv = await store.create("Web resume proof");
    await store.setWebSearch(conv.id, true);
    const c1: StreamEvent[] = [];
    let genC = "";
    const tC = performance.now();
    await sendInConversation(client, store, conv.id, WEB_PROMPT, {
      onStart: (id) => {
        genC = id;
      },
      onEvent: (e) => c1.push(e),
      onBlocked: (m) => die(`send blocked: ${m}`),
      onError: (e) => die(`send error: ${e.message}`),
      onUnauthorized: () => die("send unauthorized"),
      onComplete: () => {},
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
    console.log(`Generation ${genC}: ${c1.length} events, ${c1.filter((e) => e.type === "step").length} step events, ${((performance.now() - tC) / 1000).toFixed(1)}s`);
    const loaded = await store.get(conv.id);
    const reply = loaded?.messages.find((m) => m.role === "assistant");
    if (!loaded || !reply) die("Check C: no assistant message persisted");
    check(reply.status === "complete" && reply.content.length > 0, `Check C: the reply completed with content (${reply.content.length} chars)`);
    check((reply.steps?.length ?? 0) > 0, `Check C: the persisted reply has non-empty steps (${reply.steps?.length ?? 0})`);
    check((reply.sources?.length ?? 0) > 0, `Check C: the persisted reply has non-empty sources (${reply.sources?.length ?? 0})`);
    const allowed = new Set(["id", "role", "content", "thinking", "model", "status", "generation_id", "last_seq", "steps", "sources"]);
    const rawStorage = createFileStorage(file);
    const rawConv = JSON.parse((await rawStorage.getItem(`phone-models:v1:conversation:${conv.id}`)) ?? "{}");
    const extraKeys = (rawConv.messages ?? []).flatMap((m: any) => Object.keys(m).filter((k) => !allowed.has(k)));
    check(extraKeys.length === 0, `Check C: stored messages have only the allowed keys (extra: ${extraKeys.join(",") || "none"})`);
    const serialized = JSON.stringify(rawConv);
    check(!/"role"\s*:\s*"tool"/.test(serialized) && (rawConv.messages ?? []).every((m: any) => m.role === "user" || m.role === "assistant"), "Check C: the stored conversation has no tool messages");
    const stepKeys = new Set(["step_id", "kind", "status", "query", "url", "detail"]);
    const badStepKeys = (reply.steps ?? []).flatMap((s) => Object.keys(s).filter((k) => !stepKeys.has(k)));
    const maxDetail = Math.max(0, ...(reply.steps ?? []).map((s) => (s.detail ?? "").length));
    check(badStepKeys.length === 0 && maxDetail < 1000, `Check C: persisted steps hold only step fields, no page text (max detail ${maxDetail} chars)`);
    const badSourceKeys = (reply.sources ?? []).flatMap((s) => Object.keys(s).filter((k) => !["title", "url", "n"].includes(k)));
    check(badSourceKeys.length === 0 && (reply.sources ?? []).every((s) => /^https?:\/\//.test(s.url)), "Check C: persisted sources hold only title, url, n with http(s) URLs");
    const accounted = (rawConv.messages ?? []).reduce((n: number, m: any) => n + JSON.stringify(m.content ?? "").length + JSON.stringify(m.thinking ?? "").length + JSON.stringify(m.steps ?? []).length + JSON.stringify(m.sources ?? []).length, 0);
    check(serialized.length < accounted + 2000, `Check C: stored conversation (${serialized.length} bytes) is only content, thinking, steps, sources plus small metadata (${accounted} accounted); no page text`);
    console.log("");

    // =====================================================================
    // Check D: the follow-up carries answers with source lists, not page text (AC2)
    // =====================================================================
    console.log("--- Check D: follow-up prompt body ---");
    await store.setWebSearch(conv.id, false); // the follow-up itself need not search again
    const followUp = "Reply with just OK.";
    const before = chatBodies.length;
    await sendInConversation(client, store, conv.id, followUp, {
      onEvent: () => {},
      onBlocked: (m) => die(`send blocked: ${m}`),
      onError: (e) => die(`send error: ${e.message}`),
      onUnauthorized: () => die("send unauthorized"),
      onComplete: () => {},
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
    const body = chatBodies[before];
    if (chatBodies.length !== before + 1 || !body) die(`Check D: expected exactly one outgoing chat request, saw ${chatBodies.length - before}`);
    const roles: string[] = body.messages.map((m: any) => m.role);
    check(roles.every((r) => r === "user" || r === "assistant"), `Check D: only user/assistant roles in the outgoing body (${roles.join(",")})`);
    check(roles.join(",") === "user,assistant,user", "Check D: the outgoing body is prior prompt, prior answer, follow-up");
    const prior = body.messages[1]?.content as string;
    check(prior === historyContent(reply) && prior.includes("Sources:"), "Check D: the prior answer carries its Sources: block");
    const missing = (reply.sources ?? []).filter((s) => !prior.includes(s.url));
    check(missing.length === 0, `Check D: every source URL is in the prior answer (${(reply.sources ?? []).length} sources, ${missing.length} missing)`);
    check(prior.startsWith(reply.content), "Check D: the prior answer text is the stored answer, unchanged");
    const bodyText = JSON.stringify(body);
    const bound = prior.length + WEB_PROMPT.length + followUp.length + model.length + 1000;
    check(bodyText.length < bound, `Check D: body size ${bodyText.length} is below answer+sources+prompts+margin ${bound} (no page text re-sent)`);
    check(!body.web, "Check D: the follow-up request did not ask for web");
    console.log(`Follow-up: ${body.messages.length} messages, ${bodyText.length} bytes, answer ${reply.content.length} chars, sources block ${prior.length - reply.content.length} chars`);
    console.log("");

    console.log(failures === 0 ? "All web resume proof checks passed." : `${failures} check(s) FAILED.`);
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
