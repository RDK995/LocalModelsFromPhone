/**
 * Loopback HTTP service (C13, interface I16): POST /v1/read, POST /v1/search, GET /v1/health.
 * The handler takes fetch options only so tests can reach a loopback test server; src/index.ts
 * wires the strict default (no override).
 */
import { fetchPage, FetchPageError, type FetchPageOptions } from "../fetch/fetchPage";
import { extractPage } from "../extract/extract";
import { runHelper, type HelperOptions } from "../search/runHelper";

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

async function handleSearch(req: Request, helperOptions: HelperOptions): Promise<Response> {
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
  const outcome = await runHelper(query, max, req.signal, helperOptions);
  if (!outcome.ok && outcome.timeout) return json(504, { error: "timeout" });
  if (!outcome.ok) return json(503, { error: "search_unavailable", detail: outcome.detail });
  return json(200, { results: outcome.results, backend: outcome.backend });
}

export function createHandler(fetchOptions: FetchOverrides = {}, helperOptions: HelperOptions = {}) {
  return async (req: Request): Promise<Response> => {
    const path = new URL(req.url).pathname;
    if (path === "/v1/health") {
      if (req.method !== "GET") return json(405, { error: "method_not_allowed" });
      return json(200, { ok: true });
    }
    if (path === "/v1/search") {
      if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
      return handleSearch(req, helperOptions);
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

    try {
      const page = await fetchPage(url, { ...fetchOptions, signal: req.signal });
      const extracted = await extractPage({
        body: page.body,
        contentType: page.contentType,
        finalUrl: page.finalUrl,
        bodyTruncated: page.bodyTruncated,
      });
      return json(200, {
        url: page.url,
        final_url: page.finalUrl,
        title: extracted.title,
        markdown: extracted.markdown,
        truncated: extracted.truncated,
      });
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

export function startServer(port: number, fetchOptions: FetchOverrides = {}, helperOptions: HelperOptions = {}) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    // Bun's max idleTimeout is 255 s; the 15 s fetch deadline must not be cut off.
    idleTimeout: 60,
    fetch: createHandler(fetchOptions, helperOptions),
  });
}
