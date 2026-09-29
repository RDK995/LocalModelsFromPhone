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
