# Milestones

## M1 — Authenticated tailnet chat stream proof

Status: DONE

### Outcome

From Expo Go on the phone, over the tailnet only, a user can send one prompt to the currently resident Ollama model and watch the reply stream in token by token, protected by a bearer token, with Stop working.

Detail: `.harness/archive/M1.md`

## M2a — Installed models and true resident state on the phone

Status: DONE

### Outcome

The phone's model screen lists every model installed in Ollama by its real name and size, and shows the true resident model (including one loaded by another tool on the Mac) or an explicit nothing-loaded state, served by GET /v1/state. Split from M2 at pickup (5 criteria, within size) because of operational-complexity signals CONCURRENCY_LIFECYCLE + IMPLEMENTATION_PLUS_LIVE_PROOF (a required split), plus MULTIPLE_OUTCOMES, SUBSYSTEMS_GT_3 and PRODUCTION_FILES_GT_8; parts: M2a model list and resident state, M2b swap-load/unload that stays resident, M2c busy confirmation.

Detail: `.harness/archive/M2a.md`

## M2b — Swap-load and unload from the phone, staying resident

Status: DONE

### Outcome

From the phone a user can load a model (a swap: every other resident model is unloaded first) or unload the resident one; the operation runs asynchronously while the app polls GET /v1/state through loading to ready or a specific failure reason, and a model loaded from the phone stays resident indefinitely (keep_alive -1), including across chat replies. The confirmation rule for a reply in flight or a resident model not loaded by this server belongs to M2c.

Detail: `.harness/archive/M2b.md`

## M2c — Busy confirmation before a swap or unload

Status: DONE

### Outcome

Before a swap or unload, the server answers 409 confirmation_required with its reasons when a reply is in flight or the resident model was not loaded by this server; the app shows that warning (the other-tool case labelled as a best approximation), confirming cancels any in-flight reply and proceeds, and cancelling the confirmation leaves state unchanged.

Detail: `.harness/archive/M2c.md`

## M3 — Persisted multi-turn conversations with model attribution

Status: DONE

### Outcome

The phone keeps a list of conversations, each with full multi-turn history sent on every prompt, each reply labeled with the model that produced it, and conversations survive an app restart.

Detail: `.harness/archive/M3.md`

## M4a — Thinking shown collapsed, prompt shown on Send, reply streams in place

Status: DONE

### Outcome

In the chat screen the user's prompt appears as soon as Send is pressed, the reply streams into its own final place in the conversation (no separate streaming area), and a model's reasoning output is shown in a collapsed, expandable section separate from the answer. Split from M4 at pickup (5 criteria, within size) because of operational-complexity signals CONCURRENCY_LIFECYCLE + IMPLEMENTATION_PLUS_LIVE_PROOF (a required split), plus SUBSYSTEMS_GT_3 and MULTIPLE_OUTCOMES; parts: M4a chat display (thinking, prompt on Send, reply streams in place), M4b dropped-connection and backgrounding resume.

Detail: `.harness/archive/M4a.md`

## M4b — Dropped-connection resume

Status: DONE

### Outcome

A transport drop mid-reply resumes the same reply once the phone reconnects (Last-Event-ID replay with backoff), with no gaps or duplicated text and its terminal state received. Second part of the M4 split (see M4a). Split from the original M4b (dropped-connection and backgrounding resume) at pickup (2 criteria, within size) because of operational-complexity signals CONCURRENCY_LIFECYCLE + IMPLEMENTATION_PLUS_LIVE_PROOF (a required split), plus MULTIPLE_OUTCOMES; parts: M4b dropped-connection resume (M4-AC2), M4c backgrounding resume with Stop-only cancel (M4-AC3).

Detail: `.harness/archive/M4b.md`

## M4c — Backgrounding resume, only Stop cancels

Status: DONE

### Outcome

Backgrounding the app mid-reply and returning to the foreground resumes the same reply and receives its terminal state; only an explicit Stop cancels generation. Third part of the M4 split; split from M4b at pickup (see M4b).

Detail: `.harness/archive/M4c.md`

## M5b — Plain-language error messages

Status: DONE

### Outcome

The app shows a distinct plain-language message for each failure mode: Mac or server unreachable, Ollama down, wrong password, model failed to load, model no longer installed, and a reply already in progress. Second part of the M5 split (see M5a). Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal; seam check: the live proof is the criterion itself, so separating it would leave a component-only half — not split).

Detail: `.harness/archive/M5b.md`

## M5c — PWA retirement

Status: DONE

### Outcome

The old PWA's LaunchAgent and its Tailscale Serve /app handler are removed, leaving the harness's own / handler intact and the phoneToLocalModel repository untouched on disk. Third part of the M5 split (see M5a); runs last because FR17 requires this app's acceptance criteria to pass first.

Detail: `.harness/archive/M5c.md`

## M6 — The search service reads a web page safely over loopback

Status: DONE

### Outcome

A new loopback-only search service on 127.0.0.1:7790 answers POST /v1/read: it fetches a public page on the Mac and returns its main content as markdown, truncated and marked when too long, and refuses local, private, tailnet and other non-public destinations at connect time, including via redirects. First web milestone: proves risk R6 (Bun honouring a custom lookup) before anything depends on it. Planned 2026-09-29 for FR18-FR25; operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal; seam check: the live fetches are the criteria themselves, so separating them would leave a component-only half - not split).

Owns: FR21. Traces to: AC15.

Detail: `.harness/archive/M6.md`

## M7a — The search service answers a web search through ddgs with no account

Status: DONE

### Outcome

POST /v1/search on the search service returns UK/English results from ddgs run in a short-lived Python helper (one subprocess per search, JSON on stdout per I17), using a helper venv the ops tooling installs (Python, ddgs, Playwright, Chromium). Proves risk R7 (ddgs on Python 3.14). Split 2026-09-29 from M7 ("The search service answers web searches with no account, falling back to a headless browser", 3 criteria) at pickup: operational-complexity signals CONCURRENCY_LIFECYCLE (per-search helper subprocess spawned, killed on timeout; Chromium started on demand and closed) + IMPLEMENTATION_PLUS_LIVE_PROOF (live ddgs/engine proof) require a split, and MULTIPLE_OUTCOMES (ddgs answer, browser fallback, failure/timeout handling are independently demonstrable). Criteria conserved unchanged in wording: M7a-AC1 = M7-AC1, M7b-AC1 = M7-AC2, M7c-AC1 = M7-AC3. This part keeps IMPLEMENTATION_PLUS_LIVE_PROOF only (spawn-and-wait; no timeout kill or browser lifecycle); seam check: the live ddgs search is the criterion itself - not split further.

Traces to: FR20 (ddgs path).

Detail: `.harness/archive/M7a.md`

## M7b — When ddgs fails, a headless browser answers the search and is closed afterwards

Status: DONE

### Outcome

When ddgs errors or returns nothing, the search helper starts headless Chromium on demand via Playwright, performs the search on a search-engine results page, closes the browser, and the service returns results with backend browser. Second part of the M7 split (see M7a). Signals: IMPLEMENTATION_PLUS_LIVE_PROOF and the Chromium lifecycle (CONCURRENCY_LIFECYCLE) remain inside one criterion, which cannot be split further; the lifecycle is confined to one helper process and checked by process absence afterwards.

Owns: FR20. Traces to: AC16 (browser fallback).

Detail: `.harness/archive/M7b.md`

## M7c — A search that cannot be answered or runs too long ends with a clear error and its helper killed

Status: DONE

### Outcome

When both search backends fail the service returns 503 search_unavailable, and a search exceeding the service's time limit returns 504 timeout with its helper process (and any browser it started) killed. Third part of the M7 split (see M7a). Signal: CONCURRENCY_LIFECYCLE (timeout kill); proof uses forced failures and a forced slow helper locally, so no live-environment dependency.

Traces to: FR20 (unavailable), FR24 (service time limit).

