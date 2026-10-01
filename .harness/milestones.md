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

Owns: FR35, FR37. Traces to: AC28 (loop, format/num_ctx, malformed step, citation removal, quote check).

### Architecture

C4, C6, C7, C12

### As-Built

.harness/as-built/M15.md — RECORDED — 10/10 files attributed; components C4, C6, C7, C12; 5 edges; claim mismatches NONE

### Acceptance Criteria

- [x] **M15-AC1**: Server tests with a scripted fake Ollama and fake search/page backends: POST /v1/chat with web on and deep research requested runs brief -> plan (server-set sub-question count) -> for each sub-question at least the server-set minimum number of searches (exact repeats after normalising skipped), reads of pages chosen only from server-parsed result URLs, notes -> gap check -> one write call, and ends `complete` with the report as the answer; its phases stream live as web steps ("Planning", "Searching: <query>", "Reading: <domain>", "Writing report") and its sources are the pages read.
- [x] **M15-AC2**: Server tests: every Ollama request in a run carries a JSON-schema `format` and the same explicit `num_ctx`, keeps the model resident, and contains only the stable instructions, brief, plan, capped rolling notes and latest result - no raw page text other than the page currently being noted, and no model thinking; the model judging it has enough may end a sub-question early but a server cap always bounds it.
- [x] **M15-AC3**: Server tests: a malformed or empty JSON step is retried a bounded number of times and then skipped, and the run continues to a report; page text instructing the model to do something can influence only notes and the choice among server-parsed URLs (no other URL is read and no other action is taken).
- [x] **M15-AC4**: Server tests: each distinct page read gets a number in first-read order (FR31 numbering and distinctness); a report `[n]` with no read page, and any URL the model types into the report, are removed before the report is streamed as final; a note whose quote does not substring-match the page's stored text (after whitespace normalisation) is dropped before writing.

### Baseline

b48673499df9aa0d846bad7bbefe1548d57cb272 on m15-deep-research-skeleton

### Evidence

- M15-T1 — Cheap (BOUNDED_LOW_RISK): attempt 1 PASS; verifier PASS (exit 0, `bun test src/ollama` 23 pass, typecheck clean; .harness/evidence/M15-T1-verifier.log).
- M15-T2 — Top (ARCHITECTURE: research loop shape inside C6 across C7/C12 seams): attempt 4 PASS; verifier PASS (exit 0, `bun test && bun run typecheck` 207 pass 0 fail, tsc clean; files within allowed list; tests not weakened; .harness/evidence/M15-T2-verifier.log, worker log .harness/evidence/M15-T2-worker.log). Adds runResearch() in server/src/generations/research.ts, C12 search()/read() helpers and step kinds plan/write.
- M15-T3 — Mid (ORDINARY_IMPLEMENTATION): attempt 3 PASS; verifier PASS (exit 0 run without a pipe, `bun test && bun run typecheck` 209 pass 0 fail across 12 files, tsc clean; files within allowed list incl. additive shared/api.ts; tests not weakened; .harness/evidence/M15-T3-verifier.log). Commit 20230d5.
- M15-T4 (cycle 1, F1) — Mid (ORDINARY_IMPLEMENTATION): attempt 3 PASS; verifier PASS (exit 0, 211 pass, tsc clean; .harness/evidence/M15-T4-verifier.log). Commit 30003f2. Tests: "a sub-question that runs out of new queries before minSearches still reads its collected results (every step fails)", "a later sub-question whose proposed queries were all run earlier still reads from its own search results" (default minSearches 2).
- M15-T5 (cycle 1, F2-F4) — Cheap (BOUNDED_LOW_RISK): attempt 1 FAIL (tests green but redirect case missing and distinctness assertions vacuous; judged against packet), attempt 2 PASS; verifier PASS (exit 0, 217 pass, tsc clean; removing the readNumbers guard makes the redirect test fail, 4 vs 2 note steps; .harness/evidence/M15-T5-verifier.log). Commit f1e2785. AC4 distinctness tests: "reads a page only once when it appears in multiple search results across sub-questions", "does not create duplicate notes when a read redirects to an already-read page".
- Criteria mapping (worker/verifier evidence, for the reviewer to confirm): M15-AC1 -> research.test.ts "runs brief -> plan -> searches -> reads -> notes -> gap -> write..." and deepResearch.test.ts (POST /v1/chat + SSE: step order, sources first-read numbering, done complete); M15-AC2 -> research.test.ts "every request is a narrow, schema-constrained request...", gap-check enough:true/enough:false/repeat-only cap tests, deepResearch.test.ts Ollama body checks; M15-AC3 -> research.test.ts malformed-retry, fail-every-step, and page-text-injection tests; M15-AC4 -> research.test.ts citation/URL/quote-removal test and deepResearch.test.ts cleaned final content.

