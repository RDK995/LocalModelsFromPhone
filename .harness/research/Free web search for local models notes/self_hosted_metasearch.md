# Self-hosted metasearch / search engines as a free web-search backend for local LLMs (as of 2026-09-29)

Setup being evaluated: Mac Studio (Apple Silicon, macOS), no Docker, Homebrew Python 3.14 + Bun, Ollama; a small Bun server calls a search backend for tool-calling models. Free only.

Method note: repo metadata (archived flag, last push, licence, stars, latest release) was pulled live from the GitHub API on 2026-09-29 via `gh api repos/<owner>/<repo>`; 4get metadata from its Gitea API at git.lolcat.ca. Those are cited to the repo URL. Anything dated before 2025 is flagged **[possibly stale]**.

## Q1. Maintenance status in 2025-2026 (per candidate)

### Takeaway
Only SearXNG, 4get, degoog, websurfx, YaCy, LibreY and Vane (ex-Perplexica) are alive in Sept 2026. Whoogle and Farside were archived in Aug 2026; LibreX has been dead since mid-2024; Stract was archived in 2025; Mullvad Leta shut down (Nov 2025) and was never self-hostable. The most active by far are SearXNG and degoog (both had commits on 2026-09-29).

### Cited Findings
- **SearXNG**: not archived; last push 2026-09-29; AGPL-3.0; ~37.8k stars; no GitHub "releases" (rolling, date-versioned builds, e.g. docs version `2026.9.29+4e2c1ea7f`). — [GitHub searxng/searxng](https://github.com/searxng/searxng); [SearXNG install docs](https://docs.searxng.org/admin/installation-searxng.html)
- SearXNG issue tracker is very active: issues/PRs #6770–#6797 opened between 2026-09-22 and 2026-09-29. — [searxng issues](https://github.com/searxng/searxng/issues)
- The official `searxng/searxng-docker` repo was archived (last push 2026-03-28) — irrelevant for a no-Docker setup but signals the project's packaging changed. — [GitHub searxng/searxng-docker](https://github.com/searxng/searxng-docker)
- **Whoogle Search**: archived 2026-08-14 (read-only); MIT; last release v1.2.4 on 2026-04-15. README notice: "Whoogle no longer returns search results, and that isn't something this project can fix" — Google has blocked all no-JavaScript search queries since early 2025. No further commits/releases planned. — [GitHub benbusby/whoogle-search](https://github.com/benbusby/whoogle-search)
- **Farside** (redirector to public instances of privacy frontends, not a search engine): archived; last push 2026-08-19; last release v0.3.0 on 2025-01-29; MIT. — [GitHub benbusby/farside](https://github.com/benbusby/farside)
- **LibreX** (original): not formally archived but last push 2024-08-01 **[possibly stale / effectively abandoned]**; AGPL-3.0. — [GitHub hnhx/librex](https://github.com/hnhx/librex)
- **LibreY** (the maintained LibreX fork): not archived; last push 2026-06-10; AGPL-3.0; 323 stars; PHP; no releases. — [GitHub Ahwxorg/LibreY](https://github.com/Ahwxorg/LibreY)
- **4get**: last commit 2026-09-22 ("fix 500px"); frequent commits in Sept 2026, including 2026-09-08 commits explicitly about re-patching Google scraping ("nice try google", "google wagies!! yellow alert!! the 4get guy patched it again"); AGPLv3-only; ~490 commits, 24 open issues. Hosted on Gitea, not GitHub. — [git.lolcat.ca/lolcat/4get](https://git.lolcat.ca/lolcat/4get); [4get commits API](https://git.lolcat.ca/api/v1/repos/lolcat/4get/commits?limit=15)
- **Perplexica → renamed "Vane"**: `ItzCrazyKns/Perplexica` now redirects to `ItzCrazyKns/Vane`; not archived; last push 2026-09-01; MIT; ~36.9k stars; TypeScript; latest release v1.12.2 on 2026-04-10. It is an AI answering engine that *uses SearXNG* as its web search backend — not a search backend itself. — [GitHub ItzCrazyKns/Vane](https://github.com/ItzCrazyKns/Vane)
- **YaCy**: not archived; last push 2026-09-23 (merged PRs #835/#836 that day); latest tag `Release_1.941` committed 2026-03-29; Java; licence reported by GitHub as NOASSERTION (YaCy is commonly described as GPL — unverified here). Wikipedia still lists 1.940 (2024-12-02) as the stable release, i.e. Wikipedia is behind. — [GitHub yacy/yacy_search_server](https://github.com/yacy/yacy_search_server); [Wikipedia YaCy](https://en.wikipedia.org/wiki/YaCy)
- **degoog** (new, not in the original candidate list): search aggregator written in TypeScript on **Bun**; repo moved from fccview/degoog to degoog-org/degoog; not archived; last push 2026-09-29; AGPL-3.0; ~2.2k stars; latest release 0.26.0 on 2026-09-13. Explicitly positioned as "a more modular lighter alternative" to SearXNG. — [GitHub degoog-org/degoog](https://github.com/degoog-org/degoog)
- **Websurfx** (Rust metasearch, "open source alternative to searx"): not archived; last push 2026-09-08; AGPL-3.0; ~1.2k stars. — [GitHub neon-mmd/websurfx](https://github.com/neon-mmd/websurfx)
- **Stract** (own-index Rust search engine): archived; last push 2025-03-24. — [GitHub StractOrg/stract](https://github.com/StractOrg/stract)
- **Mwmbl** (non-profit own-index engine): active (last push 2026-09-29); AGPL-3.0; index is centralised and "much smaller than those of commercial search engines"; it is a hosted community engine, not a self-hosted metasearch. — [GitHub mwmbl/mwmbl](https://github.com/mwmbl/mwmbl)
- **Mullvad Leta**: shut down at the start of November 2025; Mullvad cited tightening anti-bot measures and CAPTCHAs making a shared proxy unsustainable. Leta was never released for self-hosting. — [TechRadar](https://www.techradar.com/vpn/vpn-services/mullvad-says-goodbye-to-proxy-search-citing-big-changes-in-the-search-industry); [Mullvad Review of 2025](https://mullvad.net/en/blog/2025/12/30/mullvad-review-of-2025)

### Inferences
- Realistic shortlist for this setup: SearXNG, degoog, 4get, (LibreY, websurfx as weaker options). YaCy is a different thing (own P2P index/crawler). Vane is a consumer of SearXNG, not an alternative to it. Whoogle, Farside, LibreX, Stract, Leta are out.
- Leta's shutdown and Whoogle's archival are two independent 2025-26 signals that scraping Google from a small number of IPs has become very hard.

### Gaps
- Did not check Presearch nodes or MetaGer self-hosting (ran out of tool budget). From background knowledge (unverified here): Presearch nodes contribute to Presearch's network rather than giving you a private API; MetaGer's code is public but it relies on paid/keyed upstream feeds — treat both as unverified.
- OmniSearch (Codeberg, LibreY-lineage C rewrite) not checked.
- YaCy licence not confirmed from the repo.

## Q2. Install effort on macOS without Docker; Python 3.14; LaunchAgent suitability

### Takeaway
SearXNG and degoog are both straightforward native installs: SearXNG is a Python venv + `pip install -e .` + `python -m searx.webapp` (all its compiled deps ship macOS arm64 wheels for CPython 3.14); degoog is `bun install && bun run build && bun run start`, matching the Bun already on the machine. Both are single foreground processes that fit a per-user LaunchAgent. 4get/LibreY need PHP (4get additionally needs curl-impersonate), websurfx needs Rust + Redis, YaCy needs Java, Vane needs Node plus a SearXNG anyway.

### Cited Findings
- SearXNG native install steps (docs version 2026.9.29): clone repo, `python3 -m venv`, `pip install -U pip setuptools wheel pyyaml msgspec typing-extensions pybind11`, `pip install --use-pep517 --no-build-isolation -e .`, set `SEARXNG_SETTINGS_PATH`, run `python -m searx.webapp`. Settings need at least `server.secret_key`. Valkey is optional (`url: false`). Granian or uWSGI are the documented production servers. No macOS-specific guidance. — [SearXNG install docs](https://docs.searxng.org/admin/installation-searxng.html)
- Default `settings.yml` binds `127.0.0.1:8888`. — [searx/settings.yml](https://github.com/searxng/searxng/blob/master/searx/settings.yml)
- SearXNG `setup.py`: `python_requires=">=3.10"`; trove classifiers list up to 3.13 only (3.14 not officially declared). — [searxng setup.py](https://github.com/searxng/searxng/blob/master/setup.py)
- Python 3.14 issue history: #5284 (2025-10) "Struct fields aren't discovered in Python 3.14" — caused by msgspec; SearXNG shipped a workaround and msgspec 0.20.0 added 3.14 support (2025-11-24); issue closed 2026-01-23. #5902 (2026-03) titled "fails to start with Python 3.14" turned out to be a bad settings key, not a 3.14 bug. — [searxng #5284](https://github.com/searxng/searxng/issues/5284); [searxng #5902](https://github.com/searxng/searxng/issues/5902)
- SearXNG's pinned `requirements.txt` (2026-09-29) includes `curl_cffi==0.16.3`, `lxml==6.1.3`, `msgspec==0.21.1`, `flask==3.1.3`, `valkey==6.1.1`. PyPI has macOS arm64 wheels for CPython 3.14 for curl_cffi 0.16.3 (abi3 + cp314t), lxml 6.1.3 (cp314 universal2), msgspec (cp314 arm64). — [searxng requirements.txt](https://github.com/searxng/searxng/blob/master/requirements.txt); [PyPI curl_cffi](https://pypi.org/project/curl_cffi/); [PyPI lxml](https://pypi.org/project/lxml/); [PyPI msgspec](https://pypi.org/project/msgspec/)
- No Homebrew formula exists for `searxng` or `yacy` (checked `brew search`/`brew info` on this Mac, 2026-09-29).
- **degoog** non-Docker install: requires Bun; `bun install`, `bun run build`, `bun run start`; default port 4444 (`package.json` stop script kills `:4444`). Optional Valkey/Postgres only for multi-replica/busy public instances; `simple.yml` = "degoog only" for personal use. Note: "If HTTPS requests fail with certificate errors, install the `ca-certificates` package". — [degoog README](https://github.com/degoog-org/degoog); [degoog package.json](https://github.com/degoog-org/degoog/blob/main/package.json)
- degoog includes a SearXNG compatibility layer with a Python bridge (`src/server/extensions/compatibility-layer/searx/bridge/engine.py`) that imports SearXNG engine modules — i.e. it can run SearXNG engine code, which implies Python is needed for that feature. — [degoog repo tree](https://github.com/degoog-org/degoog/tree/main/src/server/extensions/compatibility-layer/searx)
- **4get** requires PHP with curl-impersonate support and several PHP extensions. — [4get repo](https://git.lolcat.ca/lolcat/4get)
- **LibreY** requires PHP + cURL (Docker optional). — [LibreY README](https://github.com/Ahwxorg/LibreY)
- **Websurfx** requires Cargo (Rust) build plus a Redis server (`cargo build -r`, `redis-server --port 8082 &`). — [websurfx README](https://github.com/neon-mmd/websurfx)
- **Vane** non-Docker: install SearXNG yourself with JSON format and Wolfram Alpha engine enabled, then `npm i && npm run build && npm run start`; Docker "highly recommended". — [Vane README](https://github.com/ItzCrazyKns/Vane)
- **Whoogle** was pip-installable (`pip install whoogle-search`) — moot since it returns no results. — [Whoogle README](https://github.com/benbusby/whoogle-search)

### Inferences
- SearXNG under a LaunchAgent: `ProgramArguments` = venv python `-m searx.webapp` with `SEARXNG_SETTINGS_PATH` in `EnvironmentVariables`; the Flask dev server is fine for a single local caller. Granian could be used if concurrency matters. Nothing root-level is needed if the settings file is put under the user's home instead of `/etc/searxng`.
- Because 3.14 is not in SearXNG's declared classifiers, a `brew install python@3.13` venv is the lower-risk fallback if any 3.14 regression appears; but the known 3.14 blocker (msgspec) is resolved.
- degoog fits the Bun-centric stack best operationally (same runtime as the existing Bun server) but ships zero engines (see Q3), so setup work shifts into picking/installing engine extensions.

### Gaps
- No first-hand report found of SearXNG running natively on macOS + Python 3.14 end-to-end; compatibility inferred from wheels + closed issues.
- Whether degoog's SearXNG bridge works with Homebrew Python 3.14 was not verified.
- PHP availability on this Mac (Homebrew `php`) and curl-impersonate on macOS for 4get not checked.

## Q3. Upstream engines and their reliability from a single home IP (2025-2026); mitigations

### Takeaway
Scraping-based metasearch is in an arms race in 2026. For SearXNG: the classic `google` engine has been broken/disabled since ~July 2026 and replaced by default with `google cse` (scrapes a public Google Custom Search Element, no key); DuckDuckGo, Startpage and Brave went through a wave of CAPTCHAs / "too many requests" in Aug 2026, driven by TLS-fingerprint checks; SearXNG responded by moving its HTTP stack to curl_cffi (browser TLS impersonation). Expect individual engines to fail for days at a time and to need frequent `git pull` updates; aggregate across several engines to stay useful.

### Cited Findings
- SearXNG default `settings.yml` (2026-09-29): `google` engine **`disabled: true`**; `google cse` (shortcut `goc`) enabled; `bing` **`disabled: true`**; `duckduckgo`, `brave`, `startpage`, `qwant` present; `mojeek` **`inactive: true`** with comment "uses a Proof of Work CAPTCHA that requires much computer power to solve"; new engines `ayo` and `tusksearch` present. — [searx/settings.yml](https://github.com/searxng/searxng/blob/master/searx/settings.yml)
- `google_cse` engine: `require_api_key: False`, `use_official_api: False`, results as JSONP, max 5 pages × 20 results; it uses a hard-coded public CX (`partner-pub-8993703457585266:4862972284`, commented "blackle.com"). — [searx/engines/google_cse.py](https://github.com/searxng/searxng/blob/master/searx/engines/google_cse.py)
- 2026-07-26: maintainer "The google engine has been not working for almost a month now. The google cse can provide similar results and is enabled by default … whilst the old google engine is disabled." — [searxng #6453](https://github.com/searxng/searxng/issues/6453)
- 2026-07-03: "GSA for iPhone useragent do no longer work" (Google workaround broken). 2026-08-23: a Nokia User-Agent workaround (PR #6546) stopped working; maintainer: "Google are doing TLS inspection now. With curl_cffi impersonating `chrome99_android`, it works." — [searxng #6359](https://github.com/searxng/searxng/issues/6359); [searxng #6570](https://github.com/searxng/searxng/issues/6570)
- Google CSE itself had problems reported in Aug 2026 ("Google CSE failing" #6518, "Google CSE returning terrible results" #6524, both closed). — [searxng #6518](https://github.com/searxng/searxng/issues/6518); [searxng #6524](https://github.com/searxng/searxng/issues/6524)
- 2026-08-22 (open): feature request for a client-side Google challenge solver because "Google is notoriously difficult nowadays and every method gets patched quickly." — [searxng #6567](https://github.com/searxng/searxng/issues/6567)
- DuckDuckGo: from ~2026-08-27 every DDG query on self-hosted instances returned a 202 challenge; root cause analysis in-thread: Firefox UA + Python (httpx) TLS fingerprint mismatch; users reported brave "Suspended: too many requests", startpage "Suspended: CAPTCHA", wikidata "access denied" at the same time; applying the curl_cffi impersonation patch fixed DDG and improved Brave. Closed 2026-09-04. — [searxng #6596](https://github.com/searxng/searxng/issues/6596)
- 2026-09-24/25 (open): DDG returns CAPTCHA every time when language is "Default language [all]"; any specific language works. Maintainer: CAPTCHAs "pop up every now and then … on my instance, the reliability of the DDG engine is around 90%", and confirmed `!ddg :all test` CAPTCHAs on all instances tested. — [searxng #6779](https://github.com/searxng/searxng/issues/6779)
- Startpage: "Constant CAPTCHA error from Startpage" (2026-08-13). — [searxng #6520](https://github.com/searxng/searxng/issues/6520)
- Brave: "too many requests" even on the very first search on a fresh Raspberry Pi instance (2026-07-12); maintainer called it "a known issue at the moment" and pointed to newly added engines that use the Brave index. — [searxng #6402](https://github.com/searxng/searxng/issues/6402)
- Qwant (open, 2026-07-03): "silently returns fabricated/garbage results when server IP is blocked". — [searxng #6358](https://github.com/searxng/searxng/issues/6358)
- 2026-08-24: "Engine initialization causes HTTP 403/429 rate-limiting and cascade startup". — [searxng #6584](https://github.com/searxng/searxng/issues/6584)
- SearXNG now depends on curl_cffi 0.16.3 (browser TLS impersonation); an open issue on 2026-09-29 refers to a bug "after curl_cffi migration" (sogou engine). The original POC PR #5476 was closed rather than merged, so the migration landed via another change. — [searxng requirements.txt](https://github.com/searxng/searxng/blob/master/requirements.txt); [searxng #6797](https://github.com/searxng/searxng/issues/6797); [searxng PR #5476](https://github.com/searxng/searxng/pull/5476)
- A 2026-09-25 PR adds an `ayo` engine that solves an Anubis captcha. — [searxng #6786](https://github.com/searxng/searxng/pull/6786)
- SearXNG suspends an engine for 86,400 s (24 h) on a CAPTCHA and 604,800 s (7 days) on a Google reCAPTCHA by default (configurable in `search.suspended_times`). — [SearXNG search settings docs](https://docs.searxng.org/admin/settings/settings_search.html)
- SearXNG's limiter exists to stop bots hitting your instance (which would otherwise get your IP CAPTCHA'd upstream). — [SearXNG limiter docs](https://docs.searxng.org/admin/searx.limiter.html)
- Third-party LLM-agent project reported (Sept 2025) CAPTCHA errors on DuckDuckGo and Qwant via SearXNG. — [agenticSeek #410](https://github.com/Fosowl/agenticSeek/issues/410)
- SearXNG also has a key-based `braveapi` engine (Brave Search API) — buggy in Sept 2026 (HTTP 422 because Accept header missing, fixed; pagination offset bug). Brave's API has a free tier historically, but that is outside the "no paid tiers" scope and needs verification. — [searxng #6665](https://github.com/searxng/searxng/issues/6665); [searxng #6545](https://github.com/searxng/searxng/issues/6545)
- **Whoogle**: Google blocks all no-JS queries since early 2025 → no results. — [Whoogle README](https://github.com/benbusby/whoogle-search)
- **LibreY** engines: text from Google, DuckDuckGo, Brave, Ecosia, Yandex, Mojeek; images Qwant; README warns Google actively blocks metasearch engines. — [LibreY README](https://github.com/Ahwxorg/LibreY)
- **4get** scrapers include (web) DuckDuckGo, Brave, Yandex, Google, Google API, Google CSE, Startpage, Yahoo! JAPAN, Qwant, Marginalia, Mojeek-style others; uses curl-impersonate, supports rotating proxies per scraper; the author actively re-patches Google (commits 2026-09-08). — [4get repo](https://git.lolcat.ca/lolcat/4get); [4get commits](https://git.lolcat.ca/api/v1/repos/lolcat/4get/commits?limit=15)
- **degoog** "ships with zero search engines installed … intentional"; engines come from an extension store / community extensions (initially vetted only); supports pluggable "transports" (curl, FlareSolverr, custom) for fetching. — [degoog docs](https://degoog-org.github.io/docs); [degoog README](https://github.com/degoog-org/degoog)
- **Websurfx** supports proxies/Tor for upstream fetching and asks contributors to "improve evasion code for bot detection". — [websurfx README](https://github.com/neon-mmd/websurfx)
- **Mullvad Leta** closed because anti-bot measures made a shared proxy unsustainable. — [TechRadar](https://www.techradar.com/vpn/vpn-services/mullvad-says-goodbye-to-proxy-search-citing-big-changes-in-the-search-industry)

### Inferences
- A single residential IP with low query volume (one user's LLM agent) is actually the most favourable case for scrapers — the widespread blocks in the issues above hit both public and private instances, but the failures were mostly fingerprint-based (fixed by code updates) rather than volume-based. Keeping SearXNG updated (weekly `git pull` + restart) matters more than IP.
- LLM agents can fire many queries in a burst; the Bun server should rate-limit/cache (e.g. a few queries per minute, dedupe) to avoid tripping per-IP limits and the 24h/7-day engine suspensions. Lowering `suspended_times` lets engines recover faster.
- Mitigations available free: enable several engines (google cse, duckduckgo with a specific language rather than "all", brave, startpage, qwant, wikipedia, mojeek off), keep curl_cffi-based build current, cache results, optional Tor/proxy (4get/websurfx/degoog transports).
- All of Google/DDG/Brave/Startpage scraping is against those engines' terms; practical but fragile.

### Gaps
- No quantitative reliability numbers per engine beyond the maintainer's anecdotal "~90%" for DDG.
- No data on how 4get's Google scraper is holding up beyond its commit log.
- Didn't verify whether degoog's store currently offers working Google/Bing/DDG/Brave extensions.

## Q4. JSON API for programmatic use

### Takeaway
SearXNG (`/search?q=…&format=json`, must be enabled in settings), degoog (`/api/search` JSON + SSE stream, with optional SearXNG-shaped `format=json` mode, plus an MCP sidecar), LibreY (`api.php`) and Whoogle (`format=json`, moot) have JSON APIs. 4get documents an API (not verified this session). SearXNG's JSON is the de-facto standard that Vane, Open WebUI etc. consume.

### Cited Findings
- SearXNG default `search.formats` is `[html]` only; comment: `# formats: [html, csv, json, rss]` — JSON must be added explicitly. — [searx/settings.yml](https://github.com/searxng/searxng/blob/master/searx/settings.yml)
- Vane requires SearXNG with JSON format enabled (and Wolfram Alpha engine) — confirming SearXNG JSON as the standard LLM integration. — [Vane README](https://github.com/ItzCrazyKns/Vane)
- A SearXNG issue (2026-07-29) requested cache hit/miss telemetry "to track AI agent query reuse" — AI-agent use of SearXNG is a recognised use case. — [searxng #6471](https://github.com/searxng/searxng/issues/6471)
- degoog: `GET /api/search?q=…` (params type, page, time, lang, engines…), `POST /api/search` (JSON body with `query`, `engines` list), `GET /api/search/stream` (SSE per-engine events + `done`), `/api/search/retry`; results include title, URL, snippet, source, score; open by default, optional Bearer API key; server rate limits apply. When enabled, `/api/search` honours `format=json` and returns SearXNG-shaped responses. — [degoog API docs](https://degoog-org.github.io/docs/api.html)
- degoog ships an MCP sidecar compose example ("Exposing Degoog to LLMs / MCP clients (Claude, Cursor, llama.cpp)"). — [degoog README](https://github.com/degoog-org/degoog)
- LibreY exposes an API via `api.php`. — [LibreY README](https://github.com/Ahwxorg/LibreY)
- Whoogle: `Accept: application/json` or `format=json`. — [Whoogle README](https://github.com/benbusby/whoogle-search)

### Inferences
- Building the Bun server against SearXNG's JSON shape keeps the backend swappable: degoog can emulate it, and Vane/Open WebUI speak it.

### Gaps
- 4get's API doc URL (`docs/api.md`) returned "Not found"; 4get's API shape not verified.
- Websurfx and YaCy APIs not checked (YaCy historically has `yacysearch.json` — unverified here).

## Q5. Result quality relative to Google/Bing

### Takeaway
No rigorous 2025-26 benchmark found. Quality of a metasearch = quality of whichever upstream engines currently answer; with Google's direct engine disabled, SearXNG's Google-flavoured results now come via a public CSE element, which users reported as occasionally "terrible" in Aug 2026. Own-index engines (YaCy, Mwmbl) are far weaker than Google/Bing.

### Cited Findings
- "Google CSE returning terrible results" (2026-08-14) and "Google CSE Unexpected Regional Results" (2026-07-23), "Unnecessary Images" (2026-07-08). — [searxng #6524](https://github.com/searxng/searxng/issues/6524); [searxng #6441](https://github.com/searxng/searxng/issues/6441); [searxng #6380](https://github.com/searxng/searxng/issues/6380)
- Qwant can return fabricated/garbage results when the IP is blocked — a silent quality failure. — [searxng #6358](https://github.com/searxng/searxng/issues/6358)
- Mwmbl: index "much smaller than those of commercial search engines". — [mwmbl README](https://github.com/mwmbl/mwmbl)

### Inferences
- For LLM tool calls (short factual/technical queries), SearXNG aggregating google-cse + DDG + Brave + Startpage + Wikipedia is likely "good enough" most days, but should be treated as degraded-Google, not Google.
- YaCy is only sensible for crawling/indexing a known set of sites (docs, a personal corpus), not general web search.

### Gaps
- No head-to-head quality study of SearXNG / 4get / degoog vs Google/Bing found.

## Q6. Licence

### Takeaway
All viable candidates are free/open source; AGPL-3.0 dominates (SearXNG, LibreY, LibreX, 4get, degoog, websurfx, mwmbl). MIT: Whoogle, Farside, Vane. AGPL obligations only bite if you offer the service to others over a network; private local use is unaffected.

### Cited Findings
- SearXNG AGPL-3.0; LibreY AGPL-3.0; LibreX AGPL-3.0; degoog AGPL-3.0; websurfx AGPL-3.0; mwmbl AGPL-3.0; Stract AGPL-3.0; Whoogle MIT; Farside MIT; Vane MIT; YaCy NOASSERTION per GitHub API. — GitHub API for each repo: [searxng](https://github.com/searxng/searxng), [LibreY](https://github.com/Ahwxorg/LibreY), [librex](https://github.com/hnhx/librex), [degoog](https://github.com/degoog-org/degoog), [websurfx](https://github.com/neon-mmd/websurfx), [mwmbl](https://github.com/mwmbl/mwmbl), [whoogle](https://github.com/benbusby/whoogle-search), [farside](https://github.com/benbusby/farside), [Vane](https://github.com/ItzCrazyKns/Vane), [YaCy](https://github.com/yacy/yacy_search_server)
- 4get: AGPLv3-only. — [4get repo](https://git.lolcat.ca/lolcat/4get)

### Inferences
- None of these cost money; the only "paid" risks are optional keyed engines (e.g. SearXNG `braveapi`), which should simply be left disabled.

### Gaps
- YaCy's exact licence not confirmed in this session.

## Q7. Resource footprint

### Takeaway
No sourced benchmark numbers found. Qualitatively: SearXNG (one Python process, optional Valkey), degoog (one Bun process, SQLite by default), LibreY/4get (PHP under a web server) and websurfx (Rust binary + Redis) are all light for a Mac Studio; YaCy (Java, crawler + Solr index) and Vane (Node app + SearXNG + LLM calls) are the heavy ones.

### Cited Findings
- SearXNG Valkey is optional in minimal setups. — [SearXNG install docs](https://docs.searxng.org/admin/installation-searxng.html)
- degoog: "degoog only" compose for personal/low-traffic use; Valkey/Postgres only for multi-replica or busy public instances; Postgres "scales concurrent writes and FTS better than SQLite" (implies SQLite default). — [degoog README](https://github.com/degoog-org/degoog)
- Websurfx requires a Redis server alongside the binary. — [websurfx README](https://github.com/neon-mmd/websurfx)
- SearXNG runs on a Raspberry Pi 5 (user report). — [searxng #6402](https://github.com/searxng/searxng/issues/6402)

### Inferences
- Any of the metasearch options is negligible next to Ollama models on a Mac Studio; footprint should not drive the choice.

### Gaps
- No measured RAM/CPU figures for any candidate in 2025-26 sources consulted.
