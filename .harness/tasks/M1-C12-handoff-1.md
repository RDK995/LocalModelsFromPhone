M1-C12 handoff 1 (written by the orchestrator; the attempt-3 worker hit its 40-turn limit with no report)

Persisted state at interruption (HEAD 6fec6a1, uncommitted):
- mobile/scripts/runtime-smoke.mjs: +168/-24 lines, presumably the packet step-3 extension
  (Setup -> /chat path). Unknown whether it runs or shows RED on the current _layout.tsx.
- mobile/src/app-routing/stackChildren.test.ts: +27 lines, presumably the step-2 static assertion.
- mobile/src/app/_layout.tsx: NOT changed yet (step 1 not done).
- .harness/evidence/M1-C12-worker.log: header only, no evidence recorded.

What remains, in order:
1. Read the two diffs (`git diff -- mobile/scripts/runtime-smoke.mjs mobile/src/app-routing/stackChildren.test.ts`).
2. With _layout.tsx still unchanged, run `bun test src/app-routing/stackChildren.test.ts` and
   `bun run smoke:runtime` and record both as RED in the log (the token-absent run must show the
   Setup -> Chat path reaching Chat with the Stack header shown, i.e. failing). If the smoke
   extension does not work, fix it with the least effort; if it cannot be made to work within a few
   turns, stop and record why rather than spend the budget.
3. Packet step 1 (the fix), then GREEN for both, then the packet's Tests command, then step 4.

Turn discipline: record evidence in the log as soon as you have it. If you reach ~25 turns, write
.harness/tasks/M1-C12-handoff-2.md and return CONTINUE.
