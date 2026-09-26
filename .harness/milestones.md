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

### Architecture

C1, C3, C6, C7

### As-Built

.harness/as-built/M4a.md — RECORDED — 13/13 files attributed; components C1,C6,C7,NEW-chatItems; 6 edges; 2 claim mismatches (claimed C3 had no file changes; NEW-chatItems not claimed)

### Acceptance Criteria

- [x] **M4-AC1**: For a model that emits reasoning output, the app shows it in a collapsed, expandable section separate from the answer.
- [x] **M4-AC4**: After Send, the user's prompt appears in the conversation immediately, before any reply token arrives.
- [x] **M4-AC5**: A streaming reply renders incrementally in its final place in the conversation; on completion it stays where it is, with no separate streaming area whose text then moves into the conversation.

### Baseline

7dee5da32a1f96ff040fdc1df75e45b53360d268 on m4a-chat-display

### Evidence

Tasks (structured detail in state.json; packets under .harness/tasks/):
- M4a-T1 server thinking: think:true only when /api/show capabilities include "thinking" (cached per model); thinking SSE events before content, replayable — Mid (ORDINARY_IMPLEMENTATION), attempt 3 PASS; verifier PASS (server 109 tests, typecheck, entry-smoke; tests not weakened) — .harness/evidence/M4a-T1-verifier.log; commit f49c68f
- M4a-T2 pure chat-display logic: buildChatItems, caller-chosen message ids in sendInConversation, thinking toggle helpers — Mid (ORDINARY_IMPLEMENTATION), attempt 3 PASS; verifier PASS (typecheck, 123 tests, lint; tests not weakened) — .harness/evidence/M4a-T2-verifier.log; commit 0694ddf
- M4a-T3 chat.tsx: pending turn set before the first await, one list from buildChatItems, reply streams in its own bubble, thinking behind "Show thinking" — Mid (ORDINARY_IMPLEMENTATION), attempt 3 PASS; verifier PASS (typecheck, 123 tests, lint, smoke:runtime 3/3) — .harness/evidence/M4a-T3-verifier.log; commit 8ce0d66
- M4a-T5 live tailnet thinking proof mobile/scripts/thinking-proof.{sh,ts} — Cheap (BOUNDED_LOW_RISK), attempt 1 PASS; verifier PASS (typecheck, lint, live proof: T=qwen3.6:27b, N=devstral:24b, all checks PASS, Mac restored) — .harness/evidence/M4a-T5-verifier.log; commit 769618c
- M4a-T4 runtime smoke --token=stream drive — Mid (ORDINARY_IMPLEMENTATION), attempt 3 INTERRUPTED (turn limit) -> continuation 1 PASS; verifier PASS (typecheck, lint, smoke:runtime 4/4, stream steps 1-4; existing runs unchanged; fails at step 1 against pre-M4a chat.tsx) — .harness/evidence/M4a-T4-verifier.log; commit 1915881

Criteria evidence (full entries in state.json):
- M4-AC1: live proof — a thinking model's reasoning arrives as thinking events before content and is stored separately from the answer (M4a-T5-verifier.log); bundled app shows it behind "Show thinking", hidden until tapped, then as its own section (M4a-T4-verifier.log steps 2-3); server unit tests (M4a-T1-verifier.log).
- M4-AC4: bundled app — prompt in the tree after Send while the fake reply stream has sent no byte (M4a-T4-verifier.log step 1); pending turn set before the first await (M4a-T3-verifier.log).
- M4-AC5: bundled app — one node holds the reply while streaming and after completion, same list position, same enclosing Text node (tag 158) before and after done (M4a-T4-verifier.log step 4); key/index stability unit tests (M4a-T2-verifier.log).

### Validation

Reviewer runs once (about 15 minutes; live proofs restart com.harness.server and com.harness.bundle-host and swap/evict then restore the resident model; run nothing else against the Mac concurrently):

