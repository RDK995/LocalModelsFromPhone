# C13 Search Service HTTP API

The search service provides a loopback-only HTTP API for web search, page reading and website icons. It is not exposed via Tailscale Serve, LAN, or any network interface other than loopback.

**Base URL:** `http://127.0.0.1:7790`

**Network:** Loopback (127.0.0.1) only, IPv4; not accessible from any other network interface, Tailscale, or WAN.

**Authentication:** None. No token, key, or authentication header required. Security relies on loopback binding only.

**LaunchAgent:** The service runs under `com.harness.search` (installed by `ops/scripts/install-search-agent.sh`).

**Timeout:** Search operations have a default 25-second time limit (overridable by test-only `SEARCH_TIMEOUT_MS` environment variable). The timeout applies to the entire helper subprocess run, including DNS resolution, network I/O, and page processing.

## Routes

### GET /v1/health

Health check endpoint. Returns immediately with no dependencies.

**Request:**
- Method: `GET`
- No body required
- No query parameters

**Success Response (200 OK):**
```json
{
  "ok": true
}
```

**Error Responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 405 Method Not Allowed | `method_not_allowed` | Request method is not `GET` |
| 404 Not Found | `not_found` | If somehow routed to this response (should not occur for correct path) |

**Example:**
```bash
curl -X GET http://127.0.0.1:7790/v1/health
```

---

### POST /v1/search

Performs a web search using the helper subprocess. Spawns an external helper with Chromium/Playwright that searches the web and returns results from the configured backend(s).

**Request:**
- Method: `POST`
- Content-Type: `application/json`
- Body:
  ```json
  {
    "query": "search term",
    "max_results": 5
  }
  ```

**Request Fields:**

| Field | Type | Required | Default | Limits | Notes |
|-------|------|----------|---------|--------|-------|
| `query` | string | Yes | — | 1–500 characters (trimmed) | Non-empty after whitespace trim; can contain any UTF-8 characters |
| `max_results` | integer | No | 5 | 1–10 | Number of results to return; must be a whole number |

**Success Response (200 OK):**
```json
{
  "results": [
    {
      "url": "https://example.com/article",
      "title": "Article Title",
      "snippet": "Brief excerpt from the page..."
    }
  ],
  "backend": "ddgs"
}
```

**Success Response Fields:**

| Field | Type | Notes |
|-------|------|-------|
| `results` | array | Array of SearchResult objects (0 to `max_results` items) |
| `results[].url` | string | URL of the search result (may be empty if extraction failed) |
| `results[].title` | string | Title or heading of the result (may be empty) |
| `results[].snippet` | string | Brief text excerpt (may be empty) |
| `backend` | string | Identifier of the backend used (e.g., "ddgs", "bing"; subject to SEARCH_HELPER_FORCE_* env vars) |

**Error Responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 Bad Request | `bad_request` | Invalid JSON, missing `query`, `query` is not a string, `query` is empty/whitespace-only, `query` exceeds 500 chars, `max_results` is not an integer, `max_results` < 1 or > 10 |
| 503 Service Unavailable | `search_unavailable` | Helper subprocess failed to produce results (e.g., failed to start, crashed, produced invalid JSON, no results found). Response includes a `detail` field with the error reason. |
| 504 Gateway Timeout | `timeout` | Helper subprocess did not complete within the time limit (default 25 seconds). The helper and all its child processes (Playwright driver, Chromium) are killed. |
| 405 Method Not Allowed | `method_not_allowed` | Request method is not `POST` |

**Example:**
```bash
curl -X POST http://127.0.0.1:7790/v1/search \
  -H "Content-Type: application/json" \
  -d '{"query": "climate change", "max_results": 3}'
```

**Example Response (503):**
```json
{
  "error": "search_unavailable",
  "detail": "helper exited with code 1"
}
```

**Example Response (504):**
```json
{
  "error": "timeout"
}
```

---

### POST /v1/read

Fetches and extracts the main text content from a web page. Returns the page title and markdown-formatted content.

**Request:**
- Method: `POST`
- Content-Type: `application/json`
- Body:
  ```json
  {
    "url": "https://example.com/page"
  }
  ```

**Request Fields:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `url` | string | Yes | Absolute `http://` or `https://` URL; subject to SSRF guard |

