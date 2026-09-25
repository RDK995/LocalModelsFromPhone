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

### Architecture

C1, C2, C4, C5, C7

### As-Built

.harness/as-built/M2a.md — RECORDED — 10/12 files attributed; components C1,C4,C5 (C2,C3,C6,C7 as context); 6 edges; 2 claim mismatches (C2 claimed but no code changes, imported by C1; C7 claimed but no code changes, imported by C5).

### Acceptance Criteria

- [x] **M2-AC1**: The app's model list matches Ollama GET /api/tags by real name and size, with no hardcoded model names.

### Baseline

2632a61df5ba160dd6850f0c31d37e412d23f504 on m2-model-list-swap-unload

Baseline broad validation GREEN: server 0, ops 0, mobile 0, e2e-tailnet-proof 0 — .harness/evidence/M2a-baseline-validation-{A,B,C,D}.log

### Evidence

Tasks (structured detail in state.json):
- M2a-T1 model manager (C5) behind GET /v1/state — Mid (ORDINARY_IMPLEMENTATION), attempt 3, PASS; verifier PASS (server 48 tests, typecheck, entry-smoke; tests not weakened); commit 431723e
- M2a-T2 phone Models screen + view-model + Chat link — Mid (ORDINARY_IMPLEMENTATION), attempt 3, PASS; verifier PASS (typecheck, 46 tests, lint, smoke:runtime 3/3); commit 70dc67b
- M2a-T3 live proof over tailnet — Cheap (BOUNDED_LOW_RISK), attempt 1, PASS; verifier PASS (model-list-proof exit 0, typecheck, lint); commit 4cf3342

M2-AC1: live via the app's own client + view-model at https://ryans-mac-studio.tailc3648a.ts.net:8443 — row names equal Ollama /api/tags in order (5 models), size_bytes exact and size labels match, resident "Loaded: devstral:24b" equals /api/ps (a model this server did not load), hardcoded-name grep clean — .harness/evidence/M2a-T3-verifier.log. Unit: .harness/evidence/M2a-T1-verifier.log, .harness/evidence/M2a-T2-verifier.log.

### Validation

cd /Users/ryankenny/Projects/CodingHarnessv2 && bash ops/scripts/e2e-tailnet-proof.sh && (cd server && bun test && bun run typecheck && bash scripts/entry-smoke.sh) && (cd ops && bun test src/token && bash scripts/verify-ops-install.sh) && (cd mobile && bun run typecheck && bun test src/api src/ui src/chat src/app-routing && bun run lint && bun run smoke:runtime && bash scripts/model-list-proof.sh && npx expo export --platform ios && rm -rf dist)

Needs the live LaunchAgents, Tailscale and Ollama; model-list-proof restarts com.harness.server and com.harness.bundle-host. Artifacts: .harness/evidence/M2a-T1-verifier.log, M2a-T2-verifier.log, M2a-T3-verifier.log.

### Review

Cycle 1: PASS — tier Mid (sonnet), reason IMPLEMENTATION_MID_CHEAP_ONLY (tasks Mid/Mid/Cheap); diff 2632a61..e826a62; M2-AC1=PASS; findings 0 BLOCKER, 0 IMPORTANT, 1 OPTIONAL (recorded under Follow-ups). Reviewer re-ran the full validation live, all green — .harness/evidence/M2a-review.log

### Review Cycles

0

### Follow-ups

- Live 'Nothing loaded' path not exercised on the Mac: devstral:24b was resident with keep_alive -1 (not loaded by this run) so model-list-proof skipped its load/unload branch rather than evict it; covered by unit tests (manager.test.ts, modelList.test.ts). Re-run scripts/model-list-proof.sh with nothing resident, or check on the phone after M2b's unload lands.
- On-phone visual check of the Models screen in Expo Go (human): Chat > Models shows the five installed models with sizes and the resident marker.
- If /api/ps lists more than one model (another tool), /v1/state reports only the first; FR3 caps phone actions at one resident, but a truthful multi-resident display may be wanted.
- .harness/milestones.md is ~510 lines (> 400) but M1 is the only settled milestone and the most recently settled, so it cannot be archived yet; archive M1 once M2a settles.
- Reviewer OPTIONAL (cycle 1): mobile/scripts/model-list-proof.ts:142 types a callback as (m: any) instead of the typed StateResponse model shape; the script is outside the lint target so it is not caught.

