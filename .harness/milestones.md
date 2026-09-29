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

### Architecture

C9

### As-Built

.harness/as-built/M5c.md — RECORDED: C9 observed, 2 of 2 files attributed, 2 edges, no claim mismatches

### Acceptance Criteria

- [x] **M5-AC4**: After retirement, /app no longer resolves, the PWA's LaunchAgent is gone, and the harness's / handler still works.

### Baseline

52bc8248c798fe91e1029cb27b7f28e60b881fbb on m5c-pwa-retirement

### Evidence

- T1 — PWA retirement scripts + live run: Mid (routed Mid: live outward-facing change, not low risk), attempt 3, PASS; commit c4e3e33. Verifier re-ran `bash ops/scripts/retire-pwa.sh && bash ops/scripts/retire-pwa-proof.sh` exit 0 (idempotent "already retired" x4, 9 PASS) — .harness/evidence/M5c-T1-verifier.log; worker live run incl. pre-retirement capture (/app 200 with PWA HTML; / 502 because nothing listens on 127.0.0.1:7787) — .harness/evidence/M5c-T1-worker.log. :443 now has only "/" -> http://127.0.0.1:7787; :8443 "/" -> 7789 unchanged (401 on /v1/state); phoneToLocalModel HEAD 5c86608, clean.
- T2 — end-to-end :443 "/" routing proof: Cheap attempt 1 FAIL (EXIT trap clobbered $WORK cleanup; empty sentinel suffix; reverted) → Cheap attempt 2 PASS; commit 7a1098b. Verifier re-ran the packet's Tests command, exit 0: sentinel responder on 127.0.0.1:7787 only, `https://<mac>/` returned 200 with the exact random sentinel body via Tailscale Serve; `/app` returned the sentinel (not the PWA); nothing listens on 7787 afterwards; no mktemp dir leaked; no existing check removed (only two info lines replaced) — .harness/evidence/M5c-T2-verifier.log.
- Undo (printed by retire-pwa.sh; backups in ~/.phone-models/retired-pwa/):
  `cp ~/.phone-models/retired-pwa/com.ryankenny.phone-pwa.plist ~/Library/LaunchAgents/com.ryankenny.phone-pwa.plist`
  `launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.ryankenny.phone-pwa.plist`
  `tailscale serve --bg --https=443 --set-path=/app http://127.0.0.1:7788`

### Validation

`cd /Users/ryankenny/Projects/CodingHarnessv2 && bash -n ops/scripts/retire-pwa.sh && bash -n ops/scripts/retire-pwa-proof.sh && bash ops/scripts/retire-pwa-proof.sh && ! lsof -nP -iTCP:7787 -sTCP:LISTEN`

Read-only against live config, except a temporary sentinel HTTP responder on 127.0.0.1:7787 (started only when nothing already listens there) that an EXIT trap kills. Takes seconds. Do not run the undo commands.

### Review

Cycle 1: PASS, tier Mid (sonnet, MID_TIER_DIFF), full-milestone scope 52bc8248c798fe91e1029cb27b7f28e60b881fbb..6a0c87a; M5-AC4 PASS; 0 BLOCKER, 0 IMPORTANT, 0 OPTIONAL; no report file (PASS). Full-milestone scope. Reviewer re-ran the recorded validation live (bash -n on both scripts, retire-pwa-proof.sh, no listener on 7787 after): exit 0, 12 checks PASS, sentinel round-trip through Tailscale Serve / confirmed; phoneToLocalModel HEAD 5c86608 with clean tree. Matches C9/I14; no drift. No review log file written.

### Review Cycles

0

### Follow-ups

- Reordered 2026-09-29 by the human: M5c runs before M5a while M5a still awaits reboot attempt 2 for M5-AC1 (human busy on the Mac). FR17's ordering ('after this app's acceptance criteria pass') is waived by the human for this milestone only, accepting the risk that there is no fallback PWA if reboot attempt 2 fails. M5a stays BLOCKED until the reboot evidence exists.
- ops/scripts/verify-ops-install.sh does not list retire-pwa.sh / retire-pwa-proof.sh in required_scripts. Not needed for M5-AC4; left out of scope.
- retire-pwa-proof.sh check_root_routing: the readiness poll is 50 `curl --max-time 1` tries with no delay; connection-refused returns instantly, so the wait is bounded by count (well under a second), not ~50s. Passed twice live; could spuriously fail on a slow bun start. Consider a time-based bound.

## M6 — The search service reads a web page safely over loopback

Status: IN_PROGRESS

### Outcome

