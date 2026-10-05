/**
 * SSRF-guarded page fetcher (C13 → C15, interface I18; FR21).
 *
 * Fetches an http(s) URL through `node:http` / `node:https` — NOT Bun's global `fetch`, which has
 * no DNS hook. Every connection goes through a custom `lookup` that resolves ALL A/AAAA records
 * and refuses the connection if ANY record is non-public; the socket then connects to exactly the
 * address(es) that were checked, so there is no DNS-rebinding gap between check and connect.
 * IP-literal hosts (for which Node/Bun skip `lookup`) are checked directly against the same policy
 * before any connection is attempted. Redirects are followed manually (max 5), and every hop goes
 * through the same checks.
 *
 * Limits: body capped at 5 MiB (the first 5 MiB are returned with `bodyTruncated: true`; the later
 * extraction step truncates the markdown separately), 15 s overall deadline covering every hop and
 * the body, and only `text/html`, `text/plain` and `application/xhtml+xml` responses.
 *
 * Failures throw `FetchPageError` with a `code` that maps onto I16:
 *   bad_url → 400, blocked_destination → 400, unsupported_content → 415,
 *   fetch_failed → 502 (with upstream `status` when there was one), timeout → 504.
 * Abort via `opts.signal` rejects with a DOMException named "AbortError" (not a FetchPageError),
 * so callers can tell a user Stop apart from a fetch failure.
 *
 * R6 (architecture risk): Bun's node:http(s) DOES honour a custom `lookup`; proven by the
 * "R6: Bun honours the custom lookup" tests in fetchPage.test.ts.
 */
import http from "node:http";
import https from "node:https";
import net from "node:net";
import dns from "node:dns";
import zlib from "node:zlib";
import type { Readable } from "node:stream";
import { isPublicAddress } from "./addressPolicy";

export type FetchPageErrorCode = "bad_url" | "blocked_destination" | "unsupported_content" | "fetch_failed" | "timeout";