`cd /Users/ryankenny/Projects/CodingHarnessv2 && bash ops/scripts/e2e-tailnet-proof.sh && (cd server && bun test && bun run typecheck && bash scripts/entry-smoke.sh) && (cd ops && bun test src/token && bash scripts/verify-ops-install.sh) && (cd mobile && bun run typecheck && bun test src/store src/api src/ui src/chat src/app-routing && bun run lint && bun run smoke:runtime && bash scripts/model-list-proof.sh && bash scripts/model-swap-proof.sh && bash scripts/model-failed-load-proof.sh && bash scripts/conversation-proof.sh && bash scripts/thinking-proof.sh && npx expo export --platform ios && rm -rf dist)`

Status: PASS (reviewer re-ran the full chain; .harness/evidence/M4a-review.log). Task artifacts: .harness/evidence/M4a-T1..T5-verifier.log.

### Review

Cycle 1: PASS, tier Mid (sonnet, MID_TIER_DIFF), full-milestone scope 7dee5da32a1f96ff040fdc1df75e45b53360d268..17a7cf2; M4-AC1, M4-AC4, M4-AC5 PASS; 0 BLOCKER, 0 IMPORTANT, 0 OPTIONAL; no report file (PASS). Reviewer re-ran the full recorded validation chain in sequential segments against the real Mac: e2e-tailnet-proof, server 109 tests + typecheck + entry-smoke, ops token tests + verify-ops-install, mobile typecheck + 123 tests + lint + smoke:runtime 4/4 (all 4 stream steps), model-list/swap/failed-load/conversation/thinking live proofs, expo export; all passed and the resident model was restored. First attempt hit the reviewer 50-turn cap while model-swap-proof ran in the background, then delivered its terminal envelope on that work's completion; no retry was dispatched. Non-blocking note: the M4a-T4 discrimination drive stops at step 1 against pre-M4a chat.tsx, so AC5's step-4 check was not separately shown failing end-to-end; chatItems.test.ts key/index-stability test covers it at the pure-function level. — .harness/evidence/M4a-review.log

### Review Cycles

0

### Follow-ups

- Size/shape check at pickup: 3 criteria (run). Entry point: live POST /v1/chat over the tailnet showing thinking SSE events separate from content (M4-AC1), and the bundled app driven by runtime smoke (M4-AC4/AC5). Signal IMPLEMENTATION_PLUS_LIVE_PROOF present; CONCURRENCY_LIFECYCLE, SUBSYSTEMS_GT_3, PRODUCTION_FILES_GT_8 (~6), WORKER_TASKS_GT_6 (5), MULTIPLE_OUTCOMES judged absent. One signal -> seam check: the live proof is a thin script with no independently reviewable half; runs unsplit.
- Recon finding at pickup: the server never requested reasoning output (no think field in /api/chat; only content events emitted). Architecture I9/I10 already specifies think:true when supported, so this builds the agreed design (not a deviation); Architecture field widened from "C1, C3" to "C1, C3, C6, C7".
- Added 2026-09-26 by the human after M3 DONE (on-device observation): in M3's chat screen the user's prompt is not shown until the reply arrives, and a long reply streams in a separate area then jumps into the conversation on completion. Folded into M4 as M4-AC4/M4-AC5 (trace: FR7, FR9) because M4 reworks the same streaming display.
- M4a-T2 worker reported tests written alongside the implementation (red not observed first); accepted on the verifier mapping every packet rule to a test.
- M4a-T4 discrimination check reached only step 1 against the pre-M4a chat screen (the drive stops at the first failure), so the step-4 in-place assertion was not separately shown to fail against the old screen.
- On-device check (human, M2a convention): in Expo Go, send to a thinking model and confirm the prompt shows at once, the reply grows in place without jumping, and "Show thinking" expands the reasoning.

## M4b — Dropped-connection resume

Status: DONE

### Outcome

