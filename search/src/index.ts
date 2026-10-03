/**
 * Search service entry point: 127.0.0.1:7790 (loopback host is not overridable).
 * Test-only overrides: SEARCH_PORT (listen port); SEARCH_TIMEOUT_MS (search helper time limit in ms,
 * positive integer, otherwise ignored; default 25 000).
 * SEARCH_DDGS_BACKENDS: comma-separated ordered allowed ddgs engines (default duckduckgo,bing,brave,mojeek).
 * SEARCH_ICON_CACHE_DIR: directory for the GET /v1/icon disk cache (default
 * ~/Library/Caches/harness-search/icons; created with mode 0700 on first write).
 * The public-web fetchers (POST /v1/read, GET /v1/icon) always run under the strict SSRF policy:
 * no resolver/policy/origin override is passed here.
 */
import { startServer } from "./http/server";
import { defaultIconCacheDir } from "./icon/cache";
import { DEFAULT_DDGS_BACKENDS } from "./search/breakers";

const DEFAULT_PORT = 7790;
const port = process.env.SEARCH_PORT ? Number(process.env.SEARCH_PORT) : DEFAULT_PORT;

const envTimeout = Number(process.env.SEARCH_TIMEOUT_MS);
const timeoutMs = Number.isInteger(envTimeout) && envTimeout > 0 ? envTimeout : undefined;

const envBackends = (process.env.SEARCH_DDGS_BACKENDS ?? "")
  .split(",")
  .map((b) => b.trim())
  .filter((b) => b !== "");
const ddgsBackends = envBackends.length > 0 ? envBackends : DEFAULT_DDGS_BACKENDS;

const server = startServer(port, {}, { timeoutMs, ddgsBackends }, { cacheDir: defaultIconCacheDir() });
console.log(`search service listening on http://${server.hostname}:${server.port}`);