## M2b — Swap-load and unload from the phone, staying resident

Status: REVIEW

### Outcome

From the phone a user can load a model (a swap: every other resident model is unloaded first) or unload the resident one; the operation runs asynchronously while the app polls GET /v1/state through loading to ready or a specific failure reason, and a model loaded from the phone stays resident indefinitely (keep_alive -1), including across chat replies. The confirmation rule for a reply in flight or a resident model not loaded by this server belongs to M2c.

### Architecture

C1, C2, C4, C5, C7

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M2-AC2**: Loading model A then model B leaves only B resident in GET /api/ps; unloading leaves nothing resident.
- [ ] **M2-AC3**: A model loaded from the phone remains resident in GET /api/ps after 10 minutes idle and after a chat reply completes.
- [ ] **M2-AC5**: A failed load, such as out of memory, leaves nothing resident and the app shows the failure reason.

### Baseline

c9fdd5e42c23ebadf125b6d0cde83ae7d659f647 on m2b-swap-load-unload

Baseline broad validation GREEN: inherited from the M2a cycle-1 review run at e826a62 (.harness/evidence/M2a-review.log); c9fdd5e differs from it only under .harness/.

### Evidence

Tasks (structured detail in state.json):
- M2b-T1 server swap-load/unload in C5 behind /v1/models/load and /unload, OllamaError reasons, chat 409 operation_in_progress — Mid (ORDINARY_IMPLEMENTATION), attempt 3 INTERRUPTED (turn limit) → continuation 1 PASS; verifier PASS (server 73 tests, typecheck, entry-smoke 7/7; tests not weakened); commit 1eb08ed
- M2b-T2 phone Load/Unload, ServerError, poll-until-idle helper, busy label and failure message — Mid (ORDINARY_IMPLEMENTATION), attempt 3 INTERRUPTED (turn limit) → continuation 1 PASS; verifier PASS (typecheck, 60 tests, lint, smoke:runtime 3/3); commit a3576a7
- M2b-T3 live proof — Mid (NOT_BOUNDED), attempt 3 INTERRUPTED and continuation 1 INTERRUPTED, nothing persisted either time; split into M2b-T3a and M2b-T3b.
- M2b-T3a live proof of swap, unload, stays resident after a chat reply and 600 s idle (M2-AC2, M2-AC3) — Mid (ORDINARY_IMPLEMENTATION), attempt 3 PASS; verifier PASS (default IDLE_SECONDS=600; A=devstral:24b, B=qwen3.6:27b; tests not weakened) .harness/evidence/M2b-T3a-verifier.log; commit 75d0dc0
- M2b-T3b live proof of a genuinely failed load (M2-AC5) — Mid (NOT_BOUNDED) attempt 3 FAIL (packet's probe used an empty-prompt keep_alive 0 generate, which is Ollama's unload request, so nothing was loaded) → Top (opus, Escalated: tier, NO_TEST_ORACLE) attempt 4 PASS; verifier PASS (tests not weakened) .harness/evidence/M2b-T3b-verifier.log; commit a8daebb. Failure method: smallest installed model + a mismatched-shape LoRA adapter → Ollama 500 "llama-server process has terminated: exit status 1"; app shows "Load failed: llama-server process has terminated: exit status 1", "Nothing loaded", /api/ps empty.

Criteria evidence:
- M2-AC2: live swap A→B leaves /api/ps exactly [B]; unload leaves [] and "Nothing loaded" — .harness/evidence/M2b-T3a-verifier.log; unit: M2b-T1/T2 verifier logs.
- M2-AC3: /api/ps exactly [B] with expires_at 2319 after a completed chat reply, and exactly [B] after 600 s idle — .harness/evidence/M2b-T3a-verifier.log.
- M2-AC5: genuine runner load failure leaves resident null, /api/ps empty, view shows Ollama's reason — .harness/evidence/M2b-T3b-verifier.log (not out-of-memory; see Follow-ups).

