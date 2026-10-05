/**
 * Website icon lookup for GET /v1/icon (C13; FR27, D-M10c-2).
 *
 * Fetches `https://<host>/` (HTML only, 512 KiB cap) through the same SSRF-guarded fetcher as
 * POST /v1/read (I18: every resolved record and IP literal checked, every redirect re-checked,
 * the socket connects only to the checked address), takes the first `<link>` whose rel token list
 * contains `apple-touch-icon` or `icon` (which covers `shortcut icon`), resolved against the final
 * page URL, else `/favicon.ico`, and fetches that through the same guard. Only PNG, JPEG, GIF,
 * WebP and ICO bodies up to 256 KiB are accepted; SVG, other types and larger bodies mean "no
 * icon" (never truncated bytes). One 10 s deadline covers every fetch. If the linked icon fails
 * for any reason other than a block or the deadline, /favicon.ico is tried.
 *
 * Blocks win: if the page, a redirect, or an icon URL (linked or /favicon.ico) is refused by the
 * guard, the whole lookup is `blocked` and nothing further is fetched. Blocked and timed-out
 * lookups are not cached; `ok` and `none` are (see cache.ts). No third-party service is contacted:
 * only `<host>` and URLs that the page itself links.
 */
import net from "node:net";
import { fetchBytes, fetchPage, FetchPageError, type FetchPageOptions } from "../fetch/fetchPage";
import { readCachedIcon, writeCachedIcon, type CachedIcon } from "./cache";

export const ICON_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);
export const ICON_MAX_BYTES = 256 * 1024;
export const ICON_PAGE_MAX_BYTES = 512 * 1024;
export const ICON_TIMEOUT_MS = 10_000;

export type IconOutcome = CachedIcon | { kind: "blocked" } | { kind: "timeout" };

export interface IconOptions {
  /** Cache directory. Production passes `defaultIconCacheDir()`. */
  cacheDir: string;
  /** Clock for cache expiry (ms since epoch). Default `Date.now`. */
  now?: () => number;
  /** Overall deadline across every fetch of one lookup. Default 10 000 ms. */
  timeoutMs?: number;
  /**
   * TEST-ONLY. Maps the host to the origin that is fetched (default `https://<host>`), so tests
   * can reach a plain-http loopback server. Production callers never pass this.
   */
  origin?: (host: string) => string;
}

/** Guard overrides passed through to the fetcher (TEST-ONLY resolve / isAllowedAddress). */
export type IconFetchOverrides = Pick<FetchPageOptions, "resolve" | "isAllowedAddress" | "maxRedirects">;

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * Validates a bare DNS hostname (no scheme, path, port, credentials or IP literal; ASCII labels
 * of letters, digits and hyphens; at most 253 characters). Returns it lower-cased, or null.
 * A numeric last label is refused because URL parsers treat such names as IPv4 (e.g. `0x7f.1`).
 */
export function validateHost(raw: string): string | null {
  const host = raw.toLowerCase();
  if (host.length === 0 || host.length > 253) return null;
  if (net.isIP(host) !== 0) return null;
  const labels = host.split(".");
  if (!labels.every((l) => LABEL.test(l))) return null;
  const last = labels[labels.length - 1];
  if (/^(0x[0-9a-f]*|[0-9]+)$/.test(last)) return null;
  return host;
}

/** Cache key: lower-case, leading `www.` stripped. */
export function normaliseHost(host: string): string {
  const h = host.toLowerCase();
  return h.startsWith("www.") && h.length > 4 ? h.slice(4) : h;
}

