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

### Architecture

C12, C13, C14

### As-Built

.harness/as-built/M20.md - RECORDED - 10 of 10 files attributed; components C13, C14; 1 claim mismatch: C12 claimed but not modified (server/src/web unchanged, as M20-AC3 requires)

### Acceptance Criteria

- [x] **M20-AC1**: Search service tests through its HTTP search API with faked backends and a controlled clock: a backend returning rate-limit / too-many-requests is skipped for 1 hour and one returning a CAPTCHA or bot-check for 24 hours, searches go to the remaining backends then the headless browser meanwhile, and with every backend resting or failing the search is "unavailable" as in FR20.
- [x] **M20-AC2**: Search service tests: a repeated search (after query normalisation) and a repeated page read (by final URL) within 24 hours are served from the Mac-side cache without contacting a backend or the page; after 24 hours they are fetched again.
- [x] **M20-AC3**: Ordinary web replies go through the same breakers and cache; all existing ordinary-web and switch-off tests pass unchanged, and the existing live proofs (server/scripts/web-chat-proof.sh, server/scripts/web-failure-proof.sh) still pass.

### Plan
`.harness/plans/M20.md` — AGREED

### Baseline

7adc092e938134a3455fabdf19f1f02043f381d2 on m20-search-breakers-cache

### Evidence

- M20-T1 helper per-engine attempts (`--backends`, `--no-browser`, `attempts`, classify_failure) — Mid (ORDINARY_IMPLEMENTATION), attempt 3 PASS; verifier PASS, `cd search/helper && .venv/bin/python -m unittest test_search -v` exit 0, 52 tests — .harness/evidence/M20-T1-verifier.log.
- M20-T2 per-backend breakers in the search service (rate_limited 1 h, captcha 24 h, `--backends`/`--no-browser` from non-resting set, 503 search_unavailable when all rest; wired in src/index.ts via SEARCH_DDGS_BACKENDS, default duckduckgo,bing,brave,mojeek) — Mid (ORDINARY_IMPLEMENTATION), attempt 3 PASS; verifier PASS, `cd search && bun test && bun run typecheck` exit 0, 168 pass — search/src/http/breakers.test.ts; .harness/evidence/M20-T2-verifier.log.
- M20-T3 24 h in-memory cache (search by normalised query + max_results; page reads by final URL with requested->final map; successes only; `x-cache: hit|miss`; breakers consulted only on a miss) — Mid (ORDINARY_IMPLEMENTATION), attempt 3 BLOCKED on a packet defect (breakers.test.ts not allowed; orchestrator amended packet, test setup only, see plan Changes during implementation) → Mid retry PASS; verifier PASS, `cd search && bun test && bun run typecheck` exit 0, 175 pass — search/src/http/cache.test.ts; .harness/evidence/M20-T3-verifier.log.
- M20-T4 (Cheap, BOUNDED_LOW_RISK) attempt 1 INTERRUPTED (worker turn limit) — NOT ACCEPTED. Steps 1-3 left logs (unverified, uncommitted): server 379 pass, search 175 pass, helper 52 OK, com.harness.search restarted (pid 61417, health 200), live repeat search `x-cache: hit`. web-chat-proof.sh was still running at handoff; web-failure-proof.sh not run. Remaining: let/confirm web-chat-proof finish (or re-run), run web-failure-proof.sh, then verifier for T4; then record Validation, set REVIEW. Continuation 1 (orchestrator 2): handoff .harness/tasks/M20-T4-handoff-1.md written; Cheap continuation worker dispatched to re-run web-chat-proof.sh then web-failure-proof.sh in the background (still running at orchestrator handback; its logs are unverified). D-M20-1 recorded in .harness/architecture.md (Material: no). Next: read M20-T4-web-chat-proof.log / M20-T4-web-failure-proof.log EXIT_STATUS lines; if absent, re-dispatch per the handoff; then verifier for T4. Continuation 2 (orchestrator 3): two Cheap continuation workers had run concurrently and returned contradictory web-chat-proof results (one exit 0, one exit 1); the exit-1 run was a stray proof that orchestrator 3 terminated mid-run (its server was killed, so its curl/SSE failures are artefacts of the kill), so neither return is evidence and M20-T4-web-chat-proof.log is void. Verifier for T4 dispatched to re-run every suite and both proofs itself, one at a time, into .harness/evidence/M20-T4-verify-*.log; it was still running when orchestrator 3 handed back. Next: read the verifier's report (or, if absent, the M20-T4-verify-*.log EXIT_STATUS lines and re-dispatch the verifier); on PASS commit the T4 evidence by path, record ### Validation, set REVIEW. The M9-T5-* and M13-T3-proof.log diffs are proof-script side effects; restore them with git checkout before committing. Archiving is not possible: the only milestones written out in full are M19j (most recently settled), M20, M21 and M5a (BLOCKED).
- M20-T4 ACCEPTED (Cheap, BOUNDED_LOW_RISK; attempt 1 + continuations, no ladder rung spent) on the verifier's own one-at-a-time re-run (orchestrator 4 judged it): server `bun test` 379 pass + typecheck exit 0; search `bun test && bun run typecheck` exit 0, 175 pass; helper unittest 52 OK; `git diff --stat 7adc092 HEAD -- server/` empty (server code unchanged, so ordinary-web and switch-off tests pass unchanged); com.harness.search health 200 on the M20 code; live repeat search `x-cache: miss` then `x-cache: hit` (.harness/evidence/M20-T4-cache-live.log); web-chat-proof.sh exit 0 "All M9 live proofs passed" (.harness/evidence/M20-T4-verify-web-chat-proof.log); web-failure-proof.sh exit 0 "All M13 web failure checks passed" (.harness/evidence/M20-T4-verify-web-failure-proof.log). Tests Weakened NO — .harness/evidence/M20-T4-verifier.log. The worker's void M20-T4-web-chat-proof.log was removed; the proof scripts' rewrites of older M9-T5-* and M13-T3-proof.log evidence were restored with git checkout.

