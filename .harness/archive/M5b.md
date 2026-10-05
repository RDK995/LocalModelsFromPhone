## M5b — Plain-language error messages

Status: DONE

### Outcome

The app shows a distinct plain-language message for each failure mode: Mac or server unreachable, Ollama down, wrong password, model failed to load, model no longer installed, and a reply already in progress. Second part of the M5 split (see M5a). Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal; seam check: the live proof is the criterion itself, so separating it would leave a component-only half — not split).

### Architecture

C1, C2, C4

### As-Built

.harness/as-built/M5b.md — RECORDED — 15/17 files attributed; components C1,C2,C5; 7 edges; 2 claim mismatches (C4 claimed but not modified; C5 modified but not claimed, covered by D-M5b-1)

### Acceptance Criteria

- [x] **M5-AC3**: The app shows a distinct message for each of: Mac or server unreachable, Ollama down, wrong password, model failed to load, model no longer installed, and reply already in progress.

### Baseline

69aed5333cdee09d7d1c38aa73fcfa06f2ff3c16 on m5b-plain-errors

### Evidence

Tasks (packets under .harness/tasks/):
- M5b-T1 — error mapping + client/server/screens + unit tests: Mid (ORDINARY_IMPLEMENTATION). Attempt 3 CONTINUE (turn limit, handoff-1) → continuation 1 PASS; verifier PASS exit 0 (server 109, mobile 167 tests; typecheck, lint clean), tests weakened NO — .harness/evidence/M5b-T1-verifier.log. Accepted. Architecture deviation D-M5b-1 (operation.error_code, Material: no) recorded.
- M5b-T2 — live six-failure proof script: Mid (ORDINARY_IMPLEMENTATION). Attempt 3 INTERRUPTED (turn limit, no report; services checked healthy; fresh resume, no rung) → attempt 3 FAIL: 5/6 PASS, scenario 6 exposed a product defect in client.ts (Tailscale proxy answers bodiless 502 when the server is down; client threw TypeError instead of UnreachableError) — script not at fault, correction routed as M5b-T3 → after T3, verifier re-run PASS exit 0, 6/6 PASS, pairwise distinct, services restored — .harness/evidence/M5b-T2-verifier.log. Accepted, f0dd837.
- M5b-T3 — correction: bodiless/null-body gateway 502/503/504 → UnreachableError (getState, load/unload, chat start); JSON error bodies and resume retry unchanged: Mid (ORDINARY_IMPLEMENTATION), attempt 3 PASS; verifier PASS exit 0 (mobile 173 tests, typecheck, lint), tests weakened NO — .harness/evidence/M5b-T3-verifier.log. Accepted, e82554a.

M5-AC3 evidence (for the reviewer's table): unit — M5b-T1 and M5b-T3 verifier logs; live — mobile/scripts/error-messages-proof.sh against the Mac Studio over the tailnet and live Ollama, six exact pairwise-distinct sentences, exit 0 (.harness/evidence/M5b-T2-verifier.log).

### Validation

`cd /Users/ryankenny/Projects/CodingHarnessv2 && (cd server && bun test && bun run typecheck) && (cd mobile && bun run typecheck && bun test && bun run lint && bash scripts/error-messages-proof.sh)`

The live proof temporarily stops Ollama and the server LaunchAgent and restores both via trap (about 4 minutes). Never reboot the Mac. Scenario 3's mismatched-LoRA failed load was once seen to load successfully (pre-existing flake shared with model-failed-load-proof.sh); one rerun is reasonable if only scenario 3 fails.

### Review

Cycle 1: PASS, tier Mid (sonnet, MID_TIER_DIFF), full-milestone scope 69aed5333cdee09d7d1c38aa73fcfa06f2ff3c16..a664ee2; M5-AC3 PASS; 0 BLOCKER, 0 IMPORTANT, 0 OPTIONAL; no report file (PASS). Reviewer re-ran server tests + typecheck and mobile typecheck, 173 unit tests, lint and the live six-scenario error-messages-proof against the real Mac; exit 0, services and resident model restored. D-M5b-1 matches the diff. — .harness/evidence/M5b-review.log

### Review Cycles

0

### Follow-ups

- New feature requested by the human 2026-09-26, out of scope for current requirements: internet (web) search for the models, e.g. via Ollama's web search / tool calling. Needs roast-requirements (search provider and privacy, which models, how the app shows searching and sources) before any implementation.
- Scenario 3 of error-messages-proof.sh (and model-failed-load-proof.sh) relies on a mismatched LoRA adapter failing to load; the M5b-T2 worker saw it load successfully once. A more deterministic failed-load induction would make both proofs less flaky.
