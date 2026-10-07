# Current deep-research implementation in CodingHarnessv2 (as of branch m19-deep-research-stop-resume, commit c3799c0)

Sources are repository files cited as `path:line` (relative to /Users/ryankenny/Projects/CodingHarnessv2). No web sources were used; this is a code map. Statements marked "Inference" are reasoning from the code and the observed event timings, not verified by measurement.

## Q1. Server loop structure, model calls, options, parallelism, budget split, note extraction, page caps

### Takeaway
Deep research is a strictly sequential, code-owned pipeline (brief → plan → per sub-question: query proposal → searches → page selection → one read + one note call per page → gap check → write). Every step is a separate non-streamed-to-user Ollama chat with `think: true`, `num_ctx: 32768`, a JSON-schema `format`, no `num_predict`, no temperature, up to 3 attempts. Nothing runs in parallel. In the observed heat-pump run only about 5 model calls fit in the 6-minute research phase (each 44–113 s), the single page's note call was killed by the research deadline, zero notes survived, and the run was labelled `failed` with a message blaming the pages, although the real cause was time.

### Cited Findings

**Entry and wiring**
- POST /v1/chat with `deep_research: true` (requires `web: true`, else 400 `deep_research_needs_web`; requires the request model to equal the configured research model, else 409 `deep_research_model_not_loaded`) — [server/src/http/server.ts:549-591](server/src/http/server.ts)
- Research model default `qwen3.5:35b-a3b` (`DEFAULT_RESEARCH_MODEL`), overridable by env `PHONE_MODELS_RESEARCH_MODEL`; budget overridable by `PHONE_MODELS_RESEARCH_BUDGET_MS` — [server/src/http/server.ts:45-46](server/src/http/server.ts); [server/src/index.ts:10-13,77-103](server/src/index.ts)
- The manager creates a `stopController` for deep-research generations and runs `runDeepResearch`, which forwards every research event to the generation log unchanged; the question is the last user message only — [server/src/generations/manager.ts:139-141,155-178](server/src/generations/manager.ts)
- If `runResearch` throws (non-abort), the manager appends a content sentence "The research failed before it could produce a report. Try asking again." and a `done` with `status:"complete"`, `research.status:"failed"` — [server/src/generations/manager.ts:184-200](server/src/generations/manager.ts)
- First Stop aborts `stopController` (wrap-up); second Stop aborts the hard `abortController`; a confirmed model load/unload aborts both — [server/src/generations/manager.ts:465-488](server/src/generations/manager.ts)

**Settings (all defaults in one object)**
- `subQuestionCount 3, minSearches 2, maxSearches 3, pagesPerSubQuestion 2, notesCapChars 8000, numCtx 32768, retries 2, think true, budgetMs 480000, writeReserveFraction 0.25, stopWriteMs 60000` — [server/src/generations/research.ts:64-77](server/src/generations/research.ts)
- `think: true` default chosen from a live probe: "think-on 7/7 valid" (and think-off was also 7/7 valid) — [server/src/generations/research.ts:72](server/src/generations/research.ts); [.harness/evidence/M16-T4-probe.json](.harness/evidence/M16-T4-probe.json)

**The single model-call helper (`modelStep`)**
- Request = system message `SYSTEM_INSTRUCTIONS + "Task: <task>"`, one user message, `format: <schema>`, `options: { num_ctx: s.numCtx }`, `think: s.think`, `keep_alive: -1`. No `num_predict`, no `temperature`, no tools — [server/src/generations/research.ts:336-352](server/src/generations/research.ts)
- Up to `retries + 1` = 3 attempts; a stream/network error, JSON parse failure or validator rejection counts as a failed attempt; after the last attempt the step returns null and is skipped — [server/src/generations/research.ts:353-380](server/src/generations/research.ts)
- Only `message.content` is accumulated; the content is parsed only after the stream finishes (`chunk.done`). Thinking is ignored and not streamed to the app — [server/src/generations/research.ts:357-376](server/src/generations/research.ts)
- A deadline hit mid-call throws `PhaseTimeUp` and is never retried; whatever partial content was produced is discarded — [server/src/generations/research.ts:366-369](server/src/generations/research.ts)
- The Ollama client streams `/api/chat` with the given `think`, `format`, `options`, `keep_alive` — [server/src/ollama/client.ts:262-304](server/src/ollama/client.ts)
- Every request's user content is built by `context()`: "Research brief", the plan list, "Notes so far" (latest notes up to 8000 chars), then the step-specific latest block. The system message varies per step because the task text is appended to it — [server/src/generations/research.ts:306-330,345](server/src/generations/research.ts)
- Schemas: brief `{brief}`, plan `{sub_questions[]}`, queries `{queries[]}`, select `{pages: int[]}`, note `{notes:[{quote,claim}]}`, gap `{enough: bool, next_query}`, write `{report}` — [server/src/generations/research.ts:116-150](server/src/generations/research.ts)

