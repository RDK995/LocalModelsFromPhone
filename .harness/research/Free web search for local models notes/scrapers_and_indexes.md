# Lightweight, library-based and independent-index free web search for local LLMs (alternatives to SearXNG)

Context: Mac Studio (Apple Silicon, macOS, no Docker; Python 3.14 + Bun), small Bun server calls a search backend for Ollama tool-calling models; tens to low hundreds of queries/day from one home IP; zero spend. Research date: 2026-09-29. Tool budget was limited (~25 calls), so some items are single-source; noted where so.

## 1. Scraper libraries (ddgs, JS/TS equivalents, googlesearch-python)

### Takeaway
`ddgs` (Python, MIT) is the most viable no-server option: actively released (9.16.0, 26 Aug 2026), multi-backend metasearch (DuckDuckGo, Bing, Brave, Google, Mojeek, StartPage, Yahoo, Yandex, Wikipedia, Grokipedia) with JSON output, and it ships its own optional HTTP API server and MCP server, so Bun can call it over localhost or by shelling out to its CLI. But it scrapes public result pages, so breakage and soft rate limits are a recurring pattern (2026 issues: DuckDuckGo 403s, "No results found" in Open WebUI). googlesearch-python is effectively dead since Google required JavaScript (Jan 2025). The main JS option, duck-duck-scrape, looks weakly maintained and DuckDuckGo-only.