### Validation

- `cd search && bun test && bun run typecheck` - verifier: 175 pass, tsc clean (.harness/evidence/M20-T4-verifier.log). `cd search/helper && .venv/bin/python -m unittest test_search` - 52 OK. `cd server && bun test && bun run typecheck` - 379 pass, tsc clean; `git diff --stat 7adc092 HEAD -- server/` empty.
- Live (com.harness.search restarted onto M20 code): `bash server/scripts/web-chat-proof.sh` exit 0 and `bash server/scripts/web-failure-proof.sh` exit 0 (.harness/evidence/M20-T4-verify-web-chat-proof.log, .harness/evidence/M20-T4-verify-web-failure-proof.log); repeat search miss then hit (.harness/evidence/M20-T4-cache-live.log).

### Review

Cycle 1: PASS (2026-10-03), tier Mid (sonnet) - highest substantive tier in the diff is Mid (T1-T3 sonnet; T4 Cheap); whole milestone 7adc092..6f9dc20. Per-criterion: AC1 PASS, AC2 PASS, AC3 PASS. Findings: 0 BLOCKER, 0 IMPORTANT, 0 OPTIONAL. Reviewer re-ran search bun test (175 pass) + typecheck, helper unittest (52 OK), server bun test (379 pass) + typecheck, web-chat-proof.sh (exit 0) and web-failure-proof.sh (exit 0); restored proof-rewritten M9-T5-*/M13-T3 evidence via git checkout.

### Review Cycles

0

### Follow-ups

- FR40 amended 2026-10-02: ordinary and switch-off replies also get FR45's stream keep-alive, per-outage resume allowance and error line; those are built and proven in M19e and M19f (AC31). M20-AC3's 'existing ordinary-web and switch-off tests pass unchanged' is judged against the suite as it stands after M19f. M20's criteria are otherwise unaffected.

## M21 — Four real research questions answered on the Mac, and the owner's phone screenshot

Status: DONE

### Outcome

The finished feature proven live: three real research-style questions plus the 2026-10-02 heat-pump question run on `qwen3.5:35b-a3b` each end within budget with a report citing at least three distinct read pages, and the owner photographs a finished deep research reply on the phone. Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal; proof only) - not split.

Owns: none owned. Traces to: AC29 (amended 2026-10-02: plus the heat-pump question), AC30.

### Architecture

C1, C6, C11, C12, C13

### As-Built

`.harness/as-built/M21.md` — RECORDED - 2 of 2 files attributed; component C12; 4 claim mismatches: C1, C6, C11, C13 claimed but not in diff (M21 is a live proof; only the C12 read-step fix changed code)

### Acceptance Criteria

- [x] **M21-AC1**: Live on the Mac with `qwen3.5:35b-a3b` resident: 3 real research-style questions plus the 2026-10-02 heat-pump question each end within the budget plus a small margin with status `complete` or `partial`, a report citing at least 3 distinct read pages, and no citation number that fails to resolve to a saved source; the owner's opinion of report quality is recorded in the evidence (not a gate).
- [x] **M21-AC2**: The owner's phone screenshot of a finished deep research reply showing its steps, its status, logo citations and "Sources (n)" is saved under .harness/evidence/.