### Validation

- Milestone validation: `cd /Users/ryankenny/Projects/CodingHarnessv2/server && bun test && bun run typecheck` (last verifier run exit 0, 209 pass, 0 fail; .harness/evidence/M15-T3-verifier.log). Diff: `git diff b48673499df9aa0d846bad7bbefe1548d57cb272 HEAD`.

### Review

- Cycle 1: CHANGES REQUIRED, scope SUBSTANTIVE (.harness/reviews/M15-cycle1.md; validation re-run .harness/evidence/M15-review.log, 209 pass, tsc clean). Diff reviewed: b48673499df9aa0d846bad7bbefe1548d57cb272..7034424. Per criterion: AC1 PASS, AC2 PASS, AC3 PASS, AC4 FAIL. Findings: F1 IMPORTANT, F2 IMPORTANT, F3 OPTIONAL, F4 OPTIONAL.
  - Pre-correction: 703442411430b4f3e3ea7b84591e2b99da031ba5
  - Corrections: F1 -> M15-T4 (commit 30003f2); F2, F3, F4 -> M15-T5 (commit f1e2785). Validation after corrections: verifier exit 0, 217 pass, 0 fail, tsc clean (.harness/evidence/M15-T5-verifier.log).
  - Correction diff: `git diff 703442411430b4f3e3ea7b84591e2b99da031ba5 HEAD`. Files changed (code): server/src/generations/research.ts, server/src/generations/research.test.ts; plus .harness/ records, packets and evidence only.
  - Files outside those the findings named: none (Findings 1-4 all name research.ts / research.test.ts).
- Cycle 2: PASS — tier Mid (sonnet), reason: correction diff holds only Mid/Cheap tasks (M15-T4, M15-T5). Diff reviewed: 703442411430b4f3e3ea7b84591e2b99da031ba5..6fc67d8; all four criteria re-graded. Per criterion: AC1 PASS, AC2 PASS, AC3 PASS, AC4 PASS. Findings: none. Validation re-run: 217 pass, 0 fail, tsc clean (.harness/evidence/M15-review.log). F1-F4 resolved.

### Review Cycles

1

### Follow-ups

- Architecture does not yet list FR34-FR40 in Requirement Coverage; record D-M15-1 (deep research loop realised inside C6, server/src/generations/, using C12 and C7) as a non-material deviation in this milestone. (Recorded: D-M15-1 in .harness/architecture.md.)
- M15-T2 worker choices for the reviewer to confirm: a skipped select step reads the top unread server-parsed results; query repeats are skipped across the whole run, not per sub-question; the gap check emits no step event; a skipped write step reports `failed` while a fallback report still streams; thinking is not streamed as `thinking` events during a run.
- POST /v1/chat still requires the model to support tool calling when `web: true`, even for deep research (no tools are offered in a research run); revisit in M16/M18.
- Research settings are server defaults only; no per-request or config override yet.
- Page text in a note step is bounded only by C13's own limit; a per-page character cap against num_ctx may be needed (M16 live run will show).

