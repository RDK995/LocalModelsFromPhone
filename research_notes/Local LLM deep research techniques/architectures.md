# Agent architectures and algorithms of open deep-research systems (local / open-weight focus)

Scope note: the sources below were gathered 2026-10-01 from GitHub READMEs, arXiv abstract pages and official blogs. Several fetches returned only abstracts (not full papers), so some fine-grained details (exact prompt formats, turn caps, per-component ablation tables) are listed under Gaps rather than guessed.

## Q1. What loop designs exist, and what are the strengths/weaknesses of each?

### Takeaway
Six families recur: (a) fixed-loop "query → search → summarize → reflect on gaps → repeat N times" (local-deep-researcher); (b) plan-then-execute with parallel sub-question workers (GPT-Researcher, legacy open_deep_research workflow); (c) supervisor + isolated parallel sub-researchers + single-shot report (open_deep_research); (d) outline/perspective-driven pre-writing (STORM/Co-STORM); (e) single-agent ReAct with an action menu and budget (Jina node-DeepResearch, II-Researcher, MiroThinker, smolagents, Tongyi "ReAct mode"); (f) round-based "workspace reconstruction" with an evolving report as the only memory (IterResearch / WebResearcher, Tongyi "Heavy mode"), optionally with parallel researchers + a synthesis agent. Trained models (Search-R1, R1-Searcher, WebThinker, Tongyi, MiroThinker) bake the ReAct-style loop into weights via RL.