### Plan
`.harness/plans/M21.md` — AGREED

### Baseline

6d89bfe98a3e3738c194926b432f77787f808c7b on m21-live-research-proof

### Evidence

- M21-T1 readiness (Cheap, BOUNDED_LOW_RISK) attempt 1 FAIL on a packet defect (server start-time test counted the scripts-only commit 64a2d77; test amended to exclude server/scripts/, see plan Changes during implementation, no ladder rung) -> verifier PASS on the amended packet: `bash ops/scripts/boot-readiness-check.sh` exit 0 "PASS: ALL CHECKS PASSED"; com.harness.server started 2026-10-03T07:25:16+01:00 after last non-scripts server/ commit da9ef0f 07:23:31+01:00 (LaunchAgent runs `bun src/index.ts`; server/src references no scripts/); com.harness.search started 15:54:11 after last search/ commit 15:53:08; `git status --porcelain -- server search mobile` empty; `ollama ps` lists qwen3.5:35b-a3b; no ac29-live-run in flight — .harness/evidence/M21-T1-readiness.log, .harness/evidence/M21-T1-verifier.log.

- M21-T2 q1 Raft vs Paxos (Cheap, BOUNDED_LOW_RISK) attempt 1 PASS; verifier PASS: run log `exit=0`; generation 5486fcf9-9821-4182-b554-bc3e4093275a, final_status complete, total_wall_s 239.569 (limit 540), distinct_pages_read 5, cited_read_pages 4, unresolved_citations [], research_phase_calls 11, notes_kept 9; `bun run scripts/ac29-live-run.ts --check-only ../.harness/evidence/M21-T2-q1-stream.txt --log ../.harness/evidence/M21-T2-q1-fr41.log` exit 0, pass true — .harness/evidence/M21-T2-q1-result.json, .harness/evidence/M21-T2-q1-verifier.log.

- M21-T2 q2 LFP vs NMC (Cheap, BOUNDED_LOW_RISK) attempt 1 FAIL on the pass bar; verifier confirms (check-only exit 1): generation 3bf9e7a3-1888-4106-88e5-87209646543c, final_status complete, total_wall_s 173.522 (limit 540), distinct_pages_read 4, notes_kept 3, cited_read_pages 2 (cited_read_pages_ok false), unresolved_citations []. The report cites [1], [3], [4]; [4] was read and noted (stream line 169 read done `https://agaicpower.com/blogs/news/are-home-batteries-safe-lifepo4-vs-nmc-fire-risk-the-real-data-1`) but the final sources event lists it as `...-the-real-data` without `-1`, so the exact-URL match does not count it. Not re-run (plan: owner decides) — .harness/evidence/M21-T2-q2-result.json, .harness/evidence/M21-T2-q2-verifier.log.

- M21-T2 q3 WebAssembly component model (Cheap, BOUNDED_LOW_RISK) attempt 1 PASS; verifier PASS: run log `exit=0`; generation 4c3505d2-a265-40fc-87ca-d0a6bd01ffb8, final_status complete, total_wall_s 205.117 (limit 540), distinct_pages_read 6, notes_kept 10, cited_read_pages 3, unresolved_citations []; check-only exit 0, pass true — .harness/evidence/M21-T2-q3-result.json, .harness/evidence/M21-T2-q3-verifier.log.

- M21-T2 heat 2026-10-02 heat-pump question (Cheap, BOUNDED_LOW_RISK) attempt 1 PASS; verifier PASS: run log `exit=0`; generation 29feea53-c764-4bd6-91cf-63884e023650, final_status complete, total_wall_s 220.239 (limit 540), distinct_pages_read 6, notes_kept 13, cited_read_pages 5, unresolved_citations []; check-only exit 0, pass true — .harness/evidence/M21-T2-heat-result.json, .harness/evidence/M21-T2-heat-verifier.log.