export class FetchPageError extends Error {
  readonly code: FetchPageErrorCode;
  /** Upstream HTTP status, when the failure was an HTTP response (fetch_failed only). */
  readonly status?: number;
  constructor(code: FetchPageErrorCode, message: string, status?: number) {
    super(message);
    this.name = "FetchPageError";
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface FetchPageOptions {
  /** Aborts the whole fetch (all hops and the body). Rejects with an AbortError. */
  signal?: AbortSignal;
  /** Overall deadline in ms across all hops and the body. Default 15 000. */
  timeoutMs?: number;
  /** Body byte cap. Default 5 MiB. */
  maxBytes?: number;
  /** Maximum redirects followed. Default 5. */
  maxRedirects?: number;
  /**
   * TEST-ONLY. Replaces the DNS resolver (default: `dns.lookup` with `all: true`). Every returned
   * record is still checked against the address policy.
   */
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  /**
   * TEST-ONLY. Replaces the address policy (default: `isPublicAddress`, strict public-only).
   * PRODUCTION CALLERS MUST NEVER PASS THIS: overriding it disables the SSRF guard. It exists only
   * so tests can reach their own loopback server. The same policy is applied to resolved records
   * and to IP-literal hosts.
   */
  isAllowedAddress?: (ip: string) => boolean;
}

export interface FetchedPage {
  /** The URL as requested (normalised by the WHATWG URL parser). */
  url: string;
  /** The URL of the final response after redirects. */
  finalUrl: string;
  status: number;
  /** Lower-cased media type without parameters, e.g. "text/html". */
  contentType: string;
  body: string;
  /** True if the body exceeded `maxBytes` and was cut to its first `maxBytes` bytes. */
  bodyTruncated: boolean;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;
const ALLOWED_TYPES = new Set(["text/html", "text/plain", "application/xhtml+xml"]);
const PAGE_ACCEPT = "text/html,application/xhtml+xml,text/plain;q=0.9";
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

async function defaultResolve(hostname: string): Promise<ResolvedAddress[]> {
  const records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return records.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
}

export async function fetchPage(rawUrl: string, opts: FetchPageOptions = {}): Promise<FetchedPage> {
  const r = await guardedFetch(rawUrl, opts, ALLOWED_TYPES, PAGE_ACCEPT);
  return {
    url: r.url,
    finalUrl: r.finalUrl,
    status: r.status,
    contentType: r.contentType,
    body: decodeText(r.bytes, r.contentTypeHeader),
    bodyTruncated: r.truncated,
  };
}

export interface FetchedBytes {
  /** The URL as requested (normalised by the WHATWG URL parser). */
  url: string;
  /** The URL of the final response after redirects. */
  finalUrl: string;
  status: number;
  /** Lower-cased media type without parameters, e.g. "image/png". */
  contentType: string;
  /** The raw (content-encoding decoded) body, at most `maxBytes` bytes. */
  bytes: Buffer;
  /** True if the body exceeded `maxBytes` and was cut to its first `maxBytes` bytes. */
  truncated: boolean;
}

/**
 * Same SSRF guard, redirects, limits and error codes as `fetchPage`, but returns the body as raw
 * bytes and accepts only the given media types (anything else -> `unsupported_content`). Used by
 * the icon lookup (FR27, D-M10c-2) for image bodies.
 */
export async function fetchBytes(
  rawUrl: string,
  allowedTypes: ReadonlySet<string>,
  opts: FetchPageOptions = {},
): Promise<FetchedBytes> {
  const accept = [...allowedTypes].join(",");
  const r = await guardedFetch(rawUrl, opts, allowedTypes, accept);
  return { url: r.url, finalUrl: r.finalUrl, status: r.status, contentType: r.contentType, bytes: r.bytes, truncated: r.truncated };
}

interface GuardedResult extends FetchedBytes {
  contentTypeHeader: string | undefined;
}

/** The guarded fetch loop shared by `fetchPage` and `fetchBytes` (one copy of the SSRF checks). */
async function guardedFetch(
  rawUrl: string,
  opts: FetchPageOptions,
  allowedTypes: ReadonlySet<string>,
  accept: string,
): Promise<GuardedResult> {
  const policy = opts.isAllowedAddress ?? isPublicAddress;
  const resolve = opts.resolve ?? defaultResolve;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  const startUrl = parseHttpUrl(rawUrl);
  if (!startUrl) throw new FetchPageError("bad_url", "URL must be an absolute http(s) URL");

  if (opts.signal?.aborted) throw abortError();

  // One controller for the whole fetch: fires on the caller's signal or on the deadline.
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, timeoutMs);
  const onCallerAbort = () => ctl.abort();
  opts.signal?.addEventListener("abort", onCallerAbort, { once: true });

  try {
    let current = startUrl;
    for (let hop = 0; ; hop++) {
      const res = await requestOnce(current, policy, resolve, ctl.signal, accept);
      const status = res.statusCode ?? 0;

      if (REDIRECT_STATUSES.has(status)) {
        res.destroy();
        const location = res.headers.location;
        if (!location) throw new FetchPageError("fetch_failed", "redirect without Location", status);
        if (hop >= maxRedirects) throw new FetchPageError("fetch_failed", "too many redirects", status);
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          throw new FetchPageError("fetch_failed", "invalid redirect Location", status);
        }
        // A redirect off http(s) is refused as a destination, not reported as the caller's bad URL.
        if (next.protocol !== "http:" && next.protocol !== "https:") {
          throw new FetchPageError("blocked_destination", `redirect to ${next.protocol} refused`);
        }
        current = next;
        continue;
      }

      if (status < 200 || status > 299) {
        res.destroy();
        throw new FetchPageError("fetch_failed", `upstream status ${status}`, status);
      }

      const contentType = mediaType(res.headers["content-type"]);
      if (!allowedTypes.has(contentType)) {
        res.destroy();
        throw new FetchPageError("unsupported_content", `content type ${contentType || "(none)"} not supported`);
      }

      const { bytes, truncated } = await readCapped(decodedStream(res), maxBytes, ctl.signal);
      return {
        url: startUrl.href,
        finalUrl: current.href,
        status,
        contentType,
        bytes,
        truncated,
        contentTypeHeader: res.headers["content-type"],
      };
    }
  } catch (err) {
    if (opts.signal?.aborted) throw abortError();
    if (timedOut) throw new FetchPageError("timeout", `no complete response within ${timeoutMs} ms`);
    if (err instanceof FetchPageError) throw err;
    throw new FetchPageError("fetch_failed", err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onCallerAbort);
  }
}

function parseHttpUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname) return null;
  return u;
}

/**
 * Issues one request and resolves with the response head. Performs the destination check:
 * IP literals directly, hostnames via the guarded `lookup`.
 */
