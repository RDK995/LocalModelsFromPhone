/**
 * On-disk icon cache for GET /v1/icon (C13; FR27, D-M10c-2).
 *
 * One JSON file per normalised host, named by the sha256 of the host (so the filename is always
 * safe). An entry is either `ok` (content type + base64 bytes) or `none` (the site has no usable
 * icon), with the time it was fetched. `ok` entries live 7 days, `none` entries 1 day. Blocked and
 * timed-out lookups are never written. Any unreadable, corrupt or expired entry is a miss.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const POSITIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;

export type CachedIcon = { kind: "ok"; contentType: string; bytes: Buffer } | { kind: "none" };

interface StoredEntry {
  host: string;
  kind: "ok" | "none";
  fetchedAt: number;
  contentType?: string;
  bytes?: string;
}

/** Default cache directory: `$SEARCH_ICON_CACHE_DIR`, else `~/Library/Caches/harness-search/icons`. */
export function defaultIconCacheDir(env: Record<string, string | undefined> = process.env): string {
  const fromEnv = env.SEARCH_ICON_CACHE_DIR;
  return fromEnv && fromEnv.trim() !== "" ? fromEnv : join(homedir(), "Library", "Caches", "harness-search", "icons");
}

function entryPath(dir: string, host: string): string {
  return join(dir, `${createHash("sha256").update(host).digest("hex")}.json`);
}

export async function readCachedIcon(dir: string, host: string, now: number): Promise<CachedIcon | null> {
  let entry: StoredEntry;
  try {
    entry = JSON.parse(await readFile(entryPath(dir, host), "utf8")) as StoredEntry;
  } catch {
    return null;
  }
  if (!entry || typeof entry !== "object" || entry.host !== host || typeof entry.fetchedAt !== "number") return null;
  const age = now - entry.fetchedAt;
  if (entry.kind === "none") return age >= 0 && age < NEGATIVE_TTL_MS ? { kind: "none" } : null;
  if (entry.kind !== "ok" || typeof entry.contentType !== "string" || typeof entry.bytes !== "string") return null;
  if (age < 0 || age >= POSITIVE_TTL_MS) return null;
  const bytes = Buffer.from(entry.bytes, "base64");
  if (bytes.length === 0) return null;
  return { kind: "ok", contentType: entry.contentType, bytes };
}

/** Writes an entry atomically (temp file + rename). Write failures are swallowed: caching is best-effort. */
export async function writeCachedIcon(dir: string, host: string, icon: CachedIcon, now: number): Promise<void> {
  const entry: StoredEntry =
    icon.kind === "ok"
      ? { host, kind: "ok", fetchedAt: now, contentType: icon.contentType, bytes: icon.bytes.toString("base64") }
      : { host, kind: "none", fetchedAt: now };
  const path = entryPath(dir, host);
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(tmp, JSON.stringify(entry), { mode: 0o600 });
    await rename(tmp, path);
  } catch {
    /* best-effort */
  }
}