### Cited Findings
**(a) Fixed iterative loop (simplest; built for Ollama)**
- local-deep-researcher: LLM generates a query → web search → LLM summarizes results relevant to topic → reflects on summary to identify knowledge gaps → generates follow-up query → repeat for `MAX_WEB_RESEARCH_LOOPS` (default 3) → final markdown summary with citations to all sources — [langchain-ai/local-deep-researcher](https://github.com/langchain-ai/local-deep-researcher)

**(b) Plan-then-execute / planner + executors**
- GPT-Researcher: "The core idea is to utilize 'planner' and 'execution' agents. The planner generates research questions, while the execution agents gather relevant information"; execution agents crawl in parallel; per-source summaries tracked for citation; aggregated into one report (>2,000 words from 20+ sources) — [assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher)
- GPT-Researcher "Deep Research" mode is a recursive tree-like exploration with configurable depth and breadth; ~5 minutes and ~"$0.4 per research (using o3-mini on 'high' reasoning effort)" — [gpt-researcher](https://github.com/assafelovic/gpt-researcher)
- open_deep_research's legacy "Workflow" implementation was "Plan-and-Execute" with "Sequential Processing" and human-in-the-loop planning — [langchain-ai/open_deep_research](https://github.com/langchain-ai/open_deep_research)

**(c) Supervisor + parallel sub-researchers**
- open_deep_research (LangChain blog) three phases: Scope (clarify with user, then compress chat into "a comprehensive, yet focused research brief"); Research (supervisor delegates independent sub-topics to sub-agents; each runs a tool-calling loop then "a final LLM call to write a detailed answer to the subquestion posed"; supervisor evaluates findings against the brief and spawns more research as needed); Report (single-shot generation from brief + all sub-agent findings) — [LangChain blog: Open Deep Research](https://www.langchain.com/blog/open-deep-research)
- Strength: context isolation; single-agent on multi-topic requests suffered "context clash" as tool feedback accumulated; supervisor "can flexibly choose whether to parallelize research or not" — [LangChain blog](https://www.langchain.com/blog/open-deep-research)
- Weakness: parallel section-writing agents produced disjoint reports ("the section-writing agents were not well coordinated"); so multi-agent was restricted to the research phase only — [LangChain blog](https://www.langchain.com/blog/open-deep-research)
- Conflict: the current README fetch described the repo as emphasizing a "single-agent approach" with the multi-agent supervisor model moved to `src/legacy/`, whereas the blog describes supervisor + sub-agents as the main design — [README](https://github.com/langchain-ai/open_deep_research) vs [blog](https://www.langchain.com/blog/open-deep-research). The summarizer may have mis-characterized the README; verify in `src/open_deep_research/deep_researcher.py` before relying on either description.

**(d) Outline / perspective-driven (STORM, Co-STORM)**
- STORM pre-writing: discovers perspectives "by surveying existing articles from similar topics", then "simulates a conversation between a Wikipedia writer and a topic expert grounded in Internet sources"; then generates an outline, populates it with collected info, and polishes (summary, optional dedup) — [stanford-oval/storm](https://github.com/stanford-oval/storm)
- Co-STORM adds LLM experts, a moderator that poses questions inspired by retrieved info, and a human who can steer; maintains "a dynamic updated mind map" (hierarchical concept structure) — [stanford-oval/storm](https://github.com/stanford-oval/storm)
- Strength: report organization/breadth (see Q6). Weakness noted by expert editors: "source bias transfer" and "inappropriate associations between unrelated facts" — [STORM paper, arXiv 2402.14207](https://arxiv.org/abs/2402.14207)

**(e) Single-agent ReAct with action menu**
- Jina node-DeepResearch actions: search, visit, reflect (generate gap sub-questions), answer, coding; loop `while (tokenUsage < tokenBudget && badAttempts <= maxBadAttempts)`; actions are selectively disabled per step (e.g. no `visit` when no URLs) to avoid repetitive failures — [Jina practical guide](https://jina.ai/news/a-practical-guide-to-implementing-deepsearch-deepresearch/); [jina-ai/node-DeepResearch](https://github.com/jina-ai/node-DeepResearch)
- Jina uses a FIFO gap-question queue instead of recursion: gap questions go to the front, original question to the back, with "a single shared context across all questions" — [Jina guide](https://jina.ai/news/a-practical-guide-to-implementing-deepsearch-deepresearch/)
- II-Researcher: think–act–reflect loop; reasoning model decides search / visit / finalize each step; BAML structured outputs — [Intelligent-Internet/ii-researcher](https://github.com/Intelligent-Internet/ii-researcher)
- MiroThinker: single-agent ReAct; thought–action–observation triplets until the model emits no further action — [MiroThinker arXiv 2511.11793](https://arxiv.org/html/2511.11793v2)
- HF smolagents Open Deep Research: CodeAgent (writes Python actions) with a text browser and file inspector adapted from Magentic-One — [HF blog](https://huggingface.co/blog/open-deep-research)
- Tongyi DeepResearch "ReAct Mode": native Thought–Action–Observation cycle "without specialized prompting" — [Tongyi blog](https://tongyi-agent.github.io/blog/introducing-tongyi-deep-research/)

**(f) Round-based workspace reconstruction (IterResearch / WebResearcher)**
- Reformulates research as an MDP: "agents periodically consolidate findings into evolving reports while maintaining focused workspaces" — [WebResearcher arXiv 2509.13309](https://arxiv.org/abs/2509.13309)
- "replace linear accumulation with iterative synthesis and reconstruction"; evolving report used as memory — [IterResearch arXiv 2511.07327](https://arxiv.org/abs/2511.07327)
- Tongyi "Heavy Mode": each round "the agent reconstructs a streamlined workspace using only the most essential outputs from the previous round"; multiple parallel Research Agents, then a Synthesis Agent "integrates their refined reports and conclusions" — [Tongyi blog](https://tongyi-agent.github.io/blog/introducing-tongyi-deep-research/)

**Interleaved think-search-draft**
- WebThinker: a Deep Web Explorer lets a reasoning model search/navigate when it hits gaps; "seamlessly interleave[s] reasoning, information gathering, and report writing in real time" with write/edit/check tools; trained with iterative online DPO — [WebThinker arXiv 2504.21776](https://arxiv.org/abs/2504.21776)

**RL-trained search-in-reasoning (QA, not report)**
- Search-R1: model generates search queries during step-by-step reasoning with real-time retrieval; retrieved-token masking; simple outcome reward; +41% (Qwen2.5-7B) and +20% (Qwen2.5-3B) over RAG baselines on seven QA datasets — [Search-R1 arXiv 2503.09516](https://arxiv.org/abs/2503.09516)
- R1-Searcher: two-stage outcome-based RL; model autonomously invokes search during reasoning; claims to beat strong RAG baselines including GPT-4o-mini — [R1-Searcher arXiv 2503.05592](https://arxiv.org/abs/2503.05592)

### Inferences
- For a single-model, one-reply-at-a-time Ollama server, "parallel" designs (c, f-Heavy, GPT-Researcher executors) degrade to sequential execution; their remaining benefit is *context isolation* (each sub-question gets a fresh context, returns a compressed answer), not speed.
- Designs (a) and (e) with a fixed action menu are the most robust for small local models because each LLM call is a narrow, schema-constrained decision; open-ended code-writing agents (smolagents) and RL-trained ReAct models assume either a strong model or a specifically fine-tuned one.
- Design (f) is attractive for a long-running local tool because context stays roughly constant per round regardless of depth, and the "evolving report" doubles as a natural streaming artifact for a mobile UI.

### Gaps
- No head-to-head comparison of these loop families on the same local model was found.
- Exact structure of IterResearch's workspace (which fields are kept per round) was not visible in the abstract; the GitHub repo [Chen-GX/IterResearch](https://github.com/Chen-GX/IterResearch) was not fetched.

## Q2. How do the specific projects do it (and do they run on local open-weight models)?

### Takeaway
Ready-made local-first options: local-deep-researcher (Ollama/LM Studio, DuckDuckGo default), GPT-Researcher, STORM (litellm), II-Researcher (LiteLLM), Perplexica (SearxNG + Ollama). Prompted frameworks benchmarked with frontier models: open_deep_research (GPT-4.1/GPT-5/Claude), smolagents (o1), Jina (Gemini by default — not verified here). Open-weight *trained* agents: Tongyi DeepResearch 30B-A3B MoE, MiroThinker 8B/30B/72B, WebThinker (QwQ-32B-class), Search-R1/R1-Searcher (3B/7B, QA only).

### Cited Findings
- local-deep-researcher: Ollama (`OLLAMA_BASE_URL`, `LOCAL_LLM`) and LM Studio; search via DuckDuckGo (default, no key), SearXNG, Tavily, Perplexity; uses structured JSON output per step; small DeepSeek-R1 distills (1.5B/7B) "struggle with JSON generation" so fallbacks exist; 2025-08-06 added tool calling and gpt-oss support: "The gpt-oss models do not support JSON mode in Ollama. Select use_tool_calling" — [local-deep-researcher](https://github.com/langchain-ai/local-deep-researcher)
- open_deep_research: separate model roles (summarization `gpt-4.1-mini`, research/compression/final report `gpt-4.1` defaults); models must support "structured outputs" and "tool calling"; docs mention local models via Ollama; Deep Research Bench RACE: GPT-5 0.4943, GPT-4.1 defaults 0.4309 ($45.98), Claude Sonnet 4 0.4401 ($187.09), submission 0.4344 ($87.83), "#6" on leaderboard at time of writing — [open_deep_research](https://github.com/langchain-ai/open_deep_research)
- GPT-Researcher: planner/executor, parallel crawling, per-source summaries, OpenAI-compatible custom endpoints incl. Ollama — [gpt-researcher](https://github.com/assafelovic/gpt-researcher)
- Jina node-DeepResearch: OpenAI-compatible local LLMs supported, but requires structured output — [node-DeepResearch](https://github.com/jina-ai/node-DeepResearch); Jina says "an agent framework proved unnecessary"; used Vercel AI SDK for provider abstraction; no vector DB because "the number of queries and gap questions is typically in the hundreds" — [Jina guide](https://jina.ai/news/a-practical-guide-to-implementing-deepsearch-deepresearch/)
- HF Open Deep Research: 55.15% GAIA validation (vs Magentic-One ~46%, OpenAI Deep Research 67.36%), tested with GPT-4o/o1 — [HF blog](https://huggingface.co/blog/open-deep-research)
- STORM/Co-STORM: LMs via litellm; retrievers include SearXNG and DuckDuckGoSearchRM (no-key options) — [storm](https://github.com/stanford-oval/storm)
- II-Researcher: any OpenAI-compatible model via LiteLLM incl. self-hosted; search via SerpAPI/Tavily/Jina; scraping via Firecrawl, headless browser, BeautifulSoup etc.; Frames accuracy 84.12% with DeepSeek-R1-0528 — [ii-researcher](https://github.com/Intelligent-Internet/ii-researcher)
- Perplexica: SearxNG + local (Ollama) or cloud LLMs; Speed / Balanced / Quality modes control research depth — [Perplexica DeepWiki](https://deepwiki.com/ItzCrazyKns/Perplexica); [XDA](https://www.xda-developers.com/ran-fully-local-perplexity-alternative-month-never-went-back-cloud/). (Third-party sources; architecture of Quality mode not verified from primary repo.)
- Tongyi DeepResearch: 30.5B total / 3.3B active params per token; 128K context; HLE 32.9, BrowseComp 43.4, xbench-DeepSearch 75; trained CPT → SFT → RL (GRPO); weights and framework open — [arXiv 2510.24701](https://arxiv.org/abs/2510.24701); [Tongyi blog](https://tongyi-agent.github.io/blog/introducing-tongyi-deep-research/)
- MiroThinker v1.0: 8B/30B/72B on Qwen2.5/Qwen3; 256K context; up to 600 tool calls/task; tools = Linux sandbox, Python, Google search + scraping with lightweight LLM extraction; SFT → DPO → GRPO; weights public — [arXiv 2511.11793](https://arxiv.org/html/2511.11793v2). Repo states MiroThinker-1.7 reaches 74.0 BrowseComp / 75.3 BrowseComp-ZH — [MiroMindAI/MiroThinker](https://github.com/MiroMindAI/MiroThinker) (search-snippet only, not fetched)
- WebThinker: augments LRMs (o1/R1-class); NeurIPS 2025; evaluated on GPQA, GAIA, WebWalkerQA, HLE and Glaive report generation — [arXiv 2504.21776](https://arxiv.org/abs/2504.21776)

### Inferences
- Tongyi's 30B-A3B MoE (3.3B active) is the most plausible "trained deep-research model" for a Mac running Ollama (fast per-token due to small active params), but it expects its own ReAct prompt/tool format and Google-style search; a generic chat model driven by a prompted loop (a/e/f) is the lower-risk path.
- MiroThinker's 256K context and 200–600 turn configs assume server-class hardware; on a Mac, budgets must be far smaller.

### Gaps
- Could not verify Ollama-compat of Tongyi/MiroThinker GGUF builds or their tool-call templates.
- MiroFlow framework internals and WebSailor/WebDancer specifics were not fetched.
- No primary-source description of Perplexica's Quality-mode loop.

## Q3. How do they decide when to stop?

### Takeaway
Stopping is almost always a hard budget plus an optional model judgment: fixed loop count (local-deep-researcher), token budget + bad-attempt count with a forced final answer ("beast mode", Jina), supervisor judging findings against the brief (open_deep_research), model emitting no further action (ReAct/MiroThinker) with turn caps, and separate answer-evaluation passes (Jina).

### Cited Findings
- Fixed N loops, default 3 (`MAX_WEB_RESEARCH_LOOPS`) — [local-deep-researcher](https://github.com/langchain-ai/local-deep-researcher)
- Jina: `while (tokenUsage < tokenBudget && badAttempts <= maxBadAttempts)`; at budget/failure limit "beast mode" forces a decisive answer from accumulated knowledge — [Jina guide](https://jina.ai/news/a-practical-guide-to-implementing-deepsearch-deepresearch/)
- Jina evaluates answers on definitiveness, freshness, plurality, completeness and references; "Answer generation and evaluation should not be in the same prompt"; first pick criteria by question type, then evaluate each separately with few-shot examples; a failed evaluation counts as a bad attempt and loop continues — [Jina guide](https://jina.ai/news/a-practical-guide-to-implementing-deepsearch-deepresearch/); [node-DeepResearch](https://github.com/jina-ai/node-DeepResearch)
- open_deep_research supervisor "evaluates findings against the brief and spawns additional research as needed" — [LangChain blog](https://www.langchain.com/blog/open-deep-research)
- MiroThinker iterates "until outputting no further action"; configs like `keep5_max200` cap at 200 turns — [arXiv 2511.11793](https://arxiv.org/html/2511.11793v2); [MiroThinker summary](https://github.com/MiroMindAI/MiroThinker)
- II-Researcher continues "until sufficient evidence accumulates" (model decides to finalize) — [ii-researcher](https://github.com/Intelligent-Internet/ii-researcher)
- GPT-Researcher deep mode is bounded by configured breadth and depth — [gpt-researcher](https://github.com/assafelovic/gpt-researcher)
- IterResearch's RL (EAPO) uses geometric reward discounting "to incentivize efficient exploration", i.e. stopping early is learned for trained models — [arXiv 2511.07327](https://arxiv.org/abs/2511.07327)

### Inferences
- For a local tool with streamed events, combine: hard caps (iterations, wall-clock, tokens, fetched pages) + a separate "is this sufficient / what's missing" reflection call returning a gap list + a guaranteed forced-synthesis step when caps hit (Jina's beast mode), so the reply never ends empty.

### Gaps
- No published measurement of how well small local models self-judge sufficiency (risk of premature stopping) was found.

## Q4. How do they keep context bounded across many steps?

### Takeaway
Techniques: (1) per-source summarization/compression before anything enters the main context (local-deep-researcher, GPT-Researcher, II-Researcher embedding filter + LLM compressor, MiroThinker LLM extraction); (2) sub-agent context isolation with compressed returns (open_deep_research); (3) running summary / periodic summarization (local-deep-researcher's rolling summary, ReSum); (4) recency windows on tool outputs (MiroThinker keep-K=5) plus truncation; (5) round-wise workspace reconstruction around an evolving report (IterResearch/WebResearcher); (6) structured knowledge store of Q/A/refs plus diary, kept in context without a vector DB (Jina).

### Cited Findings
- open_deep_research compresses chat into a brief to avoid "token-bloat from prior messages"; sub-agents "prune their research findings to remove irrelevant tokens" before returning — [LangChain blog](https://www.langchain.com/blog/open-deep-research)
- MiroThinker: retains all thoughts/actions but only the most recent K tool responses (typically K=5), older ones masked; long outputs truncated with "[Result truncated]" — [arXiv 2511.11793](https://arxiv.org/html/2511.11793v2); [MiroThinker repo snippet](https://github.com/MiroMindAI/MiroThinker)
- ReSum: "periodically invoking an external tool to condense interaction histories into compact summaries"; training-free +4.5% over ReAct, +8.2% more with ReSum-GRPO — [arXiv 2509.13313](https://arxiv.org/abs/2509.13313)
- IterResearch: mono-context accumulation causes "context suffocation and noise contamination"; discrete rounds where state holds only essentials; evolving report as memory; scales to 2048 interactions (3.5% → 42.5%) — [arXiv 2511.07327](https://arxiv.org/abs/2511.07327)
- II-Researcher: embedding-based passage filtering, then optional LLM compressor — [ii-researcher](https://github.com/Intelligent-Internet/ii-researcher)
- Jina: knowledge items (question, answer, references), diary of actions, visited URLs, failed attempts all kept in prompt; embedding dedup of queries (jina-embeddings-v3) — [Jina guide](https://jina.ai/news/a-practical-guide-to-implementing-deepsearch-deepresearch/)
- Tongyi lists insufficient context length for long-horizon tasks as a limitation even at 128K — [Tongyi blog](https://tongyi-agent.github.io/blog/introducing-tongyi-deep-research/)

### Inferences
- With a local model at, say, 8–32K effective context, a per-page "extract notes relevant to the question, with URL" call plus an IterResearch-style per-round prompt (question + current report/notes + last action result) keeps every call bounded and is training-free (IterResearch prompting gains were shown on frontier models; see Q6).

### Gaps
- No source quantified the information loss from summarization with small local models.

## Q5. How do they produce the final report and attach citations reliably?

### Takeaway
The dominant pattern is: keep a source registry (URL ↔ note/summary) during research, then do one final synthesis call over compressed findings that is instructed to cite by source ID; avoid parallel section writing. STORM writes against an outline populated per section; WebThinker drafts/edits incrementally with tools.

### Cited Findings
- open_deep_research: final report single-shot from brief + all findings; parallel section writers produced disjoint reports — [LangChain blog](https://www.langchain.com/blog/open-deep-research)
- GPT-Researcher tracks summaries per source "maintaining citation integrity", then aggregates — [gpt-researcher](https://github.com/assafelovic/gpt-researcher)
- local-deep-researcher final markdown summary "with citations to all sources used" (source list accumulated across loops) — [local-deep-researcher](https://github.com/langchain-ai/local-deep-researcher)
- Jina: knowledge items carry references; "References: Citations required" as an evaluation criterion — [node-DeepResearch](https://github.com/jina-ai/node-DeepResearch); Jina distinguishes DeepSearch (concise answer with URL refs) from DeepResearch (long structured report) — [Jina guide](https://jina.ai/news/a-practical-guide-to-implementing-deepsearch-deepresearch/)
- STORM: outline first, then populate with collected information, then polish/dedup — [storm](https://github.com/stanford-oval/storm)
- WebThinker: write/edit/check tools interleaved with reasoning — [arXiv 2504.21776](https://arxiv.org/abs/2504.21776)
- II-Researcher: report builder in basic/advanced formats "with full citations" — [ii-researcher](https://github.com/Intelligent-Internet/ii-researcher)

### Inferences
- For reliability with local models, assign numeric IDs server-side to each fetched source, feed notes as `[n] title — url: notes`, ask the model to cite `[n]`, then validate/strip any `[n]` that doesn't exist and render the reference list deterministically from the registry rather than letting the model write URLs.

### Gaps
- No source reported citation-accuracy measurements for local models.

## Q6. Published ablations on which components matter most

### Takeaway
Concrete evidence: code actions vs JSON (55% vs 33% GAIA, smolagents); context management by periodic synthesis (IterResearch +19.2pp over ReAct as a prompt strategy; ReSum +4.5%); perspective/outline (STORM +25% organization, +10% breadth); query rewriting judged most critical by Jina (qualitative); multi-agent only helps for research, not writing (LangChain, qualitative).

### Cited Findings
- smolagents: JSON-action variant drops GAIA from 55.15% to 33%; code actions use "30% fewer steps" — [HF blog](https://huggingface.co/blog/open-deep-research)
- IterResearch as a prompting strategy on frontier models: "up to 19.2pp over ReAct on long-horizon tasks"; trained: +14.5pp avg across six benchmarks — [arXiv 2511.07327](https://arxiv.org/abs/2511.07327)
- WebResearcher: training data from its paradigm "significantly enhances tool-use capabilities even for traditional mono-contextual methods" — [arXiv 2509.13309](https://arxiv.org/abs/2509.13309)
- ReSum: +4.5% training-free over ReAct; +8.2% further with RL — [arXiv 2509.13313](https://arxiv.org/abs/2509.13313)
- MiroThinker: RL-driven "interactive scaling" gave 8–10 point gains via deeper interaction — [arXiv 2511.11793](https://arxiv.org/html/2511.11793v2)
- STORM vs outline-driven RAG baseline: "25% absolute increase" in articles judged organized, "10%" in breadth — [arXiv 2402.14207](https://arxiv.org/abs/2402.14207)
- Jina: query rewriting "surprisingly important—perhaps one of the most critical elements"; SLMs "probably unsuitable" for query expansion — [Jina guide](https://jina.ai/news/a-practical-guide-to-implementing-deepsearch-deepresearch/)
- open_deep_research: model choice dominates RACE (GPT-4.1 0.4309 → GPT-5 0.4943) — [open_deep_research](https://github.com/langchain-ai/open_deep_research)

### Inferences
- The code-vs-JSON result came with frontier models; with small local models, constrained JSON/tool-call schemas are probably safer than free-form Python actions (and a Bun server shouldn't execute model-written Python anyway).
- The most transferable, training-free wins for a local build: good query generation (several diverse queries per gap, dedup), per-source note extraction, periodic synthesis/workspace reset, and a forced final synthesis.

### Gaps
- No ablation found isolating reflection/gap-finding vs. fixed query lists, or number-of-loops vs. quality, on local models.
- Full-paper ablation tables for WebThinker, Tongyi, IterResearch were not fetched (abstracts only).