A transport drop mid-reply resumes the same reply once the phone reconnects (Last-Event-ID replay with backoff), with no gaps or duplicated text and its terminal state received. Second part of the M4 split (see M4a). Split from the original M4b (dropped-connection and backgrounding resume) at pickup (2 criteria, within size) because of operational-complexity signals CONCURRENCY_LIFECYCLE + IMPLEMENTATION_PLUS_LIVE_PROOF (a required split), plus MULTIPLE_OUTCOMES; parts: M4b dropped-connection resume (M4-AC2), M4c backgrounding resume with Stop-only cancel (M4-AC3).

### Architecture

C1, C2, C6

### As-Built

.harness/as-built/M4b.md — RECORDED — 6/6 files attributed; components C2,NEW-resume-proof; 4 edges; 3 claim mismatches (C1 and C6 claimed but not modified in diff; NEW-resume-proof observed but not claimed)

### Acceptance Criteria

- [x] **M4-AC2**: Killing the connection mid-reply and reconnecting yields the complete reply with no gaps and no duplicated text.

### Baseline

d46d8fd1757ca294fe9273c3aae11458c0198c07 on m4b-dropped-connection-resume

### Evidence

Tasks (structured detail in state.json; packets under .harness/tasks/):
- M4b-T1 client resume across drops (mobile/src/api/client.ts, resume.ts + tests) — Mid (ORDINARY_IMPLEMENTATION), attempt 3 INTERRUPTED (turn limit) -> continuation 1 PASS; verifier PASS (typecheck, 137 tests, lint, smoke:runtime 4/4; tests not weakened) — .harness/evidence/M4b-T1-verifier.log; commit d2f7077
- M4b-T2 live tailnet resume proof mobile/scripts/resume-proof.{sh,ts} — Cheap (BOUNDED_LOW_RISK), attempt 1 PASS; verifier PASS (typecheck, lint, live proof all checks PASS, Mac restored) — .harness/evidence/M4b-T2-verifier.log; commit a67cb44

Criteria evidence (full entries in state.json):
- M4-AC2: live proof — real /v1/chat connection aborted after 5 content events; the app's client resumed with Last-Event-ID; 309 content events equal an independent full server replay, one done complete, stored message complete (M4b-T2-verifier.log); client unit cases (a)-(k) for resume, dedupe, backoff, budget, Stop (M4b-T1-verifier.log).

### Validation

Reviewer runs once (about 16 minutes; live proofs restart com.harness.server and com.harness.bundle-host and swap/evict then restore the resident model; run nothing else against the Mac concurrently):

`cd /Users/ryankenny/Projects/CodingHarnessv2 && bash ops/scripts/e2e-tailnet-proof.sh && (cd server && bun test && bun run typecheck && bash scripts/entry-smoke.sh) && (cd ops && bun test src/token && bash scripts/verify-ops-install.sh) && (cd mobile && bun run typecheck && bun test src/store src/api src/ui src/chat src/app-routing && bun run lint && bun run smoke:runtime && bash scripts/model-list-proof.sh && bash scripts/model-swap-proof.sh && bash scripts/model-failed-load-proof.sh && bash scripts/conversation-proof.sh && bash scripts/thinking-proof.sh && bash scripts/resume-proof.sh && npx expo export --platform ios && rm -rf dist)`

Status: PASS (reviewer re-ran the full chain, exit 0 — .harness/evidence/M4b-review.log). Task artifacts: .harness/evidence/M4b-T1-verifier.log, .harness/evidence/M4b-T2-verifier.log.

### Review

Cycle 1: PASS, tier Mid (sonnet, MID_TIER_DIFF), full-milestone scope d46d8fd1757ca294fe9273c3aae11458c0198c07..9a0c70f; M4-AC2 PASS; 0 BLOCKER, 0 IMPORTANT, 0 OPTIONAL; no report file (PASS). Reviewer re-ran the full recorded validation chain against the real Mac (e2e-tailnet-proof; server tests + typecheck + entry-smoke; ops token tests + verify-ops-install; mobile typecheck, unit tests, lint, smoke:runtime, all live proofs incl. resume-proof, expo export); exit 0, resident model restored. First attempt hit the reviewer 50-turn cap while the validation chain ran in the background, then delivered its terminal envelope on that work's completion; no retry was dispatched. Discrimination: reviewer confirmed by reading client.ts at 309f9e7 that the pre-M4b client calls onError on a drop and never issues GET /v1/generations/{id}/events, so resume-proof cannot pass against it; the recorded worktree discrimination run remains invalid (follow-up stands). — .harness/evidence/M4b-review.log

