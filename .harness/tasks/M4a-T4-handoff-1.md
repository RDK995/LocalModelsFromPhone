M4a-T4 handoff 1 (written by the orchestrator; the previous worker was INTERRUPTED at its turn limit without a report)

State persisted in the repository (branch m4a-chat-display, HEAD 769618c):
- Uncommitted edits by the previous attempt:
  mobile/scripts/runtime-smoke.mjs  (+~410 lines, some deletions — REVIEW the deletions: existing
  three runs' assertions must be unchanged; restore anything removed that was not a pure refactor)
  mobile/scripts/runtime-smoke.sh   (13 lines changed)
- No .harness/evidence/M4a-T4-worker.log was written; the previous attempt's result is unknown.

What to do:
1. `git diff mobile/scripts/runtime-smoke.mjs mobile/scripts/runtime-smoke.sh` to see what exists.
2. Run the Tests command from the packet; find out which of steps 1-4 of the new `--token=stream`
   run pass, and finish the work to the packet. Keep what is correct; do not start over unless it
   is unsalvageable.
3. Budget: you have a fixed turn allowance. If you are near it, stop, leave the tree in a
   runnable state, and write .harness/tasks/M4a-T4.handoff.md stating what passes, what fails, and
   the exact next step, then return CONTINUE.
4. If a step fails because chat.tsx does not behave as the packet describes, that is a finding:
   report it with what the tree showed; do not edit chat.tsx and do not loosen the assertion.
