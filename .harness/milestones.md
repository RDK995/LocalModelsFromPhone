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

### Architecture

C1

### As-Built

.harness/as-built/M10e.md — RECORDED — 4/4 files attributed; components C1; 0 edges; no claim mismatches

### Acceptance Criteria

- [x] **M10e-AC1**: A test reproduces an answer shaped like the 2026-09-30 22:32 phone screenshot (a web reply whose body is a bulleted list of news items, with a Sources list) and shows, for both the live-streaming and the reopened-saved forms, that the answer takes the full bubble width and nothing overlaps the answer text, with "Sources (n)" and the model name below it; the diagnosed cause of the squeeze and overflow is recorded.
- [x] **M10e-AC2**: The existing FR26-FR31 rendering tests pass unchanged (none edited or weakened), and mobile typecheck, tests and lint pass.
- [x] **M10e-AC3**: The owner's phone screenshot of a new web answer, taken after the phone has loaded the new code, shows the answer at full width, entirely inside its bubble, with "Sources (n)" and the model name below it.

### Baseline

1b139be3d6add2607288a2811c3cc3db2c3b2739 on m10e-answer-fits-bubble

### Evidence

Tasks (routing -> rungs):
- T1 — diagnose + fix the squeezed list answer, computed-layout test (C1)   Top (AMBIGUOUS: undiagnosed layout bug, test oracle to design), attempt 4 PASS; verifier PASS (typecheck 0, 434 pass, lint 0, independent RED in a baseline worktree, files within allowed list, no test weakened) — commit 3240b95. .harness/evidence/M10e-T1-worker.log, M10e-T1-red.log, M10e-T1-verifier.log.
- T2 — restart com.harness.bundle-host so the phone loads the fix   Cheap (BOUNDED_LOW_RISK), attempt 1 PASS; verifier PASS (running, started 22:48:53, 43 s after 3240b95, cwd mobile/, HTTP 200 on :8081). .harness/evidence/M10e-T2-bundle-host.log, M10e-T2-verifier.log.

M10e-AC1:
- Computed-layout test mobile/src/ui/answerLayout.test.ts (yoga-layout 3.2.1 devDependency, Errata.All, point scale 3, style values read from the real StyleSheet.create blocks in chat.tsx/MarkdownText.tsx/SourceList.tsx, items built with buildChatItems, 22:32 news-list answer with 5 sources and model nemotron3:33b on a 393pt phone): reopened-saved form and live-streaming form (partial list + indicator + sources) each assert bubble width = 85% of available width, answer fills the bubble, answer text bottom inside the bubble and above "Sources (n)", the indicator and the model label; plus first-words, one-line answer and user-bubble-stays-shrink-wrapped cases. RED on baseline 1b139be independently confirmed by verifier (exit 1, 3 pass 4 fail: saved text bottom 1136 > 369.17; streaming 611.33 > 258.83; first-words width 46 vs 306.85; one-line 108 vs 306.85); GREEN 7 pass. T1 3240b95. .harness/evidence/M10e-T1-red.log, M10e-T1-verifier.log. Not reviewed.
- Diagnosed cause: the assistant bubble (mobile/src/app/chat.tsx styles.message maxWidth "85%" + assistantMessage alignSelf "flex-start", no width) shrink-wraps its content, and list item text is listText { flex: 1 } (mobile/src/ui/MarkdownText.tsx ~212), i.e. flexBasis 0, so the bubble measured only the 22pt bullets and took its width from the "Sources (n)" header (saved) or the bullet alone (46pt, first streamed words); under RN 0.86 Yoga YGErrataAll (StretchFlexBasis) the text then wrapped at the narrow width while the bubble height was sized for wider lines, so it ran out of the bubble over "Sources (n)" and the model name. Tables were unaffected because card text has no flex: 1. Fix: assistantMessage width "85%". Recorded in the chat.tsx comment above assistantMessage.

M10e-AC2:
- `cd /Users/ryankenny/Projects/CodingHarnessv2/mobile && bun run typecheck && bun test && bun run lint` exit 0: typecheck clean, 434 pass 0 fail across 28 files, lint clean; verifier confirmed no existing test file modified (only answerLayout.test.ts added). .harness/evidence/M10e-T1-verifier.log. Not reviewed.