**Loop order (all awaited in sequence)**
1. `plan` step started (elapsed 0) → brief model call → plan model call → `plan` step done — [research.ts:399-417](server/src/generations/research.ts)
2. For each sub-question (serial `for` loop) — [research.ts:420](server/src/generations/research.ts):
   - `nextQuery()` pulls from a queue; if empty, makes a "propose queries" model call (up to `maxSearches` proposals per sub-question), then falls back to the sub-question text itself — [research.ts:432-458](server/src/generations/research.ts)
   - search (one at a time); results (max 5 per search) are added to the sub-question's candidate list, de-duplicated by URL key — [research.ts:510-527](server/src/generations/research.ts); [server/src/web/tools.ts:138](server/src/web/tools.ts)
   - Only after `minSearches` (2) searches: `readChosen()` → one "select pages" model call over all unread candidates; if it fails, the top results are read — [research.ts:528-531,460-477](server/src/generations/research.ts)
   - For each chosen page (≤2 per sub-question), serially: read via the search service, then one note model call over the page — [research.ts:479-506](server/src/generations/research.ts)
   - If searches < maxSearches: a gap-check model call; `enough` or a failed call ends the sub-question; else its `next_query` is queued — [research.ts:532-541](server/src/generations/research.ts)
3. Write: one write model call from the notes only; skipped if `failed` (no notes) or if the deadline already passed — [research.ts:556-583](server/src/generations/research.ts)
- Searches, reads and model calls are all `await`ed one after another; there is no `Promise.all` or concurrency anywhere in `runResearch` — [server/src/generations/research.ts:242-622](server/src/generations/research.ts)
- Count of model calls with defaults (code reading): 2 (brief, plan) + per sub-question about 1 queries + 1–2 select + up to 2 notes + 0–1 gap, + 1 write ≈ 15–21 sequential calls, each up to 3 attempts — derived from [research.ts:399-583](server/src/generations/research.ts)

**Time budget**
- `researchMs = budgetMs * (1 - writeReserveFraction)` = 360 000 ms; final deadline 480 000 ms; separate abort controllers/timers for each — [research.ts:258-269](server/src/generations/research.ts)
- `checkDeadline()` before every search, read and model call (and on every streamed chunk) — [research.ts:297-304,354,358,480,513](server/src/generations/research.ts)
- First Stop: `stopWriteDeadline = now + stopWriteMs` (60 s) and the research signal aborts at once — [research.ts:271-284](server/src/generations/research.ts)
- When the research phase is cut, the run moves to writing; `researchCutShort` → status `partial` — [research.ts:549-554,606](server/src/generations/research.ts)

**How `failed` is decided and what text is produced**
- `failed = !userStopped && searchesRun > 0 && notes.length === 0`, regardless of whether the reason was the deadline — [research.ts:562](server/src/generations/research.ts)
- Failed text: `COULD_NOT_SEARCH_NOTE` if no search returned results, else `COULD_NOT_READ_NOTE` ("The research found search results but could not get anything usable from the pages — none could be read or none had relevant content. Try again later.") — [research.ts:97-103,585](server/src/generations/research.ts)
- Then `content`, `sources` (if any search ran) and `done` with `status:"complete"` and `research:{status, elapsed_ms, budget_ms}` — [research.ts:596-611](server/src/generations/research.ts)

**Note extraction and why a page can yield no notes**
- The note call receives the whole page text wrapped in `<untrusted_data>` plus the brief/plan/notes context; the task: "Record short notes from page [n] ... Each note has a quote copied exactly from the page text and a short claim it supports." — [research.ts:491-498](server/src/generations/research.ts)
- Each returned note is kept only if `normaliseWhitespace(page.text).includes(normaliseWhitespace(quote))` — whitespace-collapsed, case-sensitive, exact substring on the markdown text — [research.ts:499-505,177-180](server/src/generations/research.ts)
- `pageText = normaliseText(page.text)` is computed but never used (dead code) — [research.ts:491](server/src/generations/research.ts)
- Ways a page yields zero notes (from the code): (a) the read failed (non-2xx) → no note call — [research.ts:487](server/src/generations/research.ts); (b) Defuddle returned empty/near-empty markdown (JavaScript-rendered page; no headless re-fetch exists) — [search/src/extract/extract.ts:27-49](search/src/extract/extract.ts); (c) the note call failed validation 3 times → null — [research.ts:353-380](server/src/generations/research.ts); (d) every quote failed the exact-substring check, e.g. the model dropped markdown syntax (`**`, `[text](url)`), changed curly quotes/dashes, or paraphrased — [research.ts:501-503](server/src/generations/research.ts) (Inference about which variants occur); (e) the research deadline aborted the note call mid-generation → `PhaseTimeUp`, partial output discarded — [research.ts:366-369](server/src/generations/research.ts)