**Success Response (200 OK):**
```json
{
  "url": "https://example.com/page",
  "final_url": "https://example.com/page/redirected",
  "title": "Page Title",
  "markdown": "# Page Title\n\nMain article text...",
  "truncated": false
}
```

**Success Response Fields:**

| Field | Type | Notes |
|-------|------|-------|
| `url` | string | The requested URL (normalized by WHATWG URL parser) |
| `final_url` | string | Final URL after following redirects (max 5) |
| `title` | string | Extracted page title (empty string if not found or not HTML) |
| `markdown` | string | Main-content text as markdown, truncated to 40,000 characters. Includes a marker `[… truncated: ...]` if truncated. |
| `truncated` | boolean | `true` if either the fetched body or markdown exceeded size limits |

**Error Responses:**

| Status | Code | Condition | Notes |
|--------|------|-----------|-------|
| 400 Bad Request | `bad_url` | Invalid JSON body, missing `url` field, or `url` is not a string; also if the URL is not a valid absolute `http://` or `https://` URL | Does not include upstream status; indicates caller error |
| 400 Bad Request | `blocked_destination` | URL destination is not public: loopback (127.0.0.1, ::1), RFC 1918 private (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16), link-local (169.254.0.0/16 including metadata 169.254.169.254), CGNAT (100.64.0.0/10 including Tailscale 100.100.100.100), or a redirect target that fails the check | Enforced by SSRF guard (`isPublicAddress`); tests use `isAllowedAddress` override only |
| 415 Unsupported Media Type | `unsupported_content` | Response Content-Type is not `text/html`, `text/plain`, or `application/xhtml+xml` | Non-text content rejected after fetching |
| 502 Bad Gateway | `fetch_failed` | Upstream HTTP error or network failure (e.g., 404, 500, connection reset). Response includes `status` field if an upstream HTTP status was received. | May also indicate too many redirects (> 5), redirect loops, invalid Location header, or connection errors |
| 504 Gateway Timeout | `timeout` | Overall fetch deadline (15 seconds default) exceeded covering all hops and body read | Applies to DNS, connect, response headers, and body read collectively |
| 499 Client Closed Connection | — | Client aborted the request (e.g., called `AbortController.abort()` or closed the connection) | Special case; not a fetch service error but a client abort |
| 405 Method Not Allowed | `method_not_allowed` | Request method is not `POST` |

**Example:**
```bash
curl -X POST http://127.0.0.1:7790/v1/read \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/article"}'
```

**Example Response (200):**
```json
{
  "url": "https://example.com/article",
  "final_url": "https://example.com/article?v=1",
  "title": "Understanding Search Engines",
  "markdown": "# Understanding Search Engines\n\n...",
  "truncated": false
}
```

**Example Response (400 blocked_destination):**
```json
{
  "error": "blocked_destination"
}
```

**Example Response (502 with upstream status):**
```json
{
  "error": "fetch_failed",
  "status": 404
}
```

---

### GET /v1/icon

Returns a website's own icon (logo) as image bytes, fetched by the Mac from that website itself. No third-party favicon or logo service is ever used: the only addresses contacted are `<host>` and URLs that its home page itself links.

**Request:**
- Method: `GET`
- Query: `host=<hostname>`, a bare DNS hostname such as `example.com` or `www.example.com`

| Parameter | Type | Required | Notes |
|-----------|------|----------|-------|
| `host` | string | Yes | ASCII hostname only: labels of letters, digits and hyphens, at most 253 characters. No scheme, path, port, credentials, spaces or IP literal (a name whose last label is numeric, e.g. `0x7f.1`, is refused as an IP literal). Case-insensitive. |

**How the icon is found:**
1. `https://<host>/` is fetched (HTML only, first 512 KiB).
2. The first `<link>` in document order whose `rel` token list (case-insensitive) contains `apple-touch-icon` or `icon` (which covers `shortcut icon`) is taken; its `href` is resolved against the final page URL.
3. If there is no such link, the page fetch fails (other than a block or the deadline), or the linked icon is not usable, `https://<host>/favicon.ico` is tried instead.

