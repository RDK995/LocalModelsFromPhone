# Deep research as a callable tool: interface, orchestration, budgets, failure handling, and evaluation

Context for the reader: target is a Bun/TypeScript server talking to Ollama (one model resident, one reply at a time), with existing `web_search` and page-read tools and step/source events streamed to a mobile app. Replies must never hang on search failure or time limits. Hosted products below are reference points only.

## How existing systems expose deep research as a callable tool or mode (parameters in, artifacts out)

### Takeaway
There are two common shapes. (a) An MCP or function tool that takes little more than `query` (sometimes `depth`/`breadth` numbers, 1–5) and returns a report plus a sources list. (b) A "mode" with a fixed effort preset (Perplexica Speed/Balanced/Quality; OpenAI's dedicated deep-research models). None of the systems reviewed return a calibrated confidence field; sources and citations are the standard trust signal. For a single-model local server, the closest fit is a sub-loop exposed as one tool, `deep_research({question, depth?, max_seconds?})`, returning `{report, sources[], status: complete|partial, stats}`.

### Cited Findings
- GPT-Researcher MCP server (gptr-mcp) exposes the tools `deep_research`, `quick_search` (fast search, results with snippets), `write_report`, `get_research_sources` and `get_research_context`, plus a `research_resource` resource and a `research_query` prompt. It supports STDIO, SSE and Streamable HTTP transports. — [gptr-mcp GitHub](https://github.com/assafelovic/gptr-mcp)
- gptr-mcp documents a deep research call as taking about "30-40 seconds". It requires OpenAI and Tavily keys "or alternative supported retrievers", and its docs do not cover local LLM support. — [gptr-mcp GitHub](https://github.com/assafelovic/gptr-mcp)
- GPT-Researcher's `deep_research` tool takes a single `query` string and returns a dictionary with research status, ID, research context and sources. The advanced `conduct_research` usage adds `depth` ("deep"), `focus_areas` (array) and `timeline`. — [gpt-researcher MCP advanced usage docs](https://github.com/assafelovic/gpt-researcher/blob/master/docs/docs/gpt-researcher/mcp-server/advanced-usage.md) (via search snippet; not fully fetched)
- Another MCP deep-research server takes `query` (required), `depth` (1–5), `breadth` (1–5) and `existingLearnings` (string array of prior findings). This follows the dzhng "deep-research" breadth/depth recursion pattern. — [deep-research-mcp-server listing](https://www.mcpserverfinder.com/servers/ssdeanx/deep-research-mcp-server) (search snippet)
- An Ollama-based MCP deep researcher (mcp-server-ollama-deep-researcher) exposes the number of iterations (`maxLoops`), the LLM model and the search API (Tavily/Perplexity) as parameters. — [Glama listing](https://glama.ai/mcp/servers/Cam10001110101/mcp-server-ollama-deep-researcher) (search snippet)
- OpenAI exposes deep research through the Responses API with dedicated models (`o3-deep-research`, `o4-mini-deep-research`). It recommends `background=true` because runs take "tens of minutes", and `max_tool_calls` to cap cost and latency. Allowed tools are web search, file search (vector stores), code interpreter and remote MCP servers, but MCP servers must offer only a `search`/`fetch` interface. The output includes intermediate items (`web_search_call`, `mcp_tool_call`, `file_search_call`, `code_interpreter_call`) and a final message with inline citations and URL/title annotations. The fetched page also said these models are being deprecated (July 2026 shutdown) and replaced; I did not verify this independently. — [OpenAI deep research guide](https://developers.openai.com/api/docs/guides/deep-research)
- LangChain open_deep_research is a LangGraph graph with phases clarify_with_user → research brief → supervisor → parallel researcher subgraphs → compress → final report. It is configurable through `search_api` (Tavily default; OpenAI native, Anthropic native, None) and `mcp_config`/`mcp_prompt` for MCP tools. — [open_deep_research configuration.py](https://raw.githubusercontent.com/langchain-ai/open_deep_research/main/src/open_deep_research/configuration.py); [Medium overview](https://medium.com/@tuhinsharma121/building-enterprise-deep-research-agents-with-langchains-open-deep-research-63e7cdb80a58)
- LangChain local-deep-researcher (Ollama/LMStudio) runs an IterDRAG-style loop: generate query → web search → summarize → reflect on gaps → new query. `MAX_WEB_RESEARCH_LOOPS` defaults to 3. `SEARCH_API` options are DuckDuckGo (default, no key), SearXNG, Tavily and Perplexity. `FETCH_FULL_PAGE` pulls whole pages instead of snippets. Output is a markdown summary with cited sources. — [local-deep-researcher GitHub](https://github.com/langchain-ai/local-deep-researcher)
- Perplexica (renamed Vane) uses SearXNG and offers Speed, Balanced and Quality modes, which control how many sources are fetched and re-ranked before synthesis. Reported latencies are about 3–5 s, 8–15 s and 20–40 s respectively. — [Perplexica self-hosted guide](https://joshuaopolko.com/perplexica-self-hosted-guide/); [XDA](https://www.xda-developers.com/ran-fully-local-perplexity-alternative-month-never-went-back-cloud/) (secondary sources; latency figures from a blog, not official docs)
- Open WebUI "Deep Research at Home" is a function (pipe). Its valves are `MAX_CYCLES`, `MAX_RESULT_TOKENS` and `COMPRESSION_SETPOINT`. It drafts an outline for user feedback, runs iterative searches with "sliding content windows, progressive truncation, and relevance penalties" for repeats, then writes the report section by section. A run is designed to take 30–60 minutes. It needs a user-supplied search engine (SearXNG recommended), and its defaults target dual RTX 3090s. — [Open WebUI function page](https://openwebui.com/f/radeon/deep_research_at_home)
- Open WebUI can also run GPT-Researcher through a pipe function. Fully local stacks (OpenDeepResearcher-via-searxng, local-deep-research) pair Ollama (e.g. gpt-oss:20b, mistral-small, deepseek-r1:14b) with SearXNG. SearXNG must be configured to output JSON or AI searches return empty. — [Open WebUI discussion #9321](https://github.com/open-webui/open-webui/discussions/9321); [OpenDeepResearcher-via-searxng](https://github.com/benhaotang/OpenDeepResearcher-via-searxng); [servermo guide](https://www.servermo.com/howto/self-hosted-perplexity-open-webui-searxng/)

### Inferences
- A minimal, practical tool contract: input `question` (required), `depth` (enum quick|standard|deep, or 1–3), and `max_seconds`/`max_sources` set by the server rather than the model. Output: `report` (markdown with numbered `[n]` citations), `sources[]` (url, title, snippet used), `status` (complete|partial|failed), `stats` (searches, pages read, elapsed). Inputs follow gptr-mcp/dzhng; outputs follow OpenAI/open_deep_research.
- Because only one Ollama model is resident and one reply runs at a time, the "multi-agent" pattern should become sequential sub-steps run by the same model in fresh, small contexts. Parallel subagents would only queue.
- Return the compressed findings to the chat model, not the raw page dumps. Both open_deep_research (compress step) and Anthropic (subagents as "filters") do this.

### Gaps
- I did not verify the official parameter schemas of Google Gemini Deep Research or Anthropic Research as callable APIs; they are product modes, not documented tools in what I fetched.
- None of the reviewed tools return a numeric confidence score. Any "confidence" field would be our own design.

## When to call deep research vs simple web search; routing and clarification

### Takeaway
Systems route by effort scaling rules embedded in prompts (Anthropic), by an explicit user-chosen mode (Perplexica, ChatGPT), or by a clarify-then-brief front end (OpenAI, open_deep_research, Open WebUI outline review). For a chat LLM tool, the description should say plainly: use `web_search` for single facts or current values, and `deep_research` only for multi-part, comparative or synthesis questions. One optional clarifying question should be asked before the expensive run.

### Cited Findings
- Anthropic embeds scaling rules in the lead agent prompt: simple fact-finding uses 1 agent with 3–10 tool calls, direct comparisons 2–4 subagents with 10–15 calls each, complex research 10+ subagents with divided responsibilities. — [Anthropic engineering](https://www.anthropic.com/engineering/multi-agent-research-system)
- An early Anthropic failure was spawning too many subagents for simple queries. — [Anthropic engineering](https://www.anthropic.com/engineering/multi-agent-research-system)
- OpenAI recommends a three-step flow: a fast model asks clarifying questions, the prompt is rewritten into detailed instructions, then the deep research model runs. — [OpenAI deep research guide](https://developers.openai.com/api/docs/guides/deep-research)
- open_deep_research's `allow_clarification` defaults to True. The clarify_with_user node uses structured output to decide whether to ask a question or go on to write a research brief. — [configuration.py](https://raw.githubusercontent.com/langchain-ai/open_deep_research/main/src/open_deep_research/configuration.py); [Medium](https://medium.com/@tuhinsharma121/building-enterprise-deep-research-agents-with-langchains-open-deep-research-63e7cdb80a58)
- gptr-mcp ships both `quick_search` and `deep_research` so the calling LLM chooses by need. — [gptr-mcp](https://github.com/assafelovic/gptr-mcp)
- DEFT failure analysis: "Failure to Understand Requirements" accounts for 10.55% of failures and "Content Specification Deviation" for 10.73%. This supports a scope/brief step. — [How Far Are We from Genuinely Useful Deep Research Agents? (arXiv 2512.01948)](https://arxiv.org/html/2512.01948v1)

### Inferences
- Give the clarify step a budget of at most one question, and allow skipping it on mobile. If the question is already specific, go straight to the brief. Turning the question into a written brief (sub-questions plus the expected answer shape) is cheap with a local model and reduces drift.
- Router heuristic for the tool description: deep research for "compare/survey/pros-cons/history/all options/state of" questions, or where more than 3 sources are clearly needed. Web search otherwise. Let the user force either mode with a UI toggle, as Perplexica does.

### Gaps
- I found no published measurements of how accurate automatic routing between quick search and deep research is.

## Progress streaming, cancellation, time limits, partial results, and backend failures

### Takeaway
Treat deep research as a long-running job that emits step events (query issued, source found, page read, section drafted). It must check a deadline between steps and always produce a report from whatever it has: either a partial report marked `partial`, or a clear failure message. MCP has a standard progress notification. OpenAI uses background mode plus polling, and Anthropic relies on checkpointing and on telling the agent about tool failures so it can adapt.

### Cited Findings
- MCP progress: the client puts `_meta.progressToken` on the request, and the server may send `notifications/progress` with `progress` (must increase), optional `total` and optional human-readable `message`. Both sides should rate-limit, and notifications must stop after completion. — [MCP spec: progress](https://modelcontextprotocol.io/specification/2025-06-18/basic/utilities/progress)
- OpenAI: background mode is recommended for long runs, with polling and higher client timeouts. Responses expose intermediate tool-call items that a UI can render. — [OpenAI deep research guide](https://developers.openai.com/api/docs/guides/deep-research)
- Anthropic: durable execution with checkpointing so agents resume from where they failed; agents are told about tool failures and adapt; rainbow deployments avoid breaking running agents. — [Anthropic engineering](https://www.anthropic.com/engineering/multi-agent-research-system)
- Open WebUI Deep Research at Home saves research outputs locally as text files and runs through visible stages (outline, cycles, synthesis). — [Open WebUI function page](https://openwebui.com/f/radeon/deep_research_at_home)
- local-deep-researcher keeps all gathered sources in graph state, so a report can be produced from whatever has been collected. — [local-deep-researcher](https://github.com/langchain-ai/local-deep-researcher)

### Inferences
- Map existing step/source events onto research phases: `plan` → `search(query)` → `source(url,title)` → `read(url)` → `note` → `write`. That is the same information MCP progress messages and OpenAI's intermediate items carry.
- Deadline design: one overall budget, e.g. `max_seconds`, with a reserve of about 20–25% kept back for the final write-up. Check before every search or read. Use per-call timeouts on search and page fetch. A failed or empty search counts as one used step, and its "unavailable" step event is emitted. If every backend fails, return `status: failed` with a short explanation the chat model can relay, not an exception. (This extends the M13 guarantee that replies never hang.)
- Cancellation: thread an AbortSignal through search, fetch and the Ollama request (Ollama streaming can be stopped by aborting the HTTP request). On cancel, skip the write-up and return partial notes only if the user asks.
- Since there is one resident model and one reply at a time, deep research holds the model for the whole run. The UI should show elapsed time and budget, and the server should reject or queue concurrent replies.

### Gaps
- I found no source that documents specific partial-result policies (what fraction of budget to reserve for writing). The 20–25% figure is my own suggestion and has not been measured.

## Budgeting: iteration, time and token caps, breadth vs depth, defaults and their effect on quality

### Takeaway
Typical defaults: 3 loops (local-deep-researcher), 6 supervisor iterations × up to 10 tool calls per researcher × 5 concurrent units (open_deep_research), breadth/depth 1–5 (dzhng-style). Token and tool spend strongly predicts quality: about 80% of BrowseComp variance in Anthropic's analysis. Open local models under-search (fewer than 2 calls), so for local models the binding problem is getting the model to search enough, not capping it.

### Cited Findings
- open_deep_research defaults: `max_researcher_iterations` 6, `max_react_tool_calls` 10, `max_concurrent_research_units` 5, `max_structured_output_retries` 3, `max_content_length` 50,000 chars before summarization, `research_model_max_tokens` 10,000, `final_report_model_max_tokens` 10,000, summarization/compression 8,192. — [configuration.py](https://raw.githubusercontent.com/langchain-ai/open_deep_research/main/src/open_deep_research/configuration.py). Note: a secondary source cites a default of 3 for `max_researcher_iterations` ([Medium](https://medium.com/@tuhinsharma121/building-enterprise-deep-research-agents-with-langchains-open-deep-research-63e7cdb80a58)); the current source file says 6.
- local-deep-researcher `MAX_WEB_RESEARCH_LOOPS` default 3. — [GitHub](https://github.com/langchain-ai/local-deep-researcher)
- Anthropic: token usage explains 80% of performance variance on BrowseComp. Agents use about 4× the tokens of chat, and multi-agent systems about 15×. The multi-agent setup (Opus 4 lead plus Sonnet 4 subagents) beat single-agent Opus 4 by 90.2% on internal research evals. Parallel tool calling cut research time by up to 90%. — [Anthropic engineering](https://www.anthropic.com/engineering/multi-agent-research-system)
- BrowseComp-Plus: GPT-5 and o3 average over 20 search calls per query. Open models such as Qwen3-32B make fewer than 2 calls despite prompting, and score 3.49% (BM25) / 10.36% (Qwen3-Embedding-8B) vs GPT-5's 55.90% / 70.12%. A better retriever cuts search calls by 1–3 and raises accuracy. — [BrowseComp-Plus paper](https://arxiv.org/html/2508.06600v1)
- Perplexica modes trade latency (3–5 s / 8–15 s / 20–40 s) for number of sources fetched and re-ranked. — [Perplexica guide](https://joshuaopolko.com/perplexica-self-hosted-guide/)
- OpenAI exposes `max_tool_calls` as the main cost and latency control. — [OpenAI guide](https://developers.openai.com/api/docs/guides/deep-research)

### Inferences
- For a local single model, do not leave "how many searches" to the model. A fixed planner should generate N sub-questions (breadth), and the code should require at least K searches per sub-question (depth), each followed by a gap-reflection step. Stop on the budget or on "no new sources in the last round". This turns the under-searching seen in BrowseComp-Plus into a code-level guarantee.
- Suggested presets (to be tuned with the in-house eval): quick = 3 sub-questions × 1 round, about 2 min; standard = 4 × 2, about 5 min; deep = 6 × 3, about 10–15 min. Cap pages read per round (e.g. 3) and truncate pages (e.g. 8–12k chars, as open_deep_research's 50k-char cap before summarization suggests) to fit local context.
- Retrieval quality is a cheap lever. BrowseComp-Plus shows that a stronger retriever and reranker both raises accuracy and lowers search calls, so reranking fetched results with a local embedding model may help more than extra loops.

### Gaps
- I found no published controlled ablation of breadth vs depth settings on answer quality for local models specifically.

## Known failure modes and mitigations

### Takeaway
The main documented problems are fabricated or mismatched citations, insufficient retrieval, endless searching for sources that do not exist, preferring SEO content farms, redundant searches, and prompt injection from fetched pages. Mitigations: a separate citation/verification pass, source diversity rules, a no-progress stop, detailed per-step task descriptions, and treating page content as untrusted data.

### Cited Findings
- DEFT taxonomy (FINDER benchmark, 100 tasks / 419 checklist items): Generation 38.76%, Retrieval 33.10%, Reasoning 28.14% of failures. The largest single mode is Strategic Content Fabrication at 18.95% (plausible but unsupported content), followed by Insufficient External Information Acquisition 16.30%, Lack of Analytical Depth 11.09% and Verification Mechanism Failure 8.72%. Recommended fixes: closed-loop retrieval with mandatory verification, and post-generation verification. — [arXiv 2512.01948](https://arxiv.org/html/2512.01948v1)
- Citation audits: 3–13% of citation URLs from deep research agents appear never to have existed and 5–18% do not resolve, with deep research agents showing the highest hallucination rates despite more citations ([arXiv 2604.03173](https://arxiv.org/html/2604.03173v1)). Answer engines show 23–47% unsupported claims and 40–68% citation accuracy ([DeepTRACE, arXiv 2509.04499](https://arxiv.org/pdf/2509.04499)). These figures come from search snippets; I did not fetch the full papers.
- Anthropic observed endless searches for nonexistent sources, duplicated work from vague subagent tasks, and a preference for "SEO-optimized content farms over authoritative but less highly-ranked sources". Fixes: detailed task descriptions, start wide then narrow, source-quality heuristics in prompts, and a dedicated CitationAgent pass after research. — [Anthropic engineering](https://www.anthropic.com/engineering/multi-agent-research-system)
- OpenAI warns about prompt injection and data exfiltration in deep research. Its advice: connect only trusted MCP servers, log tool calls, stage public research before private data access, and screen links. "No automated filter can catch every case." — [OpenAI guide](https://developers.openai.com/api/docs/guides/deep-research)
- Local models often fail at structured JSON output. local-deep-researcher has fallbacks, and DeepSeek R1 variants may need tool-calling mode instead of JSON mode. — [local-deep-researcher](https://github.com/langchain-ai/local-deep-researcher)
- Open WebUI Deep Research at Home handles repeated results with relevance penalties and sliding windows. — [Open WebUI function](https://openwebui.com/f/radeon/deep_research_at_home)

### Inferences
- Citation integrity by construction: give each fetched page a server-side ID. The writer may only cite IDs present in the notes store, and the server maps IDs to URLs, so the model never types a URL. Strip any citation whose ID is unknown. Optionally run a cheap entailment check: ask the local model "does passage X support sentence Y?" for each cited sentence.
- Loop guards: dedupe normalized queries and URLs. Stop when a round adds no new domains or URLs. Cap pages read per domain (e.g. at most 2) to avoid leaning on one source.
- Injection: wrap page text in clear delimiters labelled as data. Never let page content trigger tools other than read/search. Do not include private chat history in the research sub-context.
- Use constrained or structured output (Ollama `format` JSON schema) for planner and reflection steps, with a retry cap (open_deep_research uses 3).

### Gaps
- I found no quantitative data on how often prompt injection succeeds against open-weight deep research agents.

## Evaluation: benchmarks, local/offline practicality, citation metrics, local LLM-as-judge, in-house regression

### Takeaway
The most practical offline benchmark is BrowseComp-Plus: fixed corpus of about 100K documents, 830 questions, BM25 or Qwen3-Embedding indexes, open-model scripts via vLLM, and a Qwen3-32B judge option. DeepResearchGym provides a free reproducible search API over ClueWeb22/FineWeb plus LLM-judge report metrics. DeepResearch Bench (RACE for report quality, FACT for citations) is the standard for long-form reports but uses strong judges. For day-to-day work, follow Anthropic: about 20 real queries, a rubric-based LLM judge (factual accuracy, citation accuracy, completeness, source quality, tool efficiency), plus human spot checks.

### Cited Findings
- BrowseComp-Plus: 830 queries (filtered from 1,266 BrowseComp), about 100,195 human-verified documents, evidence and gold document labels with hard negatives. It allows separate evaluation of retriever and agent. Metrics: accuracy, recall, number of search calls, calibration error. Retrievers: BM25 and Qwen3-Embedding (pre-built indexes). Open-model runs via vLLM, Qwen3 and gpt-oss. Requires Java 21 and Python 3.10+. The repo lists Qwen3-32B as judge, while the paper used gpt-4.1 as judge. — [BrowseComp-Plus GitHub](https://github.com/texttron/BrowseComp-Plus); [paper](https://arxiv.org/html/2508.06600v1)
- DeepResearchGym: reproducible search API over ClueWeb22-B English (about 87M docs) and FineWeb CC-MAIN-2024-51 (over 180M docs), under 0.5 s per query. Evaluation extends Researchy Questions with LLM-as-judge metrics for alignment with the user's information need, retrieval faithfulness and report quality. Corpus access must be obtained. — [DeepResearchGym arXiv](https://arxiv.org/html/2505.19253)
- DeepResearch Bench: 100 PhD-level tasks across 22 domains. RACE scores report quality, and FACT measures "effective citations" (average verifiably supported cited statements per task) and "citation accuracy" (precision). o3 Deep Research led FACT with 65.98 factual precision and 76.58 citation reliability, as reported in a secondary summary. — [DeepResearch Bench site](https://deepresearch-bench.github.io/); [arXiv 2506.11763](https://arxiv.org/pdf/2506.11763); [open_deep_research README](https://github.com/langchain-ai/open_deep_research)
- open_deep_research RACE results on DeepResearch Bench: defaults 0.4309, Claude Sonnet 4 0.4401, GPT-5 0.4943. — [open_deep_research GitHub](https://github.com/langchain-ai/open_deep_research)
- FINDER (100 tasks, 419 checklist items) combines RACE, FACT and checklist compliance. — [arXiv 2512.01948](https://arxiv.org/html/2512.01948v1)
- Anthropic's practice: start with about 20 queries from real usage, because early changes have large effects. Use one LLM judge call with a rubric (factual accuracy, citation accuracy, completeness, source quality, tool efficiency) and keep human evaluation for edge cases. — [Anthropic engineering](https://www.anthropic.com/engineering/multi-agent-research-system)

### Inferences
- Local-only plan: (1) Build an in-house regression set of 20–40 questions taken from real app usage, each with a short reference answer and must-mention facts or checklist items (FINDER-style). (2) Record search results and page bodies once into a fixture cache so runs are replayable offline and deterministic. This mirrors the BrowseComp-Plus and DeepResearchGym fixed-corpus idea and fits the existing M13 fake-backend tests. (3) Score automatically: checklist recall, citation validity (every `[n]` maps to a fetched source, which needs no LLM), citation support (local-model entailment per cited sentence, FACT-style precision), number of distinct domains, searches and pages used, wall-clock time, and the `status` distribution. (4) Add fault-injection cases (all backends down, slow backend, timeout mid-write) that must end with a reply. (5) Run a small BrowseComp-Plus subset (e.g. 50–100 questions, BM25 index) as an external sanity check on agentic search ability. Expect low absolute scores for local models given Qwen3-32B's 3–10%.
- LLM-as-judge with a local model: use a model different from, or larger than, the one being tested where VRAM allows (BrowseComp-Plus shows Qwen3-32B used as judge for short-answer matching). Prefer binary or checklist judgments over 1–10 scales, and calibrate on a few human-labelled examples.

### Gaps
- I did not fetch primary sources for GAIA, FRAMES, SimpleQA, xbench or ResearchQA in this session, so I give no figures for them. Of these, SimpleQA (short factual answers) and FRAMES (multi-hop with Wikipedia) are likely the easiest to run offline against a Wikipedia dump, but this is unverified here.
- I found no published study of how well a local judge (e.g. Qwen3-32B) agrees with GPT-4.1 or human judges for deep research reports.
- The citation hallucination figures (2604.03173, DeepTRACE) are from search snippets, not full-text reads.