**Page text caps**
- Read service: body cap 5 MiB, 15 s overall fetch deadline, max 5 redirects — [search/src/fetch/fetchPage.ts:12-13,88-90](search/src/fetch/fetchPage.ts)
- Markdown truncated to 40 000 characters with a visible marker — [search/src/extract/extract.ts:8,44-48](search/src/extract/extract.ts)
- The server passes the full (≤40 000 char) text into the note call; there is no further excerpting, passage filtering or BM25 — [server/src/web/tools.ts:186-191](server/src/web/tools.ts); [research.ts:495](server/src/generations/research.ts)
- Web tool client timeout 30 s per request — [server/src/web/tools.ts:73](server/src/web/tools.ts)

**Step timestamps**
- `step()` stamps `elapsed_ms` at the moment the event is yielded — [research.ts:295-296](server/src/generations/research.ts)
- Web tool step events (search/read "started" and "done") are built inside `webSearch`/`readPage` but only yielded by `absorb()` after the await returns, so "started" and "done" carry the same `elapsed_ms` and arrive together; the phone never sees an in-progress search or read — [server/src/web/tools.ts:133-149,171-182](server/src/web/tools.ts); [research.ts:383-392,485-486,518-519](server/src/generations/research.ts)
- No step event is emitted for query-proposal, select, note or gap-check model calls — [research.ts:432-541](server/src/generations/research.ts)

**Earlier live evidence**
- M16 live run (before the budget existed): Raft vs Paxos run took about 1 433 s wall time, 5 pages read, `done` reported `eval_count 2352` at `35.4 tok/s` — [.harness/evidence/M16-T5-live.log](.harness/evidence/M16-T5-live.log)