function requestOnce(
  url: URL,
  policy: (ip: string) => boolean,
  resolve: (hostname: string) => Promise<ResolvedAddress[]>,
  signal: AbortSignal,
  accept: string,
): Promise<http.IncomingMessage> {
  // WHATWG URL keeps IPv6 literals bracketed and normalises IPv4 forms (0x7f.1, 2130706433).
  const host = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
  if (net.isIP(host) !== 0 && !policy(host)) {
    return Promise.reject(new FetchPageError("blocked_destination", "destination address is not public"));
  }
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise((resolvePromise, reject) => {
    let blocked: FetchPageError | null = null;

    const lookup = (
      hostname: string,
      options: { family?: number; all?: boolean } | number | undefined,
      callback: (...args: unknown[]) => void,
    ) => {
      const lookupOpts = typeof options === "object" && options !== null ? options : { family: options };
      resolve(hostname).then(
        (records) => {
          if (records.length === 0) {
            const e = Object.assign(new Error(`no addresses for ${hostname}`), { code: "ENOTFOUND" });
            callback(e);
            return;
          }
          // ALL records must be public; any non-public record refuses the whole host.
          if (records.some((r) => !policy(r.address))) {
            blocked = new FetchPageError("blocked_destination", "destination resolves to a non-public address");
            callback(blocked);
            return;
          }
          const fam = lookupOpts.family === 4 || lookupOpts.family === 6 ? lookupOpts.family : 0;
          const usable = fam ? records.filter((r) => r.family === fam) : records;
          if (usable.length === 0) {
            callback(Object.assign(new Error(`no IPv${fam} address for ${hostname}`), { code: "ENOTFOUND" }));
            return;
          }
          // Hand the socket exactly the checked address(es).
          if (lookupOpts.all) callback(null, usable.map((r) => ({ address: r.address, family: r.family })));
          else callback(null, usable[0].address, usable[0].family);
        },
        (err) => callback(err),
      );
    };

    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(
      url,
      {
        method: "GET",
        lookup: lookup as unknown as net.LookupFunction,
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; HarnessSearch/0.1)",
          accept,
          "accept-encoding": "identity",
        },
        agent: false,
      },
      (res) => {
        signal.removeEventListener("abort", onAbort);
        // Abort after the head arrives is handled by the body reader.
        resolvePromise(res);
      },
    );
    const onAbort = () => {
      req.destroy(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    req.on("error", (err) => {
      signal.removeEventListener("abort", onAbort);
      reject(blocked ?? err);
    });
    req.end();
  });
}

/** Wraps the response in a decompressor if the server ignored `Accept-Encoding: identity`. */
function decodedStream(res: http.IncomingMessage): Readable {
  const enc = String(res.headers["content-encoding"] ?? "").trim().toLowerCase();
  let dec: zlib.Gunzip | zlib.Inflate | zlib.BrotliDecompress | null = null;
  if (enc === "gzip" || enc === "x-gzip") dec = zlib.createGunzip();
  else if (enc === "deflate") dec = zlib.createInflate();
  else if (enc === "br") dec = zlib.createBrotliDecompress();
  if (!dec) return res;
  const d = dec;
  res.on("error", (e) => d.destroy(e));
  d.on("close", () => res.destroy());
  return res.pipe(d);
}

/** Reads up to `maxBytes` (decoded) bytes, then stops reading and destroys the stream. */
function readCapped(stream: Readable, maxBytes: number, signal: AbortSignal): Promise<{ bytes: Buffer; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => {
      stream.destroy();
      finish(() => reject(abortError()));
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });

    stream.on("data", (chunk: Buffer) => {
      if (settled) return;
      const room = maxBytes - total;
      if (chunk.length > room) {
        if (room > 0) chunks.push(chunk.subarray(0, room));
        total = maxBytes;
        stream.destroy();
        finish(() => resolve({ bytes: Buffer.concat(chunks), truncated: true }));
        return;
      }
      chunks.push(chunk);
      total += chunk.length;
    });
    stream.on("end", () => finish(() => resolve({ bytes: Buffer.concat(chunks), truncated: false })));
    stream.on("error", (err) => finish(() => reject(err)));
    stream.on("close", () =>
      finish(() => reject(new FetchPageError("fetch_failed", "connection closed before the body completed"))),
    );
  });
}

function mediaType(header: string | undefined): string {
  if (!header) return "";
  return header.split(";")[0].trim().toLowerCase();
}

function decodeText(bytes: Buffer, contentTypeHeader: string | undefined): string {
  const m = /;\s*charset\s*=\s*"?([^";\s]+)"?/i.exec(contentTypeHeader ?? "");
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder((m ? m[1] : "utf-8") as ConstructorParameters<typeof TextDecoder>[0]);
  } catch {
    decoder = new TextDecoder("utf-8");
  }
  return decoder.decode(bytes);
}

function abortError(): Error {
  return new DOMException("The fetch was aborted", "AbortError");
}