Every fetch goes through the same SSRF guard as `POST /v1/read`: every resolved DNS record and every IP literal must be a public address, every redirect hop (max 5) is re-checked, and the socket connects only to the address that was checked.

**Accepted icon content:** `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/x-icon`, `image/vnd.microsoft.icon`. SVG and every other type count as "no icon". An icon larger than 256 KiB counts as "no icon" (bytes are never truncated).

**Limits:** 256 KiB per icon; 512 KiB for the HTML page; one 10-second deadline covering the page fetch and the icon fetch(es) together.

**Success Response (200 OK):** the icon bytes, with headers:

| Header | Value |
|--------|-------|
| `Content-Type` | The upstream image media type (one of the accepted types above, without parameters) |
| `Cache-Control` | `public, max-age=604800` |
| `X-Content-Type-Options` | `nosniff` |

**Error Responses (JSON):**

| Status | Code | Condition |
|--------|------|-----------|
| 400 Bad Request | `bad_url` | `host` missing or not a valid bare hostname (see above) |
| 400 Bad Request | `blocked_destination` | The host resolves to a non-public address (e.g. `localhost`, LAN, tailnet, link-local/metadata), or the page, a redirect, the linked icon URL or `/favicon.ico` points at one. A block ends the lookup: nothing further (not even `/favicon.ico`) is fetched. |
| 404 Not Found | `no_icon` | The site has no usable icon: no icon link and no `/favicon.ico`, only SVG / non-image / oversize icons, upstream errors, or the site is unreachable or refuses the Mac |
| 504 Gateway Timeout | `timeout` | The 10-second overall deadline was exceeded |
| 499 Client Closed Connection | — | The client aborted the request |
| 405 Method Not Allowed | `method_not_allowed` | Request method is not `GET` |

**Caching:** Results are cached on disk under the service's own cache directory (`SEARCH_ICON_CACHE_DIR`, default `~/Library/Caches/harness-search/icons`, created with mode 0700), one file per normalised host (lower-case, leading `www.` stripped; the filename is the SHA-256 of the host). Each entry records the bytes, content type and fetch time, or a "no icon" marker. Icons are kept for 7 days, "no icon" results for 1 day; after that the site is fetched again. `blocked_destination` and `timeout` results are not cached. A cache hit makes no network request. A corrupt or unreadable entry is treated as a miss.

**Logging:** each lookup that contacts the site (cache miss) logs one stdout line `icon fetch host=<normalised host> result=<ok|none|blocked|timeout>`; a cache hit logs nothing.

**Example:**
```bash
curl --max-time 15 -s -D - -o icon.bin "http://127.0.0.1:7790/v1/icon?host=example.com"
# 200, Content-Type: image/x-icon, Cache-Control: public, max-age=604800

curl --max-time 15 -s "http://127.0.0.1:7790/v1/icon?host=localhost"
# 400 {"error":"blocked_destination"}
```

**Example Response (404):**
```json
{
  "error": "no_icon"
}
```

---

## Unknown Routes and Wrong Methods

**Unknown Route:**
- Status: 404 Not Found
- Response: `{"error": "not_found"}`

**Wrong HTTP Method:**
- Status: 405 Method Not Allowed
- Response: `{"error": "method_not_allowed"}`

**Example:**
```bash
curl -X GET http://127.0.0.1:7790/v1/read
# Response: 405 {"error": "method_not_allowed"}

curl http://127.0.0.1:7790/unknown
# Response: 404 {"error": "not_found"}
```

---

## Response Format

All successful and error responses are JSON with `Content-Type: application/json`, except a `200` from `GET /v1/icon`, which is image bytes with the image `Content-Type`.

**Standard Error Shape:**
```json
{
  "error": "<error_code>"
}
```

**Error with Detail (search only):**
```json
{
  "error": "<error_code>",
  "detail": "<reason>"
}
```

**Error with Upstream Status (read only):**
```json
{
  "error": "fetch_failed",
  "status": 404
}
```

---

## Using It from Other Tools (e.g., OpenCode)

The search service can be called from any tool that makes plain HTTP JSON requests. It is designed to be wrapped as an MCP (Model Context Protocol) server or a custom tool integration.

**Integration Pattern:**

1. **Check Availability:** Call `GET /v1/health` to verify the service is running.
2. **Search:** `POST /v1/search` with a query string and optional result count.
3. **Read:** `POST /v1/read` with a URL to extract page content.

