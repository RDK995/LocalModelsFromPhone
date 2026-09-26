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

### Architecture

C1, C2, C4, C5, C6

### As-Built

.harness/as-built/M2c.md — RECORDED — 15/15 files attributed; components C1,C2,C4,C5,C6; 4 edges; no claim mismatches

### Acceptance Criteria

- [x] **M2-AC4**: Swapping or unloading while a reply is in flight, or while the resident model was not loaded by this server, requires explicit confirmation, and cancelling the confirmation leaves state unchanged.

### Baseline

ef16c787b68ef54254df5557f114a6ad9abb0227 on m2c-busy-confirmation

### Evidence

Tasks (structured detail in state.json):
- M2c-T1 server confirmation rule: 409 confirmation_required {reasons}, confirmed request cancels the in-flight reply and waits for release, claim before the /api/ps await, chat re-check — Top (opus, DIFFICULT_CONCURRENCY), attempt 4 PASS; verifier PASS (server 103 tests, typecheck, entry-smoke; tests not weakened — pre-existing swap/unload calls on a model this server did not load now pass confirm: true, assertions unchanged); commit 9af9213
- M2c-T2 phone busy warning: ConfirmationRequiredError, confirm gate in runModelAction, warning text with best-guess label, Alert with Cancel / "Load anyway" / "Unload anyway", proof scripts pass confirm — Mid (ORDINARY_IMPLEMENTATION), attempt 3 INTERRUPTED (turn limit) → continuation 1 PASS; verifier PASS (typecheck, 72 tests, lint, smoke:runtime 3/3; tests not weakened); commit 32a1204

Criteria evidence:
- M2-AC4: HTTP through the real routes — load/unload answer 409 confirmation_required with reasons for a reply in flight and for a resident model not loaded by this server; GET /v1/state afterwards shows operation idle and the same resident; confirm:true → 202 and the in-flight reply ends done {status:"cancelled"} — .harness/evidence/M2c-T1-verifier.log. Phone: declining makes no further request and no poll; confirming retries with confirm: true; warning text labels the other-program case a best guess — .harness/evidence/M2c-T2-verifier.log.

### Validation

cd /Users/ryankenny/Projects/CodingHarnessv2 && bash ops/scripts/e2e-tailnet-proof.sh && (cd server && bun test && bun run typecheck && bash scripts/entry-smoke.sh) && (cd ops && bun test src/token && bash scripts/verify-ops-install.sh) && (cd mobile && bun run typecheck && bun test src/api src/ui src/chat src/app-routing && bun run lint && bun run smoke:runtime && bash scripts/model-list-proof.sh && bash scripts/model-swap-proof.sh && bash scripts/model-failed-load-proof.sh && npx expo export --platform ios && rm -rf dist)

Same chain as M2b, about 12 minutes (model-swap-proof idles 600 s). The live proofs now pass confirm: true and must still pass against the redeployed server; they restart com.harness.server and com.harness.bundle-host and evict then restore the resident model — run nothing else against the Mac at the same time. Artifacts: .harness/evidence/M2c-T1-verifier.log, .harness/evidence/M2c-T2-verifier.log, .harness/evidence/M2c-review.log (reviewer run, exit 0).

### Review

Cycle 1: PASS, tier Top (opus, DIFFICULT_CONCURRENCY), full-milestone scope ef16c787b68ef54254df5557f114a6ad9abb0227..6a747e2; M2-AC4 PASS; 0 BLOCKER, 0 IMPORTANT, 1 OPTIONAL; no report file (PASS). Reviewer re-ran the full validation chain including live proofs (model-list, model-swap incl. 600 s idle, model-failed-load): EXIT=0 — .harness/evidence/M2c-review.log

### Review Cycles

0

### Follow-ups

