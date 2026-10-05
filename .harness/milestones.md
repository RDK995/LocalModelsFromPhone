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

Detail: `.harness/archive/M19j.md`



## M20 — Search backends rest after being blocked, and repeated searches and page reads come from cache

Status: DONE

### Outcome

The search service treats each backend as a circuit breaker (rate-limit: skipped 1 hour; CAPTCHA/bot-check: 24 hours) and caches search results by normalised query and page reads by final URL for 24 hours, for ordinary web replies as well as deep research; ordinary replies are otherwise unchanged (FR40). Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal; the live part is re-running the existing proofs) - not split.

Owns: FR39, FR40. Traces to: AC28 (rate-limit 1 h, CAPTCHA 24 h, cache, ordinary replies unchanged).

Detail: `.harness/archive/M20.md`


## M21 — Four real research questions answered on the Mac, and the owner's phone screenshot

Status: DONE

### Outcome

The finished feature proven live: three real research-style questions plus the 2026-10-02 heat-pump question run on `qwen3.5:35b-a3b` each end within budget with a report citing at least three distinct read pages, and the owner photographs a finished deep research reply on the phone. Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal; proof only) - not split.

Owns: none owned. Traces to: AC29 (amended 2026-10-02: plus the heat-pump question), AC30.

Detail: `.harness/archive/M21.md`


## M22 — Bot-check and near-empty pages are never listed as sources, and deep research reads another page in their place

Status: DONE

### Outcome