### Review Cycles

0

### Follow-ups

- Recon at split (2026-09-26): server already supports resume -- GET /v1/generations/:id/events reads Last-Event-ID (server/src/http/server.ts parseResumeSeq lines 363-372, id format <gen>-<seq>, replays from seq+1), a client abort of /v1/chat does not cancel the generation (sseResponse cancel() lines 333-336; server.test.ts lines 649, 691), logs kept 10 min (manager.ts line 35). Phone has no resume: mobile/src/api/client.ts chat() ignores SSE id: lines and treats a body that ends without a terminal event as complete (onComplete); no Last-Event-ID, backoff or AppState code anywhere in mobile/src.
- Size/shape check at pickup: 1 criterion (run). Entry point: live tailnet proof driving the app's own send path through a killed /v1/chat connection (mobile/scripts/resume-proof.sh). Signal IMPLEMENTATION_PLUS_LIVE_PROOF present; CONCURRENCY_LIFECYCLE (no AppState/lifecycle ownership here; that is M4c), SUBSYSTEMS_GT_3, PRODUCTION_FILES_GT_8 (~2), WORKER_TASKS_GT_6 (2), MULTIPLE_OUTCOMES judged absent. One signal -> seam check: the live proof is a thin script with no independently reviewable half; runs unsplit. Server resume already exists (see recon), so C6 needs no change; C1 unchanged because resume is transparent inside C2.
- No discrimination run of the live proof against the pre-resume client: the verifier's worktree run at 309f9e7 was invalid because resume-proof.sh hard-codes cd into the main checkout (existing *-proof.sh convention). By construction check 4b (a GET /v1/generations/<id>/events request) cannot pass with the pre-M4b client, which never issues that request; the reviewer may re-run the .ts from a 309f9e7 worktree to show it.
- The *-proof.sh wrappers hard-code the checkout path (cd /Users/ryankenny/Projects/CodingHarnessv2/mobile); resolving it from the script's own directory would let them run from a worktree. Out of scope here.
- T1 worker hit its 40-turn limit; one continuation (no ladder rung spent) completed it with no further code changes.
- On-device check (human, M2a convention): in Expo Go, start a long reply, toggle Airplane Mode for a few seconds mid-reply and back off, and confirm the reply carries on to the end with no repeated or missing text.

## M4c — Backgrounding resume, only Stop cancels

Status: DONE

### Outcome

Backgrounding the app mid-reply and returning to the foreground resumes the same reply and receives its terminal state; only an explicit Stop cancels generation. Third part of the M4 split; split from M4b at pickup (see M4b).

### Architecture

C1, C2, C3, C6

### As-Built

.harness/as-built/M4c.md — RECORDED — 5/5 files attributed; components C2,NEW-background-proof; 4 edges; 3 claim mismatches (C1, C3 and C6 claimed but not modified in diff)

### Acceptance Criteria

- [x] **M4-AC3**: Backgrounding the app mid-reply and returning to foreground resumes the same reply and receives its terminal state, with only an explicit Stop cancelling generation.

### Baseline

1d74498fc5099d7fa3a049c39a1a036bb33d1137 on m4c-backgrounding-resume

### Evidence