- Size/shape check at pickup: 1 criterion; entry point is HTTP (`POST /v1/models/load|unload` -> `409 confirmation_required`). Operational-complexity signal `CONCURRENCY_LIFECYCLE` present (a confirmed load/unload cancels C6's in-flight reply via I8 before C5 proceeds); `SUBSYSTEMS_GT_3` judged absent (two subsystems: server, mobile app); no live-environment proof planned; ~5 production files; 2 worker tasks. One signal -> seam check: the only seam (server rule vs app dialog) cannot conserve the single criterion M2-AC4 in both parts, so M2c runs unsplit.
- Carried from M2b (reviewer OPTIONAL F2, .harness/reviews/M2b-cycle1.md): a failed load's reason stays in `operation.error` until the next operation, so the Models screen can show "Loaded: X" beside an old "Load failed: ...". Outside M2-AC4; not implemented in M2c.
- Behaviour change outside M2-AC4 (M2c-T1): `POST /v1/models/unload` now answers 503 ollama_down when /api/ps fails (was 202 then a background "Ollama unreachable"); swap-load likewise reads /api/ps before accepting.
- Side effect (M2c-T1): a chat arriving during the few ms an unconfirmed load/unload is being checked gets 409 operation_in_progress even if that request is then refused.
- Reviewer OPTIONAL (M2c cycle 1): `.harness/architecture.md:160` failure list for `POST /v1/models/unload` omits 503 ollama_down, and the load/unload rows omit 400 bad_request; add them next time architecture.md is edited.

## M3 — Persisted multi-turn conversations with model attribution

Status: DONE

### Outcome

The phone keeps a list of conversations, each with full multi-turn history sent on every prompt, each reply labeled with the model that produced it, and conversations survive an app restart.

### Architecture

C1, C3

### As-Built

.harness/as-built/M3.md — RECORDED — 17/23 files attributed; components C1,C3; 13 edges; no claim mismatches

### Acceptance Criteria

- [x] **M3-AC1**: Conversations can be created, opened and deleted, and are listed newest first.
- [x] **M3-AC2**: A follow-up prompt in the same conversation demonstrably uses context from an earlier turn.
- [x] **M3-AC3**: Each assistant reply displays the model name that produced it, including after a mid-conversation model switch.
- [x] **M3-AC4**: Sending with no model resident is blocked with a prompt to load one.
- [x] **M3-AC5**: Force-quitting and reopening Expo Go shows the same conversations and messages as before.

### Baseline

abce8c05ff1f889081a0252f3835074fc924df1b on m3-persisted-conversations

### Evidence

Tasks (structured detail in state.json; packets under .harness/tasks/):
- M3-T1 conversation store (C3) over AsyncStorage, one key per conversation plus an index — Mid (ORDINARY_IMPLEMENTATION), attempt 3 PASS; verifier PASS (typecheck, 86 tests, lint, smoke:runtime 3/3; tests not weakened) — .harness/evidence/M3-T1-verifier.log; commit fe8b088
- M3-T2 conversation session, Conversations screen, conversation-bound chat with model label and load-a-model prompt — Mid (ORDINARY_IMPLEMENTATION), attempt 3 CONTINUE (turn limit) -> continuation 1 CONTINUE (turn limit) -> continuation cap reached; remainder split to M3-T2b; accepted scope verifier PASS (typecheck, 102 tests; tests not weakened) — .harness/evidence/M3-T2-verifier.log; commit cfc1a08

- M3-T2b runtime smoke AsyncStorage fake + Conversations-first drive path, lint quote fixes — Mid (ORDINARY_IMPLEMENTATION), attempt 3 PASS; verifier PASS (typecheck, 102 tests, lint, smoke:runtime 3/3; tests not weakened) — .harness/evidence/M3-T2b-verifier.log

- M3-T3 live tailnet proof mobile/scripts/conversation-proof.{sh,ts} (app's sendInConversation, store over file-backed StoragePort, API client) — Cheap (BOUNDED_LOW_RISK), attempt 1 FAIL (exit 0 but two packet assertions missing: turn-2 sent messages not recorded; blocked-send chat calls not counted) -> Cheap attempt 2 PASS; verifier PASS (typecheck, lint, proof all checks PASS; tests not weakened) — .harness/evidence/M3-T3-verifier.log

Criteria evidence (full entries in state.json):
- M3-AC1: store unit tests (M3-T1-verifier.log); conversationList unit tests + Conversations screen (M3-T2-verifier.log); runtime smoke lands on Conversations and drives New chat -> Chat (M3-T2b-verifier.log).
- M3-AC2: live proof Step 3 — turn-2 request at client.chat carries turn-1 user and assistant messages, reply contains the run-time random code word (M3-T3-verifier.log).
- M3-AC3: live proof Step 5 — same conversation, replies stored devstral:24b then qwen3.6:27b across a swap-load (M3-T3-verifier.log); chat.tsx per-reply label (M3-T2-verifier.log).
- M3-AC4: live proof Step 6 — /api/ps empty, send blocked with "No model loaded — load one on the Models screen to send.", zero chat calls, no assistant message (M3-T3-verifier.log).
- M3-AC5: storage-layer proxy only — live proof Step 7 fresh store over the same file-backed storage sees identical conversation (M3-T3-verifier.log). On-device Expo Go force-quit check is a pending human step (Follow-ups).

### Validation

Reviewer runs once (about 12+ minutes; live proofs restart com.harness.server and com.harness.bundle-host and evict then restore the resident model; run nothing else against the Mac concurrently):

`cd /Users/ryankenny/Projects/CodingHarnessv2 && bash ops/scripts/e2e-tailnet-proof.sh && (cd server && bun test && bun run typecheck && bash scripts/entry-smoke.sh) && (cd ops && bun test src/token && bash scripts/verify-ops-install.sh) && (cd mobile && bun run typecheck && bun test src/store src/api src/ui src/chat src/app-routing && bun run lint && bun run smoke:runtime && bash scripts/model-list-proof.sh && bash scripts/model-swap-proof.sh && bash scripts/model-failed-load-proof.sh && bash scripts/conversation-proof.sh && npx expo export --platform ios && rm -rf dist)`

Status: PENDING (reviewer). Task artifacts: .harness/evidence/M3-T1-verifier.log, M3-T2-verifier.log, M3-T2b-verifier.log, M3-T3-verifier.log.

### Review

Cycle 1: PASS, tier Mid (sonnet, MID_TIER_DIFF), full-milestone scope abce8c05ff1f889081a0252f3835074fc924df1b..f2042eb; M3-AC1..M3-AC5 PASS; 0 BLOCKER, 0 IMPORTANT, 1 OPTIONAL; no report file (PASS). Reviewer re-ran typecheck + 102 tests + lint, smoke:runtime 3/3, and the live conversation-proof.sh (7/7 steps) against the real Mac: EXIT=0. M3-AC5 graded on the storage-layer proxy per the M1 convention; on-device Expo Go force-quit check remains a recorded human follow-up. OPTIONAL: conversation delete is long-press only with no visible affordance (mobile/src/app/conversations.tsx); recorded under Follow-ups. — .harness/evidence/M3-review.log

### Review Cycles

0

### Follow-ups

- Size/shape check at pickup: 5 criteria (run). Entry point: live `POST /v1/chat` over the tailnet through the app's own client and conversation logic (M3-AC2). Operational-complexity signal `IMPLEMENTATION_PLUS_LIVE_PROOF` present (live context proof; on-device force-quit check); `SUBSYSTEMS_GT_3`, `CONCURRENCY_LIFECYCLE`, `PRODUCTION_FILES_GT_8` (~7), `WORKER_TASKS_GT_6` (4 tasks) and `MULTIPLE_OUTCOMES` judged absent (mobile only; server unchanged). One signal -> seam check: the live proof is a thin script over the same store and client, with no independently reviewable half, so M3 runs unsplit.
- M3-T2: chat.tsx header also links back to /conversations (chat hides the Stack header); small addition beyond the packet's literal wording, left for review.
- M3-AC5 on-device check (human, M2a convention): on the phone in Expo Go, create a conversation with two turns, force-quit Expo Go, reopen the project, and confirm the same conversations and messages (with model labels) are shown. Automated evidence is the storage-layer proxy only.
- M3-T3 proof counts zero client.chat calls on the blocked send but does not separately assert the counter is >0 on successful sends; wiring is shown by the recorded turn-2 messages.
- Reviewer OPTIONAL (M3 cycle 1): deleting a conversation is reachable only by long-press with no visible affordance (mobile/src/app/conversations.tsx); discoverability polish, not implemented.

## M4a — Thinking shown collapsed, prompt shown on Send, reply streams in place

Status: IN_PROGRESS

### Outcome

In the chat screen the user's prompt appears as soon as Send is pressed, the reply streams into its own final place in the conversation (no separate streaming area), and a model's reasoning output is shown in a collapsed, expandable section separate from the answer. Split from M4 at pickup (5 criteria, within size) because of operational-complexity signals CONCURRENCY_LIFECYCLE + IMPLEMENTATION_PLUS_LIVE_PROOF (a required split), plus SUBSYSTEMS_GT_3 and MULTIPLE_OUTCOMES; parts: M4a chat display (thinking, prompt on Send, reply streams in place), M4b dropped-connection and backgrounding resume.

### Architecture

C1, C3, C6, C7

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M4-AC1**: For a model that emits reasoning output, the app shows it in a collapsed, expandable section separate from the answer.
- [ ] **M4-AC4**: After Send, the user's prompt appears in the conversation immediately, before any reply token arrives.
- [ ] **M4-AC5**: A streaming reply renders incrementally in its final place in the conversation; on completion it stays where it is, with no separate streaming area whose text then moves into the conversation.

### Baseline

7dee5da32a1f96ff040fdc1df75e45b53360d268 on m4a-chat-display

### Evidence

Tasks (structured detail in state.json; packets under .harness/tasks/):
- M4a-T1 server thinking: think:true when /api/show says the model supports it; thinking SSE events — Mid (ORDINARY_IMPLEMENTATION), in progress
- M4a-T2 pure chat-display logic (chatItems, caller-chosen ids) — Mid (ORDINARY_IMPLEMENTATION), in progress
- Planned: M4a-T3 chat.tsx wiring + collapsed thinking section (Mid); M4a-T4 runtime-smoke drive proving prompt-on-Send and reply-in-place in the bundled app (Mid); M4a-T5 live thinking proof over the tailnet (Cheap)

### Validation

Pending.

### Review

Pending.

### Review Cycles

0

### Follow-ups

- Size/shape check at pickup: 3 criteria (run). Entry point: live POST /v1/chat over the tailnet showing thinking SSE events separate from content (M4-AC1), and the bundled app driven by runtime smoke (M4-AC4/AC5). Signal IMPLEMENTATION_PLUS_LIVE_PROOF present; CONCURRENCY_LIFECYCLE, SUBSYSTEMS_GT_3, PRODUCTION_FILES_GT_8 (~6), WORKER_TASKS_GT_6 (5), MULTIPLE_OUTCOMES judged absent. One signal -> seam check: the live proof is a thin script with no independently reviewable half; runs unsplit.
- Recon finding at pickup: the server never requested reasoning output (no think field in /api/chat; only content events emitted). Architecture I9/I10 already specifies think:true when supported, so this builds the agreed design (not a deviation); Architecture field widened from "C1, C3" to "C1, C3, C6, C7".
- Added 2026-09-26 by the human after M3 DONE (on-device observation): in M3's chat screen the user's prompt is not shown until the reply arrives, and a long reply streams in a separate area then jumps into the conversation on completion. Folded into M4 as M4-AC4/M4-AC5 (trace: FR7, FR9) because M4 reworks the same streaming display.

## M4b — Dropped-connection and backgrounding resume

Status: TODO

### Outcome

A transport drop or app backgrounding mid-reply resumes the same reply once the phone reconnects, with no gaps or duplicated text and its terminal state received, and only an explicit Stop cancels generation. Second part of the M4 split (see M4a).

### Architecture

C1, C2, C3, C6

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M4-AC2**: Killing the connection mid-reply and reconnecting yields the complete reply with no gaps and no duplicated text.
- [ ] **M4-AC3**: Backgrounding the app mid-reply and returning to foreground resumes the same reply and receives its terminal state, with only an explicit Stop cancelling generation.

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

## M5 — Always-on Mac tooling, plain-language errors, and PWA retirement

Status: TODO

### Outcome

The server and app bundle host survive a Mac reboot with no manual step, every failure mode shows a distinct plain-language message, and the old PWA is retired without disturbing the harness's own endpoint.

### Architecture

C4, C8, C9

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M5-AC1**: After a Mac reboot, opening the project in Expo Go on the phone works with no manual step on the Mac.
- [ ] **M5-AC2**: Killing either the server process or the bundle host process causes it to restart automatically.
- [ ] **M5-AC3**: The app shows a distinct message for each of: Mac or server unreachable, Ollama down, wrong password, model failed to load, model no longer installed, and reply already in progress.
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