Detail: `.harness/archive/M7c.md`

## M8 — The search service is always on, loopback only, with a documented API

Status: DONE

### Outcome

The search service runs under its own per-user LaunchAgent (com.harness.search) that restarts it after it is killed, answers only on loopback with no token and no Tailscale Serve mapping, and its HTTP API is documented so OpenCode can use it later. Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal; the LaunchAgent follows the existing C9 pattern and changes no existing lifecycle ownership - not split).

Detail: `.harness/archive/M8.md`

## M9 — The server answers a web-enabled chat by running the model's search tool loop

Status: DONE

### Outcome

POST /v1/chat with web:true makes the server offer web_search and read_page to the resident model through Ollama tool calling, with the current date, run each call against the search service, stream step and sources events, and cap a reply at 10 tool calls; GET /v1/state reports each model's tools capability. Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal; the tool loop runs inside the existing generation lifecycle, and Stop/resume interactions are M11 and M12 - not split).

Detail: `.harness/archive/M9.md`

## M10 — The phone has a per-chat web-search switch and shows steps and sources live

Status: DONE

### Outcome

Each conversation on the phone has a web-search switch, off by default and saved with it, disabled with an explanation for a model without tools; with it on, the chat shows each web step live, collapses the steps after the answer, and ends the answer with sources that open in Safari. Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal; seam check: the phone proof is the criteria - not split).

Owns: FR18, FR22. Traces to: AC13, AC14.

Detail: `.harness/archive/M10.md`

## M10b — Assistant answers show formatted text instead of raw markdown

Status: DONE

### Outcome

Every assistant answer on the phone - web or not, streaming or already saved - renders its markdown (bold, italics, headings, lists, inline code and code blocks, links) with no raw markup visible, and half-written markup mid-stream never breaks the view; links show as plain non-tappable text until M10c adds source logos, and thinking stays plain text. Split at planning (2026-09-30) from one FR26-FR28 milestone because of operational-complexity signals MULTIPLE_OUTCOMES + IMPLEMENTATION_PLUS_LIVE_PROOF (a required split; WORKER_TASKS_GT_6 also anticipated); parts: M10b formatted answers (AC20), M10c inline source logos (AC21), M10d collapsed source list (AC22). Each part keeps one signal: IMPLEMENTATION_PLUS_LIVE_PROOF.

Owns: FR26. Traces to: AC20.

Detail: `.harness/archive/M10b.md`

## M10c1 — The Mac serves a website's own logo through a token-protected route

Status: DONE

### Outcome

The server exposes GET /v1/icon?host=<site> behind the bearer token (C4), which asks the search service (C12 -> C13) for that site's own icon; the search service fetches it from the site itself through the same public-sites-only guard used for page reading, accepts image content only, caches it on the Mac, and returns no_icon for a refused (local, LAN, tailnet, or redirecting there) or icon-less host. No third-party logo service is called; search/API.md documents the route (FR25). Architecture deviation D-M10c-2 applies. Split from M10c on 2026-09-30 by human decision (Option A) after the pickup check found signals IMPLEMENTATION_PLUS_LIVE_PROOF, PRODUCTION_FILES_GT_8 and MULTIPLE_OUTCOMES on a one-criterion milestone; this part carries one signal (IMPLEMENTATION_PLUS_LIVE_PROOF).

Owns: none owned (FR27 owned by M10c2). Traces to: AC21 (Mac icon fetch and guard), FR27 (Mac half; FR27 owned by M10c2).

Detail: `.harness/archive/M10c1.md`

## M10c2 — Links to a web answer's sources show the site's own logo and open in Safari

Status: DONE

### Outcome

In a web answer, a link whose URL matches one of that reply's saved sources (ignoring scheme, a leading www. and a trailing slash) shows its text followed by the website's own logo, obtained from the Mac through M10c1's token-protected GET /v1/icon route and cached on the phone, with a globe icon when none loads or the Mac is unreachable; tapping the logo opens the page in Safari. The phone contacts no website or logo service itself, and no third-party logo service is called. Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal). Split from M10c on 2026-09-30 by human decision (Option A); depends on M10c1.

Owns: FR27. Traces to: AC21. Depends on: M10c1.

Detail: `.harness/archive/M10c2.md`

## M10c3 — Tables in answers line up under their headings and stay readable at phone width

Status: DONE

### Outcome

Every markdown table in an assistant answer - web or not, streaming or already saved - shows each body cell under its own column heading (short rows padded, surplus cells joined into the last column, nothing dropped or shifted); a two-column table renders as a grid and a table of three or more columns as one card per body row with "heading: value" lines, so nothing is squeezed and nothing scrolls sideways. The cause of the 2026-09-30 misalignment is diagnosed and pinned by a test. Planned 2026-09-30 from the owner-reported follow-ups under M10c1 (human decision: built after M10c2, before M10d); separate from M10c4 because the two are independently demonstrable outcomes in different halves (phone renderer vs. server web instructions). Operational-complexity signals: none (one subsystem, C1 renderer; about two production files; no automated live proof).

Owns: FR29. Traces to: AC23.

Detail: `.harness/archive/M10c3.md`

## M10c4 — Broad web questions draw on at least three different websites

Status: DONE

### Outcome

With the web switch on, the instructions the server gives the model alongside the FR19 date note tell it that a broad or open-ended question is searched with more than one query, without the exact date in the query, reading pages from at least three different websites before answering, and citing the pages it read by number, while a narrow question need not search more than it needs; the server does not check or re-prompt and the 10-call cap is unchanged. Each page the model reads in a reply gets a number (first-read order); the page text is labelled with it and the saved sources carry it, and the app shows a citation mark such as [2] as that page's logo opening its exact saved URL (FR31), deterministically, so a logo never depends on the model copying a URL. Proven live on the Mac: most broad prompts come back with sources from three or more sites, each cited so that it shows a logo. Planned 2026-09-30 from the owner-reported follow-ups under M10c1; FR31 added 2026-09-30 by human decision resolving this milestone's BLOCKED escalation (the planner may re-check size/shape: it now spans server and phone).

Owns: FR30, FR31. Traces to: AC24, AC25.

Detail: `.harness/archive/M10c4.md`

## M10d — A web answer's sources start folded as "Sources (n)", each its own tappable entry

Status: DONE

### Outcome

The source list at the end of a web answer starts collapsed behind a "Sources (n)" header that expands and collapses on tap (not remembered when the chat is reopened), and each source is its own entry - site logo as in M10c2 plus page title - opening in Safari, never merged with another source into one link. Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal; split from the FR26-FR28 plan, see M10b).

Owns: FR28. Traces to: AC22.

Detail: `.harness/archive/M10d.md`

## M10e — Every answer fits its bubble at full width, with "Sources (n)" and the model name below it

Status: DONE

### Outcome

Every assistant answer - web or not, streaming, finished or reopened from saved history, and whatever FR26 content it holds (paragraphs, bulleted/numbered lists, headings, FR29 table cards, FR27/FR31 inline logos) - is laid out at the full width available to its bubble with all of its text inside the bubble, and the FR28 "Sources (n)" header and the model name always sit below the answer text without overlapping it. The cause of the 2026-09-30 22:32 squeezed, overflowing web answer (.harness/evidence/FR32-owner-phone-squeezed-2026-09-30-2232.png) is diagnosed and pinned by a test. No change to the model instructions, the server, or the FR29 card layout beyond keeping it inside the bubble. Planned 2026-09-30 from FR32 (human decision "Layout fix now, logos later": built after M10d, ahead of M11). Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal; seam check: the live proof is the owner's phone screenshot of the same outcome, so separating it would leave a test-only half that cannot show the phone is fixed - not split). One subsystem (C1 renderer), a few production files.

Owns: FR32. Traces to: AC26.

Detail: `.harness/archive/M10e.md`

## M11 — Web replies are saved, resume after a drop, and keep page text out of later prompts