Tasks (structured detail in state.json; packets under .harness/tasks/):
- M4c-T1 foreground resume in the app client + AppState wiring (mobile/src/api/client.ts, client.test.ts, expoFetchClient.ts) — Mid (ORDINARY_IMPLEMENTATION), attempt 3 INTERRUPTED (turn limit) -> continuation 1 PASS; verifier PASS (typecheck, 147 tests, lint, smoke:runtime 4/4; tests not weakened) — .harness/evidence/M4c-T1-verifier.log; commit cd3f36f
- M4c-T2 live tailnet background/foreground proof mobile/scripts/background-proof.{sh,ts} — Cheap (BOUNDED_LOW_RISK), attempt 1 INTERRUPTED -> continuation FAIL (scenario B done complete, not cancelled) -> Mid attempt 3 (escalated: unexplained failure) INTERRUPTED -> continuation INTERRUPTED (continuation cap reached) -> SPLIT. Navigator diagnosis run (.harness/evidence/M4c-T2-diag.log): "notifying 0 listener(s)" -- the script built clients with client.ts createAPIClient(baseUrl, fetchImpl), which drops the lifecycle argument. Script bug, not a product defect.
- M4c-T3 finish the live proof (new APIClient with the simulated lifecycle; Stop at the 5th post-foreground event) — Mid (ORDINARY_IMPLEMENTATION; split from T2), attempt 3 PASS; verifier PASS (typecheck, lint, live proof 16 PASS / 0 FAIL, Mac restored; tests not weakened) — .harness/evidence/M4c-T3-verifier.log; commit 2cd6cc1

Criteria evidence (full entries in state.json):
- M4-AC3: live proof — the app's sendInConversation over an APIClient with a simulated lifecycle; /v1/chat body stalled after 5 content events for 8 s; on foreground a resume GET with Last-Event-ID went out 2 ms later, no /cancel, one done complete, 309 content events equal an independent full replay, stored message complete; scenario B: foreground then the app's Stop -> exactly one cancel POST (200 cancelled), one done cancelled, stored stopped, replay done cancelled (M4c-T3-verifier.log); client unit cases (a)-(i) for foreground resume, backgrounding never cancels, Stop still aborts (M4c-T1-verifier.log).

### Validation

Reviewer runs once (about 17 minutes; live proofs restart com.harness.server and com.harness.bundle-host and swap/evict then restore the resident model; run nothing else against the Mac concurrently):

`cd /Users/ryankenny/Projects/CodingHarnessv2 && bash ops/scripts/e2e-tailnet-proof.sh && (cd server && bun test && bun run typecheck && bash scripts/entry-smoke.sh) && (cd ops && bun test src/token && bash scripts/verify-ops-install.sh) && (cd mobile && bun run typecheck && bun test src/store src/api src/ui src/chat src/app-routing && bun run lint && bun run smoke:runtime && bash scripts/model-list-proof.sh && bash scripts/model-swap-proof.sh && bash scripts/model-failed-load-proof.sh && bash scripts/conversation-proof.sh && bash scripts/thinking-proof.sh && bash scripts/resume-proof.sh && bash scripts/background-proof.sh && npx expo export --platform ios && rm -rf dist)`

Status: PENDING (reviewer runs it). Task artifacts: .harness/evidence/M4c-T1-verifier.log, .harness/evidence/M4c-T3-verifier.log.

### Review

Cycle 1: PASS, tier Mid (sonnet, MID_TIER_DIFF), full-milestone scope 1d74498fc5099d7fa3a049c39a1a036bb33d1137..43ec857; M4-AC3 PASS; 0 BLOCKER, 0 IMPORTANT, 0 OPTIONAL; no report file (PASS). Reviewer re-ran the full recorded validation chain against the real Mac (e2e-tailnet-proof; server tests + typecheck + entry-smoke; ops token tests + verify-ops-install; mobile typecheck, 147 unit tests, lint, smoke:runtime, all live proofs incl. resume-proof and background-proof, expo export); exit 0, resident model restored. Confirmed the three recorded follow-ups are non-blocking. — .harness/evidence/M4c-review.log

### Review Cycles

0

### Follow-ups

