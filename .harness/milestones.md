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

### Architecture

C1, C2, C3

### As-Built

.harness/as-built/M10c2.md — RECORDED — 14/14 files attributed; components C1,C2,C3; 4 edges; claim mismatches NONE

### Acceptance Criteria


- [x] **M10c-AC1**: In a web answer, a link whose URL matches a saved source (including a www./trailing-slash/scheme variant) shows the site's logo after its text and tapping it opens that page in Safari; a link not among the sources (e.g. https://www.msn.com/...) and a link in a non-web answer are plain, non-tappable text with no logo; a site with no reachable logo shows the globe icon. No third-party logo service is called, and the phone contacts no website or logo service directly - logos arrive from the Mac (checked by inspection plus a network observation during the live proof); the Mac's icon fetch refuses local, LAN and tailnet destinations.

### Baseline

8f4428053ad71a5bd39d1641ef5c25266a9e84af on m10c2-source-link-logos

### Evidence

Tasks:
- M10c2-T1 — sourceLinks.ts link-to-source matching   Cheap (haiku, BOUNDED_LOW_RISK), attempt 1, PASS — commit af84383; .harness/evidence/M10c2-T1-verifier.log (51 pass, typecheck, lint)
- M10c2-T2 — siteIcon (C2) + iconCache (C3)            Mid (sonnet, ORDINARY_IMPLEMENTATION), attempt 3, PASS — commit 469b4b3; .harness/evidence/M10c2-T2-verifier.log (60 pass, typecheck, lint)
- M10c2-T3 — inline logo rendering (C1)               Mid (sonnet, ORDINARY_IMPLEMENTATION), attempt 3, PASS — commit 03c1ffe; .harness/evidence/M10c2-T3-verifier.log (368 pass, typecheck, lint)
- M10c2-T4 — live proof mobile/scripts/source-logo-proof.sh   Mid (sonnet, ORDINARY_IMPLEMENTATION), attempt 3, PASS — commit 64c47d4; .harness/evidence/M10c2-T4-verifier.log (exit 0, checks 1-8 PASS); proof log .harness/evidence/M10c2-T4-proof.log. Wrapper also restarts com.harness.search (the running copy predated M10c1's icon route).

M10c-AC1 evidence (Mac-side): live proof — siteIcon("github.com") through the Mac returns a data:image URI; the phone cache asks once then serves from memory and from storage; localhost and 100.100.100.100.nip.io (refused by the Mac) and example.com (no icon) give the globe; www./scheme/trailing-slash variants of a source match, https://www.msn.com/... and a non-source path stay plain, and a reply with no sources (non-web answer) stays plain; network observation: all 6 requests went to SERVER_URL/v1/icon?host=; inspection: no third-party logo service, fetch( only under mobile/src/api. Screen wiring (static checks, 368 pass): MarkdownText renders a source-matched link's text followed by SourceLogo, whose tap opens the source URL with Linking.openURL; other links are plain Text with no onPress.


### Validation

`cd /Users/ryankenny/Projects/CodingHarnessv2/mobile && bun run typecheck && bun test && bun run lint && bash scripts/source-logo-proof.sh` — reviewer runs once. Needs the Mac server, the token at ~/.phone-models/token and internet; restarts com.harness.server, com.harness.bundle-host and com.harness.search; loads no model. Task evidence: .harness/evidence/M10c2-T1..T4-verifier.log, .harness/evidence/M10c2-T4-proof.log.

Owner's phone observation still owed (cannot be claimed Mac-side): in a web answer, a link to one of its sources shows the site's logo after its text; tapping the logo opens Safari at that page; the link text itself and a non-source link are not tappable; a site with no logo shows the globe; an older saved web chat gets logos too.

### Review

Cycle 1: PASS — tier Mid, model sonnet, reason_code ORDINARY_IMPLEMENTATION (highest task tier in the diff: T2-T4 Mid), scope WHOLE_MILESTONE, diff 8f44280..c107138. Per-criterion: M10c-AC1 PASS. Findings: 0 BLOCKER, 0 IMPORTANT, 0 OPTIONAL. Reviewer re-ran milestone validation (typecheck, bun test, lint, source-logo-proof.sh), exit 0 — .harness/evidence/M10c2-review.log. No report written (PASS). Owner phone observation remains owed (see Validation).

### Review Cycles

0

### Follow-ups

- Architecture deviation D-M10c-2 (the Mac fetches each site's icon: C13 GET /v1/icon behind C4 GET /v1/icon; the phone talks only to the Mac) is recorded as Material: yes and approved by the human on 2026-09-30; it supersedes D-M10c-1, which is withdrawn and must not be implemented.
- A logo failing to load must never block or break the answer (FR27).
- Split from M10c 2026-09-30 by human decision (Option A); depends on M10c1 (GET /v1/icon must exist).
- Production LaunchAgent com.harness.search was found running code from before M10c1 (404 for every /v1/icon); M10c2-T4's proof now restarts it. Consider whether the deploy/restart path for com.harness.search should pick up new code automatically (ops, C9).
- Architecture deviation D-M10c2-1 (Material: no): globe fallback is the system glyph U+1F310; the phone remembers "no logo" for the app session only.
- milestones.md is still past 400 lines after archiving M10b; nothing else is archivable yet (M10c1 most recently settled, M5a BLOCKED, the rest TODO).

## M10c3 — Tables in answers line up under their headings and stay readable at phone width

Status: TODO

### Outcome

Every markdown table in an assistant answer - web or not, streaming or already saved - shows each body cell under its own column heading (short rows padded, surplus cells joined into the last column, nothing dropped or shifted); a two-column table renders as a grid and a table of three or more columns as one card per body row with "heading: value" lines, so nothing is squeezed and nothing scrolls sideways. The cause of the 2026-09-30 misalignment is diagnosed and pinned by a test. Planned 2026-09-30 from the owner-reported follow-ups under M10c1 (human decision: built after M10c2, before M10d); separate from M10c4 because the two are independently demonstrable outcomes in different halves (phone renderer vs. server web instructions). Operational-complexity signals: none (one subsystem, C1 renderer; about two production files; no automated live proof).

Owns: FR29. Traces to: AC23.

### Architecture

C1

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M10c3-AC1**: Unit tests: a table shaped like the 2026-09-30 phone screenshot (trend, description, source columns) renders each value under its own heading, and the diagnosed cause of that misalignment (model output shape vs. the FR26 renderer) is covered by a test that fails on the pre-fix code.
- [ ] **M10c3-AC2**: Unit tests: a body row with fewer cells than the header row is padded with empty cells, and a body row with more cells keeps the surplus text joined into the last column; no text is dropped and no value moves to another column.
- [ ] **M10c3-AC3**: Unit tests: a two-column table renders as a grid, and a table of three or more columns renders as one card per body row listing "heading: value" per column on its own line; inline formatting and links inside cells render as in FR26/FR27.
- [ ] **M10c3-AC4**: Unit tests: a table still streaming (header only, or half a body row) renders without error, and a saved (reopened) reply's table renders the same way as a live one.
- [ ] **M10c3-AC5**: Owner's phone observation in Expo Go (recorded in evidence): an answer containing a three-or-more-column table shows one card per row with every value under its own heading, and a two-column table shows as an aligned grid, with no sideways scrolling.

### Baseline


### Evidence


### Validation

Planned (confirmed during implementation): `cd /Users/ryankenny/Projects/CodingHarnessv2/mobile && bun run typecheck && bun test && bun run lint`

### Review

Pending.

### Review Cycles

0

### Follow-ups

- Source: owner-reported table follow-up recorded under M10c1 (.harness/archive/M10c1.md, Follow-ups).
- Architecture deviation D-M10c3-1 (Material: no) records the Requirement Coverage addition FR29 -> C1.

## M10c4 — Broad web questions draw on at least three different websites

Status: TODO

### Outcome

With the web switch on, the instructions the server gives the model alongside the FR19 date note tell it that a broad or open-ended question is searched with more than one query, without the exact date in the query, reading pages from at least three different websites before answering and citing the pages it relied on, while a narrow question need not search more than it needs; the server does not check or re-prompt and the 10-call cap is unchanged. Proven live on the Mac: most broad prompts come back with sources from three or more sites. Planned 2026-09-30 from the owner-reported follow-ups under M10c1 (human decision: built after M10c2, before M10d); separate from M10c3 (independent outcome). Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal); seam checked - the implementation is instruction text in C12 only, and splitting the live proof from it would leave a part with no real-entry-point criterion, so it stays one milestone.

Owns: FR30. Traces to: AC24.

### Architecture

C12

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M10c4-AC1**: Unit test: with web search on, the server's web instructions to the model (given alongside the FR19 date note) contain the FR30 guidance - for a broad or open-ended question search with more than one query, do not put the exact date into search queries, read pages from at least three different websites before answering, and cite the pages relied on; a narrow factual question need not search more than it needs - and with web search off no such guidance is given; the existing 10-tool-call cap tests pass unchanged and the server adds no source-diversity check or re-prompt.
- [ ] **M10c4-AC2**: Live on the Mac with the owner's usual tools-capable model resident (named in the evidence) and the web switch on, through the server's chat route: of 3 broad prompts (including "What are today's news trends"), at least 2 produce replies whose saved sources span at least 3 distinct websites (host compared ignoring a leading www.); the prompts, the per-reply distinct hosts and the pass count are recorded.

### Baseline


### Evidence


### Validation

Planned (confirmed during implementation): `cd /Users/ryankenny/Projects/CodingHarnessv2/server && bun test && bun run typecheck && bash scripts/source-diversity-proof.sh`

### Review

Pending.

### Review Cycles

0

### Follow-ups

- Source: owner-reported single-site follow-up recorded under M10c1 (.harness/archive/M10c1.md, Follow-ups).
- Architecture deviation D-M10c4-1 (Material: no) records the Requirement Coverage addition FR30 -> C12.
- The live proof loads a model and depends on the internet and a non-deterministic model; the pass bar is 2 of 3 by human decision.

## M10d — A web answer's sources start folded as "Sources (n)", each its own tappable entry

Status: TODO

### Outcome

The source list at the end of a web answer starts collapsed behind a "Sources (n)" header that expands and collapses on tap (not remembered when the chat is reopened), and each source is its own entry - site logo as in M10c2 plus page title - opening in Safari, never merged with another source into one link. Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal; split from the FR26-FR28 plan, see M10b).

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