**Example Integration (pseudo-code):**
```javascript
async function search(query, maxResults = 5) {
  const res = await fetch('http://127.0.0.1:7790/v1/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, max_results: maxResults })
  });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  return res.json();
}

async function readPage(url) {
  const res = await fetch('http://127.0.0.1:7790/v1/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  });
  if (!res.ok) throw new Error(`Read failed: ${res.status}`);
  return res.json();
}
```

**Security:** The service only binds to loopback (127.0.0.1). It is not accessible from the network, WAN, or Tailscale. No authentication is required because physical access to the machine is required to reach it.

---

## Environment Variables

The following environment variables are **test-only** and must not be relied upon in production:

| Variable | Type | Default | Effect |
|----------|------|---------|--------|
| `SEARCH_PORT` | integer | 7790 | Override the listen port (loopback binding is always 127.0.0.1) |
| `SEARCH_TIMEOUT_MS` | integer | 25000 | Override the search helper time limit in milliseconds (must be positive; invalid values are ignored) |
| `SEARCH_HELPER_FORCE_DDGS` | string | (unset) | Test-only hook to force a specific DuckDuckGo behavior (see search helper docs) |
| `SEARCH_HELPER_FORCE_BROWSER` | string (`fail` \| `hang`) | (unset) | Test-only hook to simulate browser failures (`fail`) or hangs (`hang`) without using the public network |

The following environment variable is **production configuration** (not test-only):

| Variable | Type | Default | Effect |
|----------|------|---------|--------|
| `SEARCH_ICON_CACHE_DIR` | path | `~/Library/Caches/harness-search/icons` | Directory for the `GET /v1/icon` disk cache (created with mode 0700 if missing) |

The help process group is SIGKILLed unconditionally on timeout, client abort, or after normal exit to ensure Chromium and Playwright processes do not linger.

---

## Implementation Notes

- **SSRF Guard:** The `/v1/read` route enforces a strict SSRF policy. All DNS records and IP literals are checked against the public-address classifier before connection.
- **Fetch Deadline:** The 15-second deadline on `/v1/read` covers all hops (redirects), DNS resolution, connection, response headers, and body read.
- **Markdown Truncation:** Page markdown is capped at 40,000 characters independently of the fetch body limit (5 MiB).
- **Helper Subprocess:** The helper is spawned in its own process group (detached), so process kills affect the entire search operation including Playwright and Chromium.
- **Content Types:** Only `text/html`, `text/plain`, and `application/xhtml+xml` are supported for `/v1/read`.
- **Redirects:** Up to 5 redirects are followed on `/v1/read`. Each hop is subject to the same SSRF checks.
- **Icons:** `GET /v1/icon` reuses the `/v1/read` guarded fetcher (`fetchBytes` in `fetchPage.ts`, same guard code) with an image-only type allow-list, a 256 KiB cap and a 10-second overall deadline.

---

## Traceability

All behavior, error codes, limits, and request/response shapes in this document are defined and enforced in `search/src/`:

- **Routes, HTTP status mapping, error codes:** `search/src/http/server.ts` (lines 27–110)
- **Request validation:** `search/src/http/server.ts` (lines 27–110)
- **Search handler:** `search/src/http/server.ts`, delegated to `search/src/search/runHelper.ts`
- **Error codes and details:** `search/src/http/server.ts` and `search/src/fetch/fetchPage.ts`
- **SSRF policy and address checks:** `search/src/fetch/addressPolicy.ts`
- **Fetch limits and timeouts:** `search/src/fetch/fetchPage.ts`
- **Markdown extraction and truncation:** `search/src/extract/extract.ts`
- **Configuration and defaults:** `search/src/index.ts`
- **Timeout and helper subprocess:** `search/src/search/runHelper.ts`
- **Tests:** `search/src/http/server.test.ts`
- **Icon route (FR27, architecture D-M10c-2):** `search/src/icon/icon.ts` (host validation, link discovery, guarded icon lookup), `search/src/icon/cache.ts` (disk cache, TTLs), `search/src/http/server.ts` (route); tests in `search/src/icon/icon.test.ts` and `search/src/http/server.test.ts`