A new loopback-only search service on 127.0.0.1:7790 answers POST /v1/read: it fetches a public page on the Mac and returns its main content as markdown, truncated and marked when too long, and refuses local, private, tailnet and other non-public destinations at connect time, including via redirects. First web milestone: proves risk R6 (Bun honouring a custom lookup) before anything depends on it. Planned 2026-09-29 for FR18-FR25; operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal; seam check: the live fetches are the criteria themselves, so separating them would leave a component-only half - not split).

Owns: FR21. Traces to: AC15.

### Architecture

C13, C15

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M6-AC1**: POST /v1/read on the search service (127.0.0.1:7790) with a real public article URL returns 200 with its main text as markdown (boilerplate removed) and truncated false; a page longer than the size limit comes back truncated true with a truncation marker.
- [ ] **M6-AC2**: POST /v1/read refuses with 400 blocked_destination each of http://127.0.0.1:7789, http://localhost, a 100.x tailnet address, a 192.168.x.x address, http://[::1], and a hostname that resolves to 127.0.0.1; the check is made on the address actually connected to (no DNS-rebinding gap).
- [ ] **M6-AC3**: A public URL that redirects to any blocked destination is refused (every redirect hop re-checked), and a non-http(s) scheme returns 400 bad_url.
- [ ] **M6-AC4**: Non-text content returns 415 unsupported_content, and a fetch exceeding its time limit returns 504 timeout instead of hanging.

### Baseline

662d1901ad22979562feda4dc08ac68a6fdda028 on m6-search-read-page

### Evidence

- M6-T1 — search/ scaffold + SSRF-guarded fetcher (search/src/fetch/): Top (SECURITY), attempt 4, PASS. Verifier re-ran `bun install && bun test && bun run typecheck` in search/: exit 0, 102 pass; files within allowlist; tests not weakened; no external network in tests; R6 proof re-checked by mutation (removing `lookup:` → 25 fail) — .harness/evidence/M6-T1-verifier.log. R6 resolved: Bun honours the custom lookup.

Remaining (packets on disk): M6-T2 extraction + HTTP service (Mid, .harness/tasks/M6-T2.md), then M6-T3 live proof script (Mid, .harness/tasks/M6-T3.md).

### Validation

Planned (confirmed during implementation): `cd /Users/ryankenny/Projects/CodingHarnessv2/search && bun test && bun run typecheck && bash scripts/read-proof.sh`

### Review

Pending.

### Review Cycles

0

### Follow-ups

- R6 resolved 2026-09-29 (M6-T1): Bun 1.4.0 node:http(s) honours a custom lookup (test 'R6: Bun honours the custom lookup' in search/src/fetch/fetchPage.test.ts; removing lookup fails 25 tests). IP literals bypass lookup, so they are checked separately. No deviation needed.
- M6-T1 added gzip/deflate/br decompression (byte cap applied after decompression) beyond the packet, so real sites ignoring Accept-Encoding: identity still work; reviewer to confirm in scope.
- Redirect to a non-http(s) scheme is refused as blocked_destination (not bad_url), documented in fetchPage.ts.
- R6: if Bun ignores the custom lookup, moving page fetching into C14 changes which component owns a responsibility - a Material deviation needing human agreement, not a silent workaround.

## M7 — The search service answers web searches with no account, falling back to a headless browser

Status: TODO

### Outcome

POST /v1/search on the search service returns UK/English results from ddgs run in a short-lived Python helper; when ddgs errors or returns nothing, a headless Chromium started on demand performs the search and is closed afterwards; when both fail the service says search is unavailable. The ops tooling installs the helper's Python venv, ddgs, Playwright and Chromium. Proves risk R7 (ddgs on Python 3.14, engine blocking). Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal; seam check: live engines are the criteria - not split).

Owns: FR20. Traces to: AC16 (browser fallback), FR24 (service time limit).

### Architecture

C9, C13, C14, C15

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M7-AC1**: POST /v1/search {query} returns 200 with results [{title,url,snippet}] and backend ddgs, requested for region UK/English, using a helper venv created by an ops installer (Python, ddgs, Playwright, Chromium); no account, API key or payment is involved.
- [ ] **M7-AC2**: With ddgs forced to fail or to return nothing, the same request returns results with backend browser, and no headless Chromium process remains afterwards.
- [ ] **M7-AC3**: With both backends forced to fail, the service returns 503 search_unavailable; a search exceeding its time limit returns 504 timeout and its helper process is killed.

### Baseline


### Evidence


### Validation

Planned (confirmed during implementation): `cd /Users/ryankenny/Projects/CodingHarnessv2 && bash ops/scripts/install-search-helper.sh && (cd search && bun test && bun run typecheck && bash scripts/search-proof.sh)`

### Review

Pending.

### Review Cycles

0

### Follow-ups

