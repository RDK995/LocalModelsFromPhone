# OpenCode web search / web fetch, and sharing one free search backend with the phone server

Research date: 2026-09-29. Pinned harness copy: OpenCode 1.18.21 (`/Users/ryankenny/Projects/OpenCodeOpenWeightHarness`, `package.json` pins `opencode-ai` 1.18.21). Latest upstream release at research time: v1.18.33 (2026-09-28) — [OpenCode releases](https://github.com/anomalyco/opencode/releases).

Evidence note: "Local binary" findings below come from reading strings out of the pinned compiled binary `node_modules/opencode-darwin-arm64/bin/opencode` (v1.18.21), read-only. They are primary evidence for 1.18.21 behaviour; they are cited as "[pinned 1.18.21 binary](file:///Users/ryankenny/Projects/OpenCodeOpenWeightHarness/node_modules/opencode-darwin-arm64/bin/opencode)".

## 1. OpenCode's built-in `websearch` tool: backend, enablement, keys, cost, limits, privacy, Ollama

### Takeaway
`websearch` is a thin client that calls a third-party hosted MCP endpoint — Exa (`https://mcp.exa.ai/mcp`, tool `web_search_exa`) or Parallel (`https://search.parallel.ai/mcp`, tool `web_search`). Both are keyless and free but rate-limited. With a local Ollama provider it is **hidden unless an env var is set** (`OPENCODE_ENABLE_EXA` / `OPENCODE_ENABLE_PARALLEL`, or `OPENCODE_EXPERIMENTAL`). If neither is forced, 1.18.21 picks Exa or Parallel **per session by hashing the session ID**, so queries go to one of two different companies unpredictably. It cannot be pointed at a self-hosted backend through config; it can only be switched off or overridden by a custom tool of the same name.

### Cited Findings
- Docs: websearch is "only available when using the OpenCode or OpenCode Go provider, or when either the `OPENCODE_ENABLE_EXA` or `OPENCODE_ENABLE_PARALLEL` environment variable is set to any truthy value"; "No API key is required — the tool connects directly to the backend's hosted MCP service"; controlled by `"permission": { "websearch": "allow" }` — [OpenCode docs: Tools](https://opencode.ai/docs/tools/)
- 1.18.21 registry gate: `function St(o,e={exa:!1,parallel:!1}){return o===oe.ID.opencode||o===oe.ID.make("opencode-go")||e.exa||e.parallel}` — i.e. the tool is filtered out for any other provider ID (including a custom `ollama` provider) unless an enable flag is on — [pinned 1.18.21 binary](file:///Users/ryankenny/Projects/OpenCodeOpenWeightHarness/node_modules/opencode-darwin-arm64/bin/opencode)
- 1.18.21 flags: `enableExa` = `OPENCODE_EXPERIMENTAL` || `OPENCODE_ENABLE_EXA` || `OPENCODE_EXPERIMENTAL_EXA`; `enableParallel` = `OPENCODE_ENABLE_PARALLEL` || `OPENCODE_EXPERIMENTAL_PARALLEL`; also reads `OPENCODE_WEBSEARCH_PROVIDER` ("exa"|"parallel"), `EXA_API_KEY`, `PARALLEL_API_KEY` — [pinned 1.18.21 binary](file:///Users/ryankenny/Projects/OpenCodeOpenWeightHarness/node_modules/opencode-darwin-arm64/bin/opencode). Note: the broad `OPENCODE_EXPERIMENTAL` flag also turns on Exa, which is a surprise-egress risk.
- 1.18.21 endpoints: `EXA_URL="https://mcp.exa.ai/mcp"` (with `?exaApiKey=…` appended if `EXA_API_KEY` set), `PARALLEL_URL="https://search.parallel.ai/mcp"`; `MAX_NUM_RESULTS=20`, `MAX_CONTEXT_CHARACTERS=50000`, `MAX_RESPONSE_BYTES=262144`; timeout "25 seconds"; header `User-Agent: opencode/<version>`; Parallel gets `Authorization: Bearer $PARALLEL_API_KEY` if set — [pinned 1.18.21 binary](file:///Users/ryankenny/Projects/OpenCodeOpenWeightHarness/node_modules/opencode-darwin-arm64/bin/opencode)
- 1.18.21 provider selection: `OPENCODE_WEBSEARCH_PROVIDER` wins; else parallel if enableParallel; else exa if enableExa; else `FNV-1a(sessionID) base36 % 2 === 0 ? "exa" : "parallel"` — [pinned 1.18.21 binary](file:///Users/ryankenny/Projects/OpenCodeOpenWeightHarness/node_modules/opencode-darwin-arm64/bin/opencode). Same logic in current `dev` source (`OPENCODE_WEBSEARCH_PROVIDER`, `PARALLEL_API_KEY`, "checksum-based routing", 25 s timeout, defaults numResults 8, contextMaxCharacters 10,000) — [websearch.ts on dev](https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/opencode/src/tool/websearch.ts)
- Data sent: Exa call `web_search_exa` with `{query, type:"auto", numResults:8, livecrawl:"fallback", contextMaxCharacters}`; Parallel call `web_search` with `{objective: query, search_queries:[query], session_id: <OpenCode sessionID>, model_name: <model id, ≤100 chars>}` — [pinned 1.18.21 binary](file:///Users/ryankenny/Projects/OpenCodeOpenWeightHarness/node_modules/opencode-darwin-arm64/bin/opencode). So Parallel receives the session ID and the local model name alongside every query.
- Users saw the switching: issue "websearch unexpectedly switches between Exa and Parallel providers" (opened 2026-07-27, closed as not planned) — [anomalyco/opencode#39121](https://github.com/anomalyco/opencode/issues/39121)
- A PR to let `OPENCODE_WEBSEARCH_PROVIDER=exa|parallel` alone enable the tool for custom/local providers (Ollama, LM Studio) was auto-closed for low engagement on 2026-09-23, not merged — [anomalyco/opencode#44343](https://github.com/anomalyco/opencode/pull/44343). So on current releases setting only `OPENCODE_WEBSEARCH_PROVIDER` does not expose the tool to an Ollama provider; `OPENCODE_ENABLE_*` is still needed.
- Exa keyless: "Free rate-limited usage without sign-in or API key | Connect to `https://mcp.exa.ai/mcp`"; default tools `web_search_exa`, `web_fetch_exa`; docs page gives no numeric limits and no privacy/retention information — [Exa MCP docs](https://exa.ai/docs/reference/exa-mcp)
- A secondary source states Exa's keyless tier (introduced Feb 2026) is 3 QPS and 150 calls/day — [Scalekit blog](https://www.scalekit.com/blog/exa-mcp-vs-api) (secondary, not confirmed on Exa's own page). Users of an OpenCode plugin report hitting Exa rate-limit errors without a key — [oh-my-openagent#1627](https://github.com/code-yeongyu/oh-my-openagent/issues/1627)
- Parallel keyless: "free to use" anonymous access at lower rate limits; API key as Bearer for higher limits; free-tier search runs in `fast` mode; excerpts capped ~25,000 chars per call; no numeric limits published — [Parallel Search MCP docs](https://docs.parallel.ai/integrations/mcp/search-mcp); "generous rate limits for hobby use and personal agents" — [Parallel blog](https://parallel.ai/blog/free-web-search-mcp)
- Harness today: `opencode.json` sets `"tools": {"*": false, …}` (websearch not re-enabled) and `"permission": {"webfetch": "deny"}` at top level and in agent `harness-coder` — [local opencode.json](file:///Users/ryankenny/Projects/OpenCodeOpenWeightHarness/opencode.json)
- The built-in `explore` subagent in 1.18.21 carries default permissions allowing `webfetch` and `websearch` (`{action:"webfetch",…,effect:"allow"},{action:"websearch",…,effect:"allow"}`) — [pinned 1.18.21 binary](file:///Users/ryankenny/Projects/OpenCodeOpenWeightHarness/node_modules/opencode-darwin-arm64/bin/opencode)

### Inferences
- For a "free, private, self-hosted" requirement the built-in `websearch` is unsuitable: queries leave the machine to Exa or Parallel (hosted US SaaS), keyless limits are small/unpublished, and backend choice is random per session unless pinned.
- With the harness's Ollama provider and no `OPENCODE_ENABLE_*`/`OPENCODE_EXPERIMENTAL` in the environment, the built-in tool is not even offered to the model. The harness launcher should make sure those env vars are unset (or scrubbed) so it stays that way.
- The explore-subagent default allows mean any future re-enabling of the `task` tool should be checked against an explicit deny for `websearch`/`webfetch`.

### Gaps
- Exa's and Parallel's exact keyless quotas and data-retention terms for MCP queries: not published on the pages fetched.
- Whether the harness process environment could ever carry `OPENCODE_EXPERIMENTAL`: not checked.

## 2. OpenCode's `webfetch` tool

### Takeaway
`webfetch` is fully local: OpenCode itself does an HTTP GET with a Chrome User-Agent, caps the body at 5 MB, and converts HTML to Markdown with Turndown (or to plain text with an htmlparser2 pass). No third-party service is involved, and it is available for every provider (gated only by permissions).

### Cited Findings
- 1.18.21 constants: `d0="webfetch"`, `s0=5242880` (5 MiB max response, error "Response too large (exceeds 5242880 byte limit)"), default timeout `dC=30` s, max `l0=120` s — [pinned 1.18.21 binary](file:///Users/ryankenny/Projects/OpenCodeOpenWeightHarness/node_modules/opencode-darwin-arm64/bin/opencode)
- Params: `url` (http/https only), `format` ∈ text|markdown|html (default markdown), optional `timeout` — same source.
- Sends `User-Agent: Mozilla/5.0 … Chrome/143.0.0.0 Safari/537.36` and a format-specific `Accept`; on HTTP 403 with `cf-mitigated: challenge` it retries with UA `opencode` — same source.
- Rejects image content types and non-text binary types; only converts when `content-type` includes `text/html`: markdown via Turndown (`headingStyle:"atx"`, fenced code, removes script/style/meta/link), text via an htmlparser2 walker skipping script/style/noscript/iframe/object/embed — same source.
- Tool description: "Large text results may be replaced with a preview while the complete output is retained in managed storage." — same source.
- Docs describe it only as "Retrieves and reads web page content", controlled by `permission.webfetch` — [OpenCode docs: Tools](https://opencode.ai/docs/tools/)

### Inferences
- No JavaScript rendering; JS-heavy pages will be thin. Egress goes directly from wherever OpenCode runs (in this harness, the sandbox VM), so sandbox egress policy governs it.
- Because it is local and keyless, `webfetch` is already "free" — the missing piece for OpenCode is only search, not fetch.

### Gaps
- Whether the Turndown/text conversion truncates before model hand-off (beyond the "preview" behaviour) was not traced.

## 3. Pointing OpenCode at a custom search backend (MCP, custom tools, plugins; disabling built-in)

### Takeaway
Three supported routes, all work with a local Ollama provider: (a) an MCP server in `opencode.json` `mcp` (local stdio or remote HTTP); (b) a custom tool file in `.opencode/tools/*.ts` (Bun); (c) a plugin exposing a tool. A custom/plugin tool literally named `websearch` takes precedence over the built-in, so it can replace it outright. The built-in can also just be denied/disabled.

### Cited Findings
- Local MCP: `type:"local"`, `command` (array), `cwd`, `environment`, `enabled`, `timeout` (ms, default 5000). Remote MCP: `type:"remote"`, `url`, `headers`, `oauth` (object or `false`), `enabled`, `timeout` — [OpenCode docs: MCP servers](https://opencode.ai/docs/mcp-servers/)
- "MCP server tools are registered with server name as prefix, so to disable all tools for a server simply use: `"mymcpservername_*": false`"; per-agent enabling supported; "MCP servers add to your context, so you want to be careful with which ones you enable" — [OpenCode docs: MCP servers](https://opencode.ai/docs/mcp-servers/)
- Custom tools: `.opencode/tools/` or `~/.config/opencode/tools/`, `tool()` helper from `@opencode-ai/plugin`, Zod args, context `{agent, sessionID, messageID, directory, worktree}`; filename = tool name; "If a custom tool uses the same name as a built-in tool, the custom tool takes precedence." — [OpenCode docs: Custom tools](https://opencode.ai/docs/custom-tools/)
- Plugins can add tools ("if a plugin tool uses the same name as a built-in tool, the plugin tool takes precedence") and intercept built-ins via `tool.execute.before` / `tool.execute.after` — [OpenCode docs: Plugins](https://opencode.ai/docs/plugins/)
- Community precedent: a plugin that swaps OpenCode's websearch provider for Ollama's web search API — [opencode-ollama-websearch-plugin](https://github.com/vardhanreddyG/opencode-ollama-websearch-plugin); an OpenCode plugin/MCP "opensearch" that uses a SearXNG URL for web search — [kagan-sh/opensearch](https://github.com/kagan-sh/opensearch)
- Disabling: set `permission.websearch` to `"deny"` — [OpenCode docs: Tools](https://opencode.ai/docs/tools/); the harness already uses `"tools": {"*": false}` allow-list style — [local opencode.json](file:///Users/ryankenny/Projects/OpenCodeOpenWeightHarness/opencode.json)

### Inferences
- Cleanest for this harness: keep built-in `websearch` off, add one MCP entry (e.g. server name `search`), and allow only `"search_*": true` for the coding agent. Alternative: a ~20-line `.opencode/tools/websearch.ts` that calls the shared HTTP search API — this overrides the built-in name, so models that were trained on OpenCode's prompt see a familiar tool name, and it avoids an MCP process.
- Local MCP servers are child processes of OpenCode, so in the harness they would run inside the sandbox VM and need egress to the search backend; a remote MCP (HTTP) on the host needs the sandbox to reach that host port. Either way it is a new egress path to account for in the containment policy.
- MCP `timeout` (default 5000 ms) is documented as the tool-fetch (listing) timeout; slow SearXNG queries may need their own server-side timeout.

### Gaps
- Not verified whether the 1.18.21 custom-tool override of `websearch` bypasses the provider gate `St(...)` (the gate filters by tool id `re.id`; a custom tool with the same name may or may not be filtered). Needs a quick live test on 1.18.21 before relying on the override route; the MCP route (distinct prefixed names) is not affected by that gate.

## 4. Existing free search MCP servers (SearXNG, DuckDuckGo, etc.)

### Takeaway
The most-used self-hosted option is `ihor-sokoliuk/mcp-searxng` (MIT, ~1.3k stars, stdio + HTTP transports, search + URL-reader tools). DuckDuckGo MCP (`nickclyde/duckduckgo-mcp-server`) needs no infrastructure but scrapes DDG and relies on built-in rate limiting. The two hosted keyless MCPs (Exa, Parallel) are free but not self-hosted.

### Cited Findings
- mcp-searxng: tools `searxng_web_search`, `searxng_search_suggestions`, `searxng_instance_info`, `web_url_read` (HTML→Markdown, optional FlareSolverr/Byparr for JS pages); STDIO default, HTTP mode via `MCP_HTTP_PORT` (stateful legacy or stateless modern); `SEARXNG_URL` required; `npm install -g mcp-searxng`, Node ≥ 22, Docker `isokoliuk/mcp-searxng:latest`; ~1.3k stars; MIT — [ihor-sokoliuk/mcp-searxng](https://github.com/ihor-sokoliuk/mcp-searxng)
- Other SearXNG MCPs exist (tisDDM, Knuckles-Team, tobioffice) — [Glama tisDDM](https://glama.ai/mcp/servers/@tisDDM/searxng-mcp/blob/e4b0fe297e3aac11554deae84d475d6eb6e51ac8/README.md), [Glama Knuckles-Team](https://glama.ai/mcp/servers/@Knuckles-Team/searxng-mcp/blob/870b3961c38db3386dee5726b7272a53ff6182d2/README.md), [mcpservers.org tobioffice](https://mcpservers.org/servers/tobioffice/mcp-searxng)
- DuckDuckGo MCP: default limits 30 searches/min and 20 fetches/min; newer config `DDG_SEARCH_RPM`, `DDG_FETCH_RPM`, `DDG_FETCH_HOST_RPM`, token-bucket strategy, 429 backoff — [PR #66](https://github.com/nickclyde/duckduckgo-mcp-server/pull/66); releases through v0.7.0 — [v0.7.0 release](https://github.com/nickclyde/duckduckgo-mcp-server/releases/tag/v0.7.0)
- A comparison blog positions SearXNG MCP vs Tavily for OpenCode — [BSWEN](https://docs.bswen.com/blog/2026-03-26-tavily-vs-searxng-opencode/) (secondary; not read in full)
- Parallel lists OpenCode among supported clients for its free Search MCP — [Parallel search results summary / docs](https://docs.parallel.ai/integrations/mcp/search-mcp)

### Inferences
- SearXNG + mcp-searxng is the only option here that is simultaneously free, self-hosted, key-less, and not dependent on one scraping target; quality depends on which upstream engines SearXNG is configured with (upstream engines can rate-limit/CAPTCHA SearXNG too).

### Gaps
- Latest release date/commit activity of mcp-searxng and DDG MCP not captured precisely; star counts from repo page only.

## 5. Design implication: one backend shared by the phone Bun server and OpenCode

### Takeaway
Yes — one SearXNG instance can serve both. Best shape: SearXNG (JSON API) as the single backend; the phone Bun server calls it directly over HTTP and exposes it to Ollama as a normal tool-calling function; OpenCode reaches the same instance via an MCP server (mcp-searxng, or a tiny custom MCP/`.opencode/tools` wrapper). Ollama itself is not an MCP client, so MCP only helps on the OpenCode side (or if the Bun server chooses to act as an MCP client).

### Cited Findings
- OpenCode consumes search via MCP (local or remote) or custom tools — [MCP servers docs](https://opencode.ai/docs/mcp-servers/), [Custom tools docs](https://opencode.ai/docs/custom-tools/)
- mcp-searxng is a thin client over a SearXNG URL (`SEARXNG_URL`) and supports stdio or HTTP — [mcp-searxng](https://github.com/ihor-sokoliuk/mcp-searxng)
- OpenCode's own `webfetch` is local and keyless — [pinned 1.18.21 binary](file:///Users/ryankenny/Projects/OpenCodeOpenWeightHarness/node_modules/opencode-darwin-arm64/bin/opencode)

### Inferences
- Recommended layering: SearXNG (the shared, free backend) → (a) Bun phone server: direct `GET /search?format=json` + its own fetch/readability, surfaced to Ollama as `web_search`/`web_fetch` function tools in `/api/chat` `tools`; (b) OpenCode: `mcp` entry for mcp-searxng (or a 20-line custom tool), built-in `websearch` left off, built-in `webfetch` optionally enabled.
- Making the Bun server itself speak MCP buys little: Ollama doesn't consume MCP, so the Bun server would still translate MCP tools into Ollama tool schemas. Wrapping a plain HTTP API with a tiny MCP (or using mcp-searxng) for OpenCode is the cheaper direction.
- Keep result payloads small (few results, snippets) for small local models; OpenCode's own defaults (8 results, 10k chars) are a reasonable reference.
- Harness-specific: whichever route is used adds a new egress path (sandbox → SearXNG, SearXNG → internet); it must be reflected in the harness's containment/egress policy, and `OPENCODE_ENABLE_*`/`OPENCODE_EXPERIMENTAL` should be scrubbed so the Exa/Parallel path never appears.

### Gaps
- No live test performed of mcp-searxng with OpenCode 1.18.21 + Ollama models (tool-call reliability of small models with prefixed MCP tool names untested).

## 6. OpenCode 1.18.x vs current release differences

### Takeaway
Within 1.18.x, web search behaviour appears unchanged in substance: 1.18.21 already has both Exa and Parallel, the session-hash selection, and the provider gate. Current release is v1.18.33 (2026-09-28); the only relevant release-note item found is a docs change in 1.18.24. The PR to relax the gate for local providers was not merged.

### Cited Findings
- v1.18.33 (2026-09-28), v1.18.32 (09-21), v1.18.31 (09-14), v1.18.30 (09-09), v1.18.29 (09-04); v1.18.24 note: "docs: mention Exa and Parallel as web search backends" — [OpenCode releases](https://github.com/anomalyco/opencode/releases)
- 1.18.21 binary contains Exa + Parallel URLs, `OPENCODE_ENABLE_PARALLEL`, `OPENCODE_WEBSEARCH_PROVIDER`, hash selection — [pinned 1.18.21 binary](file:///Users/ryankenny/Projects/OpenCodeOpenWeightHarness/node_modules/opencode-darwin-arm64/bin/opencode); `dev` source has the same mechanisms — [websearch.ts on dev](https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/opencode/src/tool/websearch.ts)
- PR #44343 (pinned provider enables tool for any provider) closed unmerged 2026-09-23 — [PR #44343](https://github.com/anomalyco/opencode/pull/44343)
- An OpenCode "v2" build (`v0.0.0-next-16234`) exhibited the Exa/Parallel switching in July 2026 — [issue #39121](https://github.com/anomalyco/opencode/issues/39121)

### Inferences
- Older OpenCode (pre-Parallel, 2025) was Exa-only; that history is not relevant to the pin. MCP / custom tool config schema appears stable across 1.18.x, so an MCP-based search integration should survive upgrading from 1.18.21.

### Gaps
- Did not diff every 1.18.22–1.18.33 changelog entry line by line; only release-note text surfaced by the releases page was reviewed.