M10e-AC3:
- OWED - owner phone screenshot. Bundle host com.harness.bundle-host restarted 2026-09-30 22:48:53 (43 s after commit 3240b95), running from mobile/ on m10e-answer-fits-bubble, HTTP 200 on :8081 (T2; .harness/evidence/M10e-T2-bundle-host.log, M10e-T2-verifier.log). Owner steps: (1) swipe Expo Go away so it fully quits; (2) reopen Expo Go and open the project (downloads the new bundle; if the old look persists, shake and tap Reload); (3) with Web search on, ask for today's top news as a bulleted list; (4) pass = the grey answer bubble is wide (about 85% of the screen) while streaming and when finished, every line of text is inside the bubble, "Sources (n)" is below the text inside the bubble and the model name below the bubble, nothing overlaps; (5) optionally reopen the chat and check again; save as .harness/evidence/M10e-AC3-owner-phone.png.
- Owner phone screenshot 2026-10-01 06:54, .harness/evidence/M10e-AC3-owner-phone.png: finished web reply (bulleted news list, Web search on) after loading the new code; grey bubble wide, every line inside it, "Sources (8)" below the text inside the bubble. The model name line is not in frame (screenshot ends at the bubble's bottom edge above the input bar).
- F1 correction: second owner phone screenshot 2026-10-01 06:58, .harness/evidence/M10e-AC3-owner-phone-2.png, same web reply scrolled to the bottom: wide grey bubble with every line inside it, "Sources (8)" below the text inside the bubble, and the model name "nemotron3:33b" below the bubble; nothing overlaps. Owner also stated (2026-10-01) the model name is under the bubble.

### Validation

`cd /Users/ryankenny/Projects/CodingHarnessv2/mobile && bun run typecheck && bun test && bun run lint` — typecheck 0, 434 pass, lint 0 (verifier run). Artifact: .harness/evidence/M10e-T1-verifier.log. AC3 is the owner's phone screenshot (steps under Evidence), not a command.

### Review

Cycle 1: CHANGES REQUIRED (scope RECORD_ONLY), tier Top/opus (AMBIGUOUS, T1 Top-routed), diff 1b139be..45a2911. AC1 PASS, AC2 PASS, AC3 FAIL. 0 BLOCKER, 1 IMPORTANT (F1: AC3 screenshot does not show the model name below the bubble), 0 OPTIONAL. Report .harness/reviews/M10e-cycle1.md; log .harness/evidence/M10e-review.log.
Fix cycle 1 Pre-correction: 94d0858b6084af89e6ec5a436b2cccc43f92de96 (cycle 1 review records committed). Correction is record-only: second owner screenshot added as AC3 evidence (F1); no file outside F1 changed.
Cycle 2: PASS, tier Mid/sonnet (review floor; correction contained no routed tasks), diff 94d0858..11501e9 (correction scope). AC1 PASS, AC2 PASS, AC3 PASS (judged on .harness/evidence/M10e-AC3-owner-phone-2.png). 0 BLOCKER, 0 IMPORTANT, 0 OPTIONAL. F1 resolved.

### Review Cycles

1

### Follow-ups

- The comment above gridWidth in mobile/src/ui/tableLayout.ts and the comment near markdownText.test.ts:126 still say the assistant bubble shrink-wraps; now stale (bubble has a definite 85% width). The explicit gridWidth (282 <= inner 282.85) is now redundant but harmless. Outside T1's allowed files.
- answerLayout.test.ts measures text with a fixed 0.5 x fontSize character width, not iOS text layout; it reproduces the mechanism, not exact device pixels. The owner screenshot (AC3) is the device proof.
- Every assistant answer, even a one-word reply, is now a full 85%-wide bubble (intended by FR32; user bubbles unchanged).
- Owner request 2026-10-01 (from the AC3 screenshot): add a little space between the end of a sentence and the inline source logo that follows it - the logo currently touches the last word. Not in FR32/AC26; needs a requirement before it is built.

## M11 — Web replies are saved, resume after a drop, and keep page text out of later prompts

Status: IN_PROGRESS

### Outcome

A web reply's steps and sources are saved with it in the conversation, a dropped connection mid-web-reply resumes with steps and text complete and unduplicated, page text and full results are never stored or re-sent, and a searching reply counts as a reply in progress. Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal; resume reuses the existing per-reply event log, no lifecycle change - not split).

Owns: FR23. Traces to: AC17 (resume), AC18 (persistence).

### Architecture

C1, C2, C3, C6

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M11-AC1**: Killing the connection during a web reply and reconnecting yields the complete steps and answer with no gaps and no duplicates.
- [ ] **M11-AC2**: Persisted conversations contain each web reply's steps and sources but no page text or full search results, and a follow-up prompt sends prior answers with their source lists without re-sending page text.
- [ ] **M11-AC3**: While a reply is searching, sending another prompt is refused as a reply in progress, and a swap or unload requires the busy confirmation.

### Baseline

9d8270f6cd0e5f21f6d121fa10065f3aa51bbffb on m11-web-replies-saved-resume

### Evidence

Task plan (implementation phase 1, 2026-10-01; no task dispatched yet - handed off at turn budget):
- M11-T1 Mid (ORDINARY_IMPLEMENTATION): follow-up history carries prior answers' source lists; persisted web reply holds steps+sources only (AC2). Packet .harness/tasks/M11-T1.md
- M11-T2 Mid: server HTTP tests - searching reply refuses chat (409) and needs busy confirmation; Last-Event-ID replay exact (AC3, AC1). Packet .harness/tasks/M11-T2.md
- M11-T3 Mid: phone client drop/resume mid web reply, each event once (AC1). Packet .harness/tasks/M11-T3.md
- M11-T4 Mid: live proof mobile/scripts/web-resume-proof.sh (AC1-AC3), after T1-T3. Packet .harness/tasks/M11-T4.md
Reconnaissance at baseline: gap found in mobile/src/chat/conversationSession.ts lines 113-116 (history drops stored sources); server event log, in-progress slot and busy confirmation already span the tool stage (to be proven by T2). T1 and T2 can run in parallel; T3 after T1 (both mobile); T4 last.


### Validation

Planned (confirmed during implementation): `cd /Users/ryankenny/Projects/CodingHarnessv2 && (cd server && bun test && bun run typecheck) && (cd mobile && bun run typecheck && bun test && bash scripts/web-resume-proof.sh)`

### Review

Pending.

### Review Cycles

0

### Follow-ups

None.

## M12 — Stop during a web search ends it on the Mac

Status: TODO

### Outcome

Pressing Stop while a reply is searching or reading a page cancels the reply and the in-flight search or page read on the Mac: the helper process is killed or the fetch aborted, and output stops. Operational-complexity signals: CONCURRENCY_LIFECYCLE + IMPLEMENTATION_PLUS_LIVE_PROOF (abort propagating C6 -> C12 -> C13 -> C14, proven live). Cut apart from M13 for that reason; with one criterion it is the narrowest seam and cannot be split further.

Owns: none owned (FR23 Stop clause, owned by M11). Traces to: AC17 (Stop), FR23 (Stop cancels search).

### Architecture

C6, C12, C13, C14

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M12-AC1**: Stop during an in-flight search or page read ends it on the Mac (search helper process killed or page fetch aborted in the search service) and the reply stops.

### Baseline


### Evidence


### Validation

Planned (confirmed during implementation): `cd /Users/ryankenny/Projects/CodingHarnessv2 && (cd server && bun test) && (cd search && bun test) && bash server/scripts/web-stop-proof.sh`

### Review

Pending.

### Review Cycles

0

### Follow-ups

None.

## M13 — Search failures and time limits never hang a web reply, and no hosted search is used

Status: TODO

### Outcome

When both search backends fail the reply still completes and the app shows search was unavailable; a step that exceeds its time limit is failed, the model is told, and the reply carries on; and no hosted search or fetch API or key is configured or called. Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal - not split).

Owns: FR24. Traces to: AC16 (both fail, time limit), AC18 (no hosted API).

### Architecture

C1, C12, C13, C14

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M13-AC1**: With both search backends forced to fail, the web reply still completes with an answer and the app shows that search was unavailable.
- [ ] **M13-AC2**: A search or page read exceeding its time limit is shown as a failed step, the model is told it failed, and the reply completes without hanging.
- [ ] **M13-AC3**: No hosted search or fetch API or key is configured or called: code and config inspection, plus an outbound-connection check during a live web reply.

### Baseline


### Evidence


### Validation

Planned (confirmed during implementation): `cd /Users/ryankenny/Projects/CodingHarnessv2 && (cd server && bun test) && (cd mobile && bun test) && bash server/scripts/web-failure-proof.sh && bash search/scripts/no-hosted-api-check.sh`

### Review

Pending.

### Review Cycles

0

### Follow-ups

None.

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
