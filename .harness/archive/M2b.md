## M2b — Swap-load and unload from the phone, staying resident

Status: DONE

### Outcome

From the phone a user can load a model (a swap: every other resident model is unloaded first) or unload the resident one; the operation runs asynchronously while the app polls GET /v1/state through loading to ready or a specific failure reason, and a model loaded from the phone stays resident indefinitely (keep_alive -1), including across chat replies. The confirmation rule for a reply in flight or a resident model not loaded by this server belongs to M2c.

### Architecture

C1, C2, C4, C5, C7

### As-Built

.harness/as-built/M2b.md — RECORDED — 13/17 files attributed; components C1,C2,C4,C5,C7; 4 edges; no claim mismatches

### Acceptance Criteria

- [x] **M2-AC2**: Loading model A then model B leaves only B resident in GET /api/ps; unloading leaves nothing resident.
- [x] **M2-AC3**: A model loaded from the phone remains resident in GET /api/ps after 10 minutes idle and after a chat reply completes.
- [x] **M2-AC5**: A failed load, such as out of memory, leaves nothing resident and the app shows the failure reason.

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

Cycle 1: CHANGES REQUIRED (SUBSTANTIVE), tier Top (opus) — .harness/reviews/M2b-cycle1.md (F1 IMPORTANT, F2 OPTIONAL); M2-AC2/AC3/AC5 PASS; reviewer validation exit 0 — .harness/evidence/M2b-review.log
Pre-correction: b8bcae32221cc3941ccef8702cfd6b066de6db93 (72e781c plus the committed review report and log; no code change)
Corrections (each verifier-confirmed, committed):
- M2b-C1 F1 unload() claims the operation synchronously before its ps() await — Mid (NOT_LOW_RISK), attempt 3 PASS; two Promise.allSettled race tests Red on the unfixed code then Green, plus a concurrent HTTP unload 202/409 test; server 76 pass, typecheck 0, entry-smoke 0 — .harness/evidence/M2b-C1-verifier.log; 24f981c
- F2 (OPTIONAL) not corrected; recorded under Follow-ups.
Cycle-1 validation: server `bun test && bun run typecheck && bash scripts/entry-smoke.sh` exit 0 (verifier). Live proofs not re-run: no live-proof, mobile or ops file changed; the live Mac was not touched this cycle.
Correction diff: git diff b8bcae32221cc3941ccef8702cfd6b066de6db93 HEAD
Files changed by corrections: server/src/models/manager.ts; server/src/models/manager.test.ts; server/src/http/server.test.ts (plus .harness/ records). No file outside finding F1's scope (server.test.ts carries F1's suggested concurrent-request test).
Cycle 2: PASS, tier Mid (sonnet), correction-diff scope b8bcae3..13f48ba; M2-AC2/AC3/AC5 PASS; 0 findings — .harness/evidence/M2b-review.log. Reviewer validation exit 1 at model-swap-proof Step 4 (600 s idle) because an external client loaded nemotron3:33b directly via Ollama during the idle window; Steps 1-3 passed live and model-failed-load-proof re-run alone PASS. Human chose to finalise without re-running the 600 s proof.

### Review Cycles

1

### Follow-ups

- Pickup size/shape check: 3 criteria, shape PASS; signals CONCURRENCY_LIFECYCLE + IMPLEMENTATION_PLUS_LIVE_PROOF present (nominally a required split). Not split further: M2b is already the child of the M2 split made for this exact pair, and all three criteria are live observations of the same load/unload lifecycle, so no criterion-conserving seam separates them. A human may prefer a different call.
- M2-AC5 was proven live with a runner load failure (bad LoRA adapter), not out-of-memory: on this Mac with Ollama 0.32.14 out-of-memory could not be induced (num_ctx is clamped; oversized num_batch/num_gpu oversubscribe without error). The criterion says "such as out of memory"; the reviewer or human should confirm this reading. The server's "Not enough memory" reason is covered by unit tests only.
- Reviewer OPTIONAL (cycle 1, F2, .harness/reviews/M2b-cycle1.md): a failed load's reason stays in `operation.error` until the next operation, so the Models screen can show "Loaded: X" beside an old "Load failed: ..." after something else loads X. Not corrected in cycle 1 (outside M2-AC5, which only requires the reason after the failed load); candidate for M2c, which reworks the same operation state for its confirmation rule.

