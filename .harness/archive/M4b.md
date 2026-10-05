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