- M21-T3 owner reading file (Cheap, BOUNDED_LOW_RISK) attempt 1 PASS; verifier PASS: .harness/evidence/M21-T3-reports.md holds the four questions verbatim, each result.json metrics line, the report text reassembled from the stream (exact match: q1 2015, q2 1102, q3 1399, heat 3137 chars) and the full source lists (5, 4, 6, 6), no opinion added — .harness/evidence/M21-T3-verifier.log (worker notes .harness/evidence/M21-T3-worker.log). Owner's opinion: NOT YET RECORDED.
- HANDOFF (orchestrator 1, CONTINUE, waiting on the owner): (1) q2 failed the bar (see q2 entry): owner to choose re-run q2 once / accept as substantively met with the URL note / stop and look into why; (2) owner's opinion of the four reports in M21-T3-reports.md, to be recorded word for word here; (3) owner's phone screenshot path(s) for M21-T4 (Mid, sonnet), which has not been dispatched. After those: record opinion, run M21-T4 + verifier, view the image, record ### Validation, set REVIEW.

- OWNER DECISION 2026-10-03 on q2 (handoff item 1), selected option verbatim: "Fix the cause first" — i.e. option (c) as offered: "Stop and look into why the address changes. Probably a small fix, then all four questions are re-run (about 15–20 minutes plus the fix)." Carried inside M21 as a recorded change during implementation (see plan `.harness/plans/M21.md` Changes during implementation): M21-T5 diagnoses and fixes the URL mismatch (routed, verified), the server is restarted onto the fix, all four questions are re-run fresh as M21-T6 (prefix M21-T6), and the owner reading file is regenerated as M21-T7. The earlier M21-T2/T3 runs stay as history and are superseded for M21-AC1. Owner's opinion and phone screenshot (M21-T4) are not asked for until the re-runs are complete.

- M21-T5 cause and fix (Top, AMBIGUOUS — unclear bug) attempt 4 PASS; verifier PASS: root cause server/src/web/tools.ts readPage — the read step's `done` event carried the requested URL while the `source` event and page.url carried the search service's post-redirect `final_url` (search/src/fetch/fetchPage.ts:212), which deep research saves as the source (server/src/generations/research.ts ~679, ~1152); q2's `...-real-data-1` redirected to `...-real-data`. Fix: done step now carries `url: finalUrl` (FR31: page identified by final URL after redirects); checker unchanged. New test "M21-T5: a redirected read's done step and its saved source name the same final URL" failed before, passes after; one existing expectation in "read() returns the numbered page text and the same events as read_page" moved from start.example to final.example (verifier: not weakened). `cd server && bun test` exit 0 (380 pass), `bun run typecheck` exit 0. Side effect: finished read steps for redirected pages (deep research and web chat) now show the landed-on address — .harness/evidence/M21-T5-worker.log, .harness/evidence/M21-T5-verifier.log.

- HANDOFF (orchestrator 2, CONTINUE, 2026-10-03; supersedes handoff 1 item 1): fix committed 1034b0c. Remaining, in order: (1) M21-T6R (Cheap) — kickstart com.harness.server onto 1034b0c and repeat readiness to .harness/evidence/M21-T6-readiness.log, + verifier; (2) M21-T6 (Cheap) — q1, q2, q3, heat, one fresh worker each, sequential, prefix M21-T6, + verifier each; a run that fails the bar is recorded, not re-run, and goes to the owner; (3) M21-T7 (Cheap) — .harness/evidence/M21-T7-reports.md from the T6 streams, + verifier; (4) only then return to ask the owner for their opinion of M21-T7-reports.md (recorded verbatim) and the phone screenshot path(s) for M21-T4 (Mid; its packet reads M21-T2 timing — the screenshot must come after the T6 runs); (5) M21-T4 + verifier, record ### Validation, set REVIEW. Packets for T6R/T6/T7 are written under .harness/tasks/.

- M21-T6R restart + readiness (Cheap, BOUNDED_LOW_RISK) attempt 1 PASS; verifier PASS: `launchctl kickstart -k gui/$(id -u)/com.harness.server` (pid 4781 -> 71661); server start 17:20:10+01:00 after last non-scripts server/ commit 1034b0c 2026-10-03T17:19:02+01:00; search pid 61417 start 15:54:11 after search/ commit cbd5566 15:53:08; health 401; `ollama ps` lists qwen3.5:35b-a3b; `pgrep -fl ac29-live-run` empty; `git status --porcelain -- server search mobile` empty; `bash ops/scripts/boot-readiness-check.sh` exit 0 "PASS: ALL CHECKS PASSED" — .harness/evidence/M21-T6-readiness.log, .harness/evidence/M21-T6R-verifier.log.

- M21-T6 q1 Raft vs Paxos re-run (Cheap, BOUNDED_LOW_RISK) attempt 1 PASS; verifier PASS: run log `exit=0`; generation d438e975-04a9-45e5-8c32-f9094d14fcc8, final_status complete, total_wall_s 211.303 (limit 540), distinct_pages_read 6, notes_kept 14, cited_read_pages 6, unresolved_citations [], research_phase_calls 12; check-only exit 0, pass true — .harness/evidence/M21-T6-q1-result.json, .harness/evidence/M21-T6-q1-verifier.log.

