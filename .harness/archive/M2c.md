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