- R7: if ddgs does not install on Python 3.14, pin a compatible Homebrew Python for the venv (architecture R7); results are best-effort by requirement.

## M8 — The search service is always on, loopback only, with a documented API

Status: TODO

### Outcome

The search service runs under its own per-user LaunchAgent (com.harness.search) that restarts it after it is killed, answers only on loopback with no token and no Tailscale Serve mapping, and its HTTP API is documented so OpenCode can use it later. Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal; the LaunchAgent follows the existing C9 pattern and changes no existing lifecycle ownership - not split).

Owns: FR25. Traces to: AC19.

### Architecture

C9, C13

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M8-AC1**: The search service runs under the per-user LaunchAgent com.harness.search and answers GET /v1/health on 127.0.0.1:7790; killing its process makes launchd restart it and it answers again.
- [ ] **M8-AC2**: The service is not reachable on the Mac's tailnet address or LAN address, no Tailscale Serve mapping points at it, and it requires no token.
- [ ] **M8-AC3**: The HTTP API (search, read, health: requests, responses, errors) is documented in the repository, and each documented route answers as documented on loopback.

### Baseline


### Evidence


### Validation

Planned (confirmed during implementation): `cd /Users/ryankenny/Projects/CodingHarnessv2 && bash ops/scripts/verify-ops-install.sh && bash ops/scripts/search-service-proof.sh`

### Review

Pending.

### Review Cycles

0

### Follow-ups

None.

## M9 — The server answers a web-enabled chat by running the model's search tool loop

Status: TODO

### Outcome

POST /v1/chat with web:true makes the server offer web_search and read_page to the resident model through Ollama tool calling, with the current date, run each call against the search service, stream step and sources events, and cap a reply at 10 tool calls; GET /v1/state reports each model's tools capability. Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal; the tool loop runs inside the existing generation lifecycle, and Stop/resume interactions are M11 and M12 - not split).

Owns: FR19. Traces to: AC13 (switch off), AC14 (server half), AC17 (10-call cap), FR18 (capability gate).

### Architecture

C4, C5, C6, C7, C12

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M9-AC1**: GET /v1/state reports each model's tools capability from Ollama /api/show, and POST /v1/chat with web:true for a resident model without tools returns 409 tools_unsupported (proven with a stubbed capability check if every installed model has tools).
- [ ] **M9-AC2**: With web:true, a prompt asking for current information against the live resident model makes the server offer web_search and read_page with a note of the current date; the SSE stream carries at least one step event (started, then its final status), a sources event before done, and the final answer.
- [ ] **M9-AC3**: With web absent or false, the Ollama chat request carries no tools and the search service receives no request.
- [ ] **M9-AC4**: A reply is capped at 10 tool calls: after the 10th the tools are withdrawn and the model gives its answer.

### Baseline


### Evidence


### Validation

Planned (confirmed during implementation): `cd /Users/ryankenny/Projects/CodingHarnessv2/server && bun test && bun run typecheck && bash scripts/web-chat-proof.sh`

### Review

Pending.

### Review Cycles

0

### Follow-ups

- R8: tool-calling quality varies by model; acceptance is proven on at least one installed model, others observed.

## M10 — The phone has a per-chat web-search switch and shows steps and sources live

Status: TODO

### Outcome

Each conversation on the phone has a web-search switch, off by default and saved with it, disabled with an explanation for a model without tools; with it on, the chat shows each web step live, collapses the steps after the answer, and ends the answer with sources that open in Safari. Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal; seam check: the phone proof is the criteria - not split).

Owns: FR18, FR22. Traces to: AC13, AC14.

### Architecture

C1, C2, C3

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M10-AC1**: Each conversation has a web-search switch, off by default (including for conversations created before this change), and its state survives force-quitting and reopening Expo Go.
- [ ] **M10-AC2**: The switch is disabled with an explanation when the resident model lacks the tools capability (proven with a stubbed capability check if no installed model lacks it), and changing it while a reply is in progress takes effect from the next prompt.
- [ ] **M10-AC3**: With the switch on, a prompt asking for today's news shows each web step live on the phone (e.g. Searching: <query>, Reading: <domain>), then the final answer, and the steps collapse into an expandable section after completion.
- [ ] **M10-AC4**: An answer that used the web ends with a source list whose links open in Safari.

### Baseline


### Evidence


### Validation

Planned (confirmed during implementation): `cd /Users/ryankenny/Projects/CodingHarnessv2/mobile && bun run typecheck && bun test && bun run lint && bash scripts/web-switch-proof.sh` plus the owner's phone observation (screenshot) for the live steps, collapse and Safari links.

### Review

Pending.

### Review Cycles

0

### Follow-ups

None.

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