Status: DONE

### Outcome

A web reply's steps and sources are saved with it in the conversation, a dropped connection mid-web-reply resumes with steps and text complete and unduplicated, page text and full results are never stored or re-sent, and a searching reply counts as a reply in progress. Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal; resume reuses the existing per-reply event log, no lifecycle change - not split).

Owns: FR23. Traces to: AC17 (resume), AC18 (persistence).

Detail: `.harness/archive/M11.md`

## M12 — Stop during a web search ends it on the Mac

Status: DONE

### Outcome

Pressing Stop while a reply is searching or reading a page cancels the reply and the in-flight search or page read on the Mac: the helper process is killed or the fetch aborted, and output stops. Operational-complexity signals: CONCURRENCY_LIFECYCLE + IMPLEMENTATION_PLUS_LIVE_PROOF (abort propagating C6 -> C12 -> C13 -> C14, proven live). Cut apart from M13 for that reason; with one criterion it is the narrowest seam and cannot be split further.

Owns: none owned (FR23 Stop clause, owned by M11). Traces to: AC17 (Stop), FR23 (Stop cancels search).

Detail: `.harness/archive/M12.md`

## M13 — Search failures and time limits never hang a web reply, and no hosted search is used

Status: DONE

### Outcome

When both search backends fail the reply still completes and the app shows search was unavailable; a step that exceeds its time limit is failed, the model is told, and the reply carries on; and no hosted search or fetch API or key is configured or called. Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal - not split).

Owns: FR24. Traces to: AC16 (both fail, time limit), AC18 (no hosted API).

Detail: `.harness/archive/M13.md`

## M14 — A web reply always ends with an answer

Status: DONE

### Outcome

When a web reply's model round goes quiet (no answer text, no tool call; thinking does not count), the server prods it to carry on with the tools still offered (at most 2 prods), then gives one tools-withdrawn "answer now" round, and if that also goes quiet ends the reply `complete` with the FR33 note as its answer plus its steps and sources; each prod and the answer-now round are web steps that stream live, are saved and show again when reopened. Prods are not saved, not re-sent and not counted toward the 10-call cap; switch-off replies, Stop/resume and time limits are unchanged. Planned 2026-10-01 from FR33/AC27 (owner's 2026-10-01 20:15 screenshot: 7 web steps, 14 sources, no answer). Human decision 2026-10-01: build this now, ahead of M5a; M5a stays BLOCKED and parked, its record unchanged, and is picked up after M14. Size check at pickup: 5 criteria; real entry point POST /v1/chat; one operational-complexity signal IMPLEMENTATION_PLUS_LIVE_PROOF (seam check: the live part is a regression run of an ordinary web reply plus the existing M13 proof, no lifecycle change; the quiet behaviour itself is proven by scripted tests as agreed in AC27) - not split.

Owns: FR33. Traces to: AC27.

Detail: `.harness/archive/M14.md`

## M15 — A deep research run through the server API ends with a report citing only the pages it read

Status: DONE

### Outcome

Walking skeleton of deep research: a chat sent through POST /v1/chat with web on and deep research requested is run by server code (not a model tool loop) as brief -> plan -> search/read/note per sub-question -> gap check -> one write call, each model step a narrow JSON-schema-constrained Ollama request with an explicit num_ctx, and ends with a report whose [n] citations are only pages read in this run. Planned 2026-10-01 from FR34-FR40/AC28-AC30. Human decision 2026-10-01: build deep research (FR34-FR40) now, ahead of M5a; M5a stays BLOCKED and parked, its record unchanged, and is picked up after M15-M21. Size check: 4 criteria; real entry point POST /v1/chat; one operational-complexity signal SUBSYSTEMS_GT_3 (C4, C6, C7, C12; seam check: C4 only accepts one request field and C7 only passes `format`/`num_ctx` through, and cutting either off leaves no entry point) - not split.

Detail: `.harness/archive/M15.md`

## M16 — The deep research run works on the real qwen3.5:35b-a3b on the Mac

Status: DONE

### Outcome

The deep-research model is downloaded on the Mac (`ollama pull qwen3.5:35b-a3b`), the unverified question of whether Ollama's `format` constraint holds with thinking on is settled by a live probe, and one real question run through the server API ends with a cited report. Proves the riskiest integration (real model + real search) right after the skeleton. Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal; the implementation is only the think setting the probe supports) - not split.

Owns: none owned. Traces to: AC29 (first live question), Constraints (format with thinking unverified).

Detail: `.harness/archive/M16.md`

## M17 — A deep research run always ends within about 8 minutes with its status shown

Status: DONE

### Outcome

A run has one overall time budget (server setting, about 8 minutes) with about a quarter reserved for writing, checked before every search, read and model call, with one cancellation signal reaching everything in flight; it always ends with a reply marked `complete`, `partial` or `failed`, never hangs and never ends with an error and no reply. Operational-complexity signal: CONCURRENCY_LIFECYCLE (one signal; deadline and cancellation ownership inside the run) - not split.

Owns: FR36. Traces to: AC28 (all backends failing, slow backend, deadline during write-up).

Detail: `.harness/archive/M17.md`

## M18 — The phone offers Deep research only when the configured model is loaded, and shows the run live

Status: DONE

### Outcome

With the web switch on, the composer shows a "Deep research" action beside Send, enabled only while the resident model is the deep-research model the server reports (a Mac-side setting, default `qwen3.5:35b-a3b`); using it sends that one message as a run, whose phases, elapsed clock, status, logo citations and Sources show live and when reopened. Operational-complexity signal: SUBSYSTEMS_GT_3 (C1-C5; seam check: the server part is reporting one setting and refusing one request shape, and without it the app has nothing to gate on) - not split.

Owns: FR34. Traces to: AC28 (action hidden/disabled/enabled, model name from server, steps live and saved).

Detail: `.harness/archive/M18.md`

## M19 — Stop, resume and saving work for a deep research run

Status: DONE

### Outcome

FR9, FR11 and FR23 apply to a run: it survives a dropped connection or backgrounding and resumes with no gaps or duplicates; a first Stop writes a short `partial` report from the notes so far, a second Stop ends it with steps and sources but no report; the report is saved like any answer, page text and notes are not. Operational-complexity signal: CONCURRENCY_LIFECYCLE (one signal; two-stage Stop and resume ownership) - not split.

Owns: FR38. Traces to: AC28 (first and second Stop, dropped-connection resume).

Detail: `.harness/archive/M19.md`

## M19b — Every deep research model call is logged, thinks only at plan and write, and is time-capped

Status: DONE

### Outcome