## M16 — The deep research run works on the real qwen3.5:35b-a3b on the Mac

Status: BLOCKED

### Outcome

The deep-research model is downloaded on the Mac (`ollama pull qwen3.5:35b-a3b`), the unverified question of whether Ollama's `format` constraint holds with thinking on is settled by a live probe, and one real question run through the server API ends with a cited report. Proves the riskiest integration (real model + real search) right after the skeleton. Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal; the implementation is only the think setting the probe supports) - not split.

Owns: none owned. Traces to: AC29 (first live question), Constraints (format with thinking unverified).

### Architecture

C6, C7, C11, C12, C13

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M16-AC1**: `qwen3.5:35b-a3b` is downloaded on the Mac with `ollama pull`, appears in the server's installed-model list (GET /v1/models) and loads resident through the server's swap-load.
- [ ] **M16-AC2**: A live probe against the resident `qwen3.5:35b-a3b` records whether `format`-constrained replies are schema-valid with thinking on and with thinking off (at least 5 calls each, using the run's step schemas), and deep research uses the setting the probe supports; the result and the chosen setting are recorded in the evidence.
- [ ] **M16-AC3**: Live on the Mac: one real research-style question sent through POST /v1/chat as deep research ends with status `complete` or `partial`, a report citing at least 1 read page, and no citation number that fails to resolve to a source of that reply.

### Baseline

d4037fb0e9652dc2113bf33816bf63205c893d03 on m16-real-model-live-proof

### Evidence

Accepted tasks:
- M16-T1 (pull + list + swap-load): Cheap (`haiku`), BOUNDED_LOW_RISK. Attempt 1 CONTINUE (pull in progress) -> continuation 1 PASS. Verifier PASS (`ollama list | grep 'qwen3.5:35b-a3b' && ollama ps` exit 0; resident 100% GPU, Forever) - `.harness/evidence/M16-T1-live.log`, `.harness/evidence/M16-T1-verifier.log`. Commit 1c26bc3. Note for review: the server has no GET /v1/models (404); its installed-model list is GET /v1/state (server/src/http/server.ts ~line 452), which lists `qwen3.5:35b-a3b` (size_bytes 23869191742) and shows it resident with loaded_by_server=true after POST /v1/models/load (~line 467). M16-AC1's "(GET /v1/models)" names a route that does not exist; evidenced against the actual installed-model list.
- M16-T2 (think setting + probe script): Mid (`sonnet`), ORDINARY_IMPLEMENTATION, attempt 3 PASS. Verifier: `cd server && bun test && bun run typecheck` exit 0, 219 pass - `.harness/evidence/M16-T2-verifier.log`. Commit 79fa999.
- M16-T3 (explicit `think: false` reaches Ollama): Cheap (`haiku`), BOUNDED_LOW_RISK, attempt 1 PASS. Verifier: `cd server && bun test && bun run typecheck` exit 0, 221 pass, existing think tests unchanged - `.harness/evidence/M16-T3-verifier.log`. Commit 986af8f.
- M16-T4 (live probe + default): Cheap (`haiku`), BOUNDED_LOW_RISK, attempt 1 PASS. Probe `bun run scripts/probe-format-think.ts --model qwen3.5:35b-a3b --calls 5`: think-on 7/7 schema-valid, think-off 7/7 schema-valid (one call per step schema: brief, plan, queries, select, note, gap, write; num_ctx 32768). Decision rule -> `DEFAULT_RESEARCH_SETTINGS.think = true`. Verifier: tests exit 0, 221 pass, both think values still covered - `.harness/evidence/M16-T4-probe.json`, `M16-T4-probe.log`, `M16-T4-verifier.log`. Commit 8bdee34.

Blocked:
- M16-T5 (live deep research via POST /v1/chat, M16-AC3): Mid (`sonnet`), ORDINARY_IMPLEMENTATION, attempt 3 BLOCKED (environmental, not a failed rung). The running server on :7789 (LaunchAgent `com.harness.server`, pid 42026, started 2026-10-01 09:56:39, bun without watch) predates commits 79fa999/986af8f/8bdee34, so a live run would exercise old code. Packet reserves a LaunchAgent restart for a human. No evidence created.

Human Escalation Contract:

Problem:
The live deep research run (M16-AC3) cannot be proven: the always-on server process was started before this milestone's code changes and does not reload them, so a run now would test old code.

Requirement/milestone affected:
M16-AC3 (task M16-T5); M16-AC1 and M16-AC2 are evidenced.

Attempts made:
1. M16-T5 Mid attempt 3 compared the server process start time (2026-10-01 09:56) with the newest server commits (2026-10-01 23:57 to 2026-10-02 00:32), found it stale, and identified it as LaunchAgent `com.harness.server` (KeepAlive, RunAtLoad).

Remaining issue:
The server must be restarted onto the current branch before M16-T5 can run.

Recommended decision:
Run `launchctl kickstart -k gui/$(id -u)/com.harness.server`, confirm `qwen3.5:35b-a3b` is still resident (reload it from the phone or via POST /v1/models/load if not), then resume M16 (re-dispatch M16-T5 with its packet unchanged). Alternatively, authorise the harness to perform that restart itself.

### Validation

### Review

Pending.

### Review Cycles

0

### Follow-ups


- `bun run typecheck` in server/ covers only `src/**`; `server/scripts/` (incl. the new probe) is not typechecked by the project command.
- `check-state.py` reports pre-existing missing artifacts: `.harness/evidence/M13-T4-verifier.log`, `.harness/as-built/M13.md`, `M14.md`, `M15.md`, `.harness/reviews/M15-cycle1.md` (not caused by M16).

## M17 — A deep research run always ends within about 8 minutes with its status shown

Status: TODO

### Outcome

A run has one overall time budget (server setting, about 8 minutes) with about a quarter reserved for writing, checked before every search, read and model call, with one cancellation signal reaching everything in flight; it always ends with a reply marked `complete`, `partial` or `failed`, never hangs and never ends with an error and no reply. Operational-complexity signal: CONCURRENCY_LIFECYCLE (one signal; deadline and cancellation ownership inside the run) - not split.

Owns: FR36. Traces to: AC28 (all backends failing, slow backend, deadline during write-up).

### Architecture

C6, C12, C13

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M17-AC1**: Server tests (fake Ollama and backends, shortened budget setting): the deadline is checked before every search, read and model call; when research time (budget minus the writing reserve of about a quarter) runs out the run moves to writing with what it has and ends `partial`; the run's events carry its status and elapsed time against the budget.
- [ ] **M17-AC2**: Server tests: with every search backend failing the run ends within the budget plus a small margin as `failed`, with a plain sentence saying the research could not search as its answer, plus its steps.
- [ ] **M17-AC3**: Server tests: with a slow search backend the run ends within the budget plus a small margin (each search and read keeps its FR24 time limit and one cancellation signal reaches every in-flight search, read and model request); with the deadline hitting during the write-up it ends within the budget plus a small margin as `partial` with a non-empty answer (the FR33-style note if the write-up produced nothing).

### Baseline

### Evidence

### Validation

### Review

Pending.

### Review Cycles

0

### Follow-ups


## M18 — The phone offers Deep research only when the configured model is loaded, and shows the run live

Status: TODO

### Outcome

With the web switch on, the composer shows a "Deep research" action beside Send, enabled only while the resident model is the deep-research model the server reports (a Mac-side setting, default `qwen3.5:35b-a3b`); using it sends that one message as a run, whose phases, elapsed clock, status, logo citations and Sources show live and when reopened. Operational-complexity signal: SUBSYSTEMS_GT_3 (C1-C5; seam check: the server part is reporting one setting and refusing one request shape, and without it the app has nothing to gate on) - not split.

Owns: FR34. Traces to: AC28 (action hidden/disabled/enabled, model name from server, steps live and saved).

### Architecture

C1, C2, C3, C4, C5

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M18-AC1**: Server tests: the server's state reports the configured deep-research model name (Mac-side setting, default `qwen3.5:35b-a3b`); a deep research request with web off, or when the resident model is not the configured one, is refused with a plain error and no run; the chat model is never offered a `deep_research` tool.
- [ ] **M18-AC2**: App tests: the "Deep research" action beside Send is hidden with the web switch off, shown disabled with "Load <model name> to use deep research" when another model is resident, and enabled when the configured model (name from the server, none hardcoded) is resident; using it sends that one message as a run and the next message is an ordinary reply.
- [ ] **M18-AC3**: App tests: a run's phase steps and elapsed clock ("m:ss of 8:00") show live; the finished reply shows its status (`complete`/`partial`/`failed`), its `[n]` marks as logos (FR31) and "Sources (n)" of the pages read, and reopens the same from storage.

### Baseline

### Evidence

### Validation

### Review

Pending.

### Review Cycles

0

### Follow-ups


## M19 — Stop, resume and saving work for a deep research run

Status: TODO

### Outcome

FR9, FR11 and FR23 apply to a run: it survives a dropped connection or backgrounding and resumes with no gaps or duplicates; a first Stop writes a short `partial` report from the notes so far, a second Stop ends it with steps and sources but no report; the report is saved like any answer, page text and notes are not. Operational-complexity signal: CONCURRENCY_LIFECYCLE (one signal; two-stage Stop and resume ownership) - not split.

Owns: FR38. Traces to: AC28 (first and second Stop, dropped-connection resume).

### Architecture

C1, C2, C3, C5, C6

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M19-AC1**: Server tests: a first Stop during searching or reading cancels in-flight searches and reads at once and the run writes a short report from the notes so far under its own short time limit (about a minute), ending `partial`; a second Stop during that write-up cancels it and the reply ends stopped with its steps and sources but no report.
- [ ] **M19-AC2**: Server tests: a dropped connection does not stop the run and resuming from the last seen event yields steps, clock and text with no gaps or duplicates; while a run is in progress a new message is refused as a reply in progress, and unloading the model mid-run needs the FR6 confirmation and, if confirmed, ends the run `partial` or stopped without hanging.
- [ ] **M19-AC3**: App tests: a deep research reply is saved with its report as the answer plus steps, sources and status; page text and notes are not persisted; the next prompt carries the report like any prior answer; a second-Stop reply reopens with its steps and sources and no report; backgrounding and returning resumes without gaps or duplicates.

### Baseline

### Evidence

### Validation

### Review

Pending.

### Review Cycles

0

### Follow-ups


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

### Baseline

### Evidence

### Validation

### Review

Pending.

### Review Cycles

0

### Follow-ups


## M21 — Three real research questions answered on the Mac, and the owner's phone screenshot

Status: TODO

### Outcome

The finished feature proven live: three real research-style questions run on `qwen3.5:35b-a3b` each end within budget with a report citing at least three distinct read pages, and the owner photographs a finished deep research reply on the phone. Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal; proof only) - not split.

Owns: none owned. Traces to: AC29, AC30.

### Architecture

C1, C6, C11, C12, C13

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M21-AC1**: Live on the Mac with `qwen3.5:35b-a3b` resident: 3 real research-style questions each end within the budget plus a small margin with status `complete` or `partial`, a report citing at least 3 distinct read pages, and no citation number that fails to resolve to a saved source; the owner's opinion of report quality is recorded in the evidence (not a gate).
- [ ] **M21-AC2**: The owner's phone screenshot of a finished deep research reply showing its steps, its status, logo citations and "Sources (n)" is saved under .harness/evidence/.

### Baseline

### Evidence

### Validation

### Review

Pending.

### Review Cycles

0

### Follow-ups


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