- M21-T6 q2 LFP vs NMC re-run (Cheap, BOUNDED_LOW_RISK) attempt 1 PASS; verifier PASS: run log `exit=0`; generation cb5db5c2-a80e-4b3f-ab32-1fdd95decca5, final_status complete, total_wall_s 196.086 (limit 540), distinct_pages_read 6, notes_kept 17, cited_read_pages 6, unresolved_citations [], research_phase_calls 12; check-only exit 0, pass true. Verifier checked every read step's done URL against the final sources event: all 6 match, including the agaicpower.com page that redirected from `...-real-data-1` to `...-real-data` (the M21-T2 failure) — the M21-T5 fix holds live. (Verifier's line "Owner Opinion Recorded: worker.log present" is wrong and disregarded: the owner's opinion is not yet recorded.) — .harness/evidence/M21-T6-q2-result.json, .harness/evidence/M21-T6-q2-verifier.log.

- M21-T6 q3 WebAssembly component model re-run (Cheap, BOUNDED_LOW_RISK) attempt 1 PASS; verifier PASS: run log `exit=0`; generation a6c5a24e-5ebe-4f39-852d-19cb066ed006, final_status complete, total_wall_s 201.347 (limit 540), distinct_pages_read 6, notes_kept 22, cited_read_pages 6, unresolved_citations [], research_phase_calls 12; check-only exit 0, pass true; all 6 read done URLs found in the final sources event — .harness/evidence/M21-T6-q3-result.json, .harness/evidence/M21-T6-q3-verifier.log.

- M21-T6 heat 2026-10-02 heat-pump question re-run (Cheap, BOUNDED_LOW_RISK) attempt 1 PASS; verifier PASS: run log `exit=0`; generation 51ae9df5-784f-472c-b675-ce5e6c63e391, final_status complete, total_wall_s 215.151 (limit 540), distinct_pages_read 6, notes_kept 15, cited_read_pages 6, unresolved_citations [], research_phase_calls 12; check-only exit 0, pass true; all 6 read done URLs found in the final sources event. Observation for the owner (not a gate): one of the six read pages is an alfalaval.co.uk plate-heat-exchanger product page reached via a Bing ad URL, off-topic for the question — .harness/evidence/M21-T6-heat-result.json, .harness/evidence/M21-T6-heat-verifier.log.
- M21-T6 summary: all four re-runs on the fixed server meet the M21-AC1 bar (q1 211.3 s / 6 cited, q2 196.1 s / 6, q3 201.3 s / 6, heat 215.2 s / 6; all complete, no unresolved citations). These supersede the M21-T2 runs for M21-AC1.

