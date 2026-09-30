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

### Architecture

C1, C2, C3

### As-Built

.harness/as-built/M10.md — RECORDED — 16/18 files attributed; components C1,C2,C3; 5 edges; claim mismatches NONE

### Acceptance Criteria

- [x] **M10-AC1**: Each conversation has a web-search switch, off by default (including for conversations created before this change), and its state survives force-quitting and reopening Expo Go.
- [x] **M10-AC2**: The switch is disabled with an explanation when the resident model lacks the tools capability (proven with a stubbed capability check if no installed model lacks it), and changing it while a reply is in progress takes effect from the next prompt.
- [x] **M10-AC3**: With the switch on, a prompt asking for today's news shows each web step live on the phone (e.g. Searching: <query>, Reading: <domain>), then the final answer, and the steps collapse into an expandable section after completion.
- [x] **M10-AC4**: An answer that used the web ends with a source list whose links open in Safari.

### Baseline

e98f0601a4330343f9a1063ce48e154d60109d8a on m10-phone-web-switch

### Evidence

Task plan (packets in .harness/tasks/):
- M10-T1 — C2 step/sources events, accumulator, web flag   Mid (sonnet, ORDINARY_IMPLEMENTATION), attempt 3, PASS — .harness/evidence/M10-T1-verifier.log (exit 0, 183 mobile pass, typecheck+lint 0; red M10-T1-red.log)
- M10-T2 — C3 switch + steps/sources persisted, session    Mid (sonnet, ORDINARY_IMPLEMENTATION), attempt 3, PASS — commit 7f09b0b; .harness/evidence/M10-T2-verifier.log (first run exit 0, 204 pass; a later appended FAIL is the verifier re-running over in-progress T3 files after the commit, see state note); red M10-T2-red.log. Late worker quote-style fix committed separately.
- M10-T3 — C1 view-model: labels, switch state             Cheap (haiku, BOUNDED_LOW_RISK), attempt 1, PASS — commit f9abe88; .harness/evidence/M10-T3-verifier.log (exit 0, 238 then 246 pass; late FAIL only for other tasks' files); red M10-T3-red.log
- M10-T4 — C1 chat.tsx switch, steps, sources in Safari    Mid (sonnet, ORDINARY_IMPLEMENTATION), attempt 3, PASS — commit 1d5e438; .harness/evidence/M10-T4-verifier.log (exit 0, 246 pass, diff read against criteria 1-6); no unit oracle for the screen
- M10-T5 — web-switch-proof.sh live proof                  Mid (sonnet, ORDINARY_IMPLEMENTATION), attempt 3, PASS — .harness/evidence/M10-T5-verifier.log (full command incl. live proof exit 0, all checks PASS, Mac restored); proof log M10-T5-proof.log

Implementation complete (continuation 2): all five tasks accepted. Mac-side evidence for each criterion is in the live proof (M10-T5-proof.log): AC1 check 1 (switch off by default incl. legacy data, persists across a fresh store on the same files), check 2 (off sends no web); AC2 check 3 (disabled + explanation, stubbed stub-no-tools because all 5 installed models have tools) and check 4 (mid-reply flip takes effect next prompt); AC3/AC4 check 5 (live search step before the answer, sources with http(s) links, persisted steps/sources, collapsed toggle label). Owed by the owner on the phone: see Validation.

### Validation

`cd /Users/ryankenny/Projects/CodingHarnessv2/mobile && bun run typecheck && bun test && bun run lint && bash scripts/web-switch-proof.sh` — exit 0 (M10-T5 verifier, .harness/evidence/M10-T5-verifier.log): 246 pass, lint clean, live proof all PASS.
Fix cycle 1: same command exit 0 over fb76a0c (M10-C1 verifier, .harness/evidence/M10-C1-verifier.log): 248 pass, lint clean, live proof all PASS (.harness/evidence/M10-C1-proof.log).

Owner's phone observation still owed (cannot be claimed Mac-side): (1) open a chat, see the "Web search" switch off; open an older chat, also off; (2) turn it on, force-quit Expo Go, reopen that chat, still on; (3) with web on, ask "What are today's top news headlines?", watch "Searching: ..." (and any "Reading: ...") lines appear live, then the answer; after it finishes the steps fold into "Show web steps (n)" which expands; (4) tap a source under "Sources" and it opens in Safari; (5) screenshot of (3)/(4).

### Review

Cycle 1: CHANGES REQUIRED — whole milestone (Scope SUBSTANTIVE), report .harness/reviews/M10-cycle1.md, validation re-run exit 0 (.harness/evidence/M10-review.log); M10-AC1 PASS, M10-AC2 PASS with caveat (finding 1), M10-AC3 PASS, M10-AC4 PASS (all on Mac evidence; phone observation owner-owed); 0 BLOCKER, 1 IMPORTANT, 1 OPTIONAL.
- F1 (IMPORTANT): switch stuck on and still sending web for a no-tools model — correction task M10-C1.
- F2 (OPTIONAL): capability checked only on focus; index keys for steps — not routed, recorded under Follow-ups.
Fix cycle 1 Pre-correction: e14b57f9dc084c32a5b19f87c70f03a02b7f0dc6 (after committing the review records).
Fix cycle 1 corrections: M10-C1 (F1) — Mid (sonnet, ORDINARY_IMPLEMENTATION), attempt 3, PASS, commit fb76a0c. Verifier (.harness/evidence/M10-C1-verifier.log): `cd mobile && bun run typecheck && bun test && bun run lint` exit 0, 248 pass; live `bash scripts/web-switch-proof.sh` exit 0, all checks PASS, Mac restored (.harness/evidence/M10-C1-proof.log); Tests Weakened NO; red .harness/evidence/M10-C1-red.log. sendMessage now sends web:true only when the stored switch is on AND the resident is listed with tools:true in the send-time getState; the Switch shows webSwitchDisplayValue(stored, state) (off while unavailable) and the stored web_search is not rewritten.
Correction diff: `git diff e14b57f9dc084c32a5b19f87c70f03a02b7f0dc6 HEAD`. Files changed (git diff --name-only): mobile/src/app/chat.tsx, mobile/src/chat/chatController.ts, mobile/src/chat/chatController.test.ts, mobile/src/chat/conversationSession.test.ts, mobile/src/ui/webSwitch.ts, mobile/src/ui/webSwitch.test.ts, plus .harness records (milestones.md, state.json, tasks/M10-C1.md, evidence/M10-C1-*.log, evidence/M10-T5-proof.log).
Files changed that no finding named: mobile/src/chat/chatController.ts (the gate lives where getState already runs, not in the named conversationSession.ts), mobile/src/ui/webSwitch.ts (new webSwitchDisplayValue), and their tests; .harness/evidence/M10-T5-proof.log was rewritten by the live proof re-run (the script writes that log). server/src/generations/manager.ts (named) was not changed: the gate is client-side.
Cycle 2: PASS — whole milestone (widened: the correction changed files no cycle-1 finding named), reviewer tier Mid (model sonnet, ORDINARY_IMPLEMENTATION), diff e98f060..d7704c0 with correction diff e14b57f..HEAD checked; validation re-run exit 0 (.harness/evidence/M10-cycle2-review.log); M10-AC1 PASS, M10-AC2 PASS, M10-AC3 PASS, M10-AC4 PASS (AC1/AC3/AC4 on Mac evidence); F1 confirmed resolved; 0 BLOCKER, 0 IMPORTANT, 0 OPTIONAL.

### Review Cycles

1

### Follow-ups

- Size check at pickup: 4 criteria, one signal (IMPLEMENTATION_PLUS_LIVE_PROOF); seam check: the phone observation proves the same outcome - not split.
- milestones.md stays above 400 lines after archiving M8: M9 (most recently settled), M10-M13 (open) and M5a (BLOCKED) are protected.
- Subagent completion notifications arrived before some workers/verifiers had stopped; their late re-runs landed in the shared tree and appended to evidence logs. Consider waiting for each agent's final hand-back before starting the next task.
- Review cycle 1 F2 (OPTIONAL, not routed): the capability check runs only on screen focus, so a model change while the chat is open is not seen until refocus (the send-time gate from M10-C1 now stops a wrong web request regardless); web steps use array index keys.
- Owner phone check still owed (not provable Mac-side; reviewer graded AC1/AC3/AC4 on Mac evidence): switch visible and off by default incl. an older chat; on-state survives force-quitting Expo Go; a today's-news prompt shows live steps that fold into "Show web steps (n)"; a Sources link opens in Safari; screenshot.
- The live proof's model made no read_page call, so a live "Reading: <domain>" step was not seen Mac-side (read labels are unit-tested).

## M10b — Assistant answers show formatted text instead of raw markdown

Status: DONE

### Outcome

Every assistant answer on the phone - web or not, streaming or already saved - renders its markdown (bold, italics, headings, lists, inline code and code blocks, links) with no raw markup visible, and half-written markup mid-stream never breaks the view; links show as plain non-tappable text until M10c adds source logos, and thinking stays plain text. Split at planning (2026-09-30) from one FR26-FR28 milestone because of operational-complexity signals MULTIPLE_OUTCOMES + IMPLEMENTATION_PLUS_LIVE_PROOF (a required split; WORKER_TASKS_GT_6 also anticipated); parts: M10b formatted answers (AC20), M10c inline source logos (AC21), M10d collapsed source list (AC22). Each part keeps one signal: IMPLEMENTATION_PLUS_LIVE_PROOF.

Owns: FR26. Traces to: AC20.

### Architecture

C1

### As-Built

.harness/as-built/M10b.md — RECORDED — 5/7 files attributed; components C1; 0 edges; claim mismatches NONE

### Acceptance Criteria

- [x] **M10b-AC1**: An assistant answer containing bold, a heading, a list, inline code and a link renders with no raw markdown characters visible, both for a newly streamed reply and for a reply saved before this change; a reply mid-stream with unterminated markup renders without error.

### Baseline

4e6039f5030b5fea0d13f1086f30c1cac2a08100 on m10b-formatted-answers

### Evidence

Task plan (packets in .harness/tasks/):
- M10b-T1 — C1 pure markdown parser, streaming-tolerant     Mid (sonnet, ORDINARY_IMPLEMENTATION), attempt 3, PASS — commit c69e1f3; .harness/evidence/M10b-T1-verifier.log (exit 0, 277 pass, typecheck+lint clean); red M10b-T1-red.log
- M10b-T2 — C1 MarkdownText component, chat.tsx wiring      Mid (sonnet, ORDINARY_IMPLEMENTATION), attempt 3, PASS — commit daef384; .harness/evidence/M10b-T2-verifier.log (exit 0, 295 pass, typecheck+lint clean); red M10b-T2-red.log (15 fail). Resumed an interrupted attempt's untracked test file; kept all assertions. Rendering itself has no runtime oracle under bun (static tests only).
- M10b-T3 — markdown-render-proof.sh live proof              Mid (sonnet, ORDINARY_IMPLEMENTATION), attempt 3, PASS — commit adcb7ec; .harness/evidence/M10b-T3-verifier.log (full command incl. live proof exit 0); proof log M10b-T3-proof.log; self-test failure M10b-T3-red.log

M10b-AC1 evidence (Mac-side): live proof check 1 (streamed reply: heading, list, bold, code, link parsed; visible text has no **, __, ](, backtick, # line or raw URL), check 2 (14 of 28 live prefixes ended inside unterminated markup, all parse cleanly and show no ** or ](), check 3 (a conversation saved in the pre-change format, loaded by a fresh store, renders the same). Screen wiring: chat.tsx renders assistant content through MarkdownText for both streaming and saved replies (markdownText.test.ts).

### Validation

`cd /Users/ryankenny/Projects/CodingHarnessv2/mobile && bun run typecheck && bun test && bun run lint && bash scripts/markdown-render-proof.sh` — exit 0 (M10b-T3 verifier over adcb7ec, .harness/evidence/M10b-T3-verifier.log): 295 pass, typecheck and lint clean, live proof all PASS, Mac resident model unchanged.

Owner's phone observation still owed (cannot be claimed Mac-side): ask for an answer with a heading, bold, a list, inline code and a link; watch it stream with no raw markup; reopen an older saved chat and see its answers formatted; confirm links are plain non-tappable text and thinking stays plain.

### Review

Cycle 1: PASS — whole milestone, reviewer tier Mid (model sonnet, ORDINARY_IMPLEMENTATION), diff 4e6039f..52544c3; validation re-run exit 0 incl. live proof (.harness/evidence/M10b-review.log); M10b-AC1 PASS (on Mac evidence; phone observation owner-owed, see Validation); 0 BLOCKER, 0 IMPORTANT, 0 OPTIONAL.

### Review Cycles

0

### Follow-ups

- The markdown renderer must be pure JavaScript and Expo Go-compatible (no native module; requirements Constraints). If it adds a new dependency, record that technology choice under Deviations in .harness/architecture.md before M10b completes.
- Links render as plain, non-tappable text in M10b (FR27's rule for links that are not sources); M10c adds the logo for links matching the reply's sources.

## M10c — Links to a web answer's sources show the site's own logo and open in Safari

Status: TODO

### Outcome

In a web answer, a link whose URL matches one of that reply's saved sources (ignoring scheme, a leading www. and a trailing slash) shows its text followed by the website's own logo, fetched by the Mac (the search service, through the same public-sites-only guard used for page reading, image content only, cached on the Mac) and passed to the phone through a new token-protected server route, then cached on the phone, with a globe icon when none loads or the Mac is unreachable; tapping the logo opens the page in Safari. The phone contacts no website or logo service itself, and no third-party logo service is called. Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (split from the FR26-FR28 plan, see M10b); re-planned 2026-09-30 to span phone, server and search service, so re-size at implementation start. Architecture deviation D-M10c-2 (Mac fetches icons; supersedes the withdrawn D-M10c-1) is recorded.

Owns: FR27. Traces to: AC21.

### Architecture

C1, C2, C3, C4, C12, C13

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M10c-AC1**: In a web answer, a link whose URL matches a saved source (including a www./trailing-slash/scheme variant) shows the site's logo after its text and tapping it opens that page in Safari; a link not among the sources (e.g. https://www.msn.com/...) and a link in a non-web answer are plain, non-tappable text with no logo; a site with no reachable logo shows the globe icon. No third-party logo service is called, and the phone contacts no website or logo service directly - logos arrive from the Mac (checked by inspection plus a network observation during the live proof); the Mac's icon fetch refuses local, LAN and tailnet destinations.

### Baseline


### Evidence


### Validation

Planned (confirmed during implementation): `cd /Users/ryankenny/Projects/CodingHarnessv2 && (cd search && bun test) && (cd server && bun test && bun run typecheck) && (cd mobile && bun run typecheck && bun test && bun run lint) && bash scripts/source-logo-proof.sh`

### Review

Pending.

### Review Cycles

0

### Follow-ups

- Architecture deviation D-M10c-2 (the Mac fetches each site's icon: C13 GET /v1/icon behind C4 GET /v1/icon; the phone talks only to the Mac) is recorded as Material: yes and approved by the human on 2026-09-30; it supersedes D-M10c-1, which is withdrawn and must not be implemented.
- A logo failing to load must never block or break the answer (FR27).
- search/API.md must document the new GET /v1/icon route (FR25).

## M10d — A web answer's sources start folded as "Sources (n)", each its own tappable entry

Status: TODO

### Outcome

The source list at the end of a web answer starts collapsed behind a "Sources (n)" header that expands and collapses on tap (not remembered when the chat is reopened), and each source is its own entry - site logo as in M10c plus page title - opening in Safari, never merged with another source into one link. Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal; split from the FR26-FR28 plan, see M10b).

Owns: FR28. Traces to: AC22.

### Architecture

C1

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M10d-AC1**: A web answer's sources start collapsed as "Sources (n)", expand and collapse on tap, and each source is its own tappable entry (logo + title) opening in Safari - including a source set shaped like the 2026-09-30 phone screenshot in which several sources rendered glued into one link. Proven by unit tests, a Mac-side live proof, and the owner's phone screenshot.

### Baseline


### Evidence


### Validation

Planned (confirmed during implementation): `cd /Users/ryankenny/Projects/CodingHarnessv2/mobile && bun run typecheck && bun test && bun run lint && bash scripts/sources-list-proof.sh`

### Review

Pending.

### Review Cycles

0

### Follow-ups

- Reuses M10c's site-logo component (FR27 logo and globe fallback); two sources on the same site each get their own entry with the same logo.

## M11 — Web replies are saved, resume after a drop, and keep page text out of later prompts

Status: TODO

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


### Evidence


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
