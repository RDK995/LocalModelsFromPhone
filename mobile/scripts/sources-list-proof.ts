#!/usr/bin/env bun
/**
 * Live proof for M10d (FR28, FR27; AC22): the Sources list of a real web answer starts collapsed
 * as "Sources (n)", toggles open and closed, and when open has exactly one separate entry per saved
 * source (own url, a title, a logo or the globe), through the phone app's own modules
 * (sourceListModel, APIClient chat/sources parsing, createIconCache, logoDisplay).
 *
 * Modes:
 *   --self-test   offline checks only (3, 4 on a fixed fixture, and 6). No server, model or network.
 *   (default)     live: chat through the proof server (CHAT_URL, CHAT_TOKEN_FILE, CHAT_MODEL) and logos
 *                 from the real Mac (SERVER_URL, PHONE_MODELS_TOKEN_FILE). Tokens are never printed.
 * Checks 1 (resident model) and 7 (bundle freshness) are done by the wrapper.
 */

import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { APIClient } from "../src/api/client";
import type { StreamEvent } from "../src/api/client";
import { createIconCache } from "../src/store/iconCache";
import { createFileStorage } from "../src/store/fileStorage";
import { logoDisplay } from "../src/ui/inlineLink";
import {
  initialSourcesExpanded,
  sourceListEntries,
  sourceListHeader,
  toggleSourcesExpanded,
} from "../src/ui/sourceListModel";
import type { SourceListInput } from "../src/ui/sourceListModel";

const SERVER_URL = process.env.SERVER_URL || "https://ryans-mac-studio.tailc3648a.ts.net:8443";
const TOKEN_FILE = process.env.PHONE_MODELS_TOKEN_FILE || `${process.env.HOME}/.phone-models/token`;
const CHAT_URL = process.env.CHAT_URL || "";
const CHAT_TOKEN_FILE = process.env.CHAT_TOKEN_FILE || "";
const CHAT_MODEL = process.env.CHAT_MODEL || "";
const REPLIES_JSON = process.env.REPLIES_JSON || "";

const PROMPTS = [
  "What are today's top technology news stories? Cite your sources.",
  "What are the latest developments in artificial intelligence? Cite your sources.",
];

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

/** Checks 3 and 4 over any source set. */
function checkList(label: string, sources: SourceListInput[]): void {
  const n = sources.length;
  check(sourceListHeader(sources) === `Sources (${n})`, `${label}: header is exactly "Sources (${n})" (got "${sourceListHeader(sources)}")`);
  let expanded = initialSourcesExpanded;
  check(expanded === false, `${label}: initial state collapsed`);
  expanded = toggleSourcesExpanded(expanded);
  check(expanded === true, `${label}: toggle -> expanded`);
  expanded = toggleSourcesExpanded(expanded);
  check(expanded === false, `${label}: toggle again -> collapsed`);

  const entries = sourceListEntries(sources);
  check(entries.length === n, `${label}: ${entries.length} entries for ${n} saved sources`);
  check(new Set(entries.map((e) => e.key)).size === entries.length, `${label}: entry keys are distinct`);
  check(entries.every((e, i) => e.url === sources[i].url), `${label}: entry i url equals saved source i url`);
  check(
    entries.every((e) => e.title.length > 0 && !/[\r\n]/.test(e.title)),
    `${label}: every title non-empty and single-line`,
  );
  const leaks: string[] = [];
  entries.forEach((e, i) =>
    entries.forEach((o, j) => {
      if (i !== j && o.url.length > 0 && e.title.includes(o.url)) leaks.push(`${i}<-${j}`);
    }),
  );
  check(leaks.length === 0, `${label}: no entry title contains another entry's url${leaks.length ? ` (${leaks.join(", ")})` : ""}`);
}

const FIXTURE: SourceListInput[] = [
  { title: "Fixture A", url: "https://a.example.com/one" },
  { title: "Fixture B", url: "https://b.example.org/two" },
  { title: "Fixture C", url: "https://c.example.net/three" },
];

const SCREENSHOT_FIXTURE: SourceListInput[] = [
  { title: "Markets today | WSJ", url: "https://www.wsj.com/finance/markets" },
  { title: "Tech news - WSJ", url: "https://wsj.com/tech" },
  { title: "Line one\nLine two", url: "https://news.example.org/multi-line-title" },
  { title: "", url: "https://long.example.com/" + "a".repeat(600) + "?q=" + "b".repeat(300) },
  { title: "Same page", url: "https://dup.example.com/page" },
  { title: "Same page again", url: "https://dup.example.com/page" },
];

function checkScreenshotFixture(): void {
  console.log("\n--- Check 6: screenshot-shaped fixture (offline) ---");
  checkList("screenshot fixture", SCREENSHOT_FIXTURE);
  const entries = sourceListEntries(SCREENSHOT_FIXTURE);
  check(entries.length === SCREENSHOT_FIXTURE.length, `screenshot fixture: ${entries.length} separate entries (want ${SCREENSHOT_FIXTURE.length})`);
  check(entries[0].host === "wsj.com" && entries[1].host === "wsj.com", `www.wsj.com and wsj.com entries share host "${entries[0].host}"`);
  check(entries[4].host === entries[5].host && entries[4].key !== entries[5].key, "identical-URL pair: same host, still two entries with distinct keys");
  check(entries[3].title.length > 0, `empty title (long URL) falls back to "${entries[3].title}"`);
  check(entries[2].title === "Line one Line two", `newline title collapsed to "${entries[2].title}"`);
}