- M21-T7 owner reading file regenerated (Cheap, BOUNDED_LOW_RISK) attempt 1 PASS; verifier PASS: .harness/evidence/M21-T7-reports.md holds q1, q2, q3, heat with the questions verbatim, each result.json metrics line, the report text (verifier reassembled each report independently from M21-T6-<ID>-stream.txt: full text matches exactly, first/last 200 chars match) and the full source lists (6, 6, 6, 6, equal to each stream's final sources event); no opinion added; `git status --porcelain` clean outside the new file — .harness/evidence/M21-T7-verifier.log (worker notes .harness/evidence/M21-T7-worker.log). Owner's opinion: NOT YET RECORDED.

- HANDOFF (orchestrator 3, CONTINUE, waiting on the owner; supersedes handoff 2): T6R, T6 (all four) and T7 accepted. The phone is free to use again — no live run is in flight. Remaining: (1) the owner's opinion of .harness/evidence/M21-T7-reports.md, recorded here word for word (M21-AC1 opinion part, not a gate); (2) the owner's phone screenshot path(s) of a finished deep research reply for M21-T4 (Mid, sonnet; its packet reads M21-T2 timing — amend to require the screenshot after the M21-T6 runs, which end 2026-10-03T16:45:11Z, before dispatch). After those: record opinion, run M21-T4 + verifier, view the image, record ### Validation, set REVIEW. Housekeeping due: milestones.md is past 400 lines; archive settled milestones per the template before or at the REVIEW return.

- OWNER OPINION 2026-10-03 (M21-AC1 opinion part, not a gate), recorded verbatim: "Many sources but all source in response are the same". Given by the owner with their phone screenshot of the deep research reply to "What was the cause of World War Two from German perspective" (the M21-T4 reply), not about .harness/evidence/M21-T7-reports.md; asked what to record as their opinion for M21-AC1, the owner chose, verbatim, "Use my phone comment".

- M21-T4 owner's phone screenshot (Mid, NOT_EASILY_VERIFIED) attempt 3 (Mid entry rung) PASS; verifier PASS: both owner images copied unchanged - `shasum -a 256` 9898539ec05d20dd9b17b9e12058f19f8a80f5caf584e0ccfa9fb50772eebf61 (source 789e0a36-image.png = .harness/evidence/M21-AC2-phone-screenshot-1.png) and 14bf64ee2d0697fc97647074ced8affae7e18b944a9fdeb98c4a97ca293233b0 (source 93437419-image.png = .harness/evidence/M21-AC2-phone-screenshot-2.png); `file`: PNG 1179 x 2556 each. Timing (packet amended to the M21-T6 re-runs, see plan Changes during implementation): phone clocks 19:44 and 20:28 BST, source mtimes 2026-10-03T19:45:13+0100 and 2026-10-03T20:28:33+0100, both after the re-runs ended 2026-10-03T16:45:11Z (17:45:11 BST). Items, all VISIBLE: steps (image 2, under "Hide web steps": Planning, Searching..., Reading: bbc.co.uk, scribd.com, en.wikipedia.org, encyclopedia.ushmm.org, scribd.com, politicalscienceview.com, Writing report); status (image 2, "Deep research: complete"); logo citations (image 1, three inline site logos; image 2, one); "Sources (6)" (image 1, expanded, six entries). Question: "What was the cause of World War Two from German perspective"; model qwen3.5:35b-a3b. Orchestrator viewed both images and agrees - .harness/evidence/M21-T4-screenshot-check.md, .harness/evidence/M21-T4-verifier.log. Commit e084c1c.
- Criteria map: M21-AC1 <- M21-T6 q1/q2/q3/heat entries (bar) + OWNER OPINION entry (opinion, not a gate); M21-AC2 <- M21-T4 entry.
- Housekeeping: milestones.md is ~710 lines but nothing is archivable - every settled milestone except M20 is already archived, M20 is the most recently settled (protected), M21 is active and M5a is BLOCKED.

### Validation

`cd /Users/ryankenny/Projects/CodingHarnessv2/server && for id in q1 q2 q3 heat; do bun run scripts/ac29-live-run.ts --check-only ../.harness/evidence/M21-T6-$id-stream.txt --log ../.harness/evidence/M21-T6-$id-fr41.log || exit 1; done && cd .. && shasum -a 256 /Users/ryankenny/.claude/uploads/db6a6102-6473-4871-aa04-e895eb948ec7/789e0a36-image.png .harness/evidence/M21-AC2-phone-screenshot-1.png /Users/ryankenny/.claude/uploads/db6a6102-6473-4871-aa04-e895eb948ec7/93437419-image.png .harness/evidence/M21-AC2-phone-screenshot-2.png && (cd server && bun test && bun run typecheck)` - reviewer runs once; offline (re-checks the saved M21-T6 streams against the AC29 bar, no live model call), expects exit 0 with pass true for all four, identical hashes per pair, and the server suite (380 pass at M21-T5) green for the M21-T5 fix. Reviewer views .harness/evidence/M21-AC2-phone-screenshot-1.png and -2.png for M21-AC2. Owner opinion for M21-AC1: OWNER OPINION entry in Evidence.

### Review

Cycle 1: CHANGES REQUIRED, scope RECORD_ONLY (2026-10-03), tier Top (opus) - diff contains a Top-routed task (T5); whole milestone 6d89bfe..00611bc. Per-criterion: AC1 PASS, AC2 PASS. Findings: 0 BLOCKER, 1 IMPORTANT, 1 OPTIONAL; report .harness/reviews/M21-cycle1.md. Pre-correction: 00611bc. Resolved: M21-R1-F1 IMPORTANT (recorded validation `--log` pointed at a nonexistent file) by a record-only correction to `--log ../.harness/evidence/M21-T6-$id-fr41.log` in Validation and state.json; correction 5cfa704; `check-state.py --record-only 00611bc HEAD` exit 0 and the corrected four `--check-only` runs exit 0. M21-R1-F2 OPTIONAL, left open (web-chat read step now shows the post-redirect URL; no mobile test pins it) needs no change. Reviewer re-ran bun test (380 pass), typecheck clean, screenshot hashes match; log .harness/evidence/M21-review.log.

### Review Cycles

0

### Follow-ups

- AC29 amended 2026-10-02 to add the 2026-10-02 heat-pump question: M21-AC1, title and outcome updated at planning on 2026-10-02 to the four-question set. M19g runs the same set before M20 for AC32; M21 re-runs it after M20 because M20 changes the search path. M21-AC2 is unaffected.
- Owner decision 2026-10-03, selected verbatim: "Note both for later" ("Both are written down as known problems for a later round, and this milestone finishes as planned"). Not fixed in M21; neither gates it. (i) Citation concentration: in the phone reply (.harness/evidence/M21-AC2-phone-screenshot-1.png) all three inline citations point to the same one source ("Lebensraum: Nazi Geopolitics and Expansion Explained") although Sources (6) lists six. (ii) Bot-check pages saved as sources: two of those six sources are titled "Client Challenge" (the scribd.com reads) - apparently a bot-check/challenge page saved as the source instead of the article.

## M22 — Bot-check and near-empty pages are never listed as sources, and deep research reads another page in their place

Status: TODO

### Outcome

Through POST /v1/chat, one shared check classes a fetched page as unreadable when its text shows bot-challenge markers (e.g. scribd.com's "Client Challenge" screen, CAPTCHA, "verify you are human") or has fewer than FR43's 40 words. In deep research such a page gets no number, is not saved or listed as a source, makes no note call, its read step ends failed ("Reading: scribd.com — couldn't be read"), and the next unread URL from the same sub-question's existing search results is read in its place while the deadline allows, with no extra search; in an ordinary web reply `read_page` tells the model plainly the page could not be read and why, and the page is neither numbered nor listed; an unreadable page is never stored in or served from FR39's page cache. Remaining pages stay numbered 1..n in first-read order and FR43 no-match pages are unchanged. Planned 2026-10-04 from FR47 / AC36 (FR47 part), prompted by the owner's M21 phone run (two scribd.com "Client Challenge" pages among Sources (6), .harness/evidence/M21-AC2-phone-screenshot-1.png). FR47-FR48 with AC36-AC37 split at generation into M22 (FR47), M23 (FR48) and M24 (live proof, AC37): as one milestone it carries IMPLEMENTATION_PLUS_LIVE_PROOF, MULTIPLE_OUTCOMES (unreadable pages vs kept notes, independently demonstrable) and CONCURRENCY_LIFECYCLE (replacement reads inside FR44's prefetch and FR36's deadline). This part keeps one signal, CONCURRENCY_LIFECYCLE (seam check: the deep research and ordinary-reply halves share the one check and its cache rule, so splitting them leaves the shared check unowned or duplicated); subsystems C6, C12, C13 (three, not over three) - not split further.

Owns: FR47. Traces to: AC36 (FR47 part: deep research drop and replace, contiguous numbers, every [n] resolves; ordinary web reply could-not-be-read statement; not served from the page cache), FR43 (markers and 40-word minimum reused; no-match pages unchanged), FR44/FR36 (replacement reads within prefetch and deadline), FR33 (unchanged).

### Architecture

C4, C6, C12, C13

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M22-AC1**: Server tests through POST /v1/chat with a faked search service and a scripted fake Ollama: in deep research, a bot-check page ("Client Challenge" text) and a near-empty page (under FR43's 40 words) each get no number, are absent from the saved sources and the final sources event, make no note call, are logged "blocked"/"empty" as today, and their read steps end as failed (e.g. "Reading: scribd.com — couldn't be read"); the next unread URL from the same sub-question's existing search results is read in each one's place with no additional search request; remaining page numbers are contiguous from 1 in first-read order and every [n] in the report resolves to a saved source.
- [ ] **M22-AC2**: Server tests through POST /v1/chat (faked search service, scripted fake Ollama): a replacement page that is itself unreadable is skipped in turn and the next unread URL tried; a sub-question whose results run out ends with fewer pages and no extra search; replacements stop at the FR36 deadline; a run where every opened page is unreadable ends with FR36's `failed` status and plain sentence; a site serving a bot check on one page and real content on another has the real page read, numbered and listed.
- [ ] **M22-AC3**: Server tests through POST /v1/chat with web on and deep research off: `read_page` on a bot-check page returns to the model a short plain statement that the page could not be read and why (bot check or no content) instead of page text, its step ends as failed, and the page is neither numbered nor in the reply's saved sources or "Sources (n)" list; the model may then search or read again, and FR33's quiet-round handling is unchanged.
- [ ] **M22-AC4**: Tests through the search service's page-read API (or POST /v1/chat end to end): a page classed unreadable is not stored in FR39's 24-hour page cache, and a repeat read of the same URL fetches it again rather than serving it from the cache; readable pages are still cached as before.
- [ ] **M22-AC5**: FR43 "no-match" pages (readable, no relevant passage) keep their number and stay in Sources; all existing tests pass: `cd server && bun test && bun run typecheck` and `cd search && bun test` exit 0.

### Plan

### Baseline

### Evidence

### Validation

### Review

Pending.

### Review Cycles

0

### Follow-ups

- FR47 out of scope (requirements 2026-10-04): no search is run solely to find a replacement page; a site is not remembered as blocked (each page judged on its own); FR43 'no-match' pages stay numbered and listed; no phone change.
- Placed ahead of M5a (2026-10-04, extension for FR47-FR48): M5a is BLOCKED and parked waiting on the owner's Mac reboot check, and /harness:plan and /harness:implement stop at the first BLOCKED milestone, so new work is built before it, as the human decided for M14, M15 and M19b-M21. M5a stays BLOCKED and parked, its record unchanged, and is picked up after M24.

## M23 — Deep research keeps notes whose quotes differ from the page only trivially, and logs every note it drops

Status: TODO

### Outcome

Through POST /v1/chat, FR37's quote check compares a note's quote with the page's full stored text after normalising both sides (Unicode compatibility form, curly and straight quotes alike, all dashes alike, whitespace collapsed, case ignored, markdown link, image and emphasis syntax stripped to the visible text), and a quote with an ellipsis matches when each piece appears in order; a quote whose words are not on the page is still dropped. Every dropped note is written to the FR41 log with run, page number, reason and the first ~120 characters of the quote, and the run-end line gains `notes_dropped`. Deep research only; ordinary web replies take no notes. Planned 2026-10-04 from FR48 / AC36 (FR48 part), prompted by the owner's M21 phone run (server log: note calls on four readable pages, `notes_kept:1`, so the report cited one page three times). Second part of the FR47-FR48 split (see M22). No operational-complexity signal: one subsystem (C6, server/src/generations/research.ts quote check and FR41 log line), about 1-2 production files.

Owns: FR48. Traces to: AC36 (FR48 part: normalised quote match, ellipsis pieces in order, rejection of words not on the page, every drop logged with reason, run-end notes_dropped), FR37 (citation rule otherwise unchanged), FR41 (log line).

### Architecture

C4, C6

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M23-AC1**: Server tests through POST /v1/chat with a faked search service and a scripted fake Ollama: a note is kept when its quote differs from the page's stored text only by curly vs straight quotes or apostrophes, dash variants, whitespace, letter case, Unicode compatibility forms, or markdown link, image or emphasis syntax (e.g. `[Treaty of Versailles](https://…)` on the page matches "Treaty of Versailles"); a quote containing "…" or "..." is kept when each piece, normalised, appears on the page in order.
- [ ] **M23-AC2**: Server tests through POST /v1/chat: a note is still dropped when its quote's words are not on the page, and when its ellipsis pieces appear on the page only out of order; kept notes' citations behave as FR37 already requires.
- [ ] **M23-AC3**: Server tests through POST /v1/chat: each dropped note writes one FR41 log entry carrying the run, the page number, the reason (missing quote, quote not found, invalid page number) and the first ~120 characters of the quote; the run-end log line carries `notes_dropped` equal to the number of dropped notes alongside `notes_kept`.
- [ ] **M23-AC4**: Ordinary web and switch-off replies are unchanged, and all existing tests pass: `cd server && bun test && bun run typecheck` exit 0.

### Plan

### Baseline

### Evidence

### Validation

### Review

Pending.

### Review Cycles

0

### Follow-ups

- FR48 out of scope (requirements 2026-10-04): the quote check is not removed or replaced by fuzzy matching beyond the listed normalisations; applies to deep research only.
- Placed ahead of M5a (2026-10-04, extension for FR47-FR48): M5a is BLOCKED and parked waiting on the owner's Mac reboot check, and /harness:plan and /harness:implement stop at the first BLOCKED milestone, so new work is built before it, as the human decided for M14, M15 and M19b-M21. M5a stays BLOCKED and parked, its record unchanged, and is picked up after M24.

## M24 — Real sources and kept notes proven live on the Mac with the owner's World War Two question

Status: TODO

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

### Baseline

### Evidence

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
