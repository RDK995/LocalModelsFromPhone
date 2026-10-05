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