const LINK_TAG = /<link\b[^>]*>/gi;
const ATTR = /([^\s"'=<>/]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/** The first `<link>` whose rel tokens include `apple-touch-icon` or `icon`, resolved against `baseUrl`. */
export function findIconHref(html: string, baseUrl: string): string | null {
  for (const tag of html.matchAll(LINK_TAG)) {
    const attrs = new Map<string, string>();
    for (const a of tag[0].slice(5, -1).matchAll(ATTR)) {
      const name = a[1].toLowerCase();
      if (!attrs.has(name)) attrs.set(name, a[2] ?? a[3] ?? a[4] ?? "");
    }
    const rel = (attrs.get("rel") ?? "").toLowerCase().split(/\s+/);
    if (!rel.includes("icon") && !rel.includes("apple-touch-icon")) continue;
    const href = decodeEntities((attrs.get("href") ?? "").trim());
    if (!href) continue;
    try {
      return new URL(href, baseUrl).href;
    } catch {
      continue;
    }
  }
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

class Stop extends Error {
  constructor(readonly outcome: "blocked" | "timeout") {
    super(outcome);
  }
}

/** Fetches the icon for `host` (already validated) from the site itself. Never reads the cache. */
export async function lookupIcon(
  host: string,
  opts: IconOptions,
  fetchOverrides: IconFetchOverrides = {},
  signal?: AbortSignal,
): Promise<IconOutcome> {
  const deadline = Date.now() + (opts.timeoutMs ?? ICON_TIMEOUT_MS);
  const origin = opts.origin ? opts.origin(host) : `https://${host}`;
  const guard = (maxBytes: number): FetchPageOptions => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Stop("timeout");
    return {
      resolve: fetchOverrides.resolve,
      isAllowedAddress: fetchOverrides.isAllowedAddress,
      maxRedirects: fetchOverrides.maxRedirects,
      signal,
      timeoutMs: remaining,
      maxBytes,
    };
  };
  // Blocks and the deadline end the lookup; any other failure is just "this URL gave no icon".
  const rethrowStops = (err: unknown) => {
    if (err instanceof FetchPageError && err.code === "blocked_destination") throw new Stop("blocked");
    if (err instanceof FetchPageError && err.code === "timeout") throw new Stop("timeout");
    if (err instanceof Stop || !(err instanceof FetchPageError)) throw err;
  };
  const tryIcon = async (url: string): Promise<CachedIcon | null> => {
    try {
      const r = await fetchBytes(url, ICON_TYPES, guard(ICON_MAX_BYTES));
      if (r.truncated || r.bytes.length === 0) return null;
      return { kind: "ok", contentType: r.contentType, bytes: r.bytes };
    } catch (err) {
      rethrowStops(err);
      return null;
    }
  };

  try {
    const pageUrl = `${origin}/`;
    let linked: string | null = null;
    try {
      const page = await fetchPage(pageUrl, guard(ICON_PAGE_MAX_BYTES));
      if (page.contentType === "text/html" || page.contentType === "application/xhtml+xml") {
        linked = findIconHref(page.body, page.finalUrl);
      }
    } catch (err) {
      rethrowStops(err);
    }
    const favicon = new URL("/favicon.ico", pageUrl).href;
    if (linked) {
      const got = await tryIcon(linked);
      if (got) return got;
      if (linked === favicon) return { kind: "none" };
    }
    return (await tryIcon(favicon)) ?? { kind: "none" };
  } catch (err) {
    if (err instanceof Stop) return { kind: err.outcome };
    throw err;
  }
}

/**
 * Cache-first icon lookup. A fresh cache entry is returned without any network request or log
 * line; otherwise the site is contacted once, one line `icon fetch host=<host> result=<outcome>`
 * is logged, and `ok` / `none` outcomes are cached.
 */
export async function getIcon(
  host: string,
  opts: IconOptions,
  fetchOverrides: IconFetchOverrides = {},
  signal?: AbortSignal,
): Promise<IconOutcome> {
  const key = normaliseHost(host);
  const now = opts.now ?? Date.now;
  const cached = await readCachedIcon(opts.cacheDir, key, now());
  if (cached) return cached;
  const outcome = await lookupIcon(host, opts, fetchOverrides, signal);
  console.log(`icon fetch host=${key} result=${outcome.kind}`);
  if (outcome.kind === "ok" || outcome.kind === "none") await writeCachedIcon(opts.cacheDir, key, outcome, now());
  return outcome;
}