Through POST /v1/chat, every deep research model call writes one structured log line with the FR41 fields; loading the deep-research model sends the research num_ctx so the first research call does not rebuild the runner; brief, query proposal, page choice, notes and gap check are sent with think:false, an output cap, non-thinking sampling and a hard wall-clock cap; plan and write keep thinking, streamed, under a time guard and are re-issued once with think:false when it is exceeded. Planned 2026-10-02 from FR41-FR45 / AC31-AC33 (plus the FR40 and AC29 amendments). Human decision 2026-10-02: built before M20; M20 and M21 stay TODO after these milestones; M5a stays BLOCKED, untouched. Split at planning into M19b-M19h: the FR41-FR45 work as one milestone would carry 15+ criteria and signals CONCURRENCY_LIFECYCLE (per-call caps and guards, parallel prefetch, per-outage resume), IMPLEMENTATION_PLUS_LIVE_PROOF (AC32, AC33), SUBSYSTEMS_GT_3 (C1, C2, C4, C5, C6, C7, C12), MULTIPLE_OUTCOMES and WORKER_TASKS_GT_6; parts: M19b model-call measurement, thinking and caps (FR41, FR42); M19c passages (FR43); M19d breadth first, prefetch, partial notes (FR44); M19e server liveness (FR45 server half); M19f phone liveness (FR45 app half); M19g live Mac proof (AC32); M19h live phone proof (AC33). This part keeps one signal: CONCURRENCY_LIFECYCLE (cancelling a call at its cap or guard and re-issuing it; seam check: FR41's logging is the measurement the caps are judged by and the warm-up num_ctx is one request field, so splitting them off leaves halves too small to review alone) - not split further.

Owns: FR41, FR42. Traces to: AC31 (log line per call, warm-up num_ctx, think value per step, num_predict only on thinking-off steps, thinking text detected, routine cap, plan/write guard re-issue).

Detail: `.harness/archive/M19b.md`

## M19c — A note call gets the page's most relevant passages, and useless pages cost no model call

Status: DONE

### Outcome

Through POST /v1/chat, a deep research note call receives the page title, its first paragraph and the keyword-ranked passages that best match the sub-question (about 2-3K tokens, page text first and task last, behind a byte-stable instruction prefix) instead of the whole page; quotes are still checked against the full stored page; a near-empty, bot-challenge or no-match page is skipped without a model call. Second part of the FR41-FR45 split (see M19b). Operational-complexity signals: none (one component, C6; passage splitting and ranking are in-process with no new model or service).

Owns: FR43. Traces to: AC31 (note excerpt within the size cap, quote outside the excerpt still matches, empty/blocked/no-match pages make no note call).

Detail: `.harness/archive/M19c.md`


## M19d — Research covers every sub-question first, reads chosen pages ahead, and keeps partial notes

Status: DONE

### Outcome

Through POST /v1/chat, every sub-question gets its searches and its first page before any gets a second; chosen pages are fetched in parallel as soon as page choice returns while model calls stay one at a time; a sub-question ends early when a search round adds no new URLs; a deadline-cut note call keeps its complete notes, and a run that runs out of time with no notes says so honestly and stays `failed`. Third part of the FR41-FR45 split (see M19b). Operational-complexity signal: CONCURRENCY_LIFECYCLE (one signal; parallel prefetched reads under the run's one cancellation signal; seam check: breadth-first order and prefetch are the same scheduling change in the research loop) - not split further.

Owns: FR44. Traces to: AC31 (breadth first, parallel reads with no overlapping model calls, deadline-cut note keeps complete notes, ran-out-of-time sentence).

Detail: `.harness/archive/M19d.md`


## M19e — Reply streams show they are alive: started steps for deep research and keep-alives for every reply

Status: DONE

### Outcome

Over GET /v1/generations/{id}/events, a deep research run emits a "started" step before awaiting every search, read and model call ("Choosing pages", "Taking notes: <domain>", "Checking for gaps"), and every open reply stream - deep research, ordinary web and switch off - carries an SSE comment keep-alive at least every 15 s without disturbing Last-Event-ID resume. Server half of FR45; the app half is M19f. Fourth part of the FR41-FR45 split (see M19b). Operational-complexity signal: CONCURRENCY_LIFECYCLE (one signal; a keep-alive timer owned by each open stream; seam check: the started steps and the keep-alive are the server's two liveness signals on the same stream, each a small change) - not split further.

Owns: none owned. Traces to: AC31 (started steps precede each await; keep-alives every 15 s on deep, ordinary web and switch-off streams without disturbing resume), FR45 (server half; FR45 owned by M19f), FR40 (amended: keep-alive on ordinary and switch-off replies).

Detail: `.harness/archive/M19e.md`


## M19f — On the phone the clock ticks every second, each outage gets its own resume allowance, and a failed reply shows a plain line

Status: DONE

### Outcome

In the app, a deep research reply's elapsed clock ticks every second locally from the last server `elapsed_ms` (capped at the budget, re-anchored on every event and after every resume); for every reply the 300 s resume allowance applies per outage and resets after each successful resume; and a reply saved with error status and no answer text shows a plain line such as "Lost connection to the Mac before the reply arrived" with its steps, never an empty bubble. App half of FR45 (server half in M19e). Fifth part of the FR41-FR45 split (see M19b). Operational-complexity signal: CONCURRENCY_LIFECYCLE (one signal; the resume allowance's timer ownership in the app client; seam check: the clock and error line are display changes over the same reply state) - not split further.

Owns: FR45. Traces to: AC31 (resume allowance resets after a successful resume; an error reply with no text shows the error line with steps, on deep and ordinary replies), FR40 (amended: per-outage resume allowance and error line on ordinary and switch-off replies).

Detail: `.harness/archive/M19f.md`


## M19g — Faster deep research proven live on the Mac

Status: DONE

### Outcome

With com.harness.server restarted on this code (standing human permission for FR41-FR45 work) and `qwen3.5:35b-a3b` resident, the FR35 `format` probe is re-run with thinking off and the AC29 question set (including the 2026-10-02 heat-pump question) is run with FR41 logging; each run passes on AC29's bar and its speed figures are recorded, not gated. Run before M20 to prove the riskiest integration (thinking off on the real model) early; M21 re-runs AC29 after M20 changes the search path. Sixth part of the FR41-FR45 split (see M19b). Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal; proof only, no production change expected) - not split.

Owns: none owned. Traces to: AC32, AC29 (pass bar).

Detail: `.harness/archive/M19g.md`

## M19h — On the phone, a deep research reply rides out airplane mode and its clock never stalls

Status: DONE

### Outcome

The owner runs a deep research reply on the phone, turns airplane mode on for about 30 s twice, and the reply still ends showing its steps and either the report or a visible status line, with the elapsed clock advancing every second throughout. Owner-performed proof of FR45 on the real phone; needs M19e and M19f live (server restarted under the standing permission; app bundle served from the working tree). Seventh and last part of the FR41-FR45 split (see M19b). Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal; proof only) - not split.

Owns: none owned. Traces to: AC33.

Detail: `.harness/archive/M19h.md`


## M19i — A deep research report knows today's date, looks up current prices for a cost question, and shows the money sum

Status: DONE

### Outcome

Through POST /v1/chat, every deep research model step (brief, plan, queries, pages, notes, gap, write) is given today's date from the Mac clock in its user message while the system message stays byte-identical across steps and days; the plan step is told a cost, price, bill or running-cost question must include a sub-question for current unit prices; the write step is told not to call a price or period current unless a cited note gives that period, to show quantity x unit price = money in the question's currency citing both pages, and to say plainly when no current price was found. Ordinary web replies are unchanged. Planned 2026-10-03 from FR46 / AC34 / AC35, prompted by the owner's M19h phone run (.harness/evidence/M19h-AC1-owner-report.md: kWh but no GBP figure, and 'early 2024' rates). Human decision 2026-10-03: built next, before M20. Split at planning into M19i (prompt changes proven with a scripted fake Ollama, AC34) and M19j (live Mac proof, AC35): FR46 with AC34 and AC35 as one milestone carries signals IMPLEMENTATION_PLUS_LIVE_PROOF (AC35 on the real model) and MULTIPLE_OUTCOMES (request content provable offline vs report content provable only live) - two signals, a required split. This part has no signal: one component's prompts (C6, research.ts) plus tests, about 2-3 production files.

Owns: FR46. Traces to: AC34 (date in every step's user message from an injected clock, byte-identical system message, current-prices plan instruction, write rules), FR40 (ordinary web replies unchanged), FR43 (byte-stable prefix).

Detail: `.harness/archive/M19i.md`


## M19j — Dated, priced deep research reports proven live on the Mac

Status: DONE

### Outcome

With com.harness.server restarted onto the M19i code (standing human permission extended to FR46 work) and `qwen3.5:35b-a3b` resident, the 2026-10-02 heat-pump question is run three times and the electric-car-vs-petrol question once through the server API; at least three of the four reports give a cited GBP running-cost figure, none names a past period as current prices without a cited note giving it, and every run meets AC29's bar; reports are saved and the owner's opinion is recorded, not gated. Second part of the FR46 split (see M19i). Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal; proof only, reusing server/scripts/ac29-live-run.ts) - not split.

Owns: none owned. Traces to: AC35, AC29 (pass bar).

### Architecture

C4, C6, C7, C11, C12, C13

### As-Built

.harness/as-built/M19j.md - RECORDED - 5 of 7 files attributed; components C4, C6, C7, C12; 2 claim mismatches: C11 (Ollama) and C13 (Search service) claimed but not observed - external components unchanged.

### Acceptance Criteria

- [x] **M19j-AC1**: Live on the Mac with `qwen3.5:35b-a3b` resident and com.harness.server restarted onto the M19i code: the 2026-10-02 heat-pump question is run 3 times and the question "What does it cost to run an electric car compared with a petrol car in the UK in 2026? Cover charging and fuel costs per year for typical mileage." once, one at a time, through the server API; each run ends within the budget plus a small margin with status `complete` or `partial`, a report citing at least 3 distinct read pages, and no citation number that fails to resolve to a saved source; each report, stream and run result is saved under .harness/evidence/.
- [x] **M19j-AC2**: At least 3 of the 4 reports give a GBP running-cost figure with a citation - either stated by a cited page or worked from cited usage and a cited unit price; the per-report judgement (figure, citations, which kind) is recorded in evidence.
  - **Amended 2026-10-03, owner-approved** (human decision below, verbatim "Accept and move on", option (b)): for this milestone the accepted bar is **2 of 4** reports with a cited GBP running-cost figure, in place of "at least 3 of the 4" in the original wording above, which is kept unchanged. Everything else in the criterion stands. AC35 in .harness/requirements.md still states 3 of 4; the requirement text is not changed here (see Follow-ups).
- [x] **M19j-AC3**: None of the 4 reports names a past period (e.g. "early 2024") as current prices unless a note it cites gives that period; the per-report check is recorded in evidence, and the owner's opinion of report quality is recorded (not a gate).

### Baseline

6a56912889985f168d355548965a977c0ecc7a7c on m19j-live-priced-reports

### Evidence

- T1 — archive M19h                  Cheap (haiku), attempt 1, PASS; orchestrator check: archive diffs clean against HEAD's section (exit 0); milestones.md 778 -> 720. Commit 3aceb69. .harness/evidence/M19j-T1-worker.log.
- T2 — ev question in live-run set     Cheap (haiku), attempt 1, PASS; verifier PASS: ids q1,q2,q3,heat,ev; `bun test && bun run typecheck` 373 pass, tsc clean. Commit bc73e80. .harness/evidence/M19j-T2-verifier.log.
- T3 — restart onto M19i code          Cheap (haiku), attempt 1, PASS; verifier PASS. com.harness.server pid 4781 (started 2026-10-02 21:56:12) -> 29953 started 2026-10-03 06:39:40 +01:00, after last server/src commit a1d08f3 (06:25:09 +01:00); health 401; qwen3.5:35b-a3b in `ollama ps` (100% GPU). Deviation from packet: the worker ran kickstart twice 11 s apart (4781 -> 29827 -> 29953); no run was in flight (pgrep empty), no harm. Commit df41d9c. .harness/evidence/M19j-T3-restart.log, M19j-T3-verifier.log.
- T4 — four live runs, sequential      Cheap (haiku), attempt 1, task executed as specified; verifier FAIL on the packet's pass test for r1 only (check-only reproduces every value). Budget 480 s, limit with margin 540 s. Not retried: a rerun would replace a failing live sample, which is a human decision.

  | run | generation | window (Z) | wall s | status | research calls | pages read | notes | cited read pages | unresolved | pass |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | r1 heat | 73a99094 | 05:42:37-05:44:42 | 124.417 | complete | 4 | 2 | 2 | 1 | [] | false |
  | r2 heat | 7b09a10e | 05:44:55-05:48:25 | 209.827 | complete | 12 | 6 | 18 | 6 | [] | true |
  | r3 heat | 80786cbb | 05:48:30-05:52:08 | 217.701 | complete | 12 | 6 | 15 | 5 | [] | true |
  | r4 ev | cca85262 | 05:52:13-05:55:19 | 186.212 | complete | 12 | 6 | 13 | 5 | [] | true |

  Commit 4884fd1. .harness/evidence/M19j-T4-<r1-heat|r2-heat|r3-heat|r4-ev>-{stream.txt,fr41.log,result.json,run.log}, M19j-T4-verifier.log.
- T5 — report extraction + judgement   Top (opus), attempt 4, routed Top: NO_TEST_ORACLE; PASS (extraction byte-equal to streams); orchestrator spot-check confirmed no GBP running-cost figure in r1 or r3. AC2: 2 of 4 (r2 "£1.91 to run per hour [3]" gas boiler only, borderline; r4 "£8.80 per 100 miles [6]"); r1, r3 NO. AC3: 4 of 4 pass on the literal wording, 3 borderline (r4 labels 26.11p "October 2026" though r3 cites it as July-September). Cited note/page text is not saved by the server, so judgements rest on report text, source titles/urls and cross-run agreement. Commit 018d0ca. .harness/evidence/M19j-T5-<run>-report.md, M19j-T5-judgement.md.
- T6 — r1 diagnosis                    Top (opus), attempt 4, routed Top: AMBIGUOUS; PASS; orchestrator spot-check: r1 fr41 has 1 queries call vs 3 in r2-r4; research.ts:974 `plan = p ? p.slice(0, Math.max(1, s.subQuestionCount)) : [brief];` (a maximum only). Cause (c) model behaviour: the thinking-off plan returned one sub-question (eval_count 47 vs 88-140), and pagesPerSubQuestion 2 caps reads at 2; no search or page failure; outside M20's scope. .harness/evidence/M19j-T6-diagnosis.md.
- T7 — write rule: always a running-cost figure   Cheap (haiku), attempt 1 FAIL (packet error: exact text reused PLAN_PRICES_RULE's opening phrase, breaking the existing AC3 plan-only test; worker stopped correctly) -> Cheap attempt 2 PASS; verifier PASS: `bun test src/http/deepResearchPrices.test.ts && bun test && bun run typecheck` exit 0, 374 pass, tsc clean, additions-only test diff. .harness/evidence/M19j-T7-worker.log, M19j-T7-verifier.log.
- T8 — plan top-up (server sets sub-question count)  Mid (sonnet), ORDINARY_IMPLEMENTATION. Run 1: implementation correct, but 4 existing tests scripted short plans and the packet barred editing them (packet error, no rung spent, precedent M19i-T2). Run 2 (packet revision: fixture-only edits) PASS; verifier PASS: `bun test src/http/deepResearchPlanCount.test.ts && bun test && bun run typecheck` exit 0, 379 pass (27 files), tsc clean. Only changed assertions: "(1 of 2): sq one" -> "(1 of 3)", "(2 of 2): sq two" -> "(2 of 3)" (fixture plan now 3 items). New behaviour (research.ts ~984-1006): de-dup plan (trim/lower/collapse spaces), if short ONE thinking-off extra plan request for the missing count, then top up with brief, then question; null plan still [brief]; full plan no extra call. .harness/evidence/M19j-T8-worker.log, M19j-T8-verifier.log.
- T9 — gfc2008 question in live-run set   Cheap (haiku), attempt 1, PASS; verifier PASS: ids q1,q2,q3,heat,ev,gfc2008; `bun test && bun run typecheck` 379 pass, tsc clean. Commit 64a2d77. .harness/evidence/M19j-T9-verifier.log.
- T10 — restart onto fixed code          Cheap (haiku), attempt 1, PASS; verifier PASS: pid 29953 -> 39257 started 2026-10-03T07:25:16+01:00, after last server/src commit 07:23:31+01:00 (T8); health 401; qwen3.5:35b-a3b resident; no run in flight. Commit a79692c. .harness/evidence/M19j-T10-restart.log, M19j-T10-verifier.log.
- T11 — five live re-runs, sequential    Cheap (haiku), attempt 1, PASS; verifier PASS: all five `--check-only` exit 0. Budget 480 s.

  | run | generation | window (Z) | wall s | status | research calls | pages read | cited read pages | unresolved | pass |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | r1 heat | c70f4c60 | 06:27:57-06:31:15 | 198.174 | complete | 12 | 6 | 4 | [] | true |
  | r2 heat | 0b63da49 | 06:31:21-06:35:20 | 239.368 | complete | 12 | 6 | 6 | [] | true |
  | r3 heat | e65d745c | 06:35:24-06:39:08 | 224.038 | complete | 12 | 6 | 4 | [] | true |
  | r4 ev | 6c98e963 | 06:39:11-06:42:26 | 194.795 | complete | 10 | 4 | 4 | [] | true |
  | r5 gfc2008 (extra, not gating) | bf00f87c | 06:42:30-06:45:40 | 190.268 | complete | 11 | 5 | 4 | [] | true |

  Commit 01809e0. .harness/evidence/M19j-T11-<run>-{stream.txt,fr41.log,result.json,run.log}, M19j-T11-verifier.log.
- T12 — re-run report extraction + judgement   Top (opus), attempt 4, routed Top: NO_TEST_ORACLE; PASS (extraction byte-equal to streams, worker log). Orchestrator spot-check: r1 and r3 contain no GBP running-cost figure (r1 gives % price changes and says the notes give no kWh usage; r3: "a calculated running cost figure in pounds sterling cannot be derived from the provided sources"). AC2: 2 of 4 (r2 "£1,067 per year" gas / "£848 per year" ASHP [4][3], borderline - 12,000 kWh assumed, £848 does not reproduce; r4 "£480 to £530", "£690" [4], EV only). AC3: 4 of 4 pass (r2, r4 borderline: current-period labels not verifiable from titles). Extra 2008 check (not a gate): no misplaced price/cost content. .harness/evidence/M19j-T12-<run>-report.md, M19j-T12-judgement.md.
- Re-run after T7-T8 (T11-T12) is the AC35 evidence; the first attempt (T4-T6) is kept below for history.
- M19j-AC1: MET on the re-run - r1-r4 all complete within budget, cited read pages 4/6/4/4, no unresolved citations (M19j-T11-verifier.log).
- M19j-AC2: MET against the owner-amended bar of 2 of 4 - re-run 2 of 4 (r2 YES borderline, r4 YES; r1, r3 NO) (M19j-T12-judgement.md); the original bar of 3 of 4 is not met; owner decision 2026-10-03 "Accept and move on".
- M19j-AC3: MET - per-report check PASS 4 of 4 on the re-run (M19j-T12-judgement.md); owner's opinion of report quality: asked twice on 2026-10-03, not given (recorded as "asked, not given"; not a gate).
- First live attempt (T4-T6, before the fixes):
- M19j-AC1: NOT MET - r1 fails the >= 3 cited read pages bar; r2-r4 meet it.
- M19j-AC2: NOT MET - 2 of 4 (needs 3).
- M19j-AC3: per-report check PASS 4 of 4 (literal; borderline calls in M19j-T5-judgement.md); owner's opinion of the first four reports: not given (2026-10-03); to be asked again after the re-run.

### Validation

- For each of r1-heat r2-heat r3-heat r4-ev: `cd server && bun run scripts/ac29-live-run.ts --check-only ../.harness/evidence/M19j-T4-<run>-stream.txt --log ../.harness/evidence/M19j-T4-<run>-fr41.log` - verifier: r1 exit 1 (cited_read_pages 1), r2 r3 r4 exit 0 (.harness/evidence/M19j-T4-verifier.log). `cd server && bun test && bun run typecheck` 373 pass, tsc clean (.harness/evidence/M19j-T2-verifier.log).
- Re-run (the reviewer's validation): for each of r1-heat r2-heat r3-heat r4-ev r5-gfc2008: `cd server && bun run scripts/ac29-live-run.ts --check-only ../.harness/evidence/M19j-T11-<run>-stream.txt --log ../.harness/evidence/M19j-T11-<run>-fr41.log` - verifier: all five exit 0 (.harness/evidence/M19j-T11-verifier.log). `cd server && bun test && bun run typecheck` 379 pass, tsc clean (.harness/evidence/M19j-T9-verifier.log; T8 was the last source change).

### Review

Cycle 1: PASS (2026-10-03), tier Top (opus) - diff contains Top-routed tasks (T5, T6, T12); whole milestone 6a56912..447a7b0. Per-criterion: AC1 PASS, AC2 PASS on the owner-amended 2-of-4 bar (original 3-of-4 not met), AC3 PASS. Findings: 0 BLOCKER, 0 IMPORTANT, 2 OPTIONAL (recorded under Follow-ups). Reviewer re-ran bun test (379 pass), typecheck (clean) and --check-only on all five T11 runs (exit 0); log .harness/evidence/M19j-review.log.

Human Escalation (BLOCKED, 2026-10-03, after the re-run; resolved 2026-10-03 - owner chose (b), see Human decisions below):

Problem:
After the owner's option (a) fixes (M19j-T7 stronger write money rule, M19j-T8 plan top-up) and a fresh re-run, M19j-AC2 still fails: 2 of 4 reports give a cited GBP running-cost figure (needs 3). M19j-AC1 now passes (the plan top-up fixed the short run). M19j-AC3's per-report check passes 4 of 4; owner opinion pending.

Requirement/milestone affected:
M19j / M19j-AC2 (AC35, FR46(d)).

Attempts made:
1. M19j-T4/T5: first live attempt - AC2 2 of 4.
2. M19j-T7 + T8: write step told to give a running-cost money figure per compared option; plan topped up to the server's sub-question count.
3. M19j-T10/T11: server restarted onto the fixed code; five fresh runs, all meet the AC29 bar.
4. M19j-T12: AC2 2 of 4 again (r1, r3 NO; r2 YES borderline; r4 YES); AC3 4 of 4.

Remaining issue:
The failing heat-pump reports say why: their notes held no typical yearly usage figure in kWh (r1, r3) and r3 had no per-kWh unit prices either, so the model, told to cite its inputs, declines to work a sum. A stronger instruction cannot supply missing inputs; nothing in the research step looks for typical usage. FR46 excludes a server-side money-figure check. Repeating the runs unchanged would most likely land at 2 of 4 again.

Recommended decision:
(a) For a cost question, the plan's prices sub-question also asks for typical yearly usage (kWh of gas and electricity, miles driven), so the notes carry both inputs of the sum; prove it with the scripted fake Ollama, then re-run the four AC35 questions fresh (about an hour). Alternatives: (b) accept 2 of 4 by lowering AC35's bar through roast-requirements; (c) leave M19j BLOCKED and move to M20.

Human Escalation (BLOCKED, resolved 2026-10-03 - see Human decisions below):

Problem:
The live proof did not meet AC35. M19j-AC1: run r1 (heat pump) read 2 pages and cited 1 (bar: 3), because the model's plan came back with one sub-question and the server accepts a short plan (research.ts:974 enforces the count as a maximum only; FR35 says the count "is set by the server, not the model"). M19j-AC2: only 2 of 4 reports give a cited GBP running-cost figure (bar: 3); r1 and r3 give unit prices or grants but no running-cost sum, although the M19i write rules ask for it. M19j-AC3 passes on its wording, with borderline calls; the owner's opinion is not yet recorded.

Requirement/milestone affected:
M19j / M19j-AC1, M19j-AC2 (AC35, FR46, AC29 bar; FR35 sub-question count).

Attempts made:
1. M19j-T3: server restarted onto the M19i code; model resident.
2. M19j-T4: the four runs, one at a time - r2, r3, r4 meet the AC29 bar, r1 does not (table above).
3. M19j-T5: per-report judgement - AC2 2 of 4, AC3 4 of 4 (3 borderline).
4. M19j-T6: r1 diagnosis - short plan (model behaviour, server accepts it); no search/page failure; not M20's scope; recurrence estimated 10-25% per run.

Remaining issue:
Meeting AC35 needs either a code change (server tops up or retries a plan shorter than the set sub-question count; a stronger write instruction to always state a £ running-cost sum) followed by four fresh runs, or a human decision to accept or re-run. FR46 excludes a server-side money-figure check, so AC2 can only be pushed through the prompt. Rerunning unchanged would replace failing samples and likely fail again at similar rates.

Recommended decision:
Add a small fix milestone (M19k) before M20: (1) the server enforces the sub-question count as a minimum too - retry the plan once, then top up with the brief - as FR35 already says; (2) strengthen the write step's money rule with a worked example so a cost report always states a £ running-cost figure or says none was found; proven with the scripted fake Ollama. Then re-run M19j's four runs fresh. Record the owner's opinion of the four saved reports (.harness/evidence/M19j-T5-*-report.md) now.

Human decisions:
- 2026-10-03, owner, answer verbatim "Do a": option (a) - fix both first: the server insists on a full plan (tops up a short plan so the server, not the model, sets the sub-question count, per FR35) and the write step gets a clearer instruction to always do the running-cost sum (FR46(d)); then run the four AC35 questions again, fresh. Owner's opinion of the first four reports: not given. Status BLOCKED -> IN_PROGRESS. Shape: not split - M19j has work recorded (T1-T6), so per the pickup rule the fixes run as further M19j tasks on its branch; acceptance criteria unchanged.
- 2026-10-03, owner, answer "Yes": add ONE non-price question, "What caused the 2008 financial crisis?", to the live re-run, one at a time through the server API after the fixes; save report, stream and run result under .harness/evidence/ and record a per-report check for misplaced price/cost content (a price/cost section, a current-unit-prices sub-question, or a "no current price was found" statement). Extra recorded check outside AC35: not an acceptance criterion, does not gate pass/fail.
- 2026-10-03, owner, answer verbatim "Accept and move on": interpreted as option (b) of the post-re-run escalation - accept the M19j-T11/T12 result of 2 of 4 reports with a cited GBP running-cost figure as meeting M19j-AC2's intent for this milestone; M19j-AC2 amended explicitly (original wording kept, accepted bar 2 of 4); finish M19j and move to the next milestone; no further code and no further live runs. Owner's opinion of report quality asked twice, not given (does not gate AC3). requirements.md (AC35, FR46) not changed here. Status BLOCKED -> REVIEW.

### Review Cycles

0

### Follow-ups

- FR46 out of scope (requirements, 2026-10-03): no phone check - Mac runs only.
- The server logs neither the plan's sub-question text nor per-search result counts, and saves no note text; diagnosis and the AC3 note check had to infer from titles and counts (M19j-T6, M19j-T5).
- check-state.py (harness updated 2026-10-03 06:33) reports two pre-existing errors on M1's legacy plan object (`milestones.M1.plan.status is invalid: None`, `milestones.M1.plan names no artifact`); unrelated to M19j, left untouched.
- AC35 / FR46 in .harness/requirements.md still state the original bar (at least 3 of 4 reports with a cited GBP running-cost figure); the owner accepted 2 of 4 for M19j on 2026-10-03 ("Accept and move on"). Update AC35 / FR46 via roast-requirements to reflect that acceptance.
- Unaddressed root cause of M19j-AC2's shortfall: research finds per-unit prices but not typical yearly usage (kWh of gas and electricity, miles driven), so the model cannot work a cited running-cost sum (M19j-T12-judgement.md). Candidate fix (escalation option (a)): a cost question's prices sub-question also asks for typical yearly usage, proven with the scripted fake Ollama, then a fresh re-run.
- Review M19j cycle 1 OPTIONAL: the M19j Outcome text still says 'at least three of the four reports'; fold into the AC35/FR46 roast-requirements update.
- Review M19j cycle 1 OPTIONAL: the M19j-T8 plan top-up request runs thinking off with no per-call time cap, output cap or routine sampling settings (only the plan phase deadline bounds it), unlike FR42; either pass s.routineCapMs / s.routineNumPredict or record the exception in FR42.


## M20 — Search backends rest after being blocked, and repeated searches and page reads come from cache

Status: TODO

### Outcome

The search service treats each backend as a circuit breaker (rate-limit: skipped 1 hour; CAPTCHA/bot-check: 24 hours) and caches search results by normalised query and page reads by final URL for 24 hours, for ordinary web replies as well as deep research; ordinary replies are otherwise unchanged (FR40). Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal; the live part is re-running the existing proofs) - not split.

Owns: FR39, FR40. Traces to: AC28 (rate-limit 1 h, CAPTCHA 24 h, cache, ordinary replies unchanged).

### Architecture

C12, C13, C14

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M20-AC1**: Search service tests through its HTTP search API with faked backends and a controlled clock: a backend returning rate-limit / too-many-requests is skipped for 1 hour and one returning a CAPTCHA or bot-check for 24 hours, searches go to the remaining backends then the headless browser meanwhile, and with every backend resting or failing the search is "unavailable" as in FR20.
- [ ] **M20-AC2**: Search service tests: a repeated search (after query normalisation) and a repeated page read (by final URL) within 24 hours are served from the Mac-side cache without contacting a backend or the page; after 24 hours they are fetched again.
- [ ] **M20-AC3**: Ordinary web replies go through the same breakers and cache; all existing ordinary-web and switch-off tests pass unchanged, and the existing live proofs (server/scripts/web-chat-proof.sh, server/scripts/web-failure-proof.sh) still pass.

### Plan

`.harness/plans/M20.md` — DRAFT

### Baseline

7adc092e938134a3455fabdf19f1f02043f381d2 on m20-search-breakers-cache

### Evidence

### Validation

### Review

Pending.

### Review Cycles

0

### Follow-ups

- FR40 amended 2026-10-02: ordinary and switch-off replies also get FR45's stream keep-alive, per-outage resume allowance and error line; those are built and proven in M19e and M19f (AC31). M20-AC3's 'existing ordinary-web and switch-off tests pass unchanged' is judged against the suite as it stands after M19f. M20's criteria are otherwise unaffected.

## M21 — Four real research questions answered on the Mac, and the owner's phone screenshot

Status: TODO

### Outcome

The finished feature proven live: three real research-style questions plus the 2026-10-02 heat-pump question run on `qwen3.5:35b-a3b` each end within budget with a report citing at least three distinct read pages, and the owner photographs a finished deep research reply on the phone. Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal; proof only) - not split.

Owns: none owned. Traces to: AC29 (amended 2026-10-02: plus the heat-pump question), AC30.

### Architecture

C1, C6, C11, C12, C13

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M21-AC1**: Live on the Mac with `qwen3.5:35b-a3b` resident: 3 real research-style questions plus the 2026-10-02 heat-pump question each end within the budget plus a small margin with status `complete` or `partial`, a report citing at least 3 distinct read pages, and no citation number that fails to resolve to a saved source; the owner's opinion of report quality is recorded in the evidence (not a gate).
- [ ] **M21-AC2**: The owner's phone screenshot of a finished deep research reply showing its steps, its status, logo citations and "Sources (n)" is saved under .harness/evidence/.

### Baseline

### Evidence

### Validation

### Review

Pending.

### Review Cycles

0

### Follow-ups

- AC29 amended 2026-10-02 to add the 2026-10-02 heat-pump question: M21-AC1, title and outcome updated at planning on 2026-10-02 to the four-question set. M19g runs the same set before M20 for AC32; M21 re-runs it after M20 because M20 changes the search path. M21-AC2 is unaffected.

## M5a — Always-on server and bundle host

Status: BLOCKED

### Outcome

The server and the app bundle host run under per-user LaunchAgents that restart them after a crash or a Mac reboot, so opening the project in Expo Go on the phone needs no manual step on the Mac. Split from M5 at pickup (4 criteria, within size) because of operational-complexity signals CONCURRENCY_LIFECYCLE + IMPLEMENTATION_PLUS_LIVE_PROOF (a required split), plus MULTIPLE_OUTCOMES; parts: M5a always-on LaunchAgents for server and bundle host (M5-AC1, M5-AC2), M5b plain-language error messages (M5-AC3), M5c PWA retirement (M5-AC4).

### Architecture

C8, C9

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M5-AC1**: After a Mac reboot, opening the project in Expo Go on the phone works with no manual step on the Mac.
- [x] **M5-AC2**: Killing either the server process or the bundle host process causes it to restart automatically.

### Baseline

296b9e5b87b04a92fcac5ad92df442366f636454 on m5a-always-on

### Evidence

- M5a-T1 live restart proof ops/scripts/restart-proof.sh — Mid (ORDINARY_IMPLEMENTATION: live launchd lifecycle proof), attempt 3 PASS; verifier PASS — .harness/evidence/M5a-T1-verifier.log. Commit 6322847.
- M5a-T2 read-only post-reboot readiness check ops/scripts/boot-readiness-check.sh (+1 entry in verify-ops-install.sh) — Mid (ORDINARY_IMPLEMENTATION: must be right on the single human reboot), attempt 3 PASS; verifier PASS — .harness/evidence/M5a-T2-verifier.log. Commit 3fe0ae2.
- M5-AC2: SIGKILL of launchd's tracked pid — server 88260->89022 healthy in 1 s (unauth 401, auth /v1/state 200); bundle host 88461->89068 healthy in 3 s (/status running, iOS manifest 200 naming ryans-mac-studio.tailc3648a.ts.net); SIGKILL of the TCP 8081 listener (lsof) 89068->89216 healthy in 10 s; exactly one 8081 listener after each; exit 0. No plist change needed: `bun x expo` execs into node, so launchd's pid is the listener.
- M5-AC1: NOT YET PROVEN. Mac-side check passes pre-reboot (current boot 2026-08-22). Needs the human reboot below.

### Validation

`cd /Users/ryankenny/Projects/CodingHarnessv2 && bash ops/scripts/verify-ops-install.sh && bash ops/scripts/restart-proof.sh && bash ops/scripts/boot-readiness-check.sh && (cd ops && bun test src/token)` — reviewer runs once; restart-proof kills and restarts the live services (no sudo); boot-readiness-check is read-only. M5-AC1 also needs .harness/evidence/M5a-AC1-reboot.log and the phone observation.

### Review

Pending.

Human Escalation (BLOCKED):

Problem:
M5-AC1 needs a real Mac reboot and an Expo Go check on the phone; agents may not reboot. Also, FileVault is On and auto-login is off (`fdesetup status`; loginwindow autoLoginUser unset), so after a reboot the per-user LaunchAgents, Tailscale and Ollama start only once the user types the Mac password at the unlock screen.

Requirement/milestone affected:
M5a / M5-AC1 (FR15, AC11).

Attempts made:
1. M5a-T1: live kill/restart proof for both services — PASS (M5-AC2 proven).
2. M5a-T2: read-only post-reboot readiness check — PASS pre-reboot.
3. Checked boot behaviour: FileVault On, no auto-login.

Remaining issue:
The reboot itself, the phone check, and the post-reboot readiness log; plus a decision on whether the unlock-screen login counts as a "manual step on the Mac".

Recommended decision:
Treat logging in at the unlock screen as part of the reboot (no change), then do: (1) reboot the Mac; (2) log in at the password screen and do nothing else on the Mac — no Terminal, no starting anything; (3) wait about two minutes; (4) on the iPhone with Tailscale connected, force-quit Expo Go, reopen it, open the project (exp://ryans-mac-studio.tailc3648a.ts.net:8081), confirm the app loads, the Models screen lists models, and a short message gets a reply — take a screenshot; (5) only then, on the Mac: `cd ~/Projects/CodingHarnessv2 && bash ops/scripts/boot-readiness-check.sh 2>&1 | tee .harness/evidence/M5a-AC1-reboot.log` and confirm it ends "PASS: ALL CHECKS PASSED" with a boot time from today. Then set M5a to REVIEW. Not recommended: disabling FileVault for auto-login (security cost), or moving to system-level daemons (a material architecture change to C9).

### Review Cycles

0

### Follow-ups

- FileVault login after reboot: resolved 2026-09-26 by the human — typing the Mac password at the unlock screen counts as part of rebooting, not a manual step. No change to FileVault or architecture. Reboot itself still pending.
- Reordered 2026-09-26 by the human: M5b runs before M5a while M5a waits on the human-performed reboot for M5-AC1 (human not at the Mac). M5a stays BLOCKED until the reboot evidence exists; M5c still runs last.
- R3 still applies: the bundle host serves the working tree, so a mid-edit checkout reaches the phone after any restart.
- Reboot attempt 1 (2026-09-28, boot 18:35:40 BST): FAIL. Human reported the app opened in Expo Go after the reboot, but boot-readiness-check.sh failed one check -- authenticated GET /v1/state over the tailnet -> 503 (not 200) because Ollama (C11) was not running: it had no login LaunchAgent and had only ever been started by hand. Evidence: .harness/evidence/M5a-AC1-reboot-attempt1-FAIL.log.
- Fix approved by the human 2026-09-28: Ollama starts at login. `brew services start ollama` was blocked (Xcode license not accepted, needs sudo), so Homebrew's own plist was installed the same way brew services would: cp /opt/homebrew/opt/ollama/homebrew.mxcl.ollama.plist ~/Library/LaunchAgents/ && launchctl bootstrap gui/$UID (label homebrew.mxcl.ollama, RunAtLoad + KeepAlive, env OLLAMA_FLASH_ATTENTION=1, OLLAMA_KV_CACHE_TYPE=q8_0). Undo: launchctl bootout gui/$UID/homebrew.mxcl.ollama && rm the plist. Pre-reboot re-run of boot-readiness-check.sh: PASS: ALL CHECKS PASSED. M5-AC1 still needs reboot attempt 2 (same steps as above, including a model reply on the phone) with its log at .harness/evidence/M5a-AC1-reboot.log.
- Reboot attempt 2 (2026-09-29, boot 20:43:59 BST): INCONCLUSIVE, M5-AC1 not proven. Both LaunchAgents started by launchd after boot (ppid 1), and Ollama came up at login, but Tailscale was disconnected ('Tailscale is stopped'; app and network extension running), so boot-readiness-check.sh run 1 failed 7 tailnet-dependent checks. With the human's approval an agent ran `tailscale up`; run 2 then passed all checks, retire-pwa-proof.sh exit 0 (11 PASS), and the human reported 'Expo Go works on my phone'. It is unknown whether Tailscale was already disconnected before the reboot (restartState = maintainCurrentState, TailscaleStartOnLogin = 1; no Tailscale unified-log entries). Procedure deviation: the Mac-side check ran before the phone check, and a model reply on the phone was not separately confirmed. Evidence: .harness/evidence/M5a-AC1-reboot-attempt2-INCONCLUSIVE.log, .harness/evidence/M5a-AC1-reboot-attempt2-retire-pwa-proof.log. Next: before reboot attempt 3, confirm Tailscale shows Connected; if it is disconnected after that reboot, Tailscale does not reconnect at login on its own and needs a fix before M5-AC1 can pass.
- Parked 2026-09-29 by the human (verbatim: "Park the restart for now we're moving on"): M5a stays BLOCKED with criteria, evidence and status unchanged; reboot attempt 3 for M5-AC1 is deferred; M5a is reordered to run after the web search milestones (M6-M13). Its escalation stands and is picked up again after M13.
