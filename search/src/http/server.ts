/**
 * Loopback HTTP service (C13, interface I16): POST /v1/read, POST /v1/search, GET /v1/icon,
 * GET /v1/health. The handler takes fetch options only so tests can reach a loopback test server;
 * src/index.ts wires the strict default (no override) and the icon cache directory.
 */
import { fetchPage, FetchPageError, type FetchPageOptions } from "../fetch/fetchPage";
import { extractPage } from "../extract/extract";
import { runHelper, type HelperOptions } from "../search/runHelper";
import { Breakers, BROWSER } from "../search/breakers";
import { getIcon, validateHost, type IconOptions } from "../icon/icon";
import { defaultIconCacheDir } from "../icon/cache";
import { TtlCache, searchKey, MAX_SEARCH_ENTRIES, MAX_PAGE_ENTRIES, type CachedResponse } from "../cache/resultCache";
import { classifyPage } from "@shared/readability";

const STATUS_BY_CODE = {
  bad_url: 400,
  blocked_destination: 400,
  unsupported_content: 415,
  fetch_failed: 502,
  timeout: 504,
} as const;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export type FetchOverrides = Omit<FetchPageOptions, "signal">;

const MAX_QUERY_LENGTH = 500;
const DEFAULT_MAX_RESULTS = 5;

/**
 * Helper options plus the search breakers' inputs. `ddgsBackends` (ordered allowed engines) switches the
 * breakers on; without it the helper gets no `--backends` and nothing rests. `now` is the clock in ms.
 */
export interface SearchOptions extends HelperOptions {
  ddgsBackends?: string[];
  now?: () => number;
}

/** A response with the cache marker; a cached response replays its stored status and body text. */
function withCache(status: number, body: string, state: "hit" | "miss"): Response {
  return new Response(body, { status, headers: { "content-type": "application/json", "x-cache": state } });
}

async function handleSearch(
  req: Request,
  helperOptions: HelperOptions,
  breakers: Breakers | undefined,
  ddgsBackends: string[],
  cache: TtlCache<CachedResponse>,
): Promise<Response> {
  let body: { query?: unknown; max_results?: unknown } | null;
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json(400, { error: "bad_request" });
  }
  const query = body?.query;
  const max = body?.max_results ?? DEFAULT_MAX_RESULTS;
  if (
    typeof query !== "string" ||
    query.trim() === "" ||
    query.length > MAX_QUERY_LENGTH ||
    typeof max !== "number" ||
    !Number.isInteger(max) ||
    max < 1 ||
    max > 10
  ) {
    return json(400, { error: "bad_request" });
  }
  const key = searchKey(query, max);
  const cached = cache.get(key);
  if (cached) return withCache(cached.status, cached.body, "hit");
  let options = helperOptions;
  if (breakers) {
    const open = ddgsBackends.filter((b) => !breakers.isResting(b));
    const noBrowser = breakers.isResting(BROWSER);
    if (open.length === 0 && noBrowser) {
      return json(503, { error: "search_unavailable", detail: "all search backends are resting" });
    }
    options = { ...helperOptions, backends: open, noBrowser };
  }
  const outcome = await runHelper(query, max, req.signal, options);
  breakers?.record(outcome.attempts);
  if (!outcome.ok && outcome.timeout) return json(504, { error: "timeout" });
  if (!outcome.ok) return json(503, { error: "search_unavailable", detail: outcome.detail });
  const text = JSON.stringify({ results: outcome.results, backend: outcome.backend });
  if (outcome.results.length > 0) cache.set(key, { status: 200, body: text });
  return withCache(200, text, "miss");
}

/** Icon options for the handler; `cacheDir` defaults to `defaultIconCacheDir()`. */
export type IconHandlerOptions = Partial<IconOptions>;

const ICON_CACHE_CONTROL = "public, max-age=604800";