### Inferences
- **Reconstructed timeline of the heat-pump run** (event times from the brief, mapped onto the code):
  - 0 → 113.6 s: brief call + plan call (two tiny prompts). Only `plan started` (0 ms) and `plan done` (113 642 ms) events exist.
  - 113.6 → 157.4 s (~44 s): one "propose queries" call + search 1 (search started/done stamped together at 157 445).
  - 157.4 → 159.5 s: search 2 (~2 s, from the queue — no model call).
  - 159.5 → 258.4 s (~99 s): "select pages" call + the read itself (the read's started/done stamped together at 258 432 after the read returned; the read is ≤15 s by the service limit).
  - 258.4 → 360.0 s (~102 s): the note call on that page, killed at the research deadline (360 000 = 480 000 × 0.75). Zero notes → `failed`, write skipped, `COULD_NOT_READ_NOTE` emitted. Only sub-question 1 of 3 was reached.
  - So the "pages were unusable" message is misleading: the page was read; the run ran out of research time inside the first note call.
- **Where time goes**: almost all wall time is sequential model calls (~45–110 s each), not web I/O (searches ~2 s, reads ≤15 s). With ~15–21 calls needed for a full default run, a 360 s research phase can fit only ~4–7 calls at the observed speed.
- Likely contributors to the per-call latency (not measured): (1) `think: true` on every step with no `num_predict` cap, so each JSON decision can be preceded by unbounded reasoning tokens; (2) prompt prefill of large inputs (note calls carry up to 40 000 chars ≈ 10K tokens plus context); (3) a possible model reload at the start of each run: the research calls send `num_ctx: 32768`, while model loading (`generate` with only `keep_alive`) and ordinary chat send no `num_ctx` [server/src/ollama/client.ts:179-201](server/src/ollama/client.ts), and the Ollama LaunchAgent sets only `OLLAMA_FLASH_ATTENTION=1` and `OLLAMA_KV_CACHE_TYPE=q8_0`, no `OLLAMA_CONTEXT_LENGTH` (~/Library/LaunchAgents/homebrew.mxcl.ollama.plist). Ollama reloads a runner when the requested context differs from the loaded one, so the first research call may pay a ~24 GB reload — this would inflate the 113 s plan phase. Unverified; Ollama `load_duration`/`prompt_eval_duration` are returned per call but not logged by research.ts (only `eval_count`/`eval_duration` are summed, [research.ts:360-362](server/src/generations/research.ts)).
- The M16 figure (2352 eval tokens at 35.4 tok/s ≈ 66 s of decoding over a ~1433 s run) suggests that decoding was a small share of time and prefill/reload/waiting dominated — *if* Ollama's `eval_count` includes thinking tokens. I believe it does, but this is not verified here.
- The system message changes per step (the task text is appended), and the notes block sits early in the user message, so Ollama's prompt-prefix cache can reuse only the short fixed system preamble between steps.
- Bun `idleTimeout: 255` on the HTTP server [server/src/http/server.ts:666](server/src/http/server.ts) plus no SSE heartbeat (Q3) means a silent gap longer than ~255 s might close the stream at the server side (Bun's exact semantics for streaming responses not checked).

### Gaps
- No per-call timings (prefill vs decode vs load) are logged, so the split of the 44–113 s per call cannot be confirmed from the repo.
- Whether the first research request triggers an Ollama reload (context-size mismatch) is not verified.
- Whether Ollama's `format` constraint constrains the thinking phase or only the answer, and how many thinking tokens qwen3.5:35b-a3b emits per step, is not recorded in evidence.

## Q2. The search service (/search): how searches and reads work

### Takeaway
Searches spawn a fresh Python subprocess per query (ddgs metasearch, falling back to headless Chromium on Bing), 5 results, 25 s limit. Reads are a plain guarded HTTP fetch (no JavaScript rendering) followed by Defuddle main-content extraction to markdown, cut at 40 000 chars. No caching or backend circuit breakers exist yet (FR39 is milestone M20, not built).

### Cited Findings
- POST /v1/search spawns `helper/.venv/bin/python helper/search.py --query --max` in its own process group, killed on timeout (default 25 000 ms) or client abort — [search/src/search/runHelper.ts:4-43](search/src/search/runHelper.ts); [search/API.md](search/API.md)
- Helper: ddgs `text()` with region `uk-en`, safesearch moderate; on failure/empty, headless Chromium loads Bing (`cc=GB`) and scrapes `li.b_algo h2 a` with a 20 s navigation timeout — [search/helper/search.py:1-7,24-26,86-113,157-198](search/helper/search.py)
- The server asks for `max_results: 5` per search — [server/src/web/tools.ts:138](server/src/web/tools.ts)
- POST /v1/read: SSRF-guarded `node:http(s)` fetch with custom DNS lookup, 15 s overall deadline, 5 MiB body cap, max 5 redirects; accepts only text/html, text/plain, application/xhtml+xml (else 415) — [search/src/fetch/fetchPage.ts:9-18,88-90](search/src/fetch/fetchPage.ts); [search/API.md](search/API.md)
- Extraction: linkedom parse → Defuddle (`markdown: true`, `useAsync: false`, network disabled) → markdown; text/plain returned as-is; truncated at 40 000 chars with marker — [search/src/extract/extract.ts:1-50](search/src/extract/extract.ts)
- Architecture choice record: Defuddle over linkedom chosen 2026-09-29 — [.harness/architecture.md:313](.harness/architecture.md)
- No cache or circuit-breaker code in search/src (grep found "cache" only in icon/cache.ts); FR39 is planned as M20 — [search/src/icon/cache.ts](search/src/icon/cache.ts); [.harness/milestones.md:477-497](.harness/milestones.md)
- Headless re-fetch for JavaScript-rendered pages and PDF reading are explicitly deferred — [.harness/requirements.md:482-485](.harness/requirements.md)

### Inferences
- JS-heavy or consent-walled pages will come back with little or no markdown, which then yields zero notes; nothing detects "nearly empty" pages to skip or retry them.
- Per-search Python process start (and possibly Chromium start on fallback) adds fixed overhead, but the observed second search took ~2 s, so search latency is not the bottleneck in the observed run.

### Gaps
- No measurements of read-latency distribution or empty-extraction rates exist in the repo.

## Q3. Phone app: steps, clock, done.research, content, and why a failed run showed an empty bubble

### Takeaway
The clock is only updated when a step event arrives (no local ticking), so it shows 0:00 for the entire planning phase and freezes during every long model call. The app does render the failure sentence and "Deep research: failed" when it receives the `content` and `done` events, so an empty bubble with no status means the app never processed those events: most likely the stream was lost before ~360 s and the reply was saved as an `error` with empty content, which the list renders as an empty bubble because message `status` is never displayed. This last point is a hypothesis; device logs would be needed to confirm it.

### Cited Findings

**Clock**
- The accumulator's `clock` is set only inside the `step` case, from that event's `elapsed_ms`/`budget_ms` — [mobile/src/ui/streamReducer.ts:45-58](mobile/src/ui/streamReducer.ts)
- The streaming label is `researchClockLabel(clock.elapsed_ms, clock.budget_ms)` from `acc.research ?? acc.clock`; there is no timer/interval in the app adding wall time — [mobile/src/ui/chatItems.ts:97,106-109](mobile/src/ui/chatItems.ts); [mobile/src/ui/deepResearch.ts:59-68](mobile/src/ui/deepResearch.ts)
- Server-side, the first step event is `plan started` at elapsed 0 and the next is `plan done` after both planning calls — [server/src/generations/research.ts:401-417](server/src/generations/research.ts)

**Steps**
- Steps are upserted by `step_id` in arrival order — [mobile/src/ui/streamReducer.ts:45-50](mobile/src/ui/streamReducer.ts)
- Labels: "Planning", "Searching: <query>", "Reading: <domain>", "Writing report", with "(failed)" suffixes — [mobile/src/ui/chatItems.ts:135-180](mobile/src/ui/chatItems.ts)
- While streaming, all steps are listed; once finished, they collapse behind a "Show web steps (n)" toggle — [mobile/src/app/chat.tsx:397-438](mobile/src/app/chat.tsx)

**Status and content**
- A finished reply shows "Deep research: <status>" only if `item.research` is present; while streaming it shows the clock instead — [mobile/src/app/chat.tsx:390-395](mobile/src/app/chat.tsx); [mobile/src/ui/deepResearch.ts:71-75](mobile/src/ui/deepResearch.ts)
- The bubble renders content only when `item.content.length > 0`, plus a spinner while streaming, plus Sources — [mobile/src/app/chat.tsx:432-458](mobile/src/app/chat.tsx)
- `content` events append to the accumulator; `done.research` is parsed when its status is one of complete/partial/failed with numeric elapsed/budget — [mobile/src/ui/streamReducer.ts:43-65](mobile/src/ui/streamReducer.ts); [mobile/src/api/client.ts:961-981](mobile/src/api/client.ts)
- `research` is persisted with the reply and validated on load — [mobile/src/chat/conversationSession.ts:156-168](mobile/src/chat/conversationSession.ts); [mobile/src/store/conversationStore.ts:129-156](mobile/src/store/conversationStore.ts)
- `ChatItem` carries no `status`; `buildChatItems` never reads `m.status`, so an `error`-status reply with empty content renders as an empty bubble with no explanation — [mobile/src/ui/chatItems.ts:34-70](mobile/src/ui/chatItems.ts)
- On a stream error, the reply is persisted as `status: "error"` with whatever content had accumulated, then an `Alert("Error", ...)` is shown — [mobile/src/chat/conversationSession.ts:199-202](mobile/src/chat/conversationSession.ts); [mobile/src/app/chat.tsx:256-258](mobile/src/app/chat.tsx)

**Transport / resume**
- The server SSE stream sends one `: connected` comment at start and then only real events — no periodic heartbeat — [server/src/http/server.ts:333-350](server/src/http/server.ts)
- Server HTTP `idleTimeout: 255` — [server/src/http/server.ts:666](server/src/http/server.ts)
- App: a read error or end-of-stream without a terminal event counts as a "drop" and triggers resume with `Last-Event-ID` — [mobile/src/api/client.ts:681-700](mobile/src/api/client.ts)
- Resume budget is 300 000 ms measured from `firstDropAt`; `firstDropAt` is set only when it is null (or on a foreground drop) and is carried forward after a successful resume, never reset — so repeated drops in one long reply share one 5-minute budget, after which the app gives up with "The connection to the Mac was lost and could not be restored." — [mobile/src/api/client.ts:561-595,812-837](mobile/src/api/client.ts); [mobile/src/api/resume.ts:29-35](mobile/src/api/resume.ts)

### Inferences
- **Why the clock stayed at 0:00 during Planning:** by design. The only clock source is step events, and the plan phase emits nothing between 0 and 113.6 s. The same freeze happens during each later model call (e.g. ~99 s between 159.5 s and 258.4 s).
- **Why the bubble was empty with no status:** the server did emit the failure sentence (`content`) and `done.research.status:"failed"` at ~360 s (consistent with the brief's server-side event list). If the app had processed them, the bubble would show the sentence and "Deep research: failed". Their absence, together with no read step (emitted at 258.4 s), points to the app having stopped receiving events somewhere between 159.5 s and 258.4 s. Two candidate explanations:
  1. *Stream lost, then error path (more likely):* long silent gaps (44 s, 99 s, 102 s) with no heartbeat may be cut by an intermediary or the phone's networking stack (idle timeouts of Tailscale Serve / iOS URLSession are not documented in the repo — uncertain). Each drop is resumed, but because `firstDropAt` is not reset, a first drop during planning plus later drops would exhaust the 300 s resume budget around the time the run ends; the reply is then saved as `error` with empty content (content only arrives at the very end) and renders as an empty bubble; an "Error" alert should also have appeared.
  2. *Still pending:* the pending item stays a bubble with a spinner and the last clock value; if the transport hung without erroring, the view would look frozen. Less consistent with "no status" persisting after the run, but cannot be ruled out without the device state.
- Whichever applies, three code facts make the outcome look blank: content arrives only at the very end of a deep research run (one event), message `status` is never rendered, and finished steps are collapsed by default.

### Gaps
- No device logs or saved conversation JSON from the observed run were available, so which explanation applies is unconfirmed. Checking the stored message's `status` (error vs complete) and `steps` would settle it.
- Idle timeout behaviour of Tailscale Serve and Expo fetch on iOS was not checked (out of scope: no web research).

## Q4. Requirements the redesign must respect (FR34–FR40, AC28–AC30, constraints)

### Takeaway
The redesign must keep: owner-started per-message runs on one configured model (default qwen3.5:35b-a3b, no model swapping, no second resident model), a code-owned loop of small JSON-schema-constrained calls with explicit and constant `num_ctx`, about 8 minutes total with ~a quarter reserved for writing, a guaranteed reply with status complete/partial/failed, server-assigned `[n]` citations with verbatim-quote checks, two-stage Stop, gap-free resume, and no change to ordinary replies.

### Cited Findings
- FR34: started per message by the owner via a "Deep research" action, only with web on and only when the resident model is the configured deep-research model (server setting, default `qwen3.5:35b-a3b`); the app never swaps models; the model never starts a run itself — [.harness/requirements.md:241-250](.harness/requirements.md)
- FR35: fixed server-owned sequence: brief; plan with server-set sub-question count; per sub-question more than one query (server-set minimum, repeats skipped), choose pages from server-parsed URLs, read (FR21 rules), notes each with a verbatim quote and page number; gap check (model may end early but is never the only stopping rule); one write call. Each step JSON-schema-constrained (`format`), validated, bounded retries, skip on failure. Model reads only answer content. Each request carries only stable instructions, brief, plan, capped rolling notes and latest result; raw page text discarded once noted. Every request sets `num_ctx` and keeps the model resident. Page text is untrusted — [.harness/requirements.md:251-266](.harness/requirements.md)
- FR36: one overall budget (about 8 minutes, server setting), roughly a quarter reserved for writing; deadline checked before every search/read/model call; one cancellation signal reaches everything in flight; always ends with a reply whose status is `complete`, `partial` or `failed` (failed = no usable material, plain sentence); never hangs or errors with no reply; phone shows phases live as steps plus elapsed time against budget (e.g. "3:12 of 8:00") — [.harness/requirements.md:267-278](.harness/requirements.md)
- FR37: pages numbered in first-read order; report may cite only `[n]`; server removes unknown numbers and URLs; quotes checked by substring after whitespace normalisation, non-matching notes dropped; Sources list = pages read — [.harness/requirements.md:279-285](.harness/requirements.md)
- FR38: drop/background doesn't stop the run; resume with no gaps/duplicates; first Stop cancels in-flight search/read at once and writes a short report (~1 minute) saved `partial`; second Stop ends with steps and sources, no report; report saved as the answer; page text and notes not persisted; a run counts as a reply in progress — [.harness/requirements.md:286-293](.harness/requirements.md)
- FR39: search backends rest 1 h after rate-limit, 24 h after CAPTCHA; searches cached by normalised query and reads by final URL for 24 h (not yet built; M20) — [.harness/requirements.md:294-301](.harness/requirements.md); [.harness/milestones.md:477-497](.harness/milestones.md)
- FR40: ordinary replies unchanged apart from FR39 — [.harness/requirements.md:302-303](.harness/requirements.md)
- AC28: fake-backend tests for the whole flow including `format` and `num_ctx` on every request, no raw page beyond the current one, retry-then-skip, ending within budget plus small margin in failure/slow/write-deadline cases, citation removal, quote dropping, Stop behaviour, resume, rest/caching, ordinary replies unchanged — [.harness/requirements.md:409-421](.harness/requirements.md)
- AC29: live on the Mac with qwen3.5:35b-a3b, 3 real questions each end within budget plus margin as `complete` or `partial`, citing at least 3 distinct read pages, no unresolved citation — [.harness/requirements.md:422-426](.harness/requirements.md)
- AC30: owner's phone screenshot of a finished run showing steps, status, logo citations and "Sources (n)" — [.harness/requirements.md:427-428](.harness/requirements.md)
- Constraints: Expo Go only; Bun; Ollama only runtime; Mac Studio M1 Max 64 GB (GPU ~48 GB), run times expected ~1.5× the M4 Max estimates; `num_ctx` must be set on every deep research request and must not change between calls in a run; whether `format` holds with thinking on had to be checked (later probed 7/7) — [.harness/requirements.md:432-446](.harness/requirements.md)
- Deferred (out of scope for now): model-started runs, light/normal/thorough presets, 20-question evaluation set, reranker or any second resident model, PDF reading, per-sentence entailment, headless re-fetch of JS pages — [.harness/requirements.md:482-485](.harness/requirements.md)
- Edge cases: unload mid-run ends partial/stopped without hanging; all backends resting → failed plain sentence; malformed JSON retried then skipped; write-up failure never empty — [.harness/requirements.md:532-543](.harness/requirements.md)
- Architecture decision records: D-M15-1 (research is a module of C6, `deep_research` flag on POST /v1/chat, `plan`/`write` step kinds), D-M17-1 (budget and status on existing SSE events; a deep research reply's `done.status` stays `"complete"` with `research.status` carrying failed), D-M18-1 (model reported on GET /v1/state) — [.harness/architecture.md:529-572](.harness/architecture.md)

### Inferences
- FR35 does not mandate `think: true`, a particular sub-question count, per-page note calls, or a 40 000-char page; those are implementation choices and can change. It does mandate JSON-schema steps, a brief, a plan, >1 query per sub-question, a gap check, verbatim-quote notes and a single write call.
- FR36's "status shown on it" and live clock are requirements the current app only partly meets (clock frozen between steps; `failed` reply can appear blank if the stream is lost).
- AC29 requires ≥3 distinct cited read pages per live run within ~8 minutes — the observed run reached one page in 6 minutes, so the current pacing cannot meet AC29 on this Mac.

### Gaps
- None material from the repo; the requirement text is complete for these IDs.

## Q5. Prior recommendations (reports/Local LLM deep research techniques.md) — implemented or not

### Takeaway
The structural recommendations (code-owned loop, JSON-schema steps, server-assigned citations, deadline with a write reserve, `num_ctx` set, keep_alive pinning, flash attention/q8 KV cache) were implemented. The speed-related ones were not: no passage filtering or 8–12K page cap, no thinking-off for extraction, no `num_predict` caps, no temperature 0, no byte-stable prompt prefix ordering, no caching/circuit breakers, no early stop on "no new URLs", no evaluation set. The report itself warned that prefill dominates on Macs and estimated ~5 min on an M4 Max (2–4× longer on older chips) for a 15-step run.

### Cited Findings
Implemented:
- Code owns the loop; JSON `format` steps; read only content; bounded retries (3 attempts vs report's "up to a cap (open_deep_research uses 3)") — [reports/Local LLM deep research techniques.md:13-15](reports/Local%20LLM%20deep%20research%20techniques.md); [server/src/generations/research.ts:336-380](server/src/generations/research.ts)
- Server-set breadth (3 sub-questions) and minimum depth (2 searches) with gap check not sole stopping rule — [report:11](reports/Local%20LLM%20deep%20research%20techniques.md); [research.ts:64-77,510-541](server/src/generations/research.ts)
- Explicit, constant `num_ctx` (report: 16K–32K is enough; code uses 32 768) and `keep_alive: -1` — [report:26-28](reports/Local%20LLM%20deep%20research%20techniques.md); [research.ts:349-351](server/src/generations/research.ts)
- `OLLAMA_FLASH_ATTENTION=1`, `OLLAMA_KV_CACHE_TYPE=q8_0` set in the Ollama LaunchAgent — [report:30](reports/Local%20LLM%20deep%20research%20techniques.md); ~/Library/LaunchAgents/homebrew.mxcl.ollama.plist
- Citations by construction, quote substring check, URL stripping — [report:46](reports/Local%20LLM%20deep%20research%20techniques.md); [research.ts:193-240,499-505](server/src/generations/research.ts)
- One deadline checked before every call, one abort signal, ~25% write reserve, always returns complete/partial/failed — [report:48](reports/Local%20LLM%20deep%20research%20techniques.md); [research.ts:258-304](server/src/generations/research.ts)
- Brief before the run — [report:50](reports/Local%20LLM%20deep%20research%20techniques.md); [research.ts:402-408](server/src/generations/research.ts)
- Untrusted-data delimiting; page text can influence only notes and choice of server-parsed URLs — [report:40](reports/Local%20LLM%20deep%20research%20techniques.md); [research.ts:111-114,182-186,473-477](server/src/generations/research.ts)
- Exact-repeat query skipping after normalisation — [report:36](reports/Local%20LLM%20deep%20research%20techniques.md); [research.ts:432-437,514](server/src/generations/research.ts)

Not implemented (or changed):
- "Keep only the passages relevant to the current sub-question" / "2–4K tokens per page excerpt" / "page text truncated to 8–12K characters" — not done; full page up to 40 000 chars goes to the note call — [report:26,54](reports/Local%20LLM%20deep%20research%20techniques.md); [research.ts:495](server/src/generations/research.ts); [extract.ts:8](search/src/extract/extract.ts)
- "Spend [thinking] on planning and the final write-up, and turn it off ... for per-page extraction" — not done; `think: true` on every step — [report:30](reports/Local%20LLM%20deep%20research%20techniques.md); [research.ts:73,350](server/src/generations/research.ts)
- `num_predict` caps per role — not done (no `num_predict` anywhere in the request) — [report:30](reports/Local%20LLM%20deep%20research%20techniques.md); [research.ts:342-352](server/src/generations/research.ts)
- "repeating the schema in the prompt and using temperature 0" — not done — [report:15](reports/Local%20LLM%20deep%20research%20techniques.md); [research.ts:342-352](server/src/generations/research.ts)
- "Keep the system prompt byte-stable at the front ... put the stable instructions first and the changing notes last" — partly: a fixed preamble is first, but the per-step task is appended to the system message and notes precede the latest result, so prefixes diverge early — [report:28](reports/Local%20LLM%20deep%20research%20techniques.md); [research.ts:322-330,345](server/src/generations/research.ts)
- BM25 filtering, RRF merging, near-duplicate content removal (hash/simhash), per-domain caps — not done; only URL-key dedup — [report:36,40](reports/Local%20LLM%20deep%20research%20techniques.md); [server/src/web/pageNumbers.ts](server/src/web/pageNumbers.ts)
- Circuit breakers and caching ("belong in the first version") — not done; planned as M20 — [report:71](reports/Local%20LLM%20deep%20research%20techniques.md); [.harness/milestones.md:477](.harness/milestones.md)
- Headless re-fetch for JS-rendered or nearly-empty pages — not done; deferred in requirements — [report:38](reports/Local%20LLM%20deep%20research%20techniques.md); [.harness/requirements.md:482-485](.harness/requirements.md)
- "Stop early when a round adds no new URLs or domains" — not done — [report:48](reports/Local%20LLM%20deep%20research%20techniques.md)
- `deep_research` as a tool called by the chat model with depth presets — replaced by an owner-pressed action; presets deferred — [report:5,54](reports/Local%20LLM%20deep%20research%20techniques.md); [.harness/requirements.md:241-250,482](.harness/requirements.md)
- Replayable 20-question evaluation set — deferred — [report:63-65](reports/Local%20LLM%20deep%20research%20techniques.md); [.harness/requirements.md:482-485](.harness/requirements.md)
- Report's timing estimate: "a 15-step run with about 6K new prompt tokens and 800 generated tokens per step takes about 5 minutes on an M4 Max ... 2–4 times longer on M1/M2 Pro"; it notes "On a Mac, the bottleneck is prefill" — [report:30,26-28](reports/Local%20LLM%20deep%20research%20techniques.md)

### Inferences
- The unimplemented items are exactly the ones that control per-call latency (input size, thinking length, output length, prefix reuse). The default run needs ~15–21 sequential calls; at the observed ~45–110 s per call on the M1 Max, that is ~12–35 minutes, far beyond the 6-minute research phase. The 8-minute budget is therefore structurally unreachable for a complete run with the current per-call cost.
- Applying thinking-off (or low) to queries/select/note/gap, a `num_predict` cap per step, and a small relevant-passage excerpt instead of a 40 000-char page would likely cut most calls to seconds; overlapping web I/O with model calls (prefetching reads while the model works) would add further savings. These are inferences for the redesign, not measured.

### Gaps
- No local measurements exist of per-call latency with think off vs on for qwen3.5:35b-a3b on this M1 Max, so the gain from each change is unquantified.
