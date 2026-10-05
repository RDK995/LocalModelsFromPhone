#!/usr/bin/env bun
/**
 * Live proof for M10b (FR26; AC20): assistant replies render as formatted blocks with no
 * raw markdown characters, driven through the app's own modules -- client, conversation
 * store (file-backed), conversation session, buildChatItems and the markdown parser --
 * against the real server and the real Ollama. MarkdownText.tsx renders item.content via
 * parseMarkdown, so the parser is checked on exactly the content the chat items carry.
 * How the styled text looks on screen is proven separately on the phone.
 *
 * Checks (each prints PASS/FAIL; the script exits non-zero if any FAIL):
 *   1. Streamed reply (web switch off): every streamed prefix parses without error; the
 *      stored reply, via buildChatItems, has heading/list blocks and bold/code/link inlines
 *      and its visible text has no raw markdown characters. Retried up to 2 more times.
 *   2. Mid-stream unterminated markup: prefixes that ended inside unterminated markup parse
 *      without error and show no `**` or `](`. Falls back to synthetic prefixes of the final
 *      reply (and says so) if the live stream produced none.
 *   3. Saved-before-this-change reply: written straight into file storage in the existing
 *      persisted format, loaded by a fresh store, checked like check 1.
 *
 * Env: SERVER_URL, PHONE_MODELS_TOKEN_FILE (default ~/.phone-models/token). The token is
 * never printed. MARKDOWN_PROOF_SELFTEST_FAIL=1 is a self-test switch: check 3 then uses the
 * saved content rendered WITHOUT parsing, so the proof must print FAIL and exit non-zero.
 */

import type { StreamEvent } from "@/api/client";
import type { Model } from "@shared/api";
import type { Block, Inline } from "../src/ui/markdown";

const SERVER_URL = process.env.SERVER_URL || "https://ryans-mac-studio.tailc3648a.ts.net:8443";
const TOKEN_FILE = process.env.PHONE_MODELS_TOKEN_FILE || `${process.env.HOME}/.phone-models/token`;
const SELFTEST_FAIL = process.env.MARKDOWN_PROOF_SELFTEST_FAIL === "1";
const LOAD_UNLOAD_MAX_WAIT_MS = 180_000;
const CHAT_TIMEOUT_MS = 300_000;
const MAX_ATTEMPTS = 3;

const PROMPT =
  "Reply in markdown only. Include: a level-2 heading, one **bold** phrase, a bulleted list of three items, " +
  "the inline code `npm install`, and a link written as [Example](https://example.com). Keep it under 120 words.";

const SAVED_CONTENT =
  "# Title\n\nSome **bold** text with `code` and a [Docs](https://example.com/docs) link.\n\n- item one\n- item two\n";

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

function inlineTypes(nodes: Inline[], out: Set<string>): void {
  for (const n of nodes) {
    out.add(n.type);
    if (n.type === "bold" || n.type === "italic" || n.type === "link") inlineTypes(n.children, out);
  }
}

/** Block types and inline types present anywhere in the parsed blocks. */
function collectTypes(blocks: Block[]): { blocks: Set<string>; inlines: Set<string> } {
  const b = new Set<string>();
  const i = new Set<string>();
  for (const block of blocks) {
    b.add(block.type);
    if (block.type === "paragraph" || block.type === "heading" || block.type === "quote") {
      inlineTypes(block.children, i);
    } else if (block.type === "list") {
      for (const item of block.items) inlineTypes(item.children, i);
    } else if (block.type === "table") {
      for (const row of block.rows) for (const cell of row) inlineTypes(cell, i);
    }
  }
  return { blocks: b, inlines: i };
}

