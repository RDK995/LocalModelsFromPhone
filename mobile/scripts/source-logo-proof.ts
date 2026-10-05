#!/usr/bin/env bun
/**
 * Live proof for M10c2 (FR27; AC21): source-matched links in an answer get the site's logo,
 * fetched from the Mac (GET /v1/icon) through the phone app's own modules -- APIClient.siteIcon,
 * createIconCache, presentLink and logoDisplay -- and nothing else is contacted. Needs the real
 * Mac server and internet (the Mac fetches the logos). No model is used.
 *
 * Checks (each prints PASS/FAIL; the script exits non-zero if any FAIL):
 *   1. (wrapper) Ollama's resident model is unchanged before/after.
 *   2. Live logo: siteIcon("github.com") is a data:image/...;base64 URI, non-empty, logo "image".
 *   3. Phone cache: one /v1/icon request on first get; zero on a second get and on a fresh cache.
 *   4. Globe cases: localhost, 100.100.100.100.nip.io, example.com and a token-less client -> null.
 *   5. Link rules over a saved-reply fixture.
 *   6. Network observation: every recorded URL begins with SERVER_URL/v1/icon?host=.
 *   7. Inspection: no third-party logo service in mobile/src; fetch( only under src/api/.
 *
 * Env: SERVER_URL, PHONE_MODELS_TOKEN_FILE (default ~/.phone-models/token). The token is never printed.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join, relative } from "path";
import { APIClient } from "../src/api/client";
import { createIconCache } from "../src/store/iconCache";
import { createFileStorage } from "../src/store/fileStorage";
import { logoDisplay, presentLink } from "../src/ui/inlineLink";
import type { LinkSource } from "../src/ui/sourceLinks";

const SERVER_URL = process.env.SERVER_URL || "https://ryans-mac-studio.tailc3648a.ts.net:8443";
const TOKEN_FILE = process.env.PHONE_MODELS_TOKEN_FILE || `${process.env.HOME}/.phone-models/token`;
const SRC_DIR = join(import.meta.dir, "..", "src");

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

const requested: string[] = [];
const recordingFetch = ((url: string, init?: RequestInit) => {
  requested.push(String(url));
  return fetch(url, init);
}) as ConstructorParameters<typeof APIClient>[1];

function iconRequests(host: string): number {
  return requested.filter((u) => u === `${SERVER_URL}/v1/icon?host=${encodeURIComponent(host)}`).length;
}

function decodedLength(uri: string): number {
  const m = /^data:image\/[^;]+;base64,(.*)$/.exec(uri);
  return m ? Buffer.from(m[1], "base64").length : 0;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(name) && !/\.test\.(ts|tsx|js|jsx)$/.test(name)) out.push(p);
  }
  return out;
}

async function main(): Promise<void> {
  console.log("=== Source logo proof (M10c2, FR27 / AC21) ===");
  const token = (await Bun.file(TOKEN_FILE).text()).trim();
  if (!token) die("token file is empty");

  const client = new APIClient(SERVER_URL, recordingFetch);
  client.setToken(token);
  const tmp = mkdtempSync(join(tmpdir(), "source-logo-proof-"));
  try {
    console.log("\n--- Check 2: live logo from the Mac ---");
    const uri = await client.siteIcon("github.com");
    check(
      uri !== null && /^data:image\/[^;]+;base64,/.test(uri) && decodedLength(uri) > 0,
      `siteIcon("github.com") is a data:image base64 URI (${uri ? decodedLength(uri) : 0} decoded bytes)`,
    );
    check(logoDisplay(uri).kind === "image", `logoDisplay of it is kind "${logoDisplay(uri).kind}" (want image)`);

    console.log("\n--- Check 3: phone cache ---");
    const storageFile = join(tmp, "storage.jsonl");
    const cache = createIconCache(createFileStorage(storageFile), (h) => client.siteIcon(h));
    const before = iconRequests("github.com");
    const first = await cache.get("github.com");
    const afterFirst = iconRequests("github.com");
    check(first !== null && afterFirst - before === 1, `first get made ${afterFirst - before} /v1/icon request (want 1)`);
    const second = await cache.get("github.com");
    check(
      iconRequests("github.com") === afterFirst && second === first,
      "second get made 0 further requests and returned the same URI",
    );
    const fresh = createIconCache(createFileStorage(storageFile), (h) => client.siteIcon(h));
    const third = await fresh.get("github.com");
    check(
      iconRequests("github.com") === afterFirst && third === first,
      "get from a fresh cache over the same storage made 0 requests and returned the same URI",
    );

    console.log("\n--- Check 4: globe cases ---");
    for (const host of ["localhost", "100.100.100.100.nip.io", "example.com"]) {
      const r = await client.siteIcon(host);
      check(
        r === null && logoDisplay(r).kind === "globe",
        `siteIcon("${host}") -> ${r === null ? "null" : "a URI"}, logo ${logoDisplay(r).kind} (want null, globe)`,
      );
    }
    const noToken = new APIClient(SERVER_URL, recordingFetch);
    let noTokenResult: string | null | "threw" = "threw";
    try {
      noTokenResult = await noToken.siteIcon("github.com");
    } catch {
      noTokenResult = "threw";
    }
    check(noTokenResult === null, `client with no token: siteIcon -> ${noTokenResult === null ? "null" : noTokenResult} (want null, no throw)`);

    console.log("\n--- Check 5: link rules over a saved-reply fixture ---");
    const sources: LinkSource[] = [{ title: "GitHub", url: "https://github.com/about" }];
    for (const url of ["http://www.github.com/about/", "https://github.com/about"]) {
      const p = presentLink(url, sources);
      check(
        p.kind === "source" && p.host === "github.com",
        `${url} -> ${p.kind}${p.kind === "source" ? ` (host ${p.host})` : ""} (want source, github.com)`,
      );
    }
    for (const url of ["https://www.msn.com/en-us/news/some-story", "https://github.com/pricing"]) {
      const p = presentLink(url, sources);
      check(p.kind === "plain", `${url} -> ${p.kind} (want plain)`);
    }
    for (const url of ["https://github.com/about", "http://www.github.com/about/"]) {
      const p = presentLink(url, undefined);
      check(p.kind === "plain", `no sources (non-web answer): ${url} -> ${p.kind} (want plain)`);
    }

    console.log("\n--- Check 6: network observation ---");
    console.log(`Requests recorded (${requested.length}):`);
    for (const u of requested) console.log(`  ${u}`);
    const prefix = `${SERVER_URL}/v1/icon?host=`;
    const stray = requested.filter((u) => !u.startsWith(prefix));
    check(
      requested.length > 0 && stray.length === 0,
      `all ${requested.length} requests went to ${prefix}...${stray.length ? ` (stray: ${stray.join(", ")})` : ""}`,
    );

    console.log("\n--- Check 7: inspection of mobile/src ---");
    const services = [
      "google.com/s2/favicons",
      "favicons?domain",
      "icons.duckduckgo.com",
      "icon.horse",
      "clearbit",
      "faviconkit",
      "besticon",
      "favicone",
    ];
    const files = sourceFiles(SRC_DIR);
    const hits: string[] = [];
    const fetchFiles: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf-8");
      for (const s of services) if (text.includes(s)) hits.push(`${relative(SRC_DIR, f)}: ${s}`);
      if (/\bfetch\(/.test(text)) fetchFiles.push(relative(SRC_DIR, f));
    }
    check(
      hits.length === 0,
      `no third-party logo/favicon service in ${files.length} non-test source files${hits.length ? ` (found: ${hits.join("; ")})` : ""}`,
    );
    console.log(`fetch( appears in: ${fetchFiles.length ? fetchFiles.join(", ") : "(no file)"}`);
    const outside = fetchFiles.filter((f) => !f.startsWith("api/"));
    check(outside.length === 0, `fetch( appears only under src/api/${outside.length ? ` (also in: ${outside.join(", ")})` : ""}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log("\n=== Owner phone observation owed ===");
  console.log("Only the phone can show these; this script does not prove them:");
  console.log("  - A web answer's source-matched link shows the site's logo after its text.");
  console.log("  - Tapping the logo opens Safari at that page.");
  console.log("  - The link text itself, and a non-source link, are not tappable.");
  console.log("  - A site with no logo shows the globe.");
  console.log("  - An older saved web chat gets logos too.");

  if (failures > 0) {
    console.log(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll checks passed");
}

main().catch((e) => die(`unexpected error: ${e instanceof Error ? e.message : String(e)}`));
