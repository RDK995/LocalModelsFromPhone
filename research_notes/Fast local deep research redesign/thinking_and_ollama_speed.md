# Making qwen3.5:35b-a3b on Ollama (Apple Silicon) fast enough for an ~8-minute agentic research loop

Context from the assignment: about 45 tok/s generation, thinking on, num_ctx 32768. The planning call took 1:54 and each tool-choice call took 40–100 s.
Back-of-envelope (inference): at 45 tok/s, 1:54 is about 5,100 generated tokens, and 40–100 s is about 1,800–4,500 tokens per tool step. Almost all of that is hidden thinking. Decode speed is therefore the second-order lever. The first-order lever is how many tokens each call generates.

## 1. Thinking on vs off for tool calling / agentic loops

### Takeaway
Thinking measurably improves tool-use benchmark scores for Qwen3-family models, by roughly 8–13 points on BFCL/tau-bench in third-party measurements of Qwen3-8B/32B. It also multiplies latency by thousands of tokens per call. Thinking can be switched per request in Ollama (`think: false` / `true` on `/api/chat`), so a hybrid works: think for planning and the final report, no thinking for routine tool or search steps. Qwen3.5 does NOT honour the Qwen3 `/think` / `/no_think` soft switch.

### Cited Findings
- Qwen3.5 thinks by default, emitting `<think>...</think>` before the answer. Thinking is disabled through `enable_thinking: False` in `chat_template_kwargs`. Quote: "Qwen3.5 does not officially support the soft switch of Qwen3, i.e., `/think` and `/nothink`." — [Qwen/Qwen3.5-35B-A3B model card](https://huggingface.co/Qwen/Qwen3.5-35B-A3B)
- Model-card agent scores for Qwen3.5-35B-A3B (thinking mode, the default): BFCL-V4 67.3, TAU2-Bench 81.2, VITA-Bench 31.9, DeepPlanning 22.8. The card gives no non-thinking agent scores. — [Qwen3.5-35B-A3B model card](https://huggingface.co/Qwen/Qwen3.5-35B-A3B)
- The model card's multi-turn guidance: "Historical model output should only include the final output part and does not need to include the thinking content." In other words, don't feed past thinking back into the prompt. That keeps the context small and prefill cheap. — [Qwen3.5-35B-A3B model card](https://huggingface.co/Qwen/Qwen3.5-35B-A3B)
- Recommended sampling parameters on the model card:
  - Thinking, general: temp 1.0, top_p 0.95, top_k 20, presence_penalty 1.5.
  - Thinking, precise coding: temp 0.6, top_p 0.95, top_k 20, presence_penalty 0.
  - Non-thinking, general: temp 0.7, top_p 0.8, top_k 20, presence_penalty 1.5.
  - Non-thinking, reasoning: temp 1.0, top_p 1.0, top_k 40, presence_penalty 2.0.
  — [Qwen3.5-35B-A3B model card](https://huggingface.co/Qwen/Qwen3.5-35B-A3B)
- The model card recommends an output length of 32,768 tokens for most queries (81,920 for very complex ones). Read this as a sign of how long thinking can run when unconstrained. — [Qwen3.5-35B-A3B model card](https://huggingface.co/Qwen/Qwen3.5-35B-A3B)
- Third-party measurements of Qwen3 thinking vs non-thinking on tool use (secondary citation; the Klear-AgentForge paper reports them as baselines):

  | Model | Mode | BFCL v3 | tau-bench Retail | tau-bench Airline |
  |---|---|---|---|---|
  | Qwen3-32B | Thinking | 70.4 | 48.7 | 28.0 |
  | Qwen3-32B | Non-thinking | 62.8 | 40.0 | 20.0 |
  | Qwen3-8B | Thinking | 68.2 | 45.2 | 25.0 |
  | Qwen3-8B | Non-thinking | 59.8 | 35.7 | 12.0 |

  — [Klear-AgentForge, arXiv 2511.05951](https://arxiv.org/pdf/2511.05951) (not verified against the PDF text; taken from the search summary)
- Practitioner guidance (not an official Qwen statement): non-thinking mode gives "faster, more predictable results for agent tasks" because the model "stops second-guessing itself". For llama.cpp the setting is `--chat-template-kwargs '{"enable_thinking":false}'`. — [Unsloth Qwen3.5 run guide](https://unsloth.ai/docs/models/qwen3.5); [buildmvpfast blog](https://www.buildmvpfast.com/blog/qwen-3-5-non-thinking-mode-local-agent-deployment-stable-2026) (low-authority blog)
- How Ollama's `think` field works on chat and generate requests:
  - `true`: thinking on.
  - `false`: no thinking, "if the model permits it".
  - `null`: the model's default.
  - A string: a named level from the model's `thinking.values`, discoverable via `/api/show`. Numbers are not supported.
  - Thinking comes back in `message.thinking`, separate from `message.content`.
  — [Ollama docs: Thinking](https://docs.ollama.com/capabilities/thinking)
- Bug: `/api/generate` ignored `think=false` for qwen3.5 (passed in options). Thinking then consumed the whole num_predict and the response was empty. `/api/chat` with top-level `think: false` worked. — [ollama#14793](https://github.com/ollama/ollama/issues/14793)
- There is a feature request to set `PARAMETER think false` in a Modelfile for Qwen 3.5. This implies the per-request API field is the supported control path. — [ollama#14809](https://github.com/ollama/ollama/issues/14809)
- Downstream frameworks have hit cases where qwen3.5 on Ollama "always think[s]" despite `think: false` being configured, because the flag was not actually forwarded. — [openclaw#71088](https://github.com/openclaw/openclaw/issues/71088); [hindsight#1098](https://github.com/vectorize-io/hindsight/issues/1098)

### Inferences
- **Per-call switching is possible and cheap.** `think` is a per-request field and does not reload the model. A plan-with-thinking, act-without-thinking, write-with-thinking pattern is feasible. The quality cost of no-thinking falls mostly on multi-step decisions (tau-bench-style). Producing a search query or picking the next URL is closer to single-shot BFCL-style calls, where the gap is smaller in absolute terms.
- **Use `/api/chat` with top-level `think: false`**, not `/api/generate` and not `options.think`. Verify by checking that `message.thinking` is empty.
- **Thinking-mode tool calls need to show up in `tool_calls`.** At 45 tok/s, a 300-token non-thinking tool call takes about 7 s; a 3,000-token thinking call takes about 67 s. That matches the observed 40–100 s.
- Qwen3.5 has no official "low / medium / high" thinking levels on its model card. Whether Ollama exposes string levels for qwen3.5 must be checked with `/api/show` (the `thinking.values` field).

### Gaps
- I found no official Qwen benchmark comparing thinking vs non-thinking for Qwen3.5-35B-A3B specifically on tool use or search-query quality.
- I found no evidence on report-writing quality with thinking on vs off for this model.
- I could not extract the Qwen3 technical report's thinking-mode tables (the PDF did not parse).

## 2. Ways to cap thinking (budgets, num_predict) and their risks

### Takeaway
Ollama has no thinking-token budget parameter. `num_predict` caps thinking and answer tokens together, so with thinking on it can truncate the answer to nothing. llama.cpp (not Ollama) has a real `--reasoning-budget` that forces the end of thinking, plus per-request budget fields in recent builds. That is how Qwen's own "thinking budget" idea works.

### Cited Findings
- `num_predict` interaction: with qwen3.5, thinking tokens can "consume the entire num_predict budget, resulting in an empty response field". — [ollama#14793](https://github.com/ollama/ollama/issues/14793)
- The Ollama `think` field accepts only booleans or named string levels, not numbers. There is no numeric budget. — [Ollama docs: Thinking](https://docs.ollama.com/capabilities/thinking)
- llama.cpp `--reasoning-budget 0` disables thinking for Qwen3, QwQ and the DeepSeek R1 distills. — [Olivier Chafik (llama.cpp maintainer) on X](https://x.com/ochafik/status/1927043808501387703)
- Newer llama.cpp builds have a sampler that counts reasoning tokens and forces termination at the budget. The OpenAI-compatible server reads `reasoning_budget_tokens` and `reasoning_budget_message` per request, reportedly since build b9982 (July 2026). — [Jason Vs The Noise, llama.cpp b9982 note](https://jasonvsthenoise.com/repowatch/2026-07-13-llama-cpp-reasoning-budget-per-request/); [aihaven summary](https://aihaven.com/news/llama-cpp-reasoning-budget-update/) (secondary sources)
- Example practitioner config: `--reasoning-budget 4096 --reasoning-budget-message "... I am thinking for too long -- let me gather more info about the task."` — [Michael Guo on X](https://x.com/Michaelzsguo/status/2089428942973173932)
- Badly tuned budgets can hurt accuracy. One write-up cites HumanEval dropping from 94% to 78%. — [aihaven summary](https://aihaven.com/news/llama-cpp-reasoning-budget-update/) (secondary; original measurement not located)
- Two-phase pattern used with Qwen3 on Ollama: (1) let the model think freely; (2) make a second call with that thinking pre-filled and a structured format enforced. — [Medium: Ollama + Qwen3 reasoning + structured output](https://medium.com/@maganuriyev/ollama-on-cpu-qwen3-with-reasoning-structured-output-to-solve-any-nlp-problem-4e6d5bd2b7a7)

### Inferences
- **A DIY budget in Ollama.** Stream with `think: true` and count `message.thinking` chunks. At N tokens, abort the stream and re-issue the request with `think: false`, adding the partial thinking (or a short summary) to the prompt as context. Prefix caching (section 3) keeps the re-issue's prefill cheap. This mimics llama.cpp's forced end of thinking without a server patch.
- **A wall-clock budget is the simplest guard.** Abort any thinking call after about 20–30 s (roughly 900–1,350 tokens at 45 tok/s) and fall back to a non-thinking retry. Never rely on `num_predict` alone when thinking is on.

### Gaps
- I found no Ollama release notes confirming a native thinking-budget option as of 0.32.
- I found no measurements of Qwen3.5-35B-A3B quality as a function of thinking budget.

## 3. Ollama performance knobs on Mac (num_ctx, keep_alive, parallel, flash attention, KV quantization, prefix caching, backend)

### Takeaway
The largest single speed lever is the inference engine. Ollama ≥0.19 (preview) and ≥0.30 (default) run MLX on Apple Silicon. On Qwen3.5-35B-A3B, Ollama measured about 2x the decode speed (58 → 112 tok/s) and about 1.6x the prefill speed. The default `qwen3.5:35b-a3b` tag is GGUF, though. The observed 45 tok/s matches the GGUF / llama.cpp path (about 42 tok/s measured on an M4 Max). MLX tags are separate: `-nvfp4`, `-mxfp8`, `-mlx-bf16`.

Changing num_ctx forces a model reload, so pick one value and keep it fixed. OLLAMA_NUM_PARALLEL does not batch on the default path; it only makes room for concurrent slots. Prefix and KV cache reuse improved in 0.30.x.

### Cited Findings
- **MLX backend.**
  - The Ollama 0.19 preview (March 2026) runs Apple Silicon inference on MLX.
  - On an M5 Max with Qwen3.5-35B-A3B NVFP4, prefill went from 1,154 to 1,810 tok/s and decode from 58 to 112 tok/s compared with Ollama 0.18. With int4: 1,851 tok/s prefill and 134 tok/s decode.
  - Requires a Mac with more than 32 GB of unified memory.
  - Cache changes: cache reuse across conversations, "intelligent checkpoints" at prompt locations, and smarter eviction so shared prefixes survive longer.
  — [Ollama blog: MLX](https://ollama.com/blog/mlx)
- **Version history (secondary source).**
  - v0.30.0 (13 May 2026) made MLX the default on Apple Silicon Macs with 32 GB or more. Below that it silently falls back to llama.cpp Metal.
  - v0.30.8 improved prompt caching so that multi-turn follow-ups reuse unchanged prefixes instead of reprocessing the whole history.
  - Speculative decoding arrived in v0.30.5.
  — [runaihome: Ollama v0.30 MLX stable](https://runaihome.com/blog/ollama-v030-mlx-stable-upgrade-2026/) (secondary; not checked against release notes)
- **Tags.** `qwen3.5:35b-a3b` is the "Standard" 24 GB tag (same size as `-q4_K_M`; GGUF). MLX-format tags are `qwen3.5:35b-a3b-nvfp4` (22 GB), `-mxfp8` (37 GB), `-mlx-bf16` (70 GB) and `qwen3.5:35b-mlx` (22 GB). All have a 256K context. — [ollama.com/library/qwen3.5/tags](https://ollama.com/library/qwen3.5/tags)
- **Engine comparison on M4 Max 128 GB, Qwen3.5-35B-A3B decode:**
  - Ollama (Q4_K_M): about 42 tok/s.
  - llama.cpp (Unsloth Q4_K_XL): about 68 tok/s.
  - MLX Python: 113–124 tok/s.
  - MLX over HTTP: 84–108 tok/s.
  - "No measurable speed difference" between thinking and non-thinking per token.
  - Context size did not affect generation speed with short prompts.
  — [Kapetanovic: Ollama vs llama.cpp vs MLX with Qwen3.5 35B](https://antekapetanovic.com/blog/qwen3.5-apple-silicon-benchmark/) (the Ollama version tested predates MLX-default)
- **Structured output bug on MLX tags.** In Ollama 0.32.0, the `format` JSON schema is silently ignored on MLX models (confirmed on `qwen3.5:0.8b-mlx` and `gemma4:12b-mlx`). The request returns HTTP 200 with prose. GGUF builds honour the schema. The issue was closed as a duplicate of #16563 and is unresolved in 0.32.0. — [ollama#17183](https://github.com/ollama/ollama/issues/17183)
- **num_ctx and memory.** Context size drives memory allocation. Set it via `OLLAMA_CONTEXT_LENGTH`, `/set parameter num_ctx` or `options.num_ctx`. "Required RAM will scale by `OLLAMA_NUM_PARALLEL` * `OLLAMA_CONTEXT_LENGTH`." — [Ollama FAQ](https://docs.ollama.com/faq)
- **keep_alive.** The default is 5 minutes. A negative value keeps the model loaded forever; 0 unloads it immediately. Set it per request or with `OLLAMA_KEEP_ALIVE`. — [Ollama FAQ](https://docs.ollama.com/faq)
- **Flash attention.** Set `OLLAMA_FLASH_ATTENTION=1`. It "can significantly reduce memory usage as the context size grows". — [Ollama FAQ](https://docs.ollama.com/faq)
- **KV cache quantization.** Set `OLLAMA_KV_CACHE_TYPE` to `f16` (default), `q8_0` (about 50% less memory, minimal quality loss, recommended) or `q4_0` (about 75% less, small-to-medium loss). It is a global setting. — [Ollama FAQ](https://docs.ollama.com/faq)
- **OLLAMA_NUM_PARALLEL on Apple Silicon.** Measured on Ollama 0.30.7, M1 16 GB, a small gemma4 (Metal):
  - Default (NUM_PARALLEL=1): requests queue serially. Aggregate throughput stays at about 22–23 tok/s at concurrency 1–8, and wall-clock time scales linearly.
  - NUM_PARALLEL=4: aggregate rose to about 33 tok/s at concurrency 4 (about 1.8x), but each request dropped from about 22 to about 10 tok/s. Single-request speed also fell from 21.7 to 18.4 tok/s.
  — [jangwook.net experiment](https://jangwook.net/en/blog/en/local-llm-concurrent-requests-num-parallel-experiment/)
- Another source contradicts this: it claims aggregate throughput at concurrency 4 "is approximately the same as at concurrency 1" because NUM_PARALLEL "controls queue depth, not batching". — [search summary of ollamaherd/glukhov guides](https://www.glukhov.org/llm-performance/ollama/how-ollama-handles-parallel-requests/) (low-quality and conflicting; the jangwook numbers are more concrete)

### Inferences
- **The 262144 → 32768 reload is expected.** num_ctx sizes the KV buffer at load time, so any change to num_ctx (or NUM_PARALLEL) re-creates the runner. Send the same `num_ctx` on every request, including warm-up, and set `keep_alive: -1` (or a long value) for the whole run so nothing reloads mid-loop. 32K is plenty if old thinking is stripped from history and pages are truncated.
- **Switching to an MLX tag is the biggest raw-speed win.** For example `qwen3.5:35b-a3b-nvfp4` on Ollama ≥0.30, Mac with 32 GB or more: 45 → roughly 90–110 tok/s on M4/M5 Max-class chips. The catch is the `format` bug on MLX in 0.32. If the design depends on `format`, either stay on GGUF for those calls (running two models costs extra memory) or rely on tool calling and validate the JSON yourself.
- **Parallelism.** For a single sequential agent loop, NUM_PARALLEL>1 makes each call slower. It only pays off if the loop fans out independent work, such as summarising several fetched pages at once, and only for about 1.8x aggregate throughput. MoE-specific parallel scaling on Metal was not measured in any source found.
- **Use prefix caching deliberately.** Keep the system prompt, tool schemas and research brief byte-identical at the start of every call, and append new material at the end. Don't rewrite earlier messages, and don't re-insert thinking. Then the 0.30.x cache reuse avoids re-prefilling the shared prefix.

### Gaps
- I found no primary Ollama release notes for v0.30.x / 0.32 cache behaviour; the version details come from a secondary blog.
- I found no data on whether NUM_PARALLEL, flash attention or KV-cache quantization apply to the MLX runner. The FAQ describes them generically, and they may be llama.cpp-runner-only.
- I have no measured reload time for a 24 GB model on a Mac.

## 4. Prefill (prompt-processing) speed for ~35B-A3B MoE on M-series Macs

### Takeaway
Ollama's own figure for Qwen3.5-35B-A3B prefill is about 1,150 tok/s (llama.cpp backend, Ollama 0.18) and about 1,800 tok/s (MLX, 0.19) on an M5 Max. Older or smaller chips will be slower; I found no reliable M1–M4 prefill figures for this exact model. Feeding an 8K-token page probably costs a few seconds, not minutes. Prefill is not the bottleneck; generated thinking tokens are.

### Cited Findings
- M5 Max, Qwen3.5-35B-A3B: prefill 1,154 tok/s (Ollama 0.18), 1,810 tok/s (0.19 MLX, NVFP4), 1,851 tok/s (int4). — [Ollama blog: MLX](https://ollama.com/blog/mlx)
- A secondary source reports an M3 Ultra running dense Gemma 4 27B Q4_K_M at about 700–900 tok/s prefill. A dense 27B has about 9x the active parameters of a 3B-active MoE, so it is not directly comparable. — [runaihome](https://runaihome.com/blog/ollama-v030-mlx-stable-upgrade-2026/)
- One M4 Max benchmark of this model published decode speed only, with no prefill or TTFT figures. — [Kapetanovic benchmark](https://antekapetanovic.com/blog/qwen3.5-apple-silicon-benchmark/)

### Inferences
- **Estimating page cost.** Prefill time ≈ tokens ÷ prefill rate. At 500–1,800 tok/s, a 4K-token page costs about 2–8 s and a 16K-token context about 9–32 s, unless the prefix is cached. Text appended to a cached prefix only pays for the new tokens.
- **Rough budget for an 8-minute run.** Assume about 10 non-thinking tool steps of about 300 output tokens at 45 tok/s (about 7 s each), plus about 5 page reads of about 4K tokens prefill (3–8 s each). That leaves well over half the budget for one thinking plan call and the report. All this roughly halves again on MLX tags.

### Gaps
- I found no measured prefill numbers for Qwen3.5-35B-A3B on M1/M2/M3/M4 Pro or Max via Ollama, and no TTFT-versus-context curve.

## 5. Structured outputs (Ollama `format` JSON schema) vs free tool calling

### Takeaway
Ollama's `format` accepts a full JSON Schema and applies grammar-constrained decoding. That guarantees parseable output and removes retry loops. For qwen3.5, though, `format` has a history of version-specific bugs: it was ignored when `think=false` (0.17.6, since fixed), it fights with thinking, and it is silently ignored on MLX tags in 0.32. Test it on the exact version and tag before relying on it, and always validate the output.

### Cited Findings
- `format` accepts a JSON schema (for example Pydantic `model_json_schema()`) and constrains output to it. — [Ollama docs: Structured outputs](https://docs.ollama.com/capabilities/structured-outputs); [Ollama blog: Structured outputs](https://ollama.com/blog/structured-outputs)
- In Ollama 0.17.6 with qwen3.5:35b-a3b, `format` was ignored when `think=false`. Cause: masking waits for an end-of-thinking token that is never emitted because the template pre-closes the think tag. Closed and linked to PR #15901. — [ollama#14645](https://github.com/ollama/ollama/issues/14645)
- In Ollama 0.32.0, `format` is silently ignored on MLX models at every `think` setting; GGUF builds honour it. — [ollama#17183](https://github.com/ollama/ollama/issues/17183)
- `/api/generate` silently ignores `think: true` when `format` is set: the grammar applies from the first token, so the model gets no room to reason. `/api/chat` handles it. — [ollama#17544](https://github.com/ollama/ollama/issues/17544) (from search summary)
- Older bug: `think: true` with a schema on qwen3:0.6b produced invalid JSON (a doubled `{{"`). — [ollama#10929](https://github.com/ollama/ollama/issues/10929)
- llama.cpp: grammar enforcement was inactive when `response_format` and `enable_thinking: true` were combined. — [llama.cpp#20345](https://github.com/ggml-org/llama.cpp/issues/20345)
- There is a separate report that structured output was not enforced on qwen 3.5 / gemma 4. — [ollama#15540](https://github.com/ollama/ollama/issues/15540) (title only)
- Practitioner view: the Qwen3 series is among the most reliable local models for tool calling, rarely dropping calls or emitting invalid JSON. Still, calling depends on prompt wording, prompt length and temperature, and chains of 5+ tools are weaker. — [webscraft comparison](https://webscraft.org/blog/yaku-model-ollama-obrati-dlya-agenta-z-tool-calling-porivnyannya-i-benchmarki?lang=en) (low-authority)

### Inferences
- **Recommended shape for routine steps.** Replace free tool selection with `/api/chat`, `think: false`, and `format` set to a small schema, for example `{action: enum[search, read, finish], query, url, reason}`. Output is short (tens of tokens), parsing is deterministic, and nothing is spent deciding whether to call a tool. This works on GGUF tags with Ollama past the #14645 fix, not on MLX tags in 0.32.
- **If MLX speed is wanted,** use native tool calling (`tools`) with `think: false`, or prompt for plain JSON and validate it in code with one retry. Do not trust a 200 response to mean the schema was applied.
- **Avoid `format` together with `think: true`.** Either the grammar blocks thinking, or thinking bypasses the grammar. Use two phases if both are needed: think, then a constrained non-thinking extraction.

### Gaps
- I found no benchmark comparing `format`-constrained decoding with native tool calling for Qwen3.5 on validity, latency or downstream quality.
- I found no confirmation of which Ollama version fixed #14645 (only the linked PR #15901), or whether #16563 (MLX `format`) is fixed after 0.32.0.