Live-Mac note: the first T3 attempt left a probe model and evicted devstral:24b; the orchestrator ran `ollama rm m2b-failed-load-probe` and reloaded devstral:24b with keep_alive -1 (state at start restored). This phase: both proofs restore the Mac in an EXIT trap; confirmed after T3b: only devstral:24b resident (expires 2319), the original five models in /api/tags, no probe.

### Validation

cd /Users/ryankenny/Projects/CodingHarnessv2 && bash ops/scripts/e2e-tailnet-proof.sh && (cd server && bun test && bun run typecheck && bash scripts/entry-smoke.sh) && (cd ops && bun test src/token && bash scripts/verify-ops-install.sh) && (cd mobile && bun run typecheck && bun test src/api src/ui src/chat src/app-routing && bun run lint && bun run smoke:runtime && bash scripts/model-list-proof.sh && bash scripts/model-swap-proof.sh && bash scripts/model-failed-load-proof.sh && npx expo export --platform ios && rm -rf dist)

About 12 minutes (model-swap-proof idles 600 s). Needs the live LaunchAgents, Tailscale and Ollama; the proofs restart com.harness.server and com.harness.bundle-host and evict then restore the resident model — run nothing else against the Mac at the same time. Artifacts: .harness/evidence/M2b-T1-verifier.log, M2b-T2-verifier.log, M2b-T3a-verifier.log, M2b-T3b-verifier.log.

### Review

Pending.

### Review Cycles

0

### Follow-ups

- Pickup size/shape check: 3 criteria, shape PASS; signals CONCURRENCY_LIFECYCLE + IMPLEMENTATION_PLUS_LIVE_PROOF present (nominally a required split). Not split further: M2b is already the child of the M2 split made for this exact pair, and all three criteria are live observations of the same load/unload lifecycle, so no criterion-conserving seam separates them. A human may prefer a different call.
- M2-AC5 was proven live with a runner load failure (bad LoRA adapter), not out-of-memory: on this Mac with Ollama 0.32.14 out-of-memory could not be induced (num_ctx is clamped; oversized num_batch/num_gpu oversubscribe without error). The criterion says "such as out of memory"; the reviewer or human should confirm this reading. The server's "Not enough memory" reason is covered by unit tests only.

## M2c — Busy confirmation before a swap or unload

Status: TODO

### Outcome

Before a swap or unload, the server answers 409 confirmation_required with its reasons when a reply is in flight or the resident model was not loaded by this server; the app shows that warning (the other-tool case labelled as a best approximation), confirming cancels any in-flight reply and proceeds, and cancelling the confirmation leaves state unchanged.

### Architecture

C1, C2, C4, C5, C6

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M2-AC4**: Swapping or unloading while a reply is in flight, or while the resident model was not loaded by this server, requires explicit confirmation, and cancelling the confirmation leaves state unchanged.

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

## M3 — Persisted multi-turn conversations with model attribution

Status: TODO

### Outcome

The phone keeps a list of conversations, each with full multi-turn history sent on every prompt, each reply labeled with the model that produced it, and conversations survive an app restart.

### Architecture

C1, C3

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M3-AC1**: Conversations can be created, opened and deleted, and are listed newest first.
- [ ] **M3-AC2**: A follow-up prompt in the same conversation demonstrably uses context from an earlier turn.
- [ ] **M3-AC3**: Each assistant reply displays the model name that produced it, including after a mid-conversation model switch.
- [ ] **M3-AC4**: Sending with no model resident is blocked with a prompt to load one.
- [ ] **M3-AC5**: Force-quitting and reopening Expo Go shows the same conversations and messages as before.

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

## M4 — Thinking display and dropped-connection resume

Status: TODO

### Outcome

Reasoning output appears collapsed and expandable, separate from the answer, and a transport drop or app backgrounding mid-reply resumes cleanly with no gaps or duplication once the phone reconnects.

### Architecture

C1, C2, C3, C6

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M4-AC1**: For a model that emits reasoning output, the app shows it in a collapsed, expandable section separate from the answer.
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
