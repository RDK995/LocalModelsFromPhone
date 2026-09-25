M1-C9 handoff 1 (written by the orchestrator from repository state; the attempt-3 worker hit
its turn limit and returned no report — INTERRUPTED, not FAIL)

Persisted state at handoff (uncommitted working tree on 811f5be):
- Modified: mobile/src/app/_layout.tsx, chat.tsx, settings.tsx, setup.tsx
- New: mobile/src/app-routing/keyboardHandling.test.ts
- .harness/evidence/M1-C9-worker.log holds items 5 (RED 3 fail, GREEN 3 pass) and 7
  (typecheck, 30 tests pass, lint 0, iOS export OK, dist removed).
- NOT evidenced in the log: item 6 (bundle host restart + tailnet manifest/bundle curl + grep).
  Unknown whether the restart was already run.

What remains for this continuation:
1. Read the current diff (git diff -- mobile/) and confirm it meets packet items 1-4; fix only
   what does not. Do not restart the work.
2. Do packet item 6 in full and APPEND its verbatim output to the evidence log.
3. Re-run the packet's Tests command once at the end and append the result.
4. Return the worker return contract, including: which header choice you found for chat (item 3)
   and why, and any deviation from the packet.
