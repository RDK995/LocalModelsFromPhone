# Open-source deep-research agent architectures for local models (as of Oct 2026)

## How do the main OSS projects structure their steps, and which are deterministic vs agentic?

### Takeaway
There are three families: (1) fixed pipelines with a small bounded loop (local-deep-researcher, GPT-Researcher, STORM) — all model calls are narrow, single-purpose JSON/text calls; (2) model-driven ReAct/tool loops with a hard iteration cap (open_deep_research supervisor+sub-agents, Perplexica/Vane, Jan, LearningCircuit local-deep-research "langgraph-agent"); (3) agent-trained models that run long ReAct loops (Tongyi DeepResearch, MiroThinker, WebThinker). Perplexica is the most instructive hybrid: the *outer* loop is a model-driven tool loop, but each "search" tool call internally runs a deterministic sub-pipeline (parallel searches -> pick top 2-3 -> parallel scrape -> parallel chunked per-page extraction).

### Cited Findings
**local-deep-researcher (formerly ollama-deep-researcher, LangChain) — deterministic loop**
- Graph is linear with one conditional edge: generate_query -> web_research -> summarize_sources -> reflect_on_summary -> (route_research: loop back to web_research or) finalize_summary -> END — [graph.py](https://raw.githubusercontent.com/langchain-ai/local-deep-researcher/main/src/ollama_deep_researcher/graph.py)
- Each loop makes 3 LLM calls: query generation, summarization (a single running summary that is updated each loop), and reflection/gap analysis which emits the next query — [graph.py](https://raw.githubusercontent.com/langchain-ai/local-deep-researcher/main/src/ollama_deep_researcher/graph.py)
- Defaults: max_web_research_loops = 3, search_api = DuckDuckGo, llm = llama3.2, fetch_full_page = false — [README](https://raw.githubusercontent.com/langchain-ai/local-deep-researcher/main/README.md)

**GPT-Researcher — deterministic planner/executor**
- "run 'planner' and 'execution' agents, whereas the planner generates questions to research, and the execution agents seek the most related information based on each generated research question." Steps: create task-specific agent -> generate research questions -> for each question, crawler agents scrape in parallel -> summarize with source tracking -> filter/aggregate -> report — [GPTR docs](https://docs.gptr.dev/docs/gpt-researcher/getting-started/introduction)
- A separate "deep research" mode does recursive tree exploration with DEEP_RESEARCH_BREADTH=3, DEEP_RESEARCH_DEPTH=2, DEEP_RESEARCH_CONCURRENCY=4 — [default.py](https://raw.githubusercontent.com/assafelovic/gpt-researcher/master/gpt_researcher/config/variables/default.py)

**STORM (Stanford) — deterministic multi-stage pipeline**
- Pre-writing: perspective discovery (from similar topics) -> simulated writer/expert conversations grounded in search -> outline; Writing: generate full article with citations from outline + references, then polish — [STORM README](https://raw.githubusercontent.com/stanford-oval/storm/main/README.md)
- Explicit model tiering: conv_simulator_lm and question_asker_lm are the small/fast roles; outline_gen_lm, article_gen_lm, article_polish_lm are the large roles — [STORM README](https://raw.githubusercontent.com/stanford-oval/storm/main/README.md)

**open_deep_research (LangChain) — agentic supervisor + ReAct sub-agents**
- Three phases: Scope (clarify + write research brief) -> Research (supervisor delegates to parallel sub-agents, each a tool loop; supervisor judges whether findings cover the brief) -> Write (single-pass final report) — [LangChain blog](https://www.langchain.com/blog/open-deep-research)
- They abandoned parallel section writing: "the reports were disjoint because the section-writing agents were not well coordinated"; writing now happens once after all research — [LangChain blog](https://www.langchain.com/blog/open-deep-research)
- Sub-agents must compress/prune findings before returning, because without compression "the agent was prone to running into context window limits from long, raw tool-call results" — [LangChain blog](https://www.langchain.com/blog/open-deep-research)

**Perplexica (renamed Vane) — model-driven tool loop with deterministic tool internals**
- Researcher loop: each iteration the LLM is streamed with tools; loop breaks when the model emits no tool calls or calls `done`; all tool calls in a turn are executed via `ActionRegistry.executeAll`; results appended as tool messages; chat history limited to last 10 messages — [researcher/index.ts](https://github.com/ItzCrazyKns/Perplexica/blob/master/src/lib/agents/search/researcher/index.ts)
- A `__reasoning_preamble` pseudo-tool is used to stream the model's plan to the UI before acting — [researcher/index.ts](https://github.com/ItzCrazyKns/Perplexica/blob/master/src/lib/agents/search/researcher/index.ts)
- Speed/balanced search tool: runs all queries in parallel against SearxNG, embeds each snippet, keeps those with cosine similarity > 0.5 to the query, de-dupes snippets with similarity > 0.75, returns top 20 — **snippets only, no page fetching** — [baseSearch.ts](https://github.com/ItzCrazyKns/Perplexica/blob/master/src/lib/agents/search/researcher/actions/search/baseSearch.ts)
- Quality search tool: parallel searches -> one LLM "picker" call (structured output, `picked_indices`, max 3, prompt says "Try to pick only one high quality result unless there are diverse perspective") -> skip URLs already read -> scrape picked pages in parallel -> split each page into 4000-char chunks with 500 overlap -> one small extractor call per chunk in parallel producing telegram-style bullet facts ("NEVER summarize or generalize numbers") -> concatenated facts become the page's content — [baseSearch.ts](https://github.com/ItzCrazyKns/Perplexica/blob/master/src/lib/agents/search/researcher/actions/search/baseSearch.ts)

**Jan (Jan-v1-4B) — single-agent MCP tool loop**
- Agent loop with search + scrape MCP tools; default prompt says "use one tool per message" and "call a tool only when needed"; research prompt adds "Never repeat the same tool call with identical parameters" and "All cited URLs in the report must be visited" — [Jan blog](https://www.jan.ai/post/jan-v1-for-research)
- Jan-v1 is a fine-tune of Qwen3-4B-thinking; claims 91.1% SimpleQA — [Jan docs](https://www.jan.ai/docs/desktop/jan-models/jan-v1); [HF model card](https://huggingface.co/janhq/Jan-v1-4B)

**LearningCircuit local-deep-research — multiple strategies, agentic default**
- Strategies include Quick Summary ("30 seconds to 3 minutes"), Detailed Research, a LangGraph Agent (primary; LLM chooses search engines and when to synthesize), Report Generation — [README](https://raw.githubusercontent.com/LearningCircuit/local-deep-research/main/README.md)

**Agent-trained models (Tongyi, MiroThinker, WebThinker) — long ReAct**
- Tongyi DeepResearch-30B-A3B (MoE, ~3B active, 128K ctx) supports plain ReAct and an IterResearch "Heavy" mode where each step sees only "the question, an evolving report serving as compressed memory, and the immediate context from the last interaction" — [Tongyi tech report](https://arxiv.org/html/2510.24701v1); [HF](https://huggingface.co/Alibaba-NLP/Tongyi-DeepResearch-30B-A3B)
- MiroThinker v1.0: 8B/30B/72B, 256K context, trained for up to 600 tool calls per task ("interactive scaling") — [MiroThinker paper](https://arxiv.org/abs/2511.11793); [repo](https://github.com/MiroMindAI/MiroThinker)
- WebThinker: "Autonomous Think-Search-and-Draft" — a reasoning model interleaves thinking, searching and writing report drafts in one trajectory — [summary via MiroThinker search results / Pith](https://pith.science/citations/7e319d34-eb88-4ea9-8c0d-b66320599f98)

### Inferences
- The architecture that both (a) bounds time cleanly and (b) tolerates small models is "deterministic skeleton, small narrow calls": GPT-Researcher, STORM, local-deep-researcher and Perplexica's quality-search internals all fit this. Agentic outer loops appear only where the model is either large (open_deep_research defaults to GPT-4.1) or specifically trained for tool use (Jan-v1, Tongyi, MiroThinker).
- Perplexica's "agent decides *what* to search, pipeline decides *how* to read" split is a useful middle ground if some adaptivity is wanted.
- Agent-trained models (Tongyi 30B-A3B, MiroThinker 8B/30B) are designed for 100–600 tool calls — far beyond a "minutes" budget on a Mac; they fit "leave it running" use, not fast research.

### Gaps
- Jan app's own "research mode" internals (beyond the prompt guidance) and LM Studio research features: no primary source found describing a dedicated pipeline; LM Studio appears to rely on generic MCP tool use.
- WebThinker paper details (budgets, Ollama feasibility) not fetched directly.

## How do they bound runs (iterations, searches, parallelism, timeouts, per-page caps) and how long do they take?

### Takeaway
Bounds are almost always counts, not clocks: loop counts (3 in local-deep-researcher, 3 in GPTR, 2/6/25 in Perplexica, 6 supervisor iterations x 10 tool calls in open_deep_research), results-per-query (1–5), and character/token caps per page. The only explicit wall-clock timeout found in code is open_deep_research's 60 s per-page summarization timeout. Published wall-clock numbers are cloud-model figures (GPTR ~3 min) or broad ranges (LDR 30 s–15 min).

### Cited Findings
- local-deep-researcher: loop continues while `research_loop_count <= max_web_research_loops` (default 3); Tavily max_results=1, DuckDuckGo/SearXNG max_results=3; MAX_TOKENS_PER_SOURCE = 1000 with CHARS_PER_TOKEN = 4 (~4000 chars/source); results de-duplicated — [graph.py / utils](https://raw.githubusercontent.com/langchain-ai/local-deep-researcher/main/src/ollama_deep_researcher/graph.py); [README](https://raw.githubusercontent.com/langchain-ai/local-deep-researcher/main/README.md)
- GPT-Researcher defaults: MAX_ITERATIONS 3, MAX_SEARCH_RESULTS_PER_QUERY 5, MAX_SUBTOPICS 3, BROWSE_CHUNK_MAX_LENGTH 8192, MAX_SCRAPER_WORKERS 15, SUMMARY_TOKEN_LIMIT 700, FAST_TOKEN_LIMIT 3000, SMART_TOKEN_LIMIT 6000, TOTAL_WORDS 1200, SIMILARITY_THRESHOLD 0.42 (embedding filter for context compression) — [default.py](https://raw.githubusercontent.com/assafelovic/gpt-researcher/master/gpt_researcher/config/variables/default.py)
- GPT-Researcher: "aggregates over 20 web sources per research"; "the average research task takes around 3 minutes to complete, and costs ~$0.1" (with gpt-4o-mini/gpt-4o, not local) — [GPTR docs](https://docs.gptr.dev/docs/gpt-researcher/getting-started/introduction)
- open_deep_research defaults: max_concurrent_research_units 5 (up to 20), max_researcher_iterations 6 (supervisor), max_react_tool_calls 10 (per sub-agent), max_structured_output_retries 3, max_content_length 50000 chars per page before summarization, search returns 5 results/query — [configuration.py](https://raw.githubusercontent.com/langchain-ai/open_deep_research/main/src/open_deep_research/configuration.py); [utils.py](https://raw.githubusercontent.com/langchain-ai/open_deep_research/main/src/open_deep_research/utils.py)
- open_deep_research per-page summarization: `asyncio.wait_for(model.ainvoke(...), timeout=60.0)` — [utils.py](https://raw.githubusercontent.com/langchain-ai/open_deep_research/main/src/open_deep_research/utils.py)
- Perplexica: `maxIteration = speed ? 2 : balanced ? 6 : 25`; the prompt is given the current iteration `i` and `maxIteration` so the model can pace itself; quality mode reads at most 3 picked pages per search call; snippet results capped at 20 — [researcher/index.ts](https://github.com/ItzCrazyKns/Perplexica/blob/master/src/lib/agents/search/researcher/index.ts); [baseSearch.ts](https://github.com/ItzCrazyKns/Perplexica/blob/master/src/lib/agents/search/researcher/actions/search/baseSearch.ts)
- A third-party write-up states Perplexica quality_max_iterations default 10 "though some implementations use 25" — [search summary of Perplexica guides](https://joshuaopolko.com/perplexica-self-hosted-guide/); contradicted by current source, which hard-codes 25 — [researcher/index.ts](https://github.com/ItzCrazyKns/Perplexica/blob/master/src/lib/agents/search/researcher/index.ts)
- Tongyi DeepResearch evaluation: max 128 tool invocations per task, 128K context; heavy-mode code default 100 LLM calls — [Tongyi tech report](https://arxiv.org/html/2510.24701v1)
- MiroThinker: up to 600 tool calls, 256K context — [MiroThinker paper](https://arxiv.org/abs/2511.11793)
- LearningCircuit LDR: "Research typically completes in 1-15 minutes depending on strategy"; Quick Summary 30 s–3 min — [README](https://raw.githubusercontent.com/LearningCircuit/local-deep-research/main/README.md)

### Inferences
- None of these projects uses a global wall-clock deadline; time is controlled indirectly via loop count x results x page cap. A design that wants "N seconds" guarantees would need its own deadline layer (per-call timeouts plus a global budget), modelled on open_deep_research's per-page `wait_for` + fall-back-to-raw pattern.
- Per-page caps cluster around 4k chars (local-deep-researcher, Perplexica chunk size) to 8k (GPTR chunk); open_deep_research's 50k-char cap assumes a cloud summarizer with large context.
- Exposing "iteration i of max" to the model (Perplexica) is a cheap way to make an agentic loop converge before the cap.

### Gaps
- No primary source gives measured wall-clock for these tools on Apple Silicon + Ollama. LDR's 1–15 min figure is hardware-unspecified (benchmarks note RTX 3090).

## How many LLM calls per run, and which are small vs big?

### Takeaway
Deterministic pipelines use roughly 5–30 calls, most of them small; the expensive ones are the final synthesis (and in STORM, outline + article + polish). Perplexica quality mode can fan out to dozens of small extractor calls (one per 4000-char chunk per page). Agentic loops add one "big-context" call per iteration because the whole growing history is resent.

### Cited Findings
- local-deep-researcher: 1 initial query call + 3 per loop (search->summarize, reflect) + 1 final = about 3x(loops+1) calls; ~10–13 calls at default 3 loops; summarization is a running summary so input grows modestly — [graph.py](https://raw.githubusercontent.com/langchain-ai/local-deep-researcher/main/src/ollama_deep_researcher/graph.py)
- GPT-Researcher uses three model tiers: FAST_LLM (gpt-4o-mini default; summaries), SMART_LLM (gpt-4.1; report), STRATEGIC_LLM (o4-mini; planning); "We optimize for costs using each only when necessary" — [default.py](https://raw.githubusercontent.com/assafelovic/gpt-researcher/master/gpt_researcher/config/variables/default.py); [GPTR docs](https://docs.gptr.dev/docs/gpt-researcher/getting-started/introduction)
- open_deep_research separates summarization_model (gpt-4.1-mini, per-page), research_model, compression_model and final_report_model (gpt-4.1) — [configuration.py](https://raw.githubusercontent.com/langchain-ai/open_deep_research/main/src/open_deep_research/configuration.py)
- STORM: question_asker/conv_simulator small; outline/article/polish large — [STORM README](https://raw.githubusercontent.com/stanford-oval/storm/main/README.md)
- Perplexica quality search call = 1 picker call + (pages x chunks) extractor calls, all extractor calls run concurrently with `Promise.all`; plus one researcher (tool-choice) call per iteration and a final answer call — [baseSearch.ts](https://github.com/ItzCrazyKns/Perplexica/blob/master/src/lib/agents/search/researcher/actions/search/baseSearch.ts)

### Inferences
- On a single Mac running Ollama, "parallel" small calls are only truly parallel if OLLAMA_NUM_PARALLEL > 1 and memory allows; otherwise they serialize, so Perplexica-style per-chunk fan-out multiplies wall-clock. Capping pages (2–3) and chunks per page matters more locally than in the cloud.
- The pattern every project converges on: small model for query-gen / per-page extract; biggest model only once for final synthesis.

### Gaps
- No project publishes measured call counts or token totals per run for local models.

## What happens when pages yield nothing?

### Takeaway
Fallbacks are mostly "degrade quietly": use raw content or snippets, skip the page, or use a generic fallback query. None of the examined projects implements an explicit "page empty -> re-search" retry; refilling comes only from the next loop/iteration.

### Cited Findings
- open_deep_research: if per-page summarization times out (60 s) or errors, it returns the original (truncated) raw content instead — "Summarization timed out after 60 seconds, returning original content" — [utils.py](https://raw.githubusercontent.com/langchain-ai/open_deep_research/main/src/open_deep_research/utils.py)
- local-deep-researcher: default fetch_full_page=false, i.e. it works from search-result content/snippets by default; if query generation fails JSON/tool parsing it falls back to the query "Tell me more about {research_topic}"; no explicit handling for zero results (empty context flows through) — [README](https://raw.githubusercontent.com/langchain-ai/local-deep-researcher/main/README.md); [graph.py](https://raw.githubusercontent.com/langchain-ai/local-deep-researcher/main/src/ollama_deep_researcher/graph.py)
- Perplexica speed/balanced modes never fetch pages: the SearxNG snippet (or title if snippet empty: `r.content || r.title`) *is* the note; if embedding fails, all snippets are kept with similarity 1 — [baseSearch.ts](https://github.com/ItzCrazyKns/Perplexica/blob/master/src/lib/agents/search/researcher/actions/search/baseSearch.ts)
- Perplexica quality mode: scrape failure -> page silently skipped (`if (!scrapedData) return;`); a failing chunk extraction is logged and skipped; already-read URLs are filtered out of new picks — [baseSearch.ts](https://github.com/ItzCrazyKns/Perplexica/blob/master/src/lib/agents/search/researcher/actions/search/baseSearch.ts)
- GPT-Researcher filters scraped chunks by embedding similarity (SIMILARITY_THRESHOLD 0.42), so irrelevant/empty pages simply contribute nothing — [default.py](https://raw.githubusercontent.com/assafelovic/gpt-researcher/master/gpt_researcher/config/variables/default.py)

### Inferences
- Snippet-as-note is a proven, cheap baseline (Perplexica speed/balanced, local-deep-researcher default). A robust design: always keep snippets as notes, treat full-page reads as enrichment that can fail or time out without losing the source.

### Gaps
- No project found that re-queries specifically because pages were empty; whether that helps on local models is unmeasured.

## Lessons with local models: what breaks and what works?

### Takeaway
Structured output/tool-call formatting is the most-reported failure for small local models; projects cope with JSON-mode/tool-call toggles, retries and fallback values. Small models do fine in narrow fixed roles; open-ended agent loops need either tool-trained models (Jan-v1, Qwen3.x, Tongyi) or strong prompts plus hard caps.

### Cited Findings
- local-deep-researcher: DeepSeek R1 7B/1.5B "struggle with generating required JSON output", triggering fallbacks; gpt-oss lacks JSON mode in Ollama so a `use_tool_calling` switch was added (8/6/25) — [README](https://raw.githubusercontent.com/langchain-ai/local-deep-researcher/main/README.md)
- open_deep_research retries structured outputs up to 3 times by default — [configuration.py](https://raw.githubusercontent.com/langchain-ai/open_deep_research/main/src/open_deep_research/configuration.py)
- Small local models (e.g. gemma3:4b) using prompt-only JSON emitted malformed JSON ~10 times per 1,200 completions/day; Ollama has supported native JSON-schema structured output since 0.5 — [gbrain issue #4863](https://github.com/garrytan/gbrain/issues/4863)
- Local models via LiteLLM sometimes emit tool calls as bare JSON in content rather than structured tool_calls, especially "under large system prompts with tool schemas" — [hermes-agent issue #107125](https://github.com/NousResearch/hermes-agent/issues/107125)
- Jan-v1 with its default prompt produced ~200-word answers with minimal citations vs >1,000 words with a research prompt; prompt rules added against repeating identical tool calls — [Jan blog](https://www.jan.ai/post/jan-v1-for-research)
- LDR langgraph-agent benchmarks with local models: Qwen3.6-27B 95.7% SimpleQA / 77% xbench-DeepSearch; Qwen3.5-9B 91.2% / 59%; gpt-oss-20B 85.4% SimpleQA — [LDR README](https://raw.githubusercontent.com/LearningCircuit/local-deep-research/main/README.md)
- GPT-Researcher's Ollama guide example uses qwen2:1.5b for all three tiers plus nomic-embed-text, with no warnings on context/JSON — [GPTR Ollama docs](https://docs.gptr.dev/docs/gpt-researcher/llms/running-with-ollama)
- LangChain: context blow-up from raw tool results was the main failure in agentic research; fix was compressing per-sub-agent findings — [LangChain blog](https://www.langchain.com/blog/open-deep-research)
- Tongyi Heavy mode keeps context Markovian (question + evolving report + last interaction) to avoid context growth over long runs — [Tongyi tech report](https://arxiv.org/html/2510.24701v1)

### Inferences
- Recommended pattern for a Mac + Ollama "fast" mode: deterministic plan-once -> parallel searches -> pick/rerank (embeddings, no LLM) -> read top 2–3 pages with per-page char cap ~4–8k and per-call timeout -> small per-page extraction using Ollama native JSON schema (with fallback to snippet) -> single synthesis call with the largest available model. Agentic loops only for a slower "deep" mode, with an iteration cap surfaced to the model and history compression.
- Small (<=9B) general models are adequate for query generation and extraction; tool-loop reliability below ~9B depends on a tool-trained model (Jan-v1-4B, Qwen3 family).

### Gaps
- No rigorous, sourced reports of loop behaviour (repeat-search loops) for specific Ollama models were found; evidence is anecdotal/prompt-level (Jan's "never repeat" rule).
- No Apple Silicon timing benchmarks for any of these projects.