async function runChat(client: APIClient, prompt: string): Promise<{ sources: SourceListInput[] & { n?: number }[]; text: string; status: string | null }> {
  const events: StreamEvent[] = [];
  let error: Error | null = null;
  await client.chat(
    { model: CHAT_MODEL, messages: [{ role: "user", content: prompt }], web: true } as Parameters<APIClient["chat"]>[0],
    { onEvent: (e) => events.push(e), onError: (e) => (error = e), onComplete: () => {} },
  );
  if (error) console.log(`  (chat error: ${(error as Error).message})`);
  const sources = events.filter((e) => e.type === "sources").flatMap((e) => (e as Extract<StreamEvent, { type: "sources" }>).data.items);
  const text = events.filter((e) => e.type === "content").map((e) => (e as Extract<StreamEvent, { type: "content" }>).data.text ?? "").join("");
  const done = events.find((e) => e.type === "done") as Extract<StreamEvent, { type: "done" }> | undefined;
  return { sources, text, status: done ? String((done.data as { status?: string }).status ?? "done") : null };
}

async function main(): Promise<void> {
  const selfTest = process.argv.includes("--self-test");
  console.log(`=== Sources list proof (M10d, FR28 / AC22)${selfTest ? " [self-test]" : ""} ===`);

  if (selfTest) {
    console.log("\n--- Checks 3-4: fixed fixture (offline) ---");
    checkList("fixed fixture", FIXTURE);
    checkScreenshotFixture();
    finish();
    return;
  }

  if (!CHAT_URL || !CHAT_TOKEN_FILE || !CHAT_MODEL) die("CHAT_URL, CHAT_TOKEN_FILE and CHAT_MODEL must be set (use the wrapper)");
  const chatToken = (await Bun.file(CHAT_TOKEN_FILE).text()).trim();
  const macToken = (await Bun.file(TOKEN_FILE).text()).trim();
  if (!chatToken || !macToken) die("a token file is empty");
  const chatClient = new APIClient(CHAT_URL, fetch as ConstructorParameters<typeof APIClient>[1]);
  chatClient.setToken(chatToken);

  console.log(`Model: ${CHAT_MODEL}`);
  console.log("\n--- Check 2: live web reply with >= 3 saved sources ---");
  const records: unknown[] = [];
  let chosen: { prompt: string; sources: { title: string; url: string; n?: number }[] } | null = null;
  for (const prompt of PROMPTS) {
    console.log(`Prompt: ${prompt} (may take minutes)`);
    const r = await runChat(chatClient, prompt);
    console.log(`  status=${r.status} sources=${r.sources.length}`);
    r.sources.forEach((s, i) => console.log(`    ${i + 1}. n=${(s as { n?: number }).n ?? "-"} | ${s.title} | ${s.url}`));
    records.push({ model: CHAT_MODEL, prompt, status: r.status, sourceCount: r.sources.length, sources: r.sources, reply: r.text });
    if (r.sources.length >= 3) {
      chosen = { prompt, sources: r.sources as { title: string; url: string; n?: number }[] };
      break;
    }
    console.log("  fewer than 3 sources; trying the next prompt");
  }
  if (REPLIES_JSON) writeFileSync(REPLIES_JSON, JSON.stringify({ model: CHAT_MODEL, records }, null, 2));
  if (!check(chosen !== null, `a reply has >= 3 saved sources${chosen ? ` (${chosen.sources.length}, prompt "${chosen.prompt}")` : ""}`)) {
    finish();
    return;
  }
  const sources = chosen!.sources;

  console.log("\n--- Checks 3-4: view-model over the live sources ---");
  checkList("live", sources);

  console.log("\n--- Check 5: logos through the real Mac /v1/icon ---");
  const requested: string[] = [];
  const recordingFetch = ((url: string, init?: RequestInit) => {
    requested.push(String(url));
    return fetch(url, init);
  }) as ConstructorParameters<typeof APIClient>[1];
  const macClient = new APIClient(SERVER_URL, recordingFetch);
  macClient.setToken(macToken);
  const tmp = mkdtempSync(join(tmpdir(), "sources-list-proof-"));
  try {
    const cache = createIconCache(createFileStorage(join(tmp, "storage.jsonl")), (h) => macClient.siteIcon(h));
    const entries = sourceListEntries(sources);
    const hosts = [...new Set(entries.map((e) => e.host).filter((h): h is string => !!h))];
    const shown = new Map<string, string>();
    for (const host of hosts) {
      const uri = await cache.get(host);
      const kind = logoDisplay(uri).kind;
      shown.set(host, kind);
      console.log(`  ${host} -> ${kind}`);
    }
    const allHave = entries.every((e) => {
      const kind = e.host ? shown.get(e.host) : logoDisplay(null).kind;
      return kind === "image" || kind === "globe";
    });
    check(allHave, `every one of ${entries.length} entries has a logo display (image or globe); ${[...shown.values()].filter((k) => k === "image").length}/${hosts.length} hosts got an image`);
    const prefix = `${SERVER_URL}/v1/icon?host=`;
    const stray = requested.filter((u) => !u.startsWith(prefix));
    check(stray.length === 0, `network observation: all ${requested.length} requests went to ${prefix}...${stray.length ? ` (stray: ${stray.join(", ")})` : ""}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  checkScreenshotFixture();
  finish();
}

function finish(): void {
  if (failures > 0) {
    console.log(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll checks passed");
}

main().catch((e) => die(`unexpected error: ${e instanceof Error ? e.message : String(e)}`));
