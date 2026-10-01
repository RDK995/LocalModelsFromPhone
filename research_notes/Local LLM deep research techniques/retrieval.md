# Retrieval layer for a local deep-research agent (free, self-hosted only)

Context: Bun/TypeScript server on a Mac; ddgs per-search Python subprocess with Playwright Chromium fallback; SSRF-guarded fetch with main-content extraction; models in Ollama. Research date 2026-10-01. Source-reliability flags are given inline where a source is a blog/vendor rather than a primary source.

## Query generation (decomposition, multi-query, HyDE, gap-driven follow-ups, query dedup)

### Takeaway
Open local systems use a simple loop: generate one query, search, summarise, reflect on knowledge gaps, generate a new gap-filling query, repeat a fixed number of times. Among rewrite techniques, no single one wins: decomposition helps multi-hop questions, HyDE/multi-query help fact lookups, and multi-query results are usually merged with Reciprocal Rank Fusion (RRF).

### Cited Findings
- LangChain local-deep-researcher (Ollama-based): LLM generates a web search query, summarises results, "reflect[s] on the summary, identifying knowledge gaps", generates a new query for the gap, and repeats; `MAX_WEB_RESEARCH_LOOPS` default 3 — [GitHub: langchain-ai/local-deep-researcher](https://github.com/langchain-ai/local-deep-researcher)
- Same repo: search backends are DuckDuckGo (default, no key), SearXNG, Tavily, Perplexity; `FETCH_FULL_PAGE` (default false) fetches full pages for DuckDuckGo; output is markdown with citations and all gathered sources kept in graph state — [GitHub: local-deep-researcher](https://github.com/langchain-ai/local-deep-researcher)
- Same repo: small reasoning models (DeepSeek R1 7B / 1.5B) struggle with required JSON output; a `use_tool_calling` fallback exists — [GitHub: local-deep-researcher](https://github.com/langchain-ai/local-deep-researcher)
- HyDE embeds an LLM-generated hypothetical answer document for dense retrieval; Query2doc appends a generated pseudo-document to the query for sparse and dense retrieval; RAG-Fusion generates 3–5 reformulations, runs them in parallel and fuses with RRF — [RFG Framework paper (SciTePress 2025)](https://www.scitepress.org/Papers/2025/138369/138369.pdf); [Raudaschl/rag-fusion](https://github.com/Raudaschl/rag-fusion)
- A retrieval-feedback-grounded multi-query expansion method (RFG) reportedly outperforms HyDE and Query2doc across retrievers — [RFG Framework (SciTePress 2025)](https://www.scitepress.org/Papers/2025/138369/138369.pdf)
- Practitioner comparison (blog, not peer reviewed; BEIR tracks plus 200 custom multi-hop questions): fact lookup recall@10 HyDE 0.79 / multi-query 0.74 / decomposition 0.66; multi-hop recall@10 decomposition 0.63 / multi-query 0.52 / HyDE 0.45. Author's caveat: no universal winner, and HyDE gains vanish if hypothetical docs and corpus chunks are not normalised the same way — [dev.to: HyDE, Multi-Query, Decomposition](https://dev.to/gabrielanhaia/hyde-multi-query-decomposition-which-query-rewrite-actually-moves-recall-1m08)
- A 2026 paper argues expansions should be coordinated: "dense expands, sparse anchors" (i.e. let expansions feed dense retrieval while keeping the original query for lexical/BM25) — [arXiv 2608.15851](https://arxiv.org/pdf/2608.15851) (title only seen in search results; contents not verified)

### Inferences
- For a web-search agent (where the "retriever" is a third-party engine, not your own embedding index), HyDE is of limited use at the search stage: search engines take keyword queries, not documents. HyDE is more useful at the local rerank stage (embed a hypothetical answer to score fetched chunks). Decomposition into sub-questions plus short keyword queries per sub-question fits web engines best.
- Gap-driven follow-ups (local-deep-researcher pattern) are cheap and robust with small Ollama models; keep a fixed loop cap and require structured output with a tool-calling fallback.
- Query dedup: normalise (lowercase, strip stopwords/punctuation, sort tokens) and drop exact repeats; for near-repeats, compare embeddings of past queries (cosine above a threshold) before spending a rate-limited search call. Merge multi-query results with RRF (score = sum 1/(k+rank), k≈60 is the common default) and dedupe by canonical URL.

### Gaps
- No primary, peer-reviewed head-to-head of query rewriting specifically for live web search (vs. fixed BEIR corpora) was found.
- Query-dedup techniques in open deep-research repos were not documented in sources I fetched; the dedup advice above is inference.

## Free search sources and their limits (ddgs, SearXNG, headless scraping, free APIs, Common Crawl)

### Takeaway
ddgs is now a metasearch library over many engines (not just DuckDuckGo) and fails with soft "202 Ratelimit" blocks under load; self-hosted SearXNG gives the same multi-engine idea with built-in per-engine suspension timers and a JSON API. Both depend on scraping upstream engines, so pacing, caching and multiple fallbacks are mandatory.

### Cited Findings
- ddgs ("A metasearch library that aggregates results from diverse web search services"); text backends: Bing, Brave, DuckDuckGo, Google, Grokipedia, Mojeek, StartPage, Yandex, Yahoo, Wikipedia; news: Bing, DuckDuckGo, Yahoo; supports http/https/socks5 proxy; Python >= 3.10; ships CLI, FastAPI API server and MCP server; disclaimer "for educational purposes only" — [GitHub: deedy5/ddgs](https://github.com/deedy5/ddgs)
- The duckduckgo-search package was renamed to ddgs; old pins broke. DuckDuckGo's "202 Ratelimit" is a soft block; advice is pace requests, back off with jitter, prefer residential IP over flagged proxies; DDG's token-gated path costs two requests per search while the HTML endpoint is one request (vendor blog — Serpent API sells a search API, treat with caution) — [Serpent API blog](https://apiserpent.com/blog/scrape-duckduckgo-serp-for-free)
- `RatelimitException: 202 Ratelimit` widely reported in Open WebUI, crewAI, AgentLite, Agno — [open-webui discussion #6624](https://github.com/open-webui/open-webui/discussions/6624); [crewAI #136](https://github.com/crewAIInc/crewAI/issues/136); [AgentLite #19](https://github.com/SalesforceAIResearch/AgentLite/issues/19)
- SearXNG supports result formats `html, csv, json, rss` (JSON must be enabled in `search.formats`) — [SearXNG search settings](https://docs.searxng.org/admin/settings/settings_search.html)
- SearXNG per-engine suspension on errors (seconds): SearxEngineAccessDenied 86400; SearxEngineCaptcha 86400; SearxEngineTooManyRequests 3600; cf_SearxEngineCaptcha 1296000 (15 days); cf_SearxEngineAccessDenied 86400; recaptcha_SearxEngineCaptcha 604800 (7 days); `ban_time_on_fail` 5 s, `max_ban_time_on_fail` 120 s — [SearXNG search settings](https://docs.searxng.org/admin/settings/settings_search.html)
- SearXNG's limiter exists to stop the instance itself being blocked by upstream engines (aggregate traffic looks like a bot); for private instances it can be disabled (`limiter: false`); the dynamic limiter needs Valkey — [SearXNG limiter docs](https://docs.searxng.org/admin/searx.limiter.html)
- arXiv API terms: "make no more than one request every three seconds, and limit requests to a single connection at a time", applied across all your machines; don't store and re-serve e-prints — [arXiv API Terms of Use](https://info.arxiv.org/help/api/tou.html)
- GPT-Researcher supports multiple retrievers including free ones (DuckDuckGo, SearX, arXiv, Semantic Scholar, PubMed, custom) — note: its retriever docs page returned 404 when fetched; claim is from prior knowledge and NOT verified in this session (see Gaps).

### Inferences
- Treat each upstream as a circuit-breaker: on 202/429/CAPTCHA, suspend that backend for an escalating period (SearXNG's defaults — 1 h for too-many-requests, 24 h for CAPTCHA/denied — are a reasonable template) and fall through to the next backend (ddgs `backend` list, then Playwright scraping, then vertical APIs).
- Cache search results by normalised query (hours–days TTL) and fetched pages by canonical URL (with ETag/Last-Modified); this is the single biggest lever against rate limits.
- Running SearXNG locally (Docker) alongside ddgs gives two independent scraping implementations; they share the same upstream engines and the same home IP, so they are not fully independent failure domains.
- Vertical free APIs (arXiv at ≤1 req/3 s, Wikipedia) are more reliable than scraped general engines and should be preferred when the query is academic/encyclopedic.

### Gaps
- Exact DuckDuckGo rate-limit thresholds (requests/minute before 202) are not published; only anecdotal.
- Wikipedia/MediaWiki API etiquette (User-Agent requirement, rate guidance) and Common Crawl CDX index usage were not verified this session. Common Crawl is monthly-snapshot data, so it suits recall of known pages, not fresh news (inference).
- GPT-Researcher retriever list could not be verified (docs URL 404).

## Page fetching and main-content extraction (trafilatura, Readability, ReaderLM-v2, markdown, PDF, JS pages)

### Takeaway
Heuristic extractors are fast and good: trafilatura leads both major benchmarks (F1 ≈0.92 on its own 990-doc set; ≈0.96 on ScrapingHub's), with Mozilla Readability.js close behind (≈0.947 F1) and directly usable from Bun. A local LLM converter (ReaderLM-v2, 1.5B) is a quality option for hard pages but is non-commercial-licensed and slow on CPU/small GPUs. PDFs need a separate path.

### Cited Findings
- trafilatura evaluation (990 docs, 2951 text / 2966 boilerplate segments, run dated 2026-08-04): trafilatura 2.2.0 P 0.906 / R 0.943 / F 0.924; magic-html 0.889; justext (custom) 0.862; news-please 0.836; readability-lxml 0.826 (P 0.898, R 0.764); resiliparse 0.811; goose3 0.810 (highest precision 0.936, low recall); newspaper/boilerpy3 have parse errors on malformed HTML; trafilatura has recall/precision/fast modes — [trafilatura evaluation](https://trafilatura.readthedocs.io/en/latest/evaluation.html) (note: run by trafilatura's own author)
- ScrapingHub/Zyte article-extraction-benchmark (news/blog articles): rs_trafilatura F1 0.970; go_trafilatura 0.960; trafilatura 0.958 (P 0.938, R 0.978); newspaper4k 0.949 (highest P 0.964); readability_js 0.947 (P 0.914, R 0.982); go_readability_fork 0.947; reference: commercial AutoExtract (Nov 2019) 0.970, Diffbot (Nov 2019) 0.951 — [scrapinghub/article-extraction-benchmark](https://github.com/scrapinghub/article-extraction-benchmark)
- Defuddle (MIT, by Obsidian's kepano): Readability alternative, "more forgiving, removes fewer uncertain elements", consistent output for footnotes, math (to MathML), code blocks (keeps language); uses mobile styles to detect clutter; `defuddle/node` takes DOM from linkedom, JSDOM or happy-dom; `markdown: true` emits Markdown; returns author, title, date, language, site name, word count, schema.org — [GitHub: kepano/defuddle](https://github.com/kepano/defuddle)
- ReaderLM-v2 (Jina): 1.54B params, up to 512K tokens combined in/out, CC-BY-NC-4.0 (non-commercial); HTML→Markdown ROUGE-L 0.84, Levenshtein 0.22; HTML→JSON F1 0.81; claims to beat Qwen2.5-32B and Gemini2-flash on these tasks; advise pre-cleaning HTML (strip scripts, styles, comments); quantised GGUF builds usable in llama.cpp/Ollama/LM Studio; contrastive loss added to reduce degeneration (repetition) on long outputs; T4 GPU ~67 tok/s input, 36 tok/s output — [HF: jinaai/ReaderLM-v2](https://huggingface.co/jinaai/ReaderLM-v2)
- PDF: Marker on olmocr-bench (1,403 PDFs) balanced mode 76.0% overall, 83.5% on born-digital PDFs, ahead of MinerU and Docling and ~5x MinerU throughput (claims from Marker's own README) — [GitHub: datalab-to/marker](https://github.com/datalab-to/marker)
- PyMuPDF4LLM converts digital-born PDFs to Markdown from embedded text (no OCR), positioned as the fastest option; Marker uses Surya OCR, MinerU uses PaddleOCR, Docling a custom engine — [pdf-to-markdown-benchmark](https://github.com/pdfmarkdownapp/pdf-to-markdown-benchmark); [themenonlab blog (secondary)](https://themenonlab.blog/blog/best-open-source-pdf-to-markdown-tools-2026)

### Inferences
- For Bun: run `@mozilla/readability` or Defuddle on a linkedom DOM in-process (no Python hop), and optionally call trafilatura via the existing Python subprocess for a second opinion when Readability returns too little text. trafilatura's higher F1 vs readability-lxml mostly comes from recall; Readability.js (0.947) is much better than readability-lxml (0.826) on the ScrapingHub set, so the JS port is not the weak link.
- A cheap cascade: plain HTTP fetch → Readability/Defuddle → if extracted text < N chars or page looks JS-rendered (empty body, `<noscript>` heavy), re-fetch with Playwright and re-extract → only for still-poor pages, ReaderLM-v2 via Ollama. Mind the NC license if the project is ever commercial.
- PDFs: detect by Content-Type/magic bytes; use PyMuPDF4LLM for born-digital PDFs (fast, keeps page numbers for citations); OCR tools (Marker/Docling) only when text layer is empty.
- Benchmarks are article-centric (news/blog); forums, docs sites, tables and listings score worse in practice — keep a raw-text fallback.

### Gaps
- No found benchmark of Defuddle against Readability/trafilatura on the ScrapingHub or trafilatura sets.
- No measured ReaderLM-v2 throughput on Apple Silicon/Ollama was found.
- Marker licensing terms (GPL code / model weights restrictions) were not verified this session.

## Chunking, filtering and reranking locally (BM25, embeddings, cross-encoders, LLM scoring)

### Takeaway
Best quality per compute on a Mac is a two-stage pipeline: BM25 (+ optionally a small embedding model, fused with RRF) to cut fetched chunks to ~50–100 candidates, then a ~0.6B cross-encoder reranker. Among 0.6B rerankers, published numbers disagree on whether Qwen3-Reranker-0.6B beats bge-reranker-v2-m3; jina-reranker-v3 and mxbai-rerank are stronger at similar size. Qwen3-Embedding (0.6B/4B/8B) leads MTEB among Ollama-available embedders; nomic-embed-text and embeddinggemma are the light options.

### Cited Findings
- BEIR nDCG@10, reranking top-100 from jina-embeddings-v3: jina-reranker-v3 (0.6B) 61.94; mxbai-rerank-large-v2 (1.5B) 61.44; Qwen3-Reranker-4B 61.16; jina-reranker-m0 (2.4B) 58.95; mxbai-rerank-base-v2 (0.5B) 58.40; jina-reranker-v2 (0.3B) 57.06; bge-reranker-v2-m3 (0.6B) 56.51; Qwen3-Reranker-0.6B 56.28 — [jina-reranker-v3 paper, arXiv 2509.25085](https://arxiv.org/html/2509.25085v1) (vendor paper)
- Qwen's own numbers: Qwen3-Reranker 0.6B / 4B / 8B: MTEB-R 61.82 / 69.76 / 69.02; CMTEB-R 71.02 / 75.94 / 77.45; MMTEB-R 64.64 / 72.74 / 72.94; MLDR 50.26 / 69.97 / 70.19; Code 75.41 / 81.20 / 81.22; claims to outperform bge-reranker-v2-m3 and gte-multilingual-reranker-base on most; Apache 2.0; released 2025-06-05 — [Qwen3 Embedding blog](https://qwenlm.github.io/blog/qwen3-embedding/)
- Conflict: a user issue reports Qwen3-Reranker-0.6B not better than bge-reranker-v2-m3 on their data — [QwenLM/Qwen3-Embedding issue #82](https://github.com/QwenLM/Qwen3-Embedding/issues/82); a 2026 paper's search snippet reports BEIR avg 48.09 for Qwen3-Reranker-0.6B vs 56.42 for bge-reranker-v2-m3 — [Querit-Reranker, arXiv 2606.19037](https://arxiv.org/pdf/2606.19037) (snippet only, not fetched); vs 56.28 vs 56.51 in the jina paper above.
- Qwen3-Embedding: 0.6B (1024-d), 4B (2560-d), 8B (4096-d); all support Matryoshka (MRL) dims and instructions; 32K context; 8B scored 70.58 on MTEB multilingual (#1 as of 2025-06-05) — [Qwen3 Embedding blog](https://qwenlm.github.io/blog/qwen3-embedding/)
- Ollama embedders (secondary source): qwen3-embedding:8b 4.7 GB, 4096-d; nomic-embed-text v1.5 137M params, 768-d (MRL 64–768), 8192-token context, 274 MB, ~62.28 MTEB English v1; embeddinggemma 300M, 768-d (MRL to 128), 2K context, 622 MB, 61.15 MTEB multilingual — [morphllm: Best Ollama Embedding Models 2026](https://www.morphllm.com/ollama-embedding-models)
- Qwen3 paper (via search snippet): MTEB English Qwen3-Embedding-8B 75.22, 4B 74.60, 0.6B 70.70 — [arXiv 2506.05176](https://arxiv.org/pdf/2506.05176)

### Inferences
- Qwen3-Reranker is a causal-LM "yes/no" scorer, not a classic cross-encoder head; Ollama has no native rerank endpoint, so on a Mac the practical options are (a) bge-reranker-v2-m3 / jina-reranker / mxbai-rerank via a small Python sidecar (sentence-transformers on MPS, or llama.cpp's rerank server), or (b) emulating Qwen3-Reranker through Ollama by prompting for yes/no and reading logprobs. Verify Ollama logprob support on the installed version before relying on (b).
- LLM-based relevance scoring with the main chat model is the most expensive option; reserve it for the final ~10–20 chunks or for "does this passage support claim X" checks, not first-pass filtering.
- Chunking: split extracted Markdown on headings/paragraphs into ~300–500-token chunks with small overlap, each carrying `url`, `title`, `char_start/char_end` so citations can point back to exact spans (see provenance section).
- BM25 can run in-process in TypeScript over only the pages fetched for this query (tiny corpus), so it costs effectively nothing; embedding-only retrieval over a few dozen pages adds little over BM25+reranker.

### Gaps
- No Apple-Silicon latency benchmarks for these rerankers/embedders were found.
- The three sources disagree on Qwen3-Reranker-0.6B vs bge-reranker-v2-m3; the user's own eval on representative queries should decide.
- MTEB leaderboard itself was not fetched (live page); numbers here come from model authors/secondary sources.

## Source credibility, near-duplicate pages, provenance and citation faithfulness

### Takeaway
Even commercial deep-research agents emit 3–13% hallucinated citation URLs; simple post-hoc URL verification (live check + Wayback lookup) with a self-correction pass cut non-resolving URLs below 1% for strong models, but small models failed to act on the feedback. The robust local design is structural: the model may only cite source IDs the system actually fetched, and quoted spans are verified against stored text.

### Cited Findings
- DeepResearch Bench's FACT framework measures effective citations and citation accuracy; Perplexity Deep Research had notably higher citation accuracy than Gemini-2.5-Pro and OpenAI Deep Research — [DeepResearch Bench, arXiv 2506.11763](https://arxiv.org/pdf/2506.11763); [project site](https://deepresearch-bench.github.io/)
- Across 10 models on DRBench and 3 on ExpertQA, 3–13% of citation URLs are hallucinated and 5–18% non-resolving. Gemini 2.5 Pro Deep Research: 13.3% hallucinated, 18.5% non-resolving; OpenAI Deep Research: 3.5% / 10.1%; Claude search-augmented 3.0–3.2% hallucinated; GPT 5.4–8.8%; non-resolving rates vary by field 5.4% (Business) to 11.4% (Theology) — [Detecting and Correcting Reference Hallucinations, arXiv 2604.03173](https://arxiv.org/html/2604.03173v1)
- Same paper: "hallucinated" = no Wayback Machine snapshot ever; "stale" = real but now offline. Tool `urlhealth` labels LIVE / DEAD / LIKELY_HALLUCINATED / UNKNOWN. Agentic self-correction with it: GPT-5.1 16.0%→0.6%, Gemini 2.5 Pro 6.1%→0.1%, Claude Sonnet 4.5 4.9%→0.8%; "smaller models failed to act on verification feedback despite tool access" — [arXiv 2604.03173](https://arxiv.org/html/2604.03173v1)
- Near-duplicate web pages: Google's simhash with 64-bit fingerprints and Hamming distance k = 3 was judged reasonable for 8 billion pages; Google used simhash for crawl dedup and MinHash+LSH for Google News — [Manku et al., Detecting Near-Duplicates for Web Crawling](https://research.google.com/pubs/archive/33026.pdf); [Wikipedia: SimHash](https://en.wikipedia.org/wiki/SimHash)
- Defuddle/trafilatura extract metadata (author, date, site name, schema.org) usable as credibility features — [kepano/defuddle](https://github.com/kepano/defuddle)

### Inferences
- Given that small models do not reliably self-correct, do not rely on prompting for citation honesty: give each stored chunk an ID (`S12#c3`), let the model cite IDs only, render URLs from the store, and reject/strip any citation ID not in the store. For quotes, verify by exact or fuzzy substring match against the stored chunk text and drop or flag failures.
- Dedup in layers: canonical URL (strip tracking params, `utm_*`, fragments; follow `<link rel=canonical>`), then exact content hash of extracted text, then simhash (64-bit, ≤3 bits) for syndicated/mirrored articles; when duplicates collapse, keep the earliest/most original domain as the cited source.
- Credibility signals cheaply available locally: domain type (.gov/.edu/primary docs/journals vs content farms), presence of author/date metadata, page date vs. query recency, whether multiple independent (non-duplicate) domains agree, and extraction quality (very short or ad-heavy pages). These are heuristics; no sourced benchmark validates a specific weighting.

### Gaps
- No open, validated source-credibility scoring model for web pages was found in this session.
- How specific open deep-research repos (GPT-Researcher, local-deep-researcher) verify quoted spans was not documented in the material fetched.

## Security: SSRF and prompt injection from fetched pages

### Takeaway
SSRF defense for an LLM-driven fetcher means: http/https only, resolve DNS yourself and pin the vetted IP, re-validate on every redirect (or disable redirects), and block private/link-local/metadata ranges in all encodings. For prompt injection, the only designs with strong guarantees are architectural (dual-LLM / CaMeL: untrusted text cannot change control flow); delimiting/"spotlighting" fetched text reduces but does not eliminate risk.

### Cited Findings
- OWASP SSRF: use a vetted IP library and compare its parsed output (hex/octal encodings bypass naive parsers); validate IPv4 and IPv6; defend DNS rebinding by resolving A/AAAA records and validating the IPs (pin them); reject when URL parsers disagree ("two implementations can read different hosts from the same bytes"); disable redirects; allow only http/https (no file://, gopher://); block metadata endpoints 169.254.169.254, metadata.google.internal; add network-layer egress controls — [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- Dual LLM pattern (Willison, 2023): a privileged LLM with tools never sees untrusted tokens; a quarantined LLM without tools processes untrusted content, passing back only symbolic references — [Simon Willison on CaMeL](https://simonwillison.net/2025/Apr/11/camel/)
- CaMeL (Google DeepMind): extracts control and data flow from the trusted user query so "untrusted data retrieved by the LLM can never affect the program flow" — [Simon Willison on CaMeL](https://simonwillison.net/2025/Apr/11/camel/); [Defeating Prompt Injections by Design (SaTML 2026)](https://www.computer.org/csdl/proceedings-article/satml/2026/785900a587/2jZks3ksGT6)
- Microsoft operationalised these ideas as "Spotlighting" and "Information Flow Control" (secondary blog source) — [zylos.ai 2026 overview](https://zylos.ai/research/2026-04-12-indirect-prompt-injection-defenses-agents-untrusted-content)
- Indirect prompt injection remains effective against tool-using agents (benchmarks and iterative attacks) — [InjecAgent, arXiv 2403.02691](https://arxiv.org/pdf/2403.02691); [IterInject, arXiv 2605.24659](https://arxiv.org/pdf/2605.24659); defense guidance — [OWASP LLM Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)

### Inferences
- For the target system: if Bun's fetch resolves DNS itself, the "validate then fetch" pattern is rebinding-vulnerable; connect to the pre-validated IP with the Host/SNI set to the hostname, and handle redirects manually with full re-validation per hop. Also block 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10, ::1, fc00::/7, fe80::/10, IPv4-mapped IPv6, and 0.0.0.0. Apply the same guard to Playwright (route interception) since the browser fetches subresources and follows redirects on its own.
- A deep-research agent's risk is lower than an email/coding agent's if fetched text can only influence (a) which URLs are fetched next and (b) report content. Mitigations: never let page text call tools other than search/fetch; derive follow-up URLs only from search-result lists or link lists the system parsed, not from free-text instructions; wrap page text in clearly delimited, labelled blocks; have a separate summariser (quarantined) pass produce plain notes; cap fetches per run; and strip hidden text (display:none, tiny fonts, aria-hidden, HTML comments) — extraction via Readability/trafilatura already drops much of it.
- Exfiltration channel to watch: the model embedding secrets/user data into a search query or fetch URL. Restrict the fetcher to URLs that came from search results or user input.

### Gaps
- No public evaluation of prompt-injection success rates specifically against open deep-research agents (GPT-Researcher, local-deep-researcher) was found.
- Whether Bun's fetch exposes a hook to pin a resolved IP (custom lookup) was not verified this session.