Through POST /v1/chat, one shared check classes a fetched page as unreadable when its text shows bot-challenge markers (e.g. scribd.com's "Client Challenge" screen, CAPTCHA, "verify you are human") or has fewer than FR43's 40 words. In deep research such a page gets no number, is not saved or listed as a source, makes no note call, its read step ends failed ("Reading: scribd.com — couldn't be read"), and the next unread URL from the same sub-question's existing search results is read in its place while the deadline allows, with no extra search; in an ordinary web reply `read_page` tells the model plainly the page could not be read and why, and the page is neither numbered nor listed; an unreadable page is never stored in or served from FR39's page cache. Remaining pages stay numbered 1..n in first-read order and FR43 no-match pages are unchanged. Planned 2026-10-04 from FR47 / AC36 (FR47 part), prompted by the owner's M21 phone run (two scribd.com "Client Challenge" pages among Sources (6), .harness/evidence/M21-AC2-phone-screenshot-1.png). FR47-FR48 with AC36-AC37 split at generation into M22 (FR47), M23 (FR48) and M24 (live proof, AC37): as one milestone it carries IMPLEMENTATION_PLUS_LIVE_PROOF, MULTIPLE_OUTCOMES (unreadable pages vs kept notes, independently demonstrable) and CONCURRENCY_LIFECYCLE (replacement reads inside FR44's prefetch and FR36's deadline). This part keeps one signal, CONCURRENCY_LIFECYCLE (seam check: the deep research and ordinary-reply halves share the one check and its cache rule, so splitting them leaves the shared check unowned or duplicated); subsystems C6, C12, C13 (three, not over three) - not split further.

Detail: `.harness/archive/M22.md`


## M23 — Deep research keeps notes whose quotes differ from the page only trivially, and logs every note it drops

Status: DONE

### Outcome

Through POST /v1/chat, FR37's quote check compares a note's quote with the page's full stored text after normalising both sides (Unicode compatibility form, curly and straight quotes alike, all dashes alike, whitespace collapsed, case ignored, markdown link, image and emphasis syntax stripped to the visible text), and a quote with an ellipsis matches when each piece appears in order; a quote whose words are not on the page is still dropped. Every dropped note is written to the FR41 log with run, page number, reason and the first ~120 characters of the quote, and the run-end line gains `notes_dropped`. Deep research only; ordinary web replies take no notes. Planned 2026-10-04 from FR48 / AC36 (FR48 part), prompted by the owner's M21 phone run (server log: note calls on four readable pages, `notes_kept:1`, so the report cited one page three times). Second part of the FR47-FR48 split (see M22). No operational-complexity signal: one subsystem (C6, server/src/generations/research.ts quote check and FR41 log line), about 1-2 production files.

Owns: FR48. Traces to: AC36 (FR48 part: normalised quote match, ellipsis pieces in order, rejection of words not on the page, every drop logged with reason, run-end notes_dropped), FR37 (citation rule otherwise unchanged), FR41 (log line).

### Architecture

C4, C6

### As-Built

`.harness/as-built/M23.md` — RECORDED - 7 of 7 files attributed; components C4, C6; 1 edge; no claim mismatches

### Acceptance Criteria

- [x] **M23-AC1**: Server tests through POST /v1/chat with a faked search service and a scripted fake Ollama: a note is kept when its quote differs from the page's stored text only by curly vs straight quotes or apostrophes, dash variants, whitespace, letter case, Unicode compatibility forms, or markdown link, image or emphasis syntax (e.g. `[Treaty of Versailles](https://…)` on the page matches "Treaty of Versailles"); a quote containing "…" or "..." is kept when each piece, normalised, appears on the page in order.
- [x] **M23-AC2**: Server tests through POST /v1/chat: a note is still dropped when its quote's words are not on the page, and when its ellipsis pieces appear on the page only out of order; kept notes' citations behave as FR37 already requires.
- [x] **M23-AC3**: Server tests through POST /v1/chat: each dropped note writes one FR41 log entry carrying the run, the page number, the reason (missing quote, quote not found, invalid page number) and the first ~120 characters of the quote; the run-end log line carries `notes_dropped` equal to the number of dropped notes alongside `notes_kept`.
- [x] **M23-AC4**: Ordinary web and switch-off replies are unchanged, and all existing tests pass: `cd server && bun test && bun run typecheck` exit 0.

### Plan
`.harness/plans/M23.md` — AGREED

### Baseline

7a37887986ea2bd762ca5d3133466d775c4c3cb3 on m23-quote-match

### Evidence

```
M23-T1  — FR48 quote matcher             Cheap, attempt 1, PASS (160530a; .harness/evidence/M23-T1-verifier.log)
M23-T1b — correction: fold curly quotes  Cheap attempt 1 INTERRUPTED (turn limit; change complete on disk) → verifier PASS
          U+2018/2019/201C/201D          (aecd491; .harness/evidence/M23-T1b-verifier.log). Defect found by T2 attempt 3.
M23-T2  — keepNotes uses matcher +        Cheap attempt 1 FAIL (orchestrator: e2e curly test had no curly chars; no e2e
          POST /v1/chat quote tests       Unicode-compat test) → Cheap attempt 2 INTERRUPTED twice (40-turn limit)
                                          → Mid attempt 3 FAIL only on the T1 defect → after T1b, verifier PASS on the
                                          unchanged tree (2006163; .harness/evidence/M23-T2-verifier.log)
M23-T3  — drop log + notes_dropped        Cheap attempt 1 FAIL (orchestrator: edited existing test (e); inexact quote asserts)
                                          → Cheap attempt 2 FAIL (test (e) swapped, not restored)
                                          → Mid attempt 3 PASS (8d6e9a8; .harness/evidence/M23-T3-verifier.log)
```

- M23-AC1: deepResearchQuotes.test.ts (a) 14 per-difference kept cases (real U+2019/201C/201D/2013/2014/FB01/00A0/FF1x characters, markdown link/image/emphasis) + combined run; (b) "…" and "..." in order; quoteMatch.test.ts unit cases.
- M23-AC2: deepResearchQuotes.test.ts (c) changed number dropped; (d) reversed ellipsis dropped; (e) FR37 citations and sources.
- M23-AC3: deepResearchQuotes.test.ts "note dropping" (a) four `deep_research_note_dropped` lines with run = generation id, n, reason, exact quote (collapsed; 200 chars cut to 120; ""); (b) run_end `notes_dropped: 4`, `notes_kept: 1`; (c) all kept: no drop lines, `notes_dropped: 0`. No `invalid_page_number` reason — the server assigns n (plan risk 1).
- M23-AC4: `cd server && bun test && bun run typecheck` exit 0, 467 pass, tsc clean on 8d6e9a8 (M23-T3 verifier).

### Validation

`cd /Users/ryankenny/Projects/CodingHarnessv2/server && bun test && bun run typecheck` (reviewer runs once; covers M23-AC1..AC4; focused files: server/src/http/deepResearchQuotes.test.ts, server/src/generations/quoteMatch.test.ts, server/src/http/deepResearchModelCalls.test.ts, server/src/generations/research.test.ts). Last verifier run (M23-T3) exit 0: 467 pass, typecheck clean — .harness/evidence/M23-T3-verifier.log.

### Review

Cycle 1: PASS (tier Mid, model sonnet, reason MID_ROUTED_TASK_IN_DIFF; diff 7a37887..7b10c89; full milestone scope). Per-criterion: M23-AC1..AC4 all PASS. Findings: 0 BLOCKER, 0 IMPORTANT, 0 OPTIONAL. Reviewer re-ran validation at 7b10c89: server 467 pass, typecheck exit 0 — .harness/evidence/M23-review.log. No report written (PASS).

### Review Cycles

0

### Follow-ups

- FR48 out of scope (requirements 2026-10-04): the quote check is not removed or replaced by fuzzy matching beyond the listed normalisations; applies to deep research only.
- Placed ahead of M5a (2026-10-04, extension for FR47-FR48): M5a is BLOCKED and parked waiting on the owner's Mac reboot check, and /harness:plan and /harness:implement stop at the first BLOCKED milestone, so new work is built before it, as the human decided for M14, M15 and M19b-M21. M5a stays BLOCKED and parked, its record unchanged, and is picked up after M24.
- quoteMatch.ts step-3 comments list straight characters where the regex now folds U+2018/2019/201C/201D (comment only). The existing quoteMatch.test.ts "curly" case near line 54 uses straight characters; the M23-T1b tests now cover curly folding.
- Verifiers missed three orchestrator-caught defects in M23 (T2 attempt 1, the T1 curly-quote gap, T3 attempt 1's edit to an existing test): worth tightening the verifier's existing-test-unchanged check.

## M24 — Real sources and kept notes proven live on the Mac with the owner's World War Two question

Status: IN_PROGRESS

### Outcome

After the owner agrees to com.harness.server being restarted onto the M22-M23 code (asked first: no standing permission covers this work) and with `qwen3.5:35b-a3b` resident, the owner's question "What was the cause of World War Two from German perspective" and the four AC29 questions (including the heat-pump question) are each run once through the server API; every run meets AC29's bar and no run's saved sources include a page the FR47 check classes as unreadable; per run, notes kept, notes dropped and drop reasons are recorded. A run that misses the bar is recorded and brought to the owner, not re-run until it passes. No phone change or phone screenshot. Third part of the FR47-FR48 split (see M22). Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal; proof only, reusing server/scripts/ac29-live-run.ts) - not split.

Owns: none owned. Traces to: AC37, AC29 (pass bar).

### Architecture

C4, C6, C7, C11, C12, C13

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M24-AC1**: Before any restart, the owner is asked and agrees to com.harness.server being restarted onto the M22-M23 code (their answer recorded verbatim in Evidence); a read-only readiness check then shows the server and search service running committed code at or after M23's last commit and `qwen3.5:35b-a3b` resident.
- [ ] **M24-AC2**: Live on the Mac through the server API: "What was the cause of World War Two from German perspective" and the four AC29 questions (Raft vs Paxos, LFP vs NMC, WebAssembly components, the 2026-10-02 heat-pump question) are each run once, one at a time; every run ends within the budget plus a small margin with status `complete` or `partial`, at least 3 distinct cited read pages and no citation number that fails to resolve to a saved source (`server/scripts/ac29-live-run.ts --check-only` exit 0 per run).
- [ ] **M24-AC3**: For each of the five runs, no saved source is a page the FR47 check classes as unreadable (checked by applying that check to each saved source's stored text), and the run's notes kept, notes dropped and drop reasons from its FR41 log are recorded in evidence. A run that misses any bar is recorded and brought to the owner, not re-run until it passes.

### Plan
`.harness/plans/M24.md` — AGREED

### Baseline

1bc598b1e2754d13e1e6e42b06cbbfa24f9e7ba8 on m24-live-wwii-proof

### Evidence

- M24-AC1 Owner permission, asked and answered 2026-10-05 in this session, before any restart. Question asked: "The last two fixes (skipping bot-check pages as sources, and keeping notes whose quotes differ only in small ways like curly quotes) are built, but the always-on server on your Mac is still running the old code. To test them for real, I need to restart the server and the search service so they pick up the new code. While they restart (a minute or so), the phone app won't be able to reach the Mac, and any reply in progress would be cut off. After that, I'll run your World War Two question plus the four usual test questions, one at a time — roughly 4 minutes each, about 20 minutes total. OK to restart?" Owner's answer: "Yes, restart now" Authorises restarting com.harness.server and com.harness.search once for M24; covers nothing else.
- M24-T1 ac29-live-run.ts gains ww2 question, selectNoteDroppedLines, notes_dropped/drop_reasons/note_drop_lines, checkSavedSources (classifyPage), live source re-read to <base>-sources-text.json, sources_check/ac37_pass, --check-only --sources-text — Cheap, attempt 1, PASS; verifier PASS (packet Tests exit 0: ac29 24 pass, full suite 477 pass, typecheck clean, M21-T6 q1/q2/q3/heat --check-only exit 0; files within allowed; tests weakened NO) — .harness/evidence/M24-T1-verifier.log.
- M24-T2 restart + read-only readiness (M24-AC1) — Cheap, attempt 1, PASS; verifier PASS (read-only re-check). Kickstarted once each under the owner's recorded yes: com.harness.search 61417->76643, com.harness.server 71661->76646, both started Mon 5 Oct 10:06:38 2026 (local, +01:00), after last server/ (excl. scripts) commit 8d6e9a8 2026-10-05T07:58:21+01:00, search/ 46ead91 2026-10-04T21:47:56+01:00, shared/ 5e38195 2026-10-04T21:38:07+01:00; M23 last commit 1bc598b ancestor of HEAD (exit 0); git status -- server search shared mobile empty; health 7789=401, 7790=404; ollama ps: qwen3.5:35b-a3b 100% GPU Forever; ops/scripts/boot-readiness-check.sh exit 0 'PASS: ALL CHECKS PASSED' — .harness/evidence/M24-T2-readiness.log, .harness/evidence/M24-T2-verifier.log.
- M24-T3 ww2 (M24-AC2, M24-AC3) — Cheap, attempt 1, PASS; verifier PASS (--check-only exit 0 reproduces values). generation 5898f9f5-eb0b-45e7-aa91-ed7372053176, 2026-10-05T09:10:53Z-09:14:10Z, final_status complete, total_wall_s 196.567 / limit 540, distinct_pages_read 6, cited_read_pages 4, unresolved_citations [], notes_kept 14, notes_dropped 8, drop_reasons {"quote_not_found": 8}, sources_check 6 checked / 0 unreadable / 0 unchecked, pass true, ac37_pass true — .harness/evidence/M24-T3-ww2-result.json, -run.log, -verifier.log.
- M24-T3 q1 (M24-AC2, M24-AC3) — Cheap, attempt 1, PASS; verifier PASS (--check-only exit 0 reproduces values). generation af0d2484-3ca5-47ce-b650-e9a0f7328e64, 2026-10-05T09:16:11Z-09:19:48Z, final_status complete, total_wall_s 216.395 / limit 540, distinct_pages_read 5, cited_read_pages 5, unresolved_citations [], notes_kept 19, notes_dropped 8, drop_reasons {"quote_not_found": 8}, sources_check 5 checked / 0 unreadable / 0 unchecked, pass true, ac37_pass true — .harness/evidence/M24-T3-q1-result.json, -run.log, -verifier.log (worker log renamed from M24-T3-worker.log to M24-T3-q1-worker.log by the orchestrator).
- M24-T3 q2 (M24-AC2, M24-AC3) — Cheap, attempt 1, PASS; verifier PASS (--check-only exit 0 reproduces values). generation df6d81e6-f6be-4278-8a3e-29d17472016f, 2026-10-05T09:21:55Z-09:25:14Z, final_status complete, total_wall_s 199.561 / limit 540, distinct_pages_read 6, cited_read_pages 3, unresolved_citations [], notes_kept 12, notes_dropped 13, drop_reasons {"quote_not_found": 13}, sources_check 6 checked / 0 unreadable / 0 unchecked, pass true, ac37_pass true — .harness/evidence/M24-T3-q2-result.json, -run.log, -check.log, -verifier.log.
- M24-T3 q3 (M24-AC2, M24-AC3) — Cheap, attempt 1, PASS; verifier PASS (--check-only exit 0 reproduces values). generation 1dfd519e-5fcc-46fe-82c1-ed65648827eb, 2026-10-05T09:27:13Z-09:30:50Z, final_status complete, total_wall_s 217.097 / limit 540, distinct_pages_read 6, cited_read_pages 5, unresolved_citations [], notes_kept 17, notes_dropped 13, drop_reasons {"quote_not_found": 13}, sources_check 6 checked / 0 unreadable / 0 unchecked, pass true, ac37_pass true — .harness/evidence/M24-T3-q3-result.json, -run.log, -worker.log, -verifier.log.
- M24-T3 heat (M24-AC2, M24-AC3) — Cheap, attempt 1, PASS; verifier PASS (--check-only exit 0 reproduces values; check-only total_wall_s 211.644 vs run 211.649, stream-derived). generation 482abfb6-015c-41f5-aeb5-08fbfcf9a843, 2026-10-05T09:33:34Z-09:37:06Z, final_status complete, total_wall_s 211.649 / limit 540, distinct_pages_read 5, cited_read_pages 4, unresolved_citations [], notes_kept 18, notes_dropped 5, drop_reasons {"quote_not_found": 5}, sources_check 5 checked / 0 unreadable / 0 unchecked, pass true, ac37_pass true — .harness/evidence/M24-T3-heat-result.json, -run.log, -worker.log, -verifier.log.
- Handoff (orchestrator continuation 1, turn budget): remaining M24-T3 heat (one fresh Cheap worker, packet .harness/tasks/M24-T3.md, <ID>=heat, then verifier), M24-T4 summary, milestone validation, REVIEW. Services not to be restarted again.

### Validation

### Review

Pending.

### Review Cycles

0

### Follow-ups

- Placed ahead of M5a (2026-10-04, extension for FR47-FR48): M5a is BLOCKED and parked waiting on the owner's Mac reboot check, and /harness:plan and /harness:implement stop at the first BLOCKED milestone, so new work is built before it, as the human decided for M14, M15 and M19b-M21. M5a stays BLOCKED and parked, its record unchanged, and is picked up after M24.

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
