# Making deep-research agents work with local open-weight LLMs (Ollama on Apple Silicon)

Scope: open-weight models ~4B–70B (incl. MoE) served by Ollama on a Mac (one model resident, one reply at a time, Bun/TS server on 127.0.0.1:11434). Researched 2026-10-01. Benchmark numbers are vendor-reported unless marked otherwise; vendor agent harnesses (Google search, page-visit tools, Python, 128K–256K context) are far richer than a typical local setup, so treat them as upper bounds.

## 1. Which open-weight models are best for agentic search / deep research, what evidence supports them, and what fits in 16–128 GB?

### Takeaway
The strongest *small-active-parameter* research models are all Qwen3-30B-A3B-family MoEs (~3B active): MiroThinker v1.5-30B / 1.7-mini (BrowseComp ~70%, vendor-reported), Qwen3.5-35B-A3B and Qwen3.5-27B (BrowseComp 61.0), and Tongyi-DeepResearch-30B-A3B (BrowseComp 43.4). They fit in about 20–24 GB at 4-bit, so they suit 32 GB+ Macs. gpt-oss-20b fits in 16 GB but is weak at fact-finding (BrowseComp 1.3% on Kaggle's leaderboard, SimpleQA hallucination 91.4%). All of these vendor scores assume 128K–256K context and agent harnesses built for the purpose.

### Cited Findings
**Tongyi DeepResearch-30B-A3B (Alibaba, Sep 2025)**
- 30.5B total / 3.3B active MoE built on Qwen3-30B-A3B-Base. It has a 128K context, which the report itself calls "insufficient for handling the most complex long-horizon tasks" — [Tongyi DeepResearch Technical Report](https://arxiv.org/html/2510.24701v1)
- Scores: HLE 32.9, BrowseComp 43.4, BrowseComp-ZH 46.7, GAIA 70.9, xbench-DeepSearch 75.0, WebWalkerQA 72.2, FRAMES 90.6. For comparison, DeepSeek-V3.1 gets BrowseComp 30.0 / FRAMES 83.7, GLM-4.5 gets BrowseComp 26.4 / GAIA 66.0, and OpenAI o3 gets BrowseComp 49.7 — [Tongyi report](https://arxiv.org/html/2510.24701v1)
- xbench-DeepSearch-2510 (a later refresh): 55.0. Results dated Sep 16, 2025 — [Tongyi report via search](https://arxiv.org/html/2510.24701v1)
- Tools: Search (Google), Visit (page extraction), Python interpreter, Google Scholar, File Parser. There are two modes: a plain ReAct loop, and a "Heavy" mode that runs several agents in parallel and merges their results — [Tongyi report](https://arxiv.org/html/2510.24701v1)

**MiroThinker (MiroMind)**
- v1.5 comes in 30B and 235B sizes, built on Qwen3-30B-A3B-Thinking-2507 and Qwen3-235B-A22B-Thinking-2507. It has a 256K context and allows up to 400 tool calls per task. The license is listed as MIT on HF search snippets and Apache 2.0 in the GitHub README extraction (unresolved conflict) — [GitHub MiroThinker](https://github.com/MiroMindAI/MiroThinker); [HF model card](https://huggingface.co/miromind-ai/MiroThinker-v1.5-30B)
- v1.5-30B: HLE-Text 39.2, BrowseComp 69.8, BrowseComp-ZH 71.5, GAIA-Val-165 80.8 — [HF model card](https://huggingface.co/miromind-ai/MiroThinker-v1.5-30B). Caveat: the GitHub README extraction attributed identical numbers to the 235B model, so those per-size figures are possibly conflated.
- MiroThinker 1.7: 1.7-mini (30B) scores BrowseComp-ZH 72.3 and GAIA 82.7; 1.7 (235B) scores BrowseComp 74.0, BrowseComp-ZH 75.3 and HLE-Text 42.9. Context management keeps only the 5 most recent tool results, for up to 200–300 turns — [GitHub MiroThinker](https://github.com/MiroMindAI/MiroThinker)
- v1.0 came in 8B/30B/72B sizes. v1.0-30B: BrowseComp 47.1, GAIA 81.9, FRAMES 70.4 — [GitHub MiroThinker](https://github.com/MiroMindAI/MiroThinker)
- Recommended sampling: temperature 1.0, top_p 0.95, repetition_penalty 1.05, max_tokens 16384. The vendor recommends serving with SGLang/vLLM. Community GGUF quantizations exist (listed on HF as usable with llama.cpp, Ollama and LM Studio) — [HF model card](https://huggingface.co/miromind-ai/MiroThinker-v1.5-30B)

**Qwen3.5 (general model with strong search-agent numbers)**
- Search-agent scores for Qwen3.5-35B-A3B / Qwen3.5-27B (dense) / Qwen3.5-122B-A10B:
  - HLE with tools: 47.4 / 48.5 / 47.5
  - BrowseComp: 61.0 / 61.0 / 63.8
  - BrowseComp-ZH: 69.5 / 62.1 / 69.9
  - WideSearch: 57.1 / 61.1 / 60.5
  - Seal-0: 41.4 / 47.2 / 44.1
  
  — [Qwen3.5-35B-A3B model card](https://huggingface.co/Qwen/Qwen3.5-35B-A3B)
- 262,144-token native context. Thinking is on by default; turn it off with `enable_thinking: False` — [Qwen3.5-35B-A3B card](https://huggingface.co/Qwen/Qwen3.5-35B-A3B)
- Qwen's own search agents use "a simple context-folding strategy (256k): once the cumulative Tool Response length reaches a preset threshold, earlier Tool Responses are pruned from the history" — [Qwen3.5-35B-A3B card](https://huggingface.co/Qwen/Qwen3.5-35B-A3B)
- Recommended sampling:
  - Thinking, general: temperature 1.0, top_p 0.95, top_k 20, presence_penalty 1.5
  - Non-thinking: temperature 0.7, top_p 0.8, top_k 20, presence_penalty 1.5
  
  — [Qwen3.5-35B-A3B card](https://huggingface.co/Qwen/Qwen3.5-35B-A3B)

**gpt-oss-20b / 120b (OpenAI, Aug 2025)**
- 20b: 20.9B total / 3.6B active, 12.8 GB checkpoint, "can run on systems with as little as 16GB memory". 120b: 116.8B / 5.1B active, 60.8 GB checkpoint. Both use MXFP4 for the MoE weights, have 131,072-token context and three reasoning levels (low/medium/high) — [gpt-oss model card](https://arxiv.org/html/2508.10925v1)
- Reasoning level matters a lot. AIME 2024 for 20b: 42.1 (low) → 80.0 (medium) → 92.1 (high) — [gpt-oss model card](https://arxiv.org/html/2508.10925v1)
- Tau-Bench Retail (function calling): 120b 67.8, 20b 54.8. HLE without tools: 14.9 / 10.9 — [gpt-oss model card](https://arxiv.org/html/2508.10925v1)
- SimpleQA hallucination rate: 120b 78.2%, 20b 91.4%. PersonQA: 49.1% / 53.2%. In other words, the internal knowledge is weak, so answers must be grounded in retrieved text — [gpt-oss model card](https://arxiv.org/html/2508.10925v1)
- On the BrowseComp leaderboard, gpt-oss-20b scores 1.3% (±0.6) — [Kaggle BrowseComp leaderboard (via search snippet)](https://www.kaggle.com/benchmarks/openai/browsecomp)
- The model requires the "harmony" chat format — [gpt-oss model card](https://arxiv.org/html/2508.10925v1)

**Other families (GLM, Llama, Gemma 3, DeepSeek, Mistral)**
- GLM-4.5 and DeepSeek-V3.1 appear only as comparison rows in the Tongyi report (above). Both are far beyond 128 GB at useful precision (my inference, not sourced).
- I found no 2025–2026 primary-source deep-research benchmarks for Llama, Gemma 3 or Mistral small models in this pass.

### Inferences
- **Memory fit (rule of thumb, not sourced):** Q4_K_M takes roughly 0.55–0.6 bytes per parameter, plus KV cache and OS headroom. macOS by default lets the GPU use only about 65–75% of unified memory.
  - 16 GB Mac: gpt-oss-20b (12.8 GB checkpoint), or ~8B dense models at Q4, with small context.
  - 32 GB: any 30B-A3B / 35B-A3B MoE at Q4 (~18–21 GB), or Qwen3.5-27B dense at Q4 (~16–17 GB), with moderate context.
  - 64 GB: the same models at Q8, or with long context; 70B dense at Q4 (~40 GB) is possible but slow.
  - 96–128 GB: gpt-oss-120b (60.8 GB) or Qwen3.5-122B-A10B at Q4 (~70 GB).
- **Speed vs size:** MoE models with ~3B active parameters generate tokens about as fast as a 3–4B dense model, while having 30B-class knowledge. On a Mac, which is limited by memory bandwidth, that makes them the best fit for long agent loops.
- **Best candidates for a 32–64 GB Mac, by search-agent evidence:** MiroThinker-v1.5-30B or 1.7-mini, Qwen3.5-35B-A3B, Qwen3.5-27B and Tongyi-DR-30B-A3B. The specialist models (MiroThinker, Tongyi) were trained on their own tool schemas and prompt formats. They may lose much of their edge when driven through a generic Ollama `tools` template (see BFCL format-brittleness finding in section 2).
- gpt-oss-20b is the only strong option for 16 GB Macs. Its high hallucination rate means the agent must be forced to cite fetched text.

### Gaps
- No independent (non-vendor) reproduction of MiroThinker/Tongyi/Qwen3.5 BrowseComp scores under local quantization (Q4) was found. The effect of quantization on agentic accuracy is unknown.
- MiroThinker per-size numbers are partly inconsistent between GitHub and HF extractions.
- No SimpleQA/FRAMES numbers were found for Qwen3.5 small models. No BrowseComp numbers were found for Gemma 3, Llama 3.x/4 or Mistral Small.
- Qwen3.5 small dense sizes (≤9B) were not checked.

## 2. How reliable is tool/function calling via Ollama, what are the known issues, and what mitigations work?

### Takeaway
Ollama's native `tools` path has had repeated template and parser bugs for exactly the models of interest. Qwen3 has had malformed tool definitions, plus thinking combined with tools producing empty or corrupted output. gpt-oss has had harmony tool-call parse failures that return HTTP 500. A Bun server should therefore treat tool calls as untrusted. The most robust path is a simple text or JSON protocol in a non-thinking or controlled-thinking turn, enforced with Ollama's `format` JSON schema, then validated and retried.

### Cited Findings
- **Ollama issue #14601 (Ollama 0.17.5, qwen3:8b), still open:** tool definitions passed via `/api/chat` `tools` are rendered using Go's default struct string form instead of JSON. The template engine has no toJson, so this "requires a code change in Ollama's Go source". The template also appends `/think` or `/no_think` text to prompts. Workarounds:
  - put the tool definitions in the system prompt yourself, in Hermes format;
  - use a custom Modelfile.
  
  A second reported bug (prior assistant tool calls stripped from history) was later traced to the client. — [ollama/ollama#14601](https://github.com/ollama/ollama/issues/14601)
- When an assistant turn has thinking plus tool calls but no text, the renderer never closes the `<think>` block. The tool call ends up inside an unclosed think block, "corrupting every subsequent turn" — [search summary of Ollama/Qwen3 issues](https://github.com/ollama/ollama/issues/14601); related: [ollama#10976 "Thinking + tools + qwen3 = empty output"](https://github.com/ollama/ollama/issues/10976), [ollama#11662 qwen3:32b tool issues](https://github.com/ollama/ollama/issues/11662), [ollama#15891 inconsistent tool calling with qwen](https://github.com/ollama/ollama/issues/15891), [ollama#14493 Qwen3.5 27B tool calling non-functional, repetition penalties ignored](https://github.com/ollama/ollama/issues/14493)
- Downstream clients break too: LiteLLM drops qwen3 tool_calls when Ollama returns a `thinking` field, and Home Assistant does not execute tool calls that appear inside thinking content — [BerriAI/litellm#18922](https://github.com/BerriAI/litellm/issues/18922); [home-assistant/core#167154](https://github.com/home-assistant/core/issues/167154)
- gpt-oss in Ollama:
  - harmony tool-call parsing fails during streaming and returns an object keyed "error parsing tool call" (v0.11.3);
  - Ollama returns HTTP 500 for invalid JSON in tool content, and in one case rejects "a tool call its own model generated" (array-wrapped output);
  - the model fails on tool calls in Cline.
  
  — [ollama#11781](https://github.com/ollama/ollama/issues/11781), [ollama#17638](https://github.com/ollama/ollama/issues/17638), [ollama#11800](https://github.com/ollama/ollama/issues/11800), [ollama#11991](https://github.com/ollama/ollama/issues/11991)
- gpt-oss:20b often fails to give strict JSON or schema-compliant output; harmony reasoning traces get in the way of schema parsing. Workarounds are to put the schema in the prompt, parse manually, or reformat with a second pass — [Glukhov blog (community, anecdotal)](https://www.glukhov.org/post/2025/10/ollama-gpt-oss-structured-output-issues/)
- Ollama structured outputs: `format: "json"` or a full JSON schema object. Docs advise to "also pass the JSON schema as a string in the prompt to ground the model's response" and to use temperature 0. The same feature is available through the OpenAI-compatible `response_format`. The docs say nothing about how it interacts with thinking or tools — [Ollama structured outputs docs](https://docs.ollama.com/capabilities/structured-outputs)
- Thinking control in Ollama:
  - `think` takes a bool or a named level ("low"/"medium"/"high") and returns `message.thinking` separately from `message.content`.
  - gpt-oss supports only low/medium/high (default medium) and "cannot be fully disabled".
  - When streaming, thinking tokens arrive before answer tokens.
  
  — [Ollama thinking docs](https://docs.ollama.com/capabilities/thinking)
- BFCL v4 format-sensitivity study:
  - Accuracy is higher when calls are returned as JSON or Python than as XML, and the effect is "particularly pronounced in smaller models".
  - Tool docs work best written as JSON, worse as XML, worst as Python.
  - Adding `<TOOLCALL>` tags hurts small models (Llama-3.1-8B) significantly.
  - Plain text vs Markdown and different instruction phrasings show "no consistent" effect.
  - Some tool-specialised models drop "even to 0" when asked for a different return format.
  
  — [BFCL V4 Format Sensitivity blog](https://gorilla.cs.berkeley.edu/blogs/17_bfcl_v4_prompt_variation.html)

### Inferences
- For a single-model Bun server, the safest design is: make each agent step a constrained JSON decision via Ollama `format` with a JSON schema, e.g. `{action: "search"|"fetch"|"answer", query?, url?, reason}`. Validate it with Zod and retry once or twice with the validation error appended. This avoids model-specific `tools` templates entirely. The BFCL finding that JSON beats XML or tags for small models supports this.
- Keep thinking and the structured decision apart. Either:
  - (a) run the decision with `think: false` on Qwen-family models, or the lowest level on gpt-oss; or
  - (b) let the model think and read only `message.content`, and never parse tool calls out of `thinking`.
  
  When feeding history back, either drop past thinking or close it properly, to avoid the unclosed-`<think>` corruption.
- Specialist models (MiroThinker, Tongyi) expect their own tool formats. If they are used, follow their repo's prompt or tool format verbatim rather than Ollama `tools`, because of BFCL's "drops to 0" brittleness for tool-specialised models.
- Pin the Ollama version and add a regression test per model, because tool-call behaviour has changed between versions (0.11.x gpt-oss bugs, 0.17.5 qwen3 template bug).

### Gaps
- Whether Ollama's `format` grammar enforcement applies to `message.content` only, after thinking, when `think` is on was not confirmed in the docs. Needs a local test.
- No quantitative tool-call success rates for Ollama-served Qwen3.5 / gpt-oss in multi-turn agent loops were found (only issue reports).
- BFCL v4 leaderboard scores for Qwen3.5/gpt-oss specifically were not retrieved. Aggregator snippets about BFCL rankings were unreliable and are omitted.

## 3. Context window management: Ollama defaults and memory cost, KV quantization, flash attention, compressing pages and notes, degradation

### Takeaway
Ollama defaults to a 4096-token context and silently truncates beyond it. You must set `num_ctx` per request, or `OLLAMA_CONTEXT_LENGTH`. Use flash attention plus `OLLAMA_KV_CACHE_TYPE=q8_0` to halve KV memory. Every model degrades as input grows, and distractors hurt most. So keep a small rolling "report/notes" state and prune old tool outputs rather than growing the transcript. Every leading research agent does this (Tongyi Markovian workspace, MiroThinker keeps the last 5 tool results, Qwen prunes old tool responses).

### Cited Findings
- **Ollama defaults:**
  - Default context window: 4096 tokens. Override with `OLLAMA_CONTEXT_LENGTH`, `/set parameter num_ctx`, or `options.num_ctx` per API request.
  - Memory scales with `OLLAMA_NUM_PARALLEL * OLLAMA_CONTEXT_LENGTH`; NUM_PARALLEL defaults to 1.
  
  — [Ollama FAQ](https://docs.ollama.com/faq)
- The Modelfile reference reportedly says num_ctx defaults to 2048, which conflicts with the FAQ's 4096 — [fast.io summary](https://fast.io/resources/ollama-context-window/) (secondary; verify against the installed version)
- **Flash attention:** enabled automatically when supported; force it on with `OLLAMA_FLASH_ATTENTION=1`.
- **KV cache quantization:** `OLLAMA_KV_CACHE_TYPE` = f16 (default), q8_0 ("½ memory, minimal quality loss") or q4_0 ("¼ memory, small-medium precision loss"). It requires flash attention and "Currently a global setting affecting all models" — [Ollama FAQ](https://docs.ollama.com/faq)
- `ollama ps` shows "100% GPU" vs a CPU/GPU split. A split means the model plus context spilled out of GPU memory — [Ollama FAQ](https://docs.ollama.com/faq)
- **Chroma "Context Rot" (Jul 2025):**
  - 18 models (incl. Qwen3) all degrade as input length grows, "even on simple tasks".
  - "Even a single distractor reduces performance"; distractor effects grow with length.
  - On LongMemEval, focused ~300-token prompts beat full ~113K-token prompts by a large margin.
  - Shuffled haystacks scored better than logically ordered ones.
  
  — [Chroma research](https://www.trychroma.com/research/context-rot)
- **How the research agents manage context:**
  - Tongyi: the workspace holds only the question, "an evolving report S_t serving as compressed memory," and the last interaction — [Tongyi report](https://arxiv.org/html/2510.24701v1)
  - MiroThinker 1.7: "Keep 5 most recent" tool results — [GitHub MiroThinker](https://github.com/MiroMindAI/MiroThinker)
  - Qwen3.5 agents: prune earlier tool responses past a threshold — [Qwen3.5 card](https://huggingface.co/Qwen/Qwen3.5-35B-A3B)
  - AgentFold (Alibaba, 2025) proposes proactive context "folding" for long-horizon web agents — [AgentFold arXiv 2510.24699](https://arxiv.org/pdf/2510.24699) (title only; not read in full)

### Inferences
- **Recommended per-request settings for the Bun server:**
  - Always send `options.num_ctx` explicitly, e.g. 16K–32K on 32–64 GB Macs. Keep it identical across calls to the same model: changing num_ctx forces a model reload in Ollama, a widely reported behaviour that I did not verify in a primary source here.
  - Set `OLLAMA_FLASH_ATTENTION=1` and `OLLAMA_KV_CACHE_TYPE=q8_0` at server start.
  - Check `ollama ps` for 100% GPU.
- **Compression pipeline that matches the evidence:**
  1. Fetch the page.
  2. Strip boilerplate and convert to text.
  3. Filter extractively: keep only passages scored relevant to the current sub-question (BM25 or embedding, or ask the LLM to quote lines). This keeps distractors out, per Chroma.
  4. Have the model write a short per-source note with the quote and URL.
  5. Append that to a rolling notes/report state; drop the raw page.
  
  The planner only ever sees the question, the plan, the rolling notes and the last result (Tongyi-style).
- Because small models degrade with length and with distractors, budgets of roughly 2–4K tokens per page excerpt and a capped notes buffer are probably better than using the full 128K–256K window. This is an inference; there is no direct measurement for local small models.

### Gaps
- No measured numbers for KV cache size per token for Qwen3.5-35B-A3B/gpt-oss-20b in Ollama (hybrid attention in Qwen3.5 and sliding-window attention in gpt-oss should make KV cheaper than dense attention; not verified).
- Ollama's newer versions may set default context based on available memory; the FAQ fetched today still says 4096. Verify against the installed version.
- No source quantified long-context degradation specifically for 4–30B local models at Q4.

## 4. One model for all roles vs separate planner/reader/writer models when only one can be resident

### Takeaway
I found no primary-source measurements of Ollama model-swap cost. Ollama keeps a model loaded for 5 minutes by default, and `keep_alive` can pin it. The leading open research agents (Tongyi, MiroThinker, Qwen3.5) each use one model for every role, varying only the prompt and context. Given one resident model, use one model with role-specific prompts and settings, such as thinking on or off and different output caps.

### Cited Findings
- Default keep_alive is 5 minutes. It accepts durations, seconds, negative values (forever) or 0 (unload now). Preload with an empty generate request — [Ollama FAQ](https://docs.ollama.com/faq)
- `OLLAMA_MAX_LOADED_MODELS` defaults to 3× GPU count (3 for CPU) — [Ollama FAQ](https://docs.ollama.com/faq)
- Tongyi and MiroThinker run every role (planning, search, reading, synthesis) inside one model's ReAct loop. Tongyi's "Heavy" mode adds parallel instances of the same model plus a synthesis step — [Tongyi report](https://arxiv.org/html/2510.24701v1); [GitHub MiroThinker](https://github.com/MiroMindAI/MiroThinker)

### Inferences
- **Swap cost (inference, not sourced):** loading means reading 12–60 GB of weights from SSD into unified memory. That likely costs several seconds to tens of seconds per swap, and it also destroys the prompt cache. Per-step swaps between planner and reader would dominate run time.
- **Practical pattern:** one model with `keep_alive: -1` (or a long duration) during a research run. Vary the role through:
  - the system prompt;
  - the `think` setting: on or high for planning and final synthesis, off or low for per-page extraction;
  - `format` schemas;
  - `num_predict` caps.
  
  Keep `num_ctx` constant to avoid reloads.
- A separate small embedding model for extractive filtering would also need to be resident. Use it only if memory allows two models; otherwise use BM25 or lexical filtering in TypeScript.

### Gaps
- No measured model load times for Ollama on Apple Silicon. No measured penalty from reloads caused by `num_ctx` changes.
- No study comparing single-model vs multi-model role splits for local deep research.

## 5. Throughput and latency on M-series chips; how long a run takes; speed tricks

### Takeaway
On a Mac, prompt processing (prefill) is the bottleneck for agent loops that re-read long contexts. Even an M4 Max prefills only about 900 tok/s on a 7B Q4 model, versus about 83 tok/s generation. A 30K-token context therefore costs about 30+ seconds to prefill from cold. Reusing the cached prefix (stable prompt prefix, same model, same num_ctx, keep_alive) and short per-step prompts matter more than generation speed. Reasoning level or `think` control is the other big lever.

### Cited Findings
- **llama.cpp Apple Silicon benchmark, LLaMA 7B Q4_0:**

  | Chip | Bandwidth | Prompt processing (pp512) | Generation (tg128) |
  |---|---|---|---|
  | M1 Pro | 200 GB/s | 266 tok/s | 36 tok/s |
  | M2 Max | 400 GB/s | 671 tok/s | 66 tok/s |
  | M3 Max | 300 GB/s | 760 tok/s | 66 tok/s |
  | M4 Max | 546 GB/s | 886 tok/s | 83 tok/s |
  | M2 Ultra | 800 GB/s | 1238 tok/s | 94 tok/s |
  | M3 Ultra | 800 GB/s | 1471 tok/s | 92 tok/s |

  Prompt processing scales with GPU cores; generation scales with memory bandwidth — [llama.cpp discussion #4167](https://github.com/ggml-org/llama.cpp/discussions/4167)
- **Community/aggregator estimates (anecdotal):** Qwen3 30B-A3B at "15-30 tok/s on M4 Max" and Qwen3.5-35B-A3B at "64-92 tok/s" on M4 Max. These estimates conflict with each other, and sound MoE theory (3B active) suggests the higher range — [markaicode benchmark pages (via search)](https://markaicode.com/benchmarks/llamacpp-qwen-3-m4-max-throughput-benchmark/)
- **gpt-oss reasoning levels** trade output length for accuracy (AIME 20b: 42.1/80.0/92.1 for low/medium/high). Ollama exposes them via `think: "low"|"medium"|"high"` — [gpt-oss model card](https://arxiv.org/html/2508.10925v1); [Ollama thinking docs](https://docs.ollama.com/capabilities/thinking)
- **Run-length scale in vendor setups:** MiroThinker v1.5 allows up to 400 tool calls per task (the demo caps at 100); 1.7 runs 200–300 turns — [HF card](https://huggingface.co/miromind-ai/MiroThinker-v1.5-30B); [GitHub](https://github.com/MiroMindAI/MiroThinker)

### Inferences
- **Back-of-envelope local run time** (inference): a modest run of 15 steps, where each step prefills about 6K new tokens (rolling notes plus a page excerpt) and generates about 800 tokens (thinking plus decision), on an M4 Max with a 3B-active MoE. Assume prefill around 1–2K tok/s (MoE active-parameter cost is similar to a 3–4B dense model) and generation around 60 tok/s. That is roughly 4–6 s prefill plus about 13 s generation per step, or about 5 minutes total, plus fetch time.
- Long thinking traces dominate. Use high reasoning only for planning and final synthesis.
- On M1/M2 Pro-class machines, expect 2–4× slower.
- **Tricks:**
  - Keep a byte-stable system prompt and tool description first, so the llama.cpp prefix KV cache in Ollama can be reused across calls with the same model.
  - Append rather than rewrite earlier context where feasible. Rolling summaries that rewrite the top of the prompt invalidate the cache, which is a real trade-off against compression.
  - Cap `num_predict`.
  - Pin with `keep_alive`.
  - Avoid changing `num_ctx`.

### Gaps
- No reliable primary measurements of prefill tok/s for Qwen3.5-35B-A3B, gpt-oss-20b or MiroThinker-30B under Ollama on specific M-series chips. The aggregator numbers conflict.
- No published wall-clock times for a full local deep-research run.
- Ollama prompt-prefix cache semantics (when it is reused or invalidated) are not documented in the pages fetched.

## 6. Prompting techniques that matter more for small models

### Takeaway
The direct evidence is thin. What exists points to:
- JSON (not XML or custom tags) for tool docs and calls;
- small focused contexts free of distractors;
- following the model's own recommended sampling and tool format;
- explicitly bounded steps (as the research-agent designs do).

### Cited Findings
- Small models lose the most when asked to emit XML or tagged call formats; JSON is best for both tool docs and outputs. Plain text vs Markdown and different phrasings make no consistent difference — [BFCL V4 Format Sensitivity](https://gorilla.cs.berkeley.edu/blogs/17_bfcl_v4_prompt_variation.html)
- Focused, distractor-free prompts greatly outperform long, noisy ones — [Chroma Context Rot](https://www.trychroma.com/research/context-rot)
- Include the JSON schema in the prompt as well as in `format`, and use temperature 0 for structured steps — [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs)
- Model-specific sampling matters. Qwen3.5 recommends presence_penalty 1.5 for general thinking or non-thinking use; MiroThinker recommends repetition_penalty 1.05 at temperature 1.0 — [Qwen3.5 card](https://huggingface.co/Qwen/Qwen3.5-35B-A3B); [MiroThinker card](https://huggingface.co/miromind-ai/MiroThinker-v1.5-30B)
- Caveat: Ollama issue #14493 reports repetition penalties "silently ignored" for Qwen3.5 27B — [ollama#14493](https://github.com/ollama/ollama/issues/14493)
- Tongyi "Heavy" mode (several parallel attempts plus synthesis) improves results at extra compute cost. This is a form of self-consistency — [Tongyi report](https://arxiv.org/html/2510.24701v1)

### Inferences
- **Decomposition for a single local model:**
  1. Plan: produce a list of 3–6 sub-questions (JSON).
  2. For each sub-question: search, pick URLs (JSON), fetch, and extract quotes relevant to that sub-question (JSON with verbatim quote and URL).
  3. Check: "is the sub-question answered? yes/no + missing" (JSON).
  4. Write the final answer from the notes only, with citations.
  
  Each call is small, single-purpose and schema-constrained, which plays to the small-model strengths shown above.
- A short few-shot example of the exact JSON per step is cheap and probably helps template adherence. There is no direct citation for this.
- Self-check works best as a separate short call over the notes, such as "does every claim have a quote?". Re-reading the long transcript dilutes attention, per Chroma.

### Gaps
- No 2025–2026 controlled studies were found on few-shot vs zero-shot or step templates for ≤30B models in research agents specifically.
- The effect of the repetition- or presence-penalty bug in Ollama on agent loops (looping or repeated searches) is unquantified.
