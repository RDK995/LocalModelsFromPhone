# Page fetching, main-content extraction and note-taking for a local research agent

Scope: why page reads in LLM research agents often yield no usable content, and how to extract useful notes quickly and reliably on a Mac with no paid hosted search or scraping APIs (current to Oct 2026).

## Common failure causes (JS rendering, consent walls, bot blocking, paywalls, boilerplate, truncation, model rejecting content)

### Takeaway
The failures that are documented best are (1) bot blocking at the CDN layer, which now affects a large share of the web, (2) naive "whole HTML to markdown, then cut at N characters" pipelines that keep the boilerplate and drop the relevant part, and (3) extractors that work on articles but fail badly on forums, listings, product pages and other non-article pages. JS-only pages, consent walls and paywalls are widely talked about, but I found no reliable numbers on how common they are.

### Cited Findings
- **Bot blocking (Cloudflare):** From 1 July 2025, every new Cloudflare domain blocks AI crawlers (GPTBot, ClaudeBot, PerplexityBot and others) by default unless the owner opts out ("Content Independence Day") — [Cloudflare blog](https://blog.cloudflare.com/content-independence-day-no-ai-crawl-without-compensation/).
- As of June 2026, 52% of crawler requests Cloudflare saw were for AI training, up from 22% in spring 2025. More than a third of crawler activity comes from "mixed-use" bots whose intent cannot be told apart, and Cloudflare is pushing verifiable bot self-identification — [Cloudflare blog, "Content Independence Day, one year on"](https://blog.cloudflare.com/agentic-internet-bot-report/).
- On 15 Sept 2026 Cloudflare changed its defaults again. AI crawlers are now sorted into Training / Agent / Search groups. New ad-monetized domains disallow Training crawlers and block Agent crawlers on ad-bearing pages, while Search stays open — [Crawlora](https://crawlora.net/blog/cloudflare-ai-crawler-block-2026); [luonghongthuan.com](https://luonghongthuan.com/en/blog/cloudflare-ai-crawler-default-block-september-2026/) (secondary sources; I could not reach the primary Cloudflare post for the Sept 2026 change).
- Cloudflare sits in front of about 22.4% of websites (June 2026). About 17% of Cloudflare sites turn on some form of training-crawler blocking, and under 1% block search bots — [indexly.ai](https://indexly.ai/insights/cloudflare-ai-blocking-jun-2026); [joinmassive.com](https://www.joinmassive.com/blog/cloudflare-ai-crawler-defaults) (secondary/vendor sources, so treat the numbers as approximate).
- **Naive conversion plus character truncation is the norm in reference agents.** LangChain's local-deep-researcher fetches with `httpx` (10 s timeout), converts the whole HTML with `markdownify` (no main-content extraction), then cuts at `max_tokens_per_source * 4` characters with "... [truncated]". On any error it falls back to the search snippet — [local-deep-researcher utils.py](https://raw.githubusercontent.com/langchain-ai/local-deep-researcher/main/src/ollama_deep_researcher/utils.py). Because nav, header and cookie text come first in the DOM, a head-truncate of unextracted markdown can use up the budget before the main content starts. This follows from the code; I found no measurement of it.
- **Plain HTML-to-text keeps a lot of boilerplate.** In the trafilatura benchmark, full-text converters inscriptis (precision 0.534, recall 0.991, F1 0.694) and html_text (precision 0.531, F1 0.691) keep almost everything, but about half of their output is boilerplate. Trafilatura scores F1 0.926 — [trafilatura evaluation](https://trafilatura.readthedocs.io/en/latest/evaluation.html).
- **Extraction fails on non-article pages.** WCXB (2,008 pages, 1,613 domains, 7 page types): best F1 is 0.932 on articles but only 0.794 on forums, 0.710 on listings, 0.713 on collections and 0.670 on products. On forums and collections the gap between systems is 20–30 F1 points. Named failure modes: forum comments mistaken for boilerplate; single-node extraction capturing only one card on listings; filter panels mixed in with content; product data that lives only in JSON-LD is invisible to DOM extractors — [WCXB, arXiv 2605.21097](https://arxiv.org/html/2605.21097v1).
- **Readability returns nothing for short pages by design.** Mozilla Readability's `charThreshold` defaults to 500 characters, below which it returns no article. `isProbablyReaderable` (minContentLength 140, minScore 20) is a quick pre-check of whether a page is article-like — [mozilla/readability README](https://github.com/mozilla/readability).
- **Long context lowers accuracy on relevant content placed in the middle.** Liu et al. ("Lost in the Middle", TACL 2023) found a U-shaped curve: QA accuracy is worst when the answer document sits mid-context (tested at about 4k–16k tokens) — [Liu et al.](https://cs.stanford.edu/~nfliu/papers/lost-in-the-middle.arxiv2023.pdf).
- **JS rendering:** Playwright is the usual fallback for rendering. Its default navigation and action timeout is 30 s, and Playwright's own docs discourage `networkidle` as a wait condition — [Scrapfly](https://scrapfly.io/blog/posts/web-scraping-with-playwright-and-python); [ScrapingBee](https://www.scrapingbee.com/blog/playwright-web-scraping/).

### Inferences
- For a local agent, "the page gave nothing" usually means one of three things: (a) an HTTP 403/429/503 or a challenge page from bot protection, (b) a fetch that worked but whose extracted text is empty or tiny (a JS shell, a consent wall, Readability's 500-char floor, or a non-article layout), or (c) usable text that was truncated or buried, so the model found nothing relevant. The fetcher should tell these apart and log which one happened. Signals: status code; challenge markers in the HTML (e.g. "Just a moment", `cf-chl`, `challenge-platform`); extracted length below about 200–500 chars; a high ratio of raw HTML bytes to extracted text.
- A user-triggered local fetch sending an ordinary browser User-Agent is not the same as a declared AI crawler. Even so, CDN bot scoring can still challenge plain `httpx` requests. Sites that block will keep blocking, so the right response is a fast fallback (search snippet), not retries.
- Product and listing pages often hold their facts in JSON-LD (`<script type="application/ld+json">`) and `<meta>` tags. Parsing these is cheap and recovers content that DOM extractors miss (backed by the WCXB failure analysis).

### Gaps
- No reliable sourced figures on what share of pages are JS-only shells, consent-walled (EU cookie banners) or paywalled. No figure for how often a research agent's fetches fail outright.
- No study found that measures how often an LLM wrongly rejects a page as irrelevant when given truncated or boilerplate-heavy input. The link to "lost in the middle" is an inference.
- Could not fetch the primary Cloudflare post for the Sept 2026 default change; details come from secondary blogs.

## Best extraction tools and their quality (trafilatura, Readability, jina reader / ReaderLM, markdownify, newspaper, crawl4ai, headless fallback)

### Takeaway
Use a heuristic main-content extractor, with trafilatura as the default. It is the top or near-top open-source tool on every benchmark found, it is fast, and it runs locally. Readability is the most consistent second opinion. Small neural HTML-to-markdown models (ReaderLM-v2, MinerU-HTML) are slower and worse on non-article pages. markdownify on its own is not an extractor.

### Cited Findings
- **Trafilatura benchmark (990 docs, 2,951 text vs 2,966 boilerplate segments):** trafilatura 2.3.0 F1 0.926 (P 0.906, R 0.946). magic-html 0.889; justext 0.862; readability-lxml 0.853; news-please 0.836; resiliparse 0.811; goose3 0.810 (highest precision, 0.936, but recall 0.713); boilerpy3 0.807; newspaper4k 0.803; inscriptis 0.694; html_text 0.691. Relative speed: resiliparse 0.3x, html_text 0.6x, trafilatura 2.9x, readability-lxml 3.0x, newspaper4k 6.8x, goose3 10.6x, news-please 20.9x. Trafilatura `fast` mode F1 0.920, precision mode 0.922, recall mode 0.919 — [trafilatura evaluation](https://trafilatura.readthedocs.io/en/latest/evaluation.html). (The maintainer runs this benchmark, so there is possible home-team bias.)
- **Zyte/ScrapingHub article benchmark** (181 article pages, token-level F1): Trafilatura 2.0.0 F1 0.958 (P 0.938, R 0.978), Newspaper4k 0.949, Mozilla Readability 0.947, readability-lxml 0.922 — [Contextractor comparison](https://www.contextractor.com/trafilatura-vs-readability-vs-newspaper/); benchmark repo [scrapinghub/article-extraction-benchmark](https://github.com/scrapinghub/article-extraction-benchmark). Go ports: go-trafilatura 0.960, go-readability fork 0.947 — [markusmobius/content-extractor-benchmark](https://github.com/markusmobius/content-extractor-benchmark).
- **Bevendorff et al., SIGIR 2023** (8 datasets combined, 14 extractors): Trafilatura best mean F1 0.883; Readability best median 0.970 and most predictable across page types. A weighted majority-vote ensemble does better than any single tool (mean F1 0.912). "Heuristic extractors perform the best and are most robust across the board, whereas the performance of large neural models is surprisingly bad – especially on the most complex pages." A plain HTML-to-text baseline scored 0.738 — [chuniversiteit summary](https://chuniversiteit.nl/papers/comparison-of-web-content-extraction-algorithms); paper: [ACM DL](https://dl.acm.org/doi/pdf/10.1145/3539618.3591920).
- **Sandia 2024 evaluation:** Trafilatura mean F1 0.937, P 0.978, R 0.92 — [SAND2024-10208](https://www.osti.gov/servlets/purl/2429881).
- **WCXB (2026), multi-type:** dev set F1: rs-trafilatura (hybrid rule+ML, Rust) 0.859, MinerU-HTML (0.6B neural) 0.827, Resiliparse 0.797, Trafilatura 0.791, dom-smoothie 0.762, ReaderLM-v2 (1.5B) 0.741. Held-out test: rs-trafilatura 0.903, Trafilatura 0.841, dom-smoothie 0.817. Speed: heuristics 26–1,825 ms/page; rs-trafilatura 44 ms; MinerU-HTML 1,570 ms (GPU); ReaderLM-v2 10,410 ms (GPU). Neural models did worse than heuristics on 6 of 7 page types. Recommendation: route by page type before extracting — [WCXB](https://arxiv.org/html/2605.21097v1).
- **Trafilatura knobs:** `favor_precision`, `favor_recall`, `fast=True` (skips the readability/jusText fallbacks, roughly 2x faster), `include_comments`, `include_tables`, `output_format="markdown"`, `with_metadata`, `prune_xpath`, plus `baseline()` and `html2txt()` as high-recall last resorts. In standard mode, the readability and jusText fallbacks run automatically when the first result is too short — [trafilatura Python usage](https://trafilatura.readthedocs.io/en/latest/usage-python.html).
- **Jina Reader / ReaderLM-v2:** ReaderLM-v2 is a 1.54B model for HTML to Markdown/JSON, including schema-guided extraction. It can run locally through `transformers` — [Hugging Face model card](https://huggingface.co/jinaai/ReaderLM-v2); [arXiv 2503.01151](https://arxiv.org/html/2503.01151v1). An OSS Reader container exists (`docker pull ghcr.io/jina-ai/reader:oss`, serve at localhost:3000/<url>) — [search summary of jina docs / ghtrends](https://ghtrends.dev/jina-ai/reader/) (I did not verify that the image is still current). The hosted `r.jina.ai` is a paid/hosted API, so it is out of scope here.
- **crawl4ai** (open source, Playwright-based): produces `result.markdown.fit_markdown` via a content filter. `PruningContentFilter` scores nodes by text density, link density and tag importance (threshold ~0.48, fixed or dynamic, `min_word_threshold`). `BM25ContentFilter(user_query, bm25_threshold=1.0)` keeps query-relevant chunks. Pipeline: drop `excluded_tags`, then filter, then fit_markdown — [crawl4ai Fit Markdown docs](https://docs.crawl4ai.com/core/fit-markdown/); [Markdown generation](https://docs.crawl4ai.com/core/markdown-generation/).
- **GPT Researcher** defaults: scraper `bs` (BeautifulSoup) with `newspaper` as an option; `MAX_SCRAPER_WORKERS=15`; `MAX_SEARCH_RESULTS_PER_QUERY=5`; `BROWSE_CHUNK_MAX_LENGTH=8192` chars; `SIMILARITY_THRESHOLD=0.42` for embedding-based context filtering — [GPT Researcher config docs](https://docs.gptr.dev/docs/gpt-researcher/gptr/config).

### Inferences
- A practical local cascade (fastest first): `httpx` GET (browser UA, about 8–10 s timeout) → trafilatura `extract(output_format="markdown", include_tables=True, with_metadata=True)` → if the result is shorter than about 300 chars, try readability (Python `readability-lxml`, or Mozilla Readability via Node) → if still short, parse JSON-LD/meta description and `trafilatura.html2txt()` → only then a headless render (Playwright/crawl4ai) for pages that look like JS shells. Running two extractors and taking the longer or merged result follows the Bevendorff ensemble finding.
- Headless rendering costs seconds per page and needs a Chromium download. Keep it as a capped, rare fallback (e.g. at most 1–2 per run, with a 15 s cap), not the default path.
- ReaderLM-v2 at about 10 s/page on GPU is too slow for a "fast" research loop on a Mac, and it is less accurate than trafilatura on non-article pages.

### Gaps
- No benchmark found that measures extractor behaviour on consent-walled or paywalled pages specifically.
- No Mac (Apple Silicon) timing numbers for trafilatura/Readability/Playwright. The relative speeds above come from other hardware.

## Chunking and relevance selection before the LLM (BM25 / embedding ranking against the query)

### Takeaway
Do not send the first N characters of a page. Split the extracted text into passages, rank them against the sub-question (BM25 is free and instant; a small local embedding model adds semantic matching), and send only the top passages, with the query placed after the document text. Mature agents (GPT Researcher, crawl4ai) already do this kind of filtering.

### Cited Findings
- crawl4ai's `BM25ContentFilter` ranks chunks against `user_query` and keeps those above `bm25_threshold` (default 1.0; higher means fewer chunks), producing a compact `fit_markdown` — [crawl4ai docs](https://docs.crawl4ai.com/core/fit-markdown/).
- GPT Researcher chunks pages (`BROWSE_CHUNK_MAX_LENGTH=8192`) and filters context by embedding similarity (threshold 0.42), falling back to keyword ranking when no embedding key is set — [GPT Researcher config](https://docs.gptr.dev/docs/gpt-researcher/gptr/config).
- Accuracy drops when relevant text sits mid-context (U-shaped curve) — [Liu et al. 2023](https://cs.stanford.edu/~nfliu/papers/lost-in-the-middle.arxiv2023.pdf).
- Anthropic: put long documents at the top and the query at the end ("can improve response quality by up to 30 percent in tests, especially with complex, multidocument inputs"), and wrap each document in `<document>` with `<source>` metadata — [Claude prompting best practices, long-context section](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/long-context-tips).

### Inferences
- Suggested recipe: split on headings/paragraphs into passages of about 150–400 words, with a little overlap. Score with BM25 against the sub-question plus the main question terms (e.g. the `rank_bm25` Python package, or a hand-rolled version; no network needed). Keep the top k (e.g. 4–8 passages, about 1.5–3k tokens per page). Always include the title and the first paragraph, since they usually give the page's claim and date. Optionally re-rank with a small local embedding model if one is already loaded for the LLM runtime.
- If BM25 finds no passage above threshold, that is a useful signal ("page off-topic") and lets the agent skip the LLM call entirely. This saves time and avoids a wasted "nothing relevant" note.

### Gaps
- No head-to-head benchmark found comparing BM25 against embedding passage selection specifically for research-agent note quality or speed.

## Note extraction prompts (per-page structured JSON facts with quotes; search snippets as fallback)

### Takeaway
Extract quotes first, then facts tied to those quotes, in a fixed JSON shape per page. Treat "no relevant facts" as a valid, explicit output. When a fetch or extraction gives nothing, keep the search-result title and snippet as a low-confidence note instead of dropping the source. Reference agents already do this.

### Cited Findings
- Anthropic guidance: "For long document tasks, ask Claude to quote relevant parts of the documents first before carrying out its task. This helps Claude focus on the relevant content and ignore the rest of the document." The example puts quotes in `<quotes>` tags and then derives info from them — [Claude prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/long-context-tips).
- local-deep-researcher falls back to the search snippet when a full-page fetch fails (the fetch function returns `None` on any error) — [utils.py](https://raw.githubusercontent.com/langchain-ai/local-deep-researcher/main/src/ollama_deep_researcher/utils.py).
- GPT Researcher caps per-source summaries at `SUMMARY_TOKEN_LIMIT=700` tokens — [GPT Researcher config](https://docs.gptr.dev/docs/gpt-researcher/gptr/config).
- ReaderLM-v2 and crawl4ai also support schema-guided HTML-to-JSON extraction — [ReaderLM-v2 card](https://huggingface.co/jinaai/ReaderLM-v2); [crawl4ai SDK reference](https://docs.crawl4ai.com/complete-sdk-reference/).

### Inferences
- Suggested per-page output schema: `{"relevant": bool, "facts": [{"claim": str, "quote": str (verbatim, ≤ 300 chars), "date"?: str, "numbers"?: [...]}], "page_date"?: str, "source_type": "primary|secondary|vendor|forum"}`. Cap it at about 5 facts per page to keep outputs short and fast. Checking that each `quote` occurs (after whitespace normalization) in the passages sent is a cheap, local hallucination guard.
- Snippet fallback: store `{title, url, snippet, confidence: "snippet-only"}` so the writer can still cite or discount the source, and so failed pages don't make the run look empty.

### Gaps
- No published evaluation found comparing structured JSON-with-quotes notes against free-text summaries for downstream report accuracy in research agents.

## How many pages to read, in what parallelism, and per-fetch timeouts

### Takeaway
Reference agents read about 5 results per query, fetch in parallel (GPT Researcher uses 15 workers), and use short HTTP timeouts (10 s in local-deep-researcher). Headless browsers default to 30 s, which is too long for a fast loop. Over-fetch a little and use whatever comes back before a deadline.

### Cited Findings
- GPT Researcher: `MAX_SEARCH_RESULTS_PER_QUERY=5`, `MAX_SCRAPER_WORKERS=15` — [GPT Researcher config](https://docs.gptr.dev/docs/gpt-researcher/gptr/config).
- local-deep-researcher: `httpx` timeout 10.0 s per page; snippet fallback on failure — [utils.py](https://raw.githubusercontent.com/langchain-ai/local-deep-researcher/main/src/ollama_deep_researcher/utils.py).
- Playwright defaults to 30 s for navigation and actions; you can override per context (`set_default_timeout`) or per call (`page.goto(url, timeout=...)`) — [Scrapfly Playwright guide](https://scrapfly.io/blog/posts/web-scraping-with-playwright-and-python).
- Extractor cost is small next to network time: heuristic extractors take 26–1,825 ms/page, and rs-trafilatura 44 ms/page — [WCXB](https://arxiv.org/html/2605.21097v1).

### Inferences
- For a fast local loop: fetch the top 5–8 results per sub-question concurrently (about 8–16 total in flight, at most 2–3 per host). Use a connect timeout of about 3–5 s, a total of about 8–10 s, and a response size cap (e.g. 2–5 MB). Proceed once about 3–5 good pages are in, or when a round deadline (e.g. 15–20 s) passes, and cancel the rest. Because some fetches will be blocked or empty, over-fetching by about 1.5–2x is cheaper than retries.
- Skip known-bad types up front (login pages; PDFs unless a PDF path exists; social sites that need JS). Cache results by URL for the run so re-reads cost nothing.
- Since extraction is cheap, run trafilatura and readability in a worker pool off the event loop rather than doing a separate fetch pass for each.

### Gaps
- No published study found on the best number of pages per sub-question for research quality vs latency. The numbers above are defaults from reference implementations, not tuned values.
- No sourced data on per-host rate limits or ban thresholds for a single local user agent.