### Cited Findings
**ddgs (formerly duckduckgo-search)**
- Latest version 9.16.0, released 26 Aug 2026; requires Python >= 3.10; install `pip install -U ddgs`, with extras `ddgs[api]` (FastAPI server) and `ddgs[mcp]` (MCP server). — [PyPI ddgs](https://pypi.org/project/ddgs/)
- text() backends: bing, brave, duckduckgo, google, grokipedia, mojeek, startpage, yandex, yahoo, wikipedia; news(): bing, duckduckgo, yahoo; images(): bing, duckduckgo; videos(): duckduckgo; books(): annasarchive. Supports `backend="auto"` or a specific engine, HTTP/HTTPS/SOCKS5 proxies, default timeout 5 s. — [PyPI ddgs](https://pypi.org/project/ddgs/)
- MIT licence; results are lists of dicts (title, URL/href, body); API server listens on port 4479 by default with text/images/videos/news/books endpoints plus content extraction; MCP server uses stdio transport; README states "This library is for educational purposes only." — [GitHub deedy5/ddgs](https://github.com/deedy5/ddgs)
- Package renamed from duckduckgo-search to ddgs in mid-2025. — [Serpent API blog (vendor, possibly biased)](https://apiserpent.com/blog/scrape-duckduckgo-serp-for-free)
- Open issues in 2026 include: #480 "duckduckgo backed 403 error" (25 Jul 2026); #478 "RatelimitException is defined but never raised — users cannot catch rate limits distinctly" (4 Jul 2026); #427 "_search drops results from successful backends when another backend raises first" (11 Mar 2026); #490 failing tests (11 Sep 2026). — [ddgs issues](https://github.com/deedy5/ddgs/issues)
- Open WebUI issue #24428 (opened 7 May 2026): DuckDuckGo via DDGS consistently returns "No results found" while Google works; no maintainer resolution visible. — [open-webui #24428](https://github.com/open-webui/open-webui/issues/24428)
- Historic "202 Ratelimit" errors from duckduckgo_search hit many agent frameworks (Open WebUI, LangChain OpenGPTs, Agno). — [open-webui discussion #6624](https://github.com/open-webui/open-webui/discussions/6624); [langchain opengpts #247](https://github.com/langchain-ai/opengpts/issues/247); [agno #175](https://github.com/DeadantCo/agno/issues/175) (these are older, 2024-2025, possibly stale)
- DDG's 202 "Ratelimit" is described as a soft block; suggested mitigation: randomized multi-second delays, exponential backoff, home rather than datacenter IP, and under ~30 requests/min per IP. — [Serpent API blog (vendor selling a SERP API; treat as opinion)](https://apiserpent.com/blog/scrape-duckduckgo-serp-for-free)

**JS/TS equivalents usable from Bun**
- duck-duck-scrape (Snazzah): MIT, DuckDuckGo search (regular/image/video/news) plus "spice" APIs; ~232 stars, not archived. — [GitHub duck-duck-scrape](https://github.com/Snazzah/duck-duck-scrape)
- Snyk flags that no new npm version shipped in the prior 12 months ("could be considered discontinued"); ~53k weekly downloads (largely via LangChain.js). — [Snyk advisor](https://snyk.io/advisor/npm-package/duck-duck-scrape) (Snyk snapshot date not shown)
- Known "anomaly detection" blocking from DDG on repeated searches (issue #140); a changelog change (ss_mkt -> bing_market) was made to reduce anomalies. — [duck-duck-scrape #140](https://github.com/Snazzah/duck-duck-scrape/issues/140); [CHANGELOG](https://github.com/Snazzah/duck-duck-scrape/blob/master/CHANGELOG.md)

**googlesearch-python**
- Latest 1.3.0 released 21 Jan 2025; requests + BeautifulSoup scraper of Google; MIT. — [PyPI googlesearch-python](https://pypi.org/project/googlesearch-python/)
- Google began requiring JavaScript for Search on ~17 Jan 2025. — [Michael Tsai blog, 24 Jan 2025](https://mjtsai.com/blog/2025/01/24/google-search-now-requires-javascript/); [SerpApi blog](https://serpapi.com/blog/google-now-requires-javascript/)
- One tester reports googlesearch-python 1.3.0 "runs but returns zero results" post-change. — [Serpent API "I tested 8 Python Google search libraries (2026)" (vendor, unverified)](https://apiserpent.com/blog/python-google-search-libraries-tested)

### Inferences
- For Bun, the lowest-effort path is `pip install "ddgs[api]"` (a venv under Python 3.14 should work since >=3.10 is required, though 3.14 compatibility of its deps like primp/lxml wheels was not verified) and calling `http://127.0.0.1:4479/...` or spawning `ddgs text -q ... -o json`. This technically is "a server", but a tiny single-process one, not a SearXNG stack.
- Using `backend="auto"` (or a list excluding duckduckgo) gives resilience: when one engine blocks, others may still answer. Issue #427 suggests the fallback logic has had bugs, so the Bun side should handle empty results and retry.
- At tens to low hundreds of queries/day from a residential IP, soft blocks are likely occasional rather than constant, but silent "no results" (not an exception) is the realistic failure mode; build a cache and a secondary backend.
- ToS: all of these scrape pages whose ToS generally forbid automated access; the ddgs "educational purposes only" disclaimer reflects that. Risk to a home user is practically IP soft-blocks, not legal action, but it is a ToS grey area.
- No mature, actively maintained JS multi-backend equivalent of ddgs was found; calling ddgs from Bun beats duck-duck-scrape.

### Gaps
- Could not confirm ddgs install/run on Python 3.14 specifically (native deps).
- No quantitative reliability data (success rate per backend) for a single home IP in 2026; only issue reports.
- Did not check other npm packages (e.g. search-engine scrapers for Bing/Brave) due to budget.

## 2. Browser-automation approaches (Playwright/Puppeteer, headless Chrome)

### Takeaway
Several open-source projects drive real Google via Playwright (Node and Python), some exposed as MCP servers, with stealth patches, persistent profiles and a headed-mode fallback for CAPTCHAs. They work around the JS requirement but cost a Chromium install (~hundreds of MB), 1-3+ s per query, and ongoing cat-and-mouse maintenance; CAPTCHAs are mitigated, not eliminated.

### Cited Findings
- web-agent-master/google-search: Playwright-based Node.js tool + MCP server; "intelligent browser fingerprint management", saved browser state, auto-switch to headed mode when verification is needed; JSON output {query, title, link, snippet}; ~620 stars; warns against sending requests too frequently. — [GitHub web-agent-master/google-search](https://github.com/web-agent-master/google-search)
- noapi-google-search-mcp: MCP server for Google search and page fetch using headless Chromium; claims stealth JS injection (patch navigator.webdriver, fake plugins), cookie persistence, and a neural-net CAPTCHA solver; lists Ollama and LM Studio compatibility. — [GitHub VincentKaufmann/noapi-google-search-mcp](https://github.com/VincentKaufmann/noapi-google-search-mcp) (claims from search snippet, not independently verified)
- giveen/mcp_web_search: Playwright-based Python tool/MCP server that "bypasses Google's anti-bot mechanisms". — [GitHub giveen/mcp_web_search](https://github.com/giveen/mcp_web_search)
- Google catches headless Chromium and serves CAPTCHAs; after the JS change, the practical options are browser automation, lighter engines, or paid SERP APIs; a requests+residential-proxy approach completed only 31/50 queries in one test. — [Serpent API blog (vendor)](https://apiserpent.com/blog/google-search-requires-javascript)

### Inferences
- Playwright runs natively on macOS/Apple Silicon and Bun can drive it, so this is feasible without Docker; but it is the highest-effort, most fragile option. Best as a fallback, not the primary backend.
- Headed-mode fallback on a Mac Studio means a Chrome window may pop up for a human to solve a CAPTCHA, which is fine for a desk machine but breaks unattended use.
- Driving DuckDuckGo/Bing HTML in a real browser is likely less CAPTCHA-prone than Google, but I found no source measuring this.

### Gaps
- No independent 2026 measurements of CAPTCHA rates for these tools at low volume.
- Last-commit dates for these repos were not visible in fetched pages.

## 3. Independent / alternative indexes with free access

### Takeaway
Marginalia (free, JSON API; "public" key works but shares a rate limit; free personal non-commercial key by email) and Wiby (keyless JSON) are genuinely free but index the "small web", so they are poor as general search. Mwmbl is alive but small and now gates its better combined endpoint to 100 requests/month. Stract is dead (repo archived 2 Apr 2026). Mojeek's own API is paid (from £2 per 1,000 queries) with only a limited free trial, though ddgs can scrape Mojeek's public pages. Wikipedia is available as a ddgs backend.

### Cited Findings
**Marginalia Search**
- API: `GET https://api2.marginalia-search.com/search?query=...` with header `API-Key`; params count (1-100), timeout (50-250 ms), dc (max results per domain), page, nsfw, filter. JSON fields: query, license, results[{url, title, description}]. Old endpoints api.marginalia.nu deprecated. Page updated 2025-12-08. — [Marginalia API docs](https://about.marginalia-search.com/article/api/)
- Key "public" works without email but "often hits a rate limit" (shared across all consumers; HTTP 503 when hit). Free non-commercial key by emailing contact@marginalia-search.com; paid/commercial keys exist. Non-commercial results licensed CC-BY-NC-SA 4.0. — [Marginalia API docs](https://about.marginalia-search.com/article/api/)
- Marginalia deliberately indexes the independent/"small" web rather than the commercial web. — [Wikipedia: Marginalia (search engine)](https://en.wikipedia.org/wiki/Marginalia_(search_engine))

**Mwmbl**
- Non-profit, open-source, community-ranked index; public search at api.mwmbl.org. — [GitHub mwmbl/mwmbl](https://github.com/mwmbl/mwmbl); [api.mwmbl.org](https://api.mwmbl.org/)
- PR #439, merged 23 Sep 2026: new authenticated `GET /api/v2/combined-search/` pooling Mwmbl index + Staan (commercial API) + Wikipedia, limited to 100 requests/month ("like Super Search, which it is intended to replace"); Mwmbl-only gold recall was 4.8% vs 20.0% combined in their eval. — [mwmbl PR #439](https://github.com/mwmbl/mwmbl/pull/439)
- Issue #411 (Sep 2026): maintainers working on classifying/counting external API traffic, "without gating anything". — [mwmbl #411](https://github.com/mwmbl/mwmbl/issues/411)
- SearXNG ships a Mwmbl engine (so there is a known keyless search endpoint). — [SearXNG Mwmbl engine docs](https://docs.searxng.org/dev/engines/online/mwmbl.html)

**Stract**
- GitHub repo StractOrg/stract archived 2 Apr 2026 (read-only); issue #267 (7 Nov 2025) reported main search not working, no maintainer reply. — [Stract #267](https://github.com/StractOrg/stract/issues/267); [GitHub StractOrg/stract](https://github.com/StractOrg/stract)

**Mojeek**
- Paid pay-as-you-go API: Startup £2 CPM (5 qps, 100k/day, 10 results/request); Business £3 CPM; Enterprise custom. JSON or XML. "Free trial version, with limited queries" on request. — [Mojeek Web Search API](https://www.mojeek.com/services/search/web-search-api/)
- ddgs includes a `mojeek` text backend (scraping public pages, not the API). — [PyPI ddgs](https://pypi.org/project/ddgs/)

**Wiby**
- Keyless JSON API: `https://wiby.me/json/?q=test`, `&p=N` for paging; Wiby indexes older-style/"classic web" pages. — [wiby.me JSON API](https://wiby.me/json/); [About Wiby](https://wiby.me/about/)

**Wikipedia**
- Available as a ddgs text backend (`wikipedia`). — [PyPI ddgs](https://pypi.org/project/ddgs/)

### Inferences
- None of the independent indexes can replace a general web search for questions like news, docs or product lookups; they are useful as supplementary sources (Wikipedia for factual grounding, Marginalia for blogs/essays).
- A free personal Marginalia key is the most reliable "legit" free API here (documented, JSON, no scraping), but its coverage limits its use to a secondary source; CC-BY-NC-SA terms are fine for personal use.
- Mwmbl's plain search endpoint status (keyed or not) for v2 is unclear; with only 100/month for the combined endpoint, it is not a primary backend.

### Gaps
- Exact Mwmbl v2 `/search` auth requirements not confirmed.
- Did not fetch MediaWiki API docs; Wikipedia's own search API (keyless, with a User-Agent policy) is assumed from general knowledge, not verified here.
- Marginalia index size / Mojeek index size not found in this pass.

## 4. Existing MCP servers / LLM tools bundling free search

### Takeaway
Most "free search" bundles default to DuckDuckGo via ddgs or a direct DDG HTML scrape: Open WebUI's DDGS provider (works with zero config, but has 2026 "no results" reports), nickclyde's duckduckgo-mcp-server (1.5k stars, built-in rate limiting, curl_cffi fallback for TLS-fingerprint blocks), and ddgs's own MCP server. Ollama itself now offers a hosted web_search/web_fetch API with a free tier (needs a free Ollama account key; limits undisclosed) — outside "independent index" scope but directly relevant as a zero-cost, no-server option.

### Cited Findings
- Open WebUI DDGS provider: engine value `duckduckgo` (`WEB_SEARCH_ENGINE=duckduckgo`); reaches providers "through that provider's public pages rather than through a paid API"; DDGS backend selectable from a dropdown; docs say web search works out of the box via DuckDuckGo; for reliability/quotas, docs point to keyed providers (Brave, Google PSE, SerpApi). — [Open WebUI DDGS docs](https://docs.openwebui.com/features/chat-conversations/web-search/providers/ddgs/)
- nickclyde/duckduckgo-mcp-server: MIT, ~1.5k stars; search, content-fetch and link-expansion tools; httpx by default with automatic fallback to curl_cffi to beat TLS-fingerprint bot detection; built-in rate limits 30 searches/min and 20 fetches/min (sliding window or token bucket). — [GitHub nickclyde/duckduckgo-mcp-server](https://github.com/nickclyde/duckduckgo-mcp-server)
- ddgs ships an MCP server (`ddgs[mcp]`, stdio). — [GitHub deedy5/ddgs](https://github.com/deedy5/ddgs)
- Ollama web search API launched 24 Sep 2025: `https://ollama.com/api/web_search` (+ `web_fetch`), Bearer API key from an Ollama account, "a generous free tier of web searches for individuals", results[{title, url, content}]; demoed with local qwen3 and gpt-oss tool calling. — [Ollama blog](https://ollama.com/blog/web-search)
- Ollama does not publish exact free-tier limits; users report session/weekly limits. — [itsfree.ai (aggregator, weak source)](https://itsfree.ai/provider/ollama/); [odysseusai.blog (aggregator)](https://odysseusai.blog/ollama-web-search/)
- Marginalia MCP connectors exist in the ecosystem. — [Glama Marginalia connector](https://glama.ai/mcp/connectors/io.github.pipeworx-io/marginalia)

### Inferences
- The Bun server can mirror nickclyde's design (rate limiter + TLS-fingerprint fallback) or simply run ddgs's API server; both are single-process, no Docker.
- If "user pays nothing" allows a free account, Ollama's web_search is the lowest-effort reliable option for Ollama tool calling, with a scraper (ddgs) as fallback; but it sends queries to Ollama's cloud and the free quota is undocumented and could change.
- A sensible layered design: primary ddgs (auto backends) -> secondary Ollama web_search or Marginalia -> Wikipedia for encyclopedic queries; cache results locally to keep volume low.

### Gaps
- No systematic comparison found of how well these MCP servers work in 2026 beyond issue reports.
- Ollama free-tier numeric limits and ToS on automated/bulk use not found in primary docs.
- Did not survey LobeChat/LibreChat/Perplexica defaults (Perplexica historically depends on SearXNG).