async function handleIcon(
  req: Request,
  fetchOptions: FetchOverrides,
  iconOptions: IconHandlerOptions,
): Promise<Response> {
  const raw = new URL(req.url).searchParams.get("host");
  const host = raw === null ? null : validateHost(raw);
  if (!host) return json(400, { error: "bad_url" });
  try {
    const outcome = await getIcon(
      host,
      { ...iconOptions, cacheDir: iconOptions.cacheDir ?? defaultIconCacheDir() },
      { resolve: fetchOptions.resolve, isAllowedAddress: fetchOptions.isAllowedAddress },
      req.signal,
    );
    switch (outcome.kind) {
      case "ok":
        return new Response(new Uint8Array(outcome.bytes), {
          status: 200,
          headers: {
            "content-type": outcome.contentType,
            "cache-control": ICON_CACHE_CONTROL,
            "x-content-type-options": "nosniff",
          },
        });
      case "none":
        return json(404, { error: "no_icon" });
      case "blocked":
        return json(400, { error: "blocked_destination" });
      case "timeout":
        return json(504, { error: "timeout" });
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return new Response(null, { status: 499 });
    return json(404, { error: "no_icon" });
  }
}

export function createHandler(
  fetchOptions: FetchOverrides = {},
  helperOptions: SearchOptions = {},
  iconOptions: IconHandlerOptions = {},
) {
  const { ddgsBackends, now, ...helper } = helperOptions;
  const breakers = ddgsBackends ? new Breakers(now) : undefined;
  const searchCache = new TtlCache<CachedResponse>(MAX_SEARCH_ENTRIES, now);
  const pageCache = new TtlCache<CachedResponse>(MAX_PAGE_ENTRIES, now); // by final URL
  const finalUrls = new TtlCache<string>(MAX_PAGE_ENTRIES, now); // requested URL -> final URL
  return async (req: Request): Promise<Response> => {
    const path = new URL(req.url).pathname;
    if (path === "/v1/icon") {
      if (req.method !== "GET") return json(405, { error: "method_not_allowed" });
      return handleIcon(req, fetchOptions, iconOptions);
    }
    if (path === "/v1/health") {
      if (req.method !== "GET") return json(405, { error: "method_not_allowed" });
      return json(200, { ok: true });
    }
    if (path === "/v1/search") {
      if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
      return handleSearch(req, helper, breakers, ddgsBackends ?? [], searchCache);
    }
    if (path !== "/v1/read") return json(404, { error: "not_found" });
    if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

    let url: unknown;
    try {
      url = ((await req.json()) as { url?: unknown } | null)?.url;
    } catch {
      return json(400, { error: "bad_url" });
    }
    if (typeof url !== "string") return json(400, { error: "bad_url" });

    const knownFinal = finalUrls.get(url);
    const knownPage = knownFinal === undefined ? undefined : pageCache.get(knownFinal);
    if (knownPage) return withCache(knownPage.status, knownPage.body, "hit");

    try {
      const page = await fetchPage(url, { ...fetchOptions, signal: req.signal });
      finalUrls.set(url, page.finalUrl);
      const sameFinal = pageCache.get(page.finalUrl);
      if (sameFinal) return withCache(sameFinal.status, sameFinal.body, "hit");
      const extracted = await extractPage({
        body: page.body,
        contentType: page.contentType,
        finalUrl: page.finalUrl,
        bodyTruncated: page.bodyTruncated,
      });
      const text = JSON.stringify({
        url: page.url,
        final_url: page.finalUrl,
        title: extracted.title,
        markdown: extracted.markdown,
        truncated: extracted.truncated,
      });
      const readability = classifyPage({ title: extracted.title ?? "", text: extracted.markdown ?? "" });
      if (readability.readable) {
        pageCache.set(page.finalUrl, { status: 200, body: text });
      }
      return withCache(200, text, "miss");
    } catch (err) {
      if (err instanceof FetchPageError) {
        const body: { error: string; status?: number } = { error: err.code };
        if (err.code === "fetch_failed" && err.status !== undefined) body.status = err.status;
        return json(STATUS_BY_CODE[err.code], body);
      }
      if (err instanceof DOMException && err.name === "AbortError") return new Response(null, { status: 499 });
      return json(502, { error: "fetch_failed" });
    }
  };
}

export function startServer(
  port: number,
  fetchOptions: FetchOverrides = {},
  helperOptions: SearchOptions = {},
  iconOptions: IconHandlerOptions = {},
) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    // Bun's max idleTimeout is 255 s; the 15 s fetch deadline must not be cut off.
    idleTimeout: 60,
    fetch: createHandler(fetchOptions, helperOptions, iconOptions),
  });
}