/** Problems with the visible text: raw markdown characters that should have been consumed. */
function rawProblems(visible: string): string[] {
  const problems: string[] = [];
  if (visible.includes("**")) problems.push("`**`");
  if (visible.includes("__")) problems.push("`__`");
  if (visible.includes("](")) problems.push("`](`");
  if (visible.includes("`")) problems.push("a backtick");
  if (/^#/m.test(visible)) problems.push("a line starting with `#`");
  if (visible.includes("https://example.com")) problems.push("the raw link url");
  return problems;
}

/** True when the prefix ends inside unterminated markup (odd `**`, unclosed backtick, `[` or `](`). */
function endsUnterminated(prefix: string): boolean {
  const count = (s: string, sub: string) => prefix.split(sub).length - 1;
  if (count(prefix, "**") % 2 === 1) return true;
  if (count(prefix, "`") % 2 === 1) return true;
  if (count(prefix, "[") > count(prefix, "]")) return true;
  const linkOpen = prefix.lastIndexOf("](");
  if (linkOpen >= 0 && prefix.indexOf(")", linkOpen) < 0) return true;
  return false;
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
  const { buildChatItems } = await import("../src/ui/chatItems");
  const { parseMarkdown, visibleText } = await import("../src/ui/markdown");

  const client = createAPIClient(SERVER_URL, fetch);
  client.setToken(token);

  const dir = mkdtempSync(join(tmpdir(), "markdown-render-proof-"));
  const file = join(dir, "storage.jsonl");
  const store = createConversationStore(createFileStorage(file));

  function tryParse(text: string): { blocks: Block[] } | { error: unknown } {
    try {
      return { blocks: parseMarkdown(text) };
    } catch (error) {
      return { error };
    }
  }

  /** The check-1 assertions on a reply's final content; returns the list of missing constructs. */
  function assessFinal(content: string, label: string): string[] {
    const blocks = parseMarkdown(content);
    const visible = visibleText(blocks);
    console.log(`--- ${label}: raw reply ---\n${content}\n--- ${label}: visible text ---\n${visible}\n---`);
    const { blocks: bt, inlines: it } = collectTypes(blocks);
    const missing: string[] = [];
    if (!bt.has("heading")) missing.push("heading block");
    if (!bt.has("list")) missing.push("list block");
    for (const t of ["bold", "code", "link"]) if (!it.has(t)) missing.push(`${t} inline`);
    return missing;
  }

  async function run() {
    // --- Setup: use the resident model, or load the smallest installed one ---
    console.log("--- Setup: choosing a model ---");
    let state = await client.getState();
    console.log(`Installed: ${state.models.map((m) => m.name).join(", ")}`);
    console.log(`Resident: ${state.resident ? state.resident.name : "(none)"}`);
    if (!state.resident) {
      const smallest: Model | undefined = [...state.models].sort((a, b) => a.size_bytes - b.size_bytes)[0];
      if (!smallest) die("Setup: no installed models");
      const target = smallest.name;
      console.log(`Loading ${target} (nothing resident)...`);
      const loaded = await runModelAction({
        getState: () => client.getState(),
        start: () => client.loadModel({ name: target, confirm: true }),
        maxWaitMs: LOAD_UNLOAD_MAX_WAIT_MS,
      });
      if ("cancelled" in loaded) die("Setup: load was unexpectedly cancelled");
      state = await client.getState();
    }
    if (!state.resident) die("Setup: no model is resident");
    console.log(`Using model: ${state.resident.name}\n`);

    // --- Check 1 (and prefixes for check 2): streamed reply, retried if constructs are missing ---
    console.log("--- Check 1: streamed reply formats without raw markdown (AC20) ---");
    let prefixes: string[] = [];
    let finalContent = "";
    let gotAll = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !gotAll; attempt++) {
      console.log(`Attempt ${attempt} of ${MAX_ATTEMPTS}`);
      const conv = await store.create(`Markdown proof ${attempt}`);
      const captured: string[] = [];
      let acc = "";
      await sendInConversation(client, store, conv.id, PROMPT, {
        onEvent: (e: StreamEvent) => {
          if (e.type === "content") {
            acc += e.data.text;
            captured.push(acc);
          }
        },
        onBlocked: (m) => die(`send blocked: ${m}`),
        onError: (e) => die(`send error: ${e.message}`),
        onUnauthorized: () => die("send unauthorized"),
        onComplete: () => {},
        signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
      });
      prefixes = captured;
      const stored = await store.get(conv.id);
      const item = stored ? buildChatItems(stored.messages, null).find((c) => c.role === "assistant") : undefined;
      if (!item) {
        console.log("No assistant chat item after the reply; retrying");
        continue;
      }
      finalContent = item.content;
      const missing = assessFinal(finalContent, `Attempt ${attempt}`);
      if (missing.length === 0) gotAll = true;
      else console.log(`Missing constructs: ${missing.join(", ")}`);
    }

    check(prefixes.length > 0, `Check 1: content events were captured (${prefixes.length} prefixes)`);
    let parseErrors = 0;
    for (const p of prefixes) if ("error" in tryParse(p)) parseErrors++;
    check(parseErrors === 0, `Check 1: every streamed prefix parses without error (${prefixes.length} prefixes, ${parseErrors} errors)`);
    check(gotAll, "Check 1: the stored reply, via buildChatItems, has a heading, a list, and bold, code and link inlines");
    if (gotAll) {
      const problems = rawProblems(visibleText(parseMarkdown(finalContent)));
      check(problems.length === 0, `Check 1: visible text has no raw markdown characters${problems.length ? ` (found ${problems.join(", ")})` : ""}`);
    }
    console.log("");

    // --- Check 2: mid-stream unterminated markup ---
    console.log("--- Check 2: mid-stream unterminated markup ---");
    const unterminated = prefixes.filter(endsUnterminated);
    console.log(`Live prefixes that ended inside unterminated markup: ${unterminated.length} of ${prefixes.length}`);
    const badPrefix = (p: string): string | null => {
      const r = tryParse(p);
      if ("error" in r) return "parse error";
      const v = visibleText(r.blocks);
      if (v.includes("**")) return "shows `**`";
      if (v.includes("](")) return "shows `](`";
      return null;
    };
    if (unterminated.length > 0) {
      const bad = unterminated.filter((p) => badPrefix(p) !== null);
      check(bad.length === 0, `Check 2: all ${unterminated.length} live unterminated prefixes parse and show no \`**\` or \`](\``);
    } else {
      console.log("Synthetic path used: the live stream produced no unterminated prefix; checking every prefix length of the final reply.");
      let synthetic = 0;
      let bad = 0;
      for (let n = 0; n <= finalContent.length; n++) {
        const p = finalContent.slice(0, n);
        if (endsUnterminated(p)) synthetic++;
        if (badPrefix(p) !== null) bad++;
      }
      check(bad === 0, `Check 2: all ${finalContent.length + 1} synthetic prefixes parse and show no \`**\` or \`](\` (${synthetic} unterminated)`);
      check(synthetic > 0, "Check 2: the final reply has at least one unterminated synthetic prefix");
    }
    console.log("");

    // --- Check 3: reply saved before this change, loaded from file storage ---
    console.log("--- Check 3: a reply saved before this change renders the same way ---");
    const savedId = "saved-before-m10b";
    const rawStorage = createFileStorage(file);
    const saved = {
      id: savedId,
      title: "Saved chat",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      messages: [
        { id: "u1", role: "user", content: "Show me formatting", status: "complete" },
        { id: "a1", role: "assistant", content: SAVED_CONTENT, status: "complete" },
      ],
    };
    await rawStorage.setItem(`phone-models:v1:conversation:${savedId}`, JSON.stringify(saved));
    const indexKey = "phone-models:v1:conversations-index";
    const index: string[] = JSON.parse((await rawStorage.getItem(indexKey)) ?? "[]");
    await rawStorage.setItem(indexKey, JSON.stringify([...index, savedId]));

    const freshStore = createConversationStore(createFileStorage(file));
    const loadedConv = await freshStore.get(savedId);
    check(loadedConv !== null, "Check 3: a fresh store over the file loads the saved conversation");
    const savedItem = loadedConv ? buildChatItems(loadedConv.messages, null).find((c) => c.role === "assistant") : undefined;
    check(!!savedItem && savedItem.content === SAVED_CONTENT, "Check 3: the chat item carries the saved content unchanged");
    if (savedItem) {
      const missing = assessFinal(savedItem.content, "Saved reply");
      check(missing.length === 0, `Check 3: parsed blocks have a heading, a list, and bold, code and link inlines${missing.length ? ` (missing ${missing.join(", ")})` : ""}`);
      const visible = SELFTEST_FAIL ? savedItem.content : visibleText(parseMarkdown(savedItem.content));
      if (SELFTEST_FAIL) console.log("SELFTEST: check 3 uses the content rendered WITHOUT parsing");
      const problems = rawProblems(visible);
      check(problems.length === 0, `Check 3: visible text has no raw markdown characters${problems.length ? ` (found ${problems.join(", ")})` : ""}`);
    }
    console.log("");

    console.log(failures === 0 ? "All markdown render proof checks passed." : `${failures} check(s) FAILED.`);
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
