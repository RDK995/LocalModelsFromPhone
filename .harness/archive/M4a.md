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