- Recon at split (2026-09-26): server already supports resume -- GET /v1/generations/:id/events reads Last-Event-ID (server/src/http/server.ts parseResumeSeq lines 363-372, id format <gen>-<seq>, replays from seq+1), a client abort of /v1/chat does not cancel the generation (sseResponse cancel() lines 333-336; server.test.ts lines 649, 691), logs kept 10 min (manager.ts line 35). Phone has no resume: mobile/src/api/client.ts chat() ignores SSE id: lines and treats a body that ends without a terminal event as complete (onComplete); no Last-Event-ID, backoff or AppState code anywhere in mobile/src.
- Pickup size/shape check (2026-09-26): 1 criterion; operational signal IMPLEMENTATION_PLUS_LIVE_PROOF only (CONCURRENCY_LIFECYCLE judged absent: a foreground listener is added, but ownership of generation lifecycle and cancellation does not change). Seam check: the only seam is implementation vs proof, not independently reviewable; run as one milestone. The live proof simulates AppState with an injected lifecycle; an on-device Expo Go background/foreground check is a human spot-check.
- background-proof.ts A-a asserts "at least K" content events before the stall (the wrapper forwards exactly K by construction; packet said "exactly K"); B-a asserts exactly one cancel POST, and Stop is the script's only cancel path, but it does not separately assert no cancel preceded Stop. Reviewer may judge.
- mobile/src/api/client.ts createAPIClient(baseUrl, fetchImpl) cannot take a lifecycle/clock, which silently cost M4c-T2 two attempts; production uses expoFetchClient.createAPIClient, which passes it. Consider removing or extending the client.ts factory (out of scope).
- M4c-T2 exceeded its two worker continuations (turn limits during a live-run diagnosis) and was split into M4c-T3 once diagnosed.

## M5b — Plain-language error messages

Status: IN_PROGRESS

### Outcome

The app shows a distinct plain-language message for each failure mode: Mac or server unreachable, Ollama down, wrong password, model failed to load, model no longer installed, and a reply already in progress. Second part of the M5 split (see M5a). Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal; seam check: the live proof is the criterion itself, so separating it would leave a component-only half — not split).

### Architecture

C1, C2, C4

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M5-AC3**: The app shows a distinct message for each of: Mac or server unreachable, Ollama down, wrong password, model failed to load, model no longer installed, and reply already in progress.

### Baseline

69aed5333cdee09d7d1c38aa73fcfa06f2ff3c16 on m5b-plain-errors

### Evidence

Tasks (packets under .harness/tasks/):
- M5b-T1 — error mapping + client/server/screens + unit tests: Mid (ORDINARY_IMPLEMENTATION). Attempt 3 CONTINUE (turn limit, handoff-1) → continuation 1 PASS; verifier PASS exit 0 (server 109, mobile 167 tests; typecheck, lint clean), tests weakened NO — .harness/evidence/M5b-T1-verifier.log. Accepted. Architecture deviation D-M5b-1 (operation.error_code, Material: no) recorded.
- M5b-T2 — live six-failure proof script: Mid (ORDINARY_IMPLEMENTATION), not started (next phase dispatches it with .harness/tasks/M5b-T2.md)

### Validation

Pending.

### Review

Pending.

### Review Cycles

0

### Follow-ups

- New feature requested by the human 2026-09-26, out of scope for current requirements: internet (web) search for the models, e.g. via Ollama's web search / tool calling. Needs roast-requirements (search provider and privacy, which models, how the app shows searching and sources) before any implementation.

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

## M5c — PWA retirement

Status: TODO

### Outcome

The old PWA's LaunchAgent and its Tailscale Serve /app handler are removed, leaving the harness's own / handler intact and the phoneToLocalModel repository untouched on disk. Third part of the M5 split (see M5a); runs last because FR17 requires this app's acceptance criteria to pass first.

### Architecture

C9

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M5-AC4**: After retirement, /app no longer resolves, the PWA's LaunchAgent is gone, and the harness's / handler still works.

### Baseline

Pending.

### Evidence

Pending.

### Validation

Pending.

### Review

Pending.

### Review Cycles

0

### Follow-ups

None.
