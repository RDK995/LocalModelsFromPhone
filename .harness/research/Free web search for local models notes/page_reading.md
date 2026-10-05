# Page reading ("web fetch"): turning a URL into clean text/markdown for a local LLM

Scope: free, self-hostable fetch-and-extract options runnable on a Mac Studio (Apple Silicon, macOS, no Docker), inside or beside a Bun server, feeding local Ollama models (32k-128k context) via tool calling. Researched 2026-09-29. Registry/GitHub figures below were pulled live on 2026-09-29 from registry.npmjs.org, pypi.org/pypi/*/json and api.github.com (cited per row as the package/repo page).

Hands-on check (run by the researcher on this Mac, 2026-09-29, Bun 1.4.0, Python 3.14.7) on a small synthetic page (nav + article + code block + footer + an "Ignore previous instructions." line):
- `@mozilla/readability` 0.6.0 + `linkedom` 0.18.13 + `turndown` 7.2.4 under Bun: installed in ~0.5 s, ran without errors, ~11 ms; nav and footer stripped; code block kept as a fenced block but the `js` language tag was lost.
- `defuddle` 0.19.4 (`defuddle/node`) on a linkedom document under Bun, `markdown: true`: ran without errors, ~15 ms; nav/footer stripped; fenced code block kept its `js` language tag; returned title and word count.
- `trafilatura` 2.2.0 in a Python 3.14 venv (`pip install trafilatura`, pulled lxml 6.1.3): installed cleanly, ~4 ms extraction; markdown output with YAML front-matter; BUT it turned the `<pre><code>` block into inline code, and emitted `date: "2026-01-01"`, apparently inferred from the "Copyright 2026" footer (a fabricated-looking date).
- All three passed the injected "Ignore previous instructions." sentence straight through, as expected — extractors are not a prompt-injection defence.

## Extraction quality: articles vs docs vs JS-rendered pages

### Takeaway
For ordinary articles, trafilatura, Readability and Defuddle are all good (roughly 0.9 F1 range in published benchmarks); trafilatura leads the largest independent-style benchmark, while Readability-family tools do well on English blogs/news but can drop content on docs/landing pages with many equal-weight sections. None of the DOM-only tools run JavaScript, so SPA/JS-rendered pages need a headless browser (Playwright) in front of the extractor.

### Cited Findings
- trafilatura's own evaluation (dated 2026-08-04; 990 docs, 2,951 text + 2,966 boilerplate segments, Python 3.13): F1 trafilatura 2.2.0 **0.924**, magic-html 0.889, justext 0.862, news-please 0.836, readability-lxml 0.826, resiliparse 0.811, goose3 0.810, boilerpy3 0.807, **newspaper4k 0.9.6 0.801**. goose3 has the highest precision (0.936) but low recall (0.714); newspaper4k recall only 0.736. Note: authored by trafilatura's maintainer — [trafilatura evaluation](https://github.com/adbar/trafilatura/blob/master/docs/evaluation.rst)
- Same doc cites external benchmarks: ScrapingHub article-extraction-benchmark called trafilatura "most efficient open-source library"; Bevendorff et al. (2023) ranked it "best single tool by ROUGE-LSum Mean F1 Page Scores"; Lejeune & Barbaresi (2020) "best overall tool" — [trafilatura evaluation](https://github.com/adbar/trafilatura/blob/master/docs/evaluation.rst)
- BulkMD benchmark (2026-05-26, 50 pages across blogs, tech docs, news, product/landing pages, forums; M3 Pro): median F1 Readability 0.94, jsdom-readability 0.94, trafilatura 0.91; pages within 5% of ground truth 88% / 88% / 78%; median runtime 18 ms / 14 ms / 85 ms; cold start 22 ms / 310 ms / 1,100 ms. Caveat: small corpus, published by a vendor of a Readability-based product, table labels are somewhat confusing — [BulkMD](https://bulkmd.app/blog/readability-vs-trafilatura-extractors)
- BulkMD: Readability struggles with "comparison tables, dashboard-style technical docs, product landing pages with multiple equal-weight sections", can return partial content; only trafilatura handles multilingual pages and embedded comments out of the box — [BulkMD](https://bulkmd.app/blog/readability-vs-trafilatura-extractors)
- BulkMD: jsdom + Readability "does not run JavaScript by default, does not honor CSS, does not lazy-load images"; for JS pages combine a headless browser (Playwright/Puppeteer) with extraction, roughly doubling cost — [BulkMD](https://bulkmd.app/blog/readability-vs-trafilatura-extractors)
- Defuddle vs Readability: Defuddle is "more forgiving, removes fewer uncertain elements", "provides a consistent output for footnotes, math, code blocks, etc.", and "uses a page's mobile styles to guess at unnecessary elements"; standardises headings, code blocks, footnotes, math, callouts — [Defuddle README](https://github.com/kepano/defuddle)
- Readability exposes `isProbablyReaderable()` (defaults minContentLength 140, minScore 20) for a cheap pre-check, and `charThreshold` (default 500 chars) below which it returns no result — [Readability README](https://github.com/mozilla/readability)
- Cloudflare "Markdown for Agents" (launched 2026-02-12): sites on Cloudflare Pro/Business/Enterprise can return server-side markdown when the client sends `Accept: text/markdown`; response carries an `X-Markdown-Tokens` estimate; Cloudflare's own blog post dropped from 16,180 HTML tokens to 3,150 markdown tokens (~80%). Not available on the Free plan, so only some sites — [Cloudflare changelog](https://developers.cloudflare.com/changelog/post/2026-02-12-markdown-for-agents/); [The New Stack](https://thenewstack.io/cloudflares-markdown-for-agents-automatically-make-websites-more-aifriendly/)
- OpenCode's webfetch already sends `Accept: text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1` and passes non-HTML responses through unconverted, so it benefits from such sites automatically — [OpenCode webfetch.ts](https://github.com/sst/opencode/blob/dev/packages/opencode/src/tool/webfetch.ts)
- Crawl4AI offers "Fit Markdown" and LLM-free content filter strategies (pruning/BM25-style) on top of a Playwright browser, i.e. it handles JS-rendered pages by design — [Crawl4AI install docs](https://docs.crawl4ai.com/core/installation/)
- Jina Reader open-source build renders with Puppeteer (headless Chrome) and parses PDFs with PDF.js, so it handles JS pages and PDFs — [jina-ai/reader](https://github.com/jina-ai/reader)
- Newer single-package Bun/Node options appeared in 2026: `readdown` (replaces readability + turndown, adds token estimation; self-reported March 2026 benchmark wins on speed 4/5 pages) and `h2m-parser` (Readability on linkedom + streaming markdown renderer). Both are small, self-benchmarked projects — [readdown](https://github.com/zcag/readdown); [h2m-parser](https://github.com/gustavovalverde/h2m-parser)

### Inferences
- Articles/blogs/news: any of trafilatura, Defuddle, Readability+Turndown is fine. Defuddle likely gives the best markdown for technical content (keeps code-language tags, math, footnotes — confirmed for code language in the hands-on test; trafilatura flattened a code block to inline code).
- Docs pages: Readability's "pick one main block" heuristic is the weak spot; Defuddle's "removes fewer uncertain elements" stance and a fallback to plain whole-page Turndown (what OpenCode does, no extraction) are safer. A practical design: try extractor; if result is short relative to the page text (or `isProbablyReaderable` is false), fall back to whole-body Turndown with script/style/nav removed.
- JS-rendered pages: detect "almost empty body / only `<noscript>` / tiny text" and only then escalate to Playwright; keep the browser path optional because it is heavy.
- trafilatura's date/metadata heuristics can emit misleading metadata (observed); if using it, consider `with_metadata=False` or don't show inferred dates to the model as fact.

### Gaps
- No independent benchmark found that includes Defuddle alongside trafilatura/Readability; its quality claims are the author's.
- No benchmark found that isolates documentation sites or JS-heavy SPAs with numbers; BulkMD's per-category breakdown was not extractable.
- newspaper4k was not hands-on tested; only the trafilatura-run score (0.801 F1) is available.

## Install effort without Docker; Bun compatibility

### Takeaway
The JS stack (Readability or Defuddle + linkedom + Turndown) is a `bun add` away and runs in-process in Bun with no native deps (verified on Bun 1.4.0). trafilatura/markdownify/newspaper4k install cleanly into a Python 3.14 venv (trafilatura verified) and would run as a sidecar or subprocess. Crawl4AI and Playwright work without Docker but download a Chromium. Firecrawl self-host and the Jina Reader open-source build are documented only as Docker deployments, so they are out for this setup.

### Cited Findings
- Readability in Node needs an external DOM; README recommends jsdom and passing the page URL so relative links become absolute — [Readability README](https://github.com/mozilla/readability)
- linkedom is commonly paired with Readability on servers; described as same correctness on the tested corpus with ~3x lower cold-start than jsdom (secondary claim via search summary of BulkMD/readdown material) — [BulkMD](https://bulkmd.app/blog/readability-vs-trafilatura-extractors); [h2m-parser](https://github.com/gustavovalverde/h2m-parser)
- Defuddle works with linkedom, JSDOM or happy-dom via `defuddle/node`; bundles: `defuddle` (core, browser, no deps), `defuddle/full` (math + markdown), `defuddle/node`; also a CLI accepting file/URL/stdin with markdown/JSON output — [Defuddle README](https://github.com/kepano/defuddle)
- Hands-on: `bun add @mozilla/readability linkedom turndown defuddle` installed 28 packages in 506 ms and both pipelines ran on Bun 1.4.0 (see header) — researcher's local test, 2026-09-29 (no URL)
- Hands-on: `pip install trafilatura markdownify` into a Python 3.14.7 venv succeeded (lxml 6.1.3 wheel) — researcher's local test, 2026-09-29 (no URL). PyPI declares requires_python >=3.10 for trafilatura 2.2.0, newspaper4k 0.9.6, crawl4ai 0.9.4; markitdown 0.1.8 declares `<3.15,>=3.10` — [PyPI trafilatura](https://pypi.org/project/trafilatura/); [PyPI crawl4ai](https://pypi.org/project/crawl4ai/); [PyPI markitdown](https://pypi.org/project/markitdown/)
- Crawl4AI non-Docker install: `pip install crawl4ai`, then `crawl4ai-setup` (installs browser deps), `crawl4ai-doctor` to diagnose; semantic features need optional Torch/Transformers — [Crawl4AI install docs](https://docs.crawl4ai.com/core/installation/)
- Firecrawl self-host: Docker Compose is the only documented path; stack = PostgreSQL (queue), Redis, RabbitMQ, Playwright service; self-host lacks Fire-engine, screenshots/actions, agent/browser/interact features; LLM extraction needs an OpenAI-compatible or Ollama endpoint — [Firecrawl self-host docs](https://docs.firecrawl.dev/contributing/self-host)
- Jina Reader OSS: "fully self-hostable via Docker" with prebuilt GHCR image bundling headless Chrome, LibreOffice and CJK fonts; no longer uses Firebase (2025-03); "open source branch of the codebase behind r.jina.ai and s.jina.ai", stateless, MongoDB-backed SaaS storage not included — [jina-ai/reader](https://github.com/jina-ai/reader)
- Hosted r.jina.ai: README says "free, stable and scalable" with rate limits documented at jina.ai/reader#pricing (numbers not in README) — [jina-ai/reader](https://github.com/jina-ai/reader)
- Playwright npm 1.63.0 published 2026-09-04 — [npm playwright](https://www.npmjs.com/package/playwright)

### Inferences
- Lowest-effort in-process choice for a Bun server: Defuddle (or Readability) on linkedom + Turndown (Defuddle can emit markdown itself). No sidecar, no native modules.
- trafilatura as an optional second opinion/sidecar is cheap (small venv, pure wheels) — run via `Bun.spawn` or a tiny local HTTP service bound to 127.0.0.1.
- Playwright can be driven from Bun, but Bun-compatibility of Playwright's Node-specific internals was not verified here; the safest route is running the browser step in Node or Python (Crawl4AI) as a subprocess. Treat as unverified.
- Firecrawl self-host (Docker + 4 services, AGPL) and Jina Reader OSS (Docker image with Chrome + LibreOffice) are poor fits for a no-Docker Mac; running Jina's TS code natively may be possible but is undocumented.
- r.jina.ai hosted is free-ish but sends every URL the model reads to a third party; it is not "self-hosted".

### Gaps
- Playwright-under-Bun compatibility status in 2026 was not verified.
- Exact r.jina.ai free-tier rate limits not found in primary source.
- Non-Docker install of Jina Reader not documented anywhere found.

## Maintenance status 2025-2026 and licence

### Takeaway
All mainstream options are actively maintained in 2026 and permissively licensed, except Firecrawl (AGPL-3.0) and html2text (GPL-3.0). @mozilla/readability's last npm release is from March 2025 though the repo is still active; Defuddle ships very frequently but calls itself "very much a work in progress".

### Cited Findings (fetched 2026-09-29)
| Tool | Latest version (date) | Licence | GitHub stars / last push | Source |
|---|---|---|---|---|
| @mozilla/readability | 0.6.0 (2025-03-03) | Apache-2.0 | 11.5k / 2026-08-04 | [npm](https://www.npmjs.com/package/@mozilla/readability), [GitHub](https://github.com/mozilla/readability) |
| turndown | 7.2.4 (2026-04-03) | MIT | 11.5k / 2026-09-03 | [npm](https://www.npmjs.com/package/turndown), [GitHub](https://github.com/mixmark-io/turndown) |
| defuddle | 0.19.4 (2026-09-17) | MIT | 9.5k / 2026-09-28 | [npm](https://www.npmjs.com/package/defuddle), [GitHub](https://github.com/kepano/defuddle) |
| linkedom | 0.18.13 (2026-07-07) | ISC | — | [npm](https://www.npmjs.com/package/linkedom) |
| happy-dom | 20.14.5 (2026-09-12) | MIT | — | [npm](https://www.npmjs.com/package/happy-dom) |
| jsdom | 30.1.1 (2026-09-22) | MIT | — | [npm](https://www.npmjs.com/package/jsdom) |
| node-html-markdown | 2.0.0 (2025-11-14) | MIT | — | [npm](https://www.npmjs.com/package/node-html-markdown) |
| playwright | 1.63.0 (2026-09-04) | Apache-2.0 | — | [npm](https://www.npmjs.com/package/playwright) |
| trafilatura | 2.2.0 (2026-07-31) | Apache-2.0 | 6.9k / 2026-09-29 | [PyPI](https://pypi.org/project/trafilatura/), [GitHub](https://github.com/adbar/trafilatura) |
| newspaper4k | 0.9.6 (2026-07-19) | MIT | 1.1k / 2026-08-24 | [PyPI](https://pypi.org/project/newspaper4k/), [GitHub](https://github.com/AndyTheFactory/newspaper4k) |
| markdownify | 1.2.3 (2026-06-30) | MIT (GitHub) | 2.3k / 2026-06-30 | [PyPI](https://pypi.org/project/markdownify/), [GitHub](https://github.com/matthewwithanm/python-markdownify) |
| crawl4ai | 0.9.4 (2026-09-23) | Apache-2.0 | 84.5k / 2026-09-25 | [PyPI](https://pypi.org/project/crawl4ai/), [GitHub](https://github.com/unclecode/crawl4ai) |
| markitdown (Microsoft) | 0.1.8 (2026-09-21) | MIT | 187.6k / 2026-09-21 | [PyPI](https://pypi.org/project/markitdown/), [GitHub](https://github.com/microsoft/markitdown) |
| html2text | 2025.4.15 | GPL-3.0-or-later | — | [PyPI](https://pypi.org/project/html2text/) |
| readabilipy | 0.3.0 (2024-12-02) | MIT | — | [PyPI](https://pypi.org/project/readabilipy/) |
| jina-ai/reader | (no releases checked) | Apache-2.0 | 12.1k / 2026-05-22 | [GitHub](https://github.com/jina-ai/reader) |
| firecrawl | — | AGPL-3.0 | 186.6k / 2026-09-29 | [GitHub](https://github.com/firecrawl/firecrawl) |

- Defuddle README: "Beware! Defuddle is very much a work in progress!" — [Defuddle README](https://github.com/kepano/defuddle)
- None of the GitHub repos above are archived (api.github.com `archived: false`) — per-repo GitHub links above

### Inferences
- @mozilla/readability is stable/slow-moving (no npm release in ~18 months) rather than abandoned — repo still gets pushes. Low churn is fine for a dependency.
- Defuddle's fast release cadence plus WIP warning suggests pinning an exact version.
- markitdown is mostly a file-format converter (PDF/Office/etc. to markdown), useful for non-HTML fetches (PDFs) rather than article extraction — this is an inference from its purpose; its HTML-extraction quality was not evaluated.
- AGPL (Firecrawl) matters only if the harness is distributed or offered as a network service; for a private home server it is legally fine but heavy for other reasons.

### Gaps
- No Mozilla "successor" to Readability found for 2025-2026; searched but found nothing primary.
- Did not verify ReaderLM-v2 (Jina's small HTML-to-markdown model) licence/status in this session; if considered, check its licence (believed non-commercial) before use.

## Safety when a model fetches arbitrary URLs from a home Mac

### Takeaway
The big risk is SSRF: a model (or a page it read) can ask the tool to fetch `http://127.0.0.1:<port>`, LAN devices, tailnet `100.64.0.0/10` hosts or `100.100.100.100`, and read back admin UIs or APIs. Mitigate by resolving DNS yourself, rejecting any non-public address (IPv4 and IPv6, all A/AAAA answers), connecting to the validated IP (pinning), following redirects manually with re-validation each hop, http/https only, and hard caps on bytes, time, content-type and output tokens. Prompt injection in page text cannot be filtered out by extractors; treat fetched text as untrusted data and limit what the model can do after reading it.

### Cited Findings
- OWASP SSRF cheat sheet (case: must fetch arbitrary URLs): verify target IP/hostname is public; reject 127.0.0.0/8, 10.0.0.0/8 and other RFC1918, 169.254.169.254; for domains "Retrieve all the IP addresses behind the domain name provided (taking records A + AAAA)" and check each; allow only HTTP/HTTPS; "Disable the support for redirection in your web client"; add network-layer egress controls; warns "Deny-lists are bypass-prone. Prefer allow-lists." — [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- Tailscale assigns node IPs from RFC6598 CGNAT `100.64.0.0/10` (100.64.0.0-100.127.255.255); every tailnet device can reach Quad100 `100.100.100.100` — [Tailscale docs](https://tailscale.com/kb/1015/100.x-addresses)
- DNS rebinding / TOCTOU: validating a hostname then calling `fetch()` re-resolves it, so a hostile DNS server can answer public on the check and internal on the connect; bypasses seen in the wild include names like `localtest.me` (resolves to 127.0.0.1) and open redirectors (e.g. `httpbin.org/redirect-to`) — [ssrf-fetch](https://github.com/iansduncan-oss/ssrf-fetch); [Hemmelig advisory GHSA-vvxf-wj5w-6gj5](https://github.com/HemmeligOrg/Hemmelig.app/security/advisories/GHSA-vvxf-wj5w-6gj5)
- Fix pattern: `dns.lookup(host, { all: true })`, reject if any address is private/loopback/link-local, then connect to the pinned IP with the original Host header via a custom lookup/dispatcher — [ssrf-fetch](https://github.com/iansduncan-oss/ssrf-fetch); [ssrf-guard](https://github.com/jonathanong/ssrf-guard); [fleet issue #420](https://github.com/khang859/fleet/issues/420)
- Node libraries: `request-filtering-agent` (http.Agent that blocks private/reserved IPs at lookup time), `ssrf-guard` (returns pinnable resolved IPs), `ssrf-fetch` (undici Agent with pinned lookup) — [request-filtering-agent](https://github.com/azu/request-filtering-agent); [ssrf-guard](https://github.com/jonathanong/ssrf-guard); [ssrf-fetch](https://github.com/iansduncan-oss/ssrf-fetch)
- Pinned-lookup dispatchers can break with Happy Eyeballs (`autoSelectFamily`) producing "Invalid IP address: undefined" — [openclaw issue #87763](https://github.com/openclaw/openclaw/issues/87763)
- Bun: one project notes Bun's internal DNS cache narrows the rebinding window "an accident of the runtime, not a control" — [search summary of BuilderIO/agent-native #5610 and related issues](https://github.com/BuilderIO/agent-native/issues/5610) (secondary; wording from search snippet)
- Readability output HTML must be sanitised (DOMPurify recommended) if ever rendered — Firefox Reader Mode uses DOMPurify + CSP — [Readability README](https://github.com/mozilla/readability)
- Prompt injection: LLMs can't reliably distinguish instructions from data; the dangerous combination is private data access + untrusted content + ability to communicate externally; defences in 2026 literature are dual-LLM/quarantine designs, detection models, information-flow control — [Sysdig](https://www.sysdig.com/learn-cloud-native/prompt-injection); [Unit 42 — indirect prompt injection in the wild](https://unit42.paloaltonetworks.com/ai-agent-prompt-injection/); [Indirect Prompt Injection in the Wild (arXiv 2604.27202)](https://arxiv.org/pdf/2604.27202)
- Size/time caps in practice: OpenCode caps responses at 5 MB (checks Content-Length and actual bytes), default timeout 30 s, max 120 s; only http(s) schemes; per-URL permission prompt — [OpenCode webfetch.ts](https://github.com/sst/opencode/blob/dev/packages/opencode/src/tool/webfetch.ts)
- Token budgeting: Cloudflare returns `X-Markdown-Tokens` so agents can plan context; Ollama docs advise ≥ ~32,000-token context for search agents and show truncating fetched results "for limited context lengths" — [Cloudflare changelog](https://developers.cloudflare.com/changelog/post/2026-02-12-markdown-for-agents/); [Ollama web search docs](https://docs.ollama.com/capabilities/web-search)

### Inferences (recommended mitigations for this setup)
- Blocklist (reject if ANY resolved address matches): 0.0.0.0/8, 127.0.0.0/8, 10/8, 172.16/12, 192.168/16, 169.254/16, **100.64.0.0/10 (tailnet + Quad100)**, 224.0.0.0/4, 240.0.0.0/4, 255.255.255.255; IPv6 ::1, ::, fc00::/7 (includes Tailscale's ULA range), fe80::/10, ff00::/8, and IPv4-mapped ::ffff:0:0/96 (re-check the embedded v4). Also reject hostnames `localhost`, `*.local`, `*.ts.net`/MagicDNS names, and bare hostnames without a dot. Parse with `new URL()` so decimal/octal/hex IP spellings normalise before checking.
- Pinning in Bun: Bun's `fetch` does not use Node's undici dispatcher, so undici-based libs (ssrf-fetch) may not apply; options are (a) resolve with `node:dns` then fetch `https://<ip>` with Host header/SNI (awkward for TLS), (b) use `node:http(s)` with a `lookup` option that validates (request-filtering-agent style) — needs verifying under Bun, or (c) run the fetcher in a separate process with macOS egress restrictions. Test with `localtest.me`, a redirect to 127.0.0.1, and `http://2130706433/`.
- Redirects: use `redirect: "manual"`, follow at most ~5 hops, re-run the full URL + DNS check on each `Location`.
- Response hygiene: allow content-types text/html, application/xhtml+xml, text/plain, text/markdown, (optionally application/pdf via a converter); reject others early; stream the body and abort past a byte cap (e.g. 2-5 MB) rather than trusting Content-Length; overall timeout ~15-30 s; strip credentials in URLs; send no cookies; don't forward any local auth headers.
- Output truncation: after extraction, cap by tokens (approx 4 chars/token for English is a common rough rule) to a fixed fraction of the model's context, e.g. 8k-16k tokens for a 32k model; say "[truncated at N of M chars]" and offer an offset/page parameter so the model can request more, rather than silently cutting.
- Prompt injection: wrap output in clear delimiters labelled as untrusted page content; keep the fetch tool read-only; don't let fetched text alone trigger write/exec/send tools without user confirmation; consider stripping hidden text (display:none, aria-hidden, zero-width chars) — extractors like Defuddle using mobile/CSS cues may already drop some hidden elements, but not reliably.
- Binary content: never feed undecoded bytes to the model; detect via content-type and a NUL-byte sniff.

### Gaps
- Did not find authoritative documentation on whether Bun's `fetch` supports a custom DNS lookup/dispatcher hook in 2026, or whether `request-filtering-agent` works under Bun's `node:http`.
- No primary source found on Tailscale's IPv6 range in the fetched page (fd7a:115c:a1e0::/48 is from prior knowledge; falls inside fc00::/7 anyway).

## How Ollama's web_fetch and OpenCode's webfetch do it (reference)

### Takeaway
Ollama's `web_fetch` is not local at all: it is a hosted API on ollama.com requiring an API key, returning title/content/links. OpenCode's `webfetch` is a simple in-process fetch + Turndown (no Readability-style main-content extraction), with a 5 MB cap, timeouts, markdown-preferring Accept header, a Cloudflare-challenge retry, and a user permission prompt — but no SSRF/private-IP filtering in the tool code.

### Cited Findings
- Ollama web fetch: `POST https://ollama.com/api/web_fetch`, Bearer API key required; request `{url}`; response `title`, `content`, `links`; cloud-hosted; docs suggest ≥ ~32k context for search agents and show truncation in the Python example — [Ollama web search docs](https://docs.ollama.com/capabilities/web-search)
- ollama-python client `web_fetch()` raises unless an `Authorization: Bearer` header is set and posts to `https://ollama.com/api/web_fetch` — [ollama-python _client.py](https://github.com/ollama/ollama-python/blob/main/ollama/_client.py)
- OpenCode webfetch: params `url`, `format` (text|markdown|html, default markdown), `timeout` (s, max 120); requires http(s); asks permission `webfetch` per URL; Chrome-like UA, falls back to UA "opencode" on 403 with `cf-mitigated: challenge`; 5 MB limit; images returned as base64 attachments; HTML→markdown via Turndown (atx headings, fenced code, `-` bullets) removing script/style/meta/link; "text" mode uses htmlparser2 and skips script/style/noscript/iframe/object/embed; non-HTML returned as-is — [OpenCode webfetch.ts](https://github.com/sst/opencode/blob/dev/packages/opencode/src/tool/webfetch.ts)

### Inferences
- OpenCode's approach (whole-page Turndown) keeps nav/footer boilerplate and so wastes tokens; adding Defuddle/Readability before Turndown is the obvious upgrade for small-context local models.
- OpenCode relies on the human permission prompt instead of network filtering; an unattended harness on a home Mac needs the SSRF controls above because nobody is there to approve.
- Ollama's web_fetch would make the "local" setup depend on ollama.com and an account; the pipeline it implies (title + main content + links) is a good output shape to copy.

### Gaps
- Ollama does not document what extractor it uses server-side, nor its free-tier quotas for web_fetch.
- Did not check whether OpenCode applies a separate generic output-length truncation to tool results outside webfetch.ts.
