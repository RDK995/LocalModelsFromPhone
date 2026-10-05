TASK M4c-T3 — Finish the live background/foreground proof (split from M4c-T2 after its diagnosis)

Routing: tier Mid, model sonnet, reason_code ORDINARY_IMPLEMENTATION
  detail: split from M4c-T2, which exhausted its two worker continuations (turn limits) while
  diagnosing. The diagnosis is now done (below); what remains is a bounded fix plus a live run whose
  scenario B outcome still needs judgement, so Mid rather than Cheap.

Authority for goal, simulation, acceptance criteria 1-4, relevant files, constraints and return
format: .harness/tasks/M4c-T2.md (read it in full; its criteria apply unchanged to this task).

Diagnosis already established (orchestrator, from .harness/evidence/M4c-T2-diag.log):
- The fake lifecycle is never reached by the client: the log shows
  "[DIAG] setForeground(true): ... notifying 0 listener(s)" and no "listener registered" line.
- Cause (SCRIPT BUG): background-proof.ts builds its clients with `createAPIClient` from
  mobile/src/api/client.ts (line ~858), whose signature is `createAPIClient(baseUrl, fetchImpl)` —
  it silently drops the third `{ lifecycle }` argument, so the APIClient uses the default
  never-fires lifecycle. The 16 s late resume is the ordinary stall/drop path, not foreground.
- Fix: construct every client in the script with
  `new APIClient(SERVER_URL, wrappingFetch, { lifecycle: simLifecycle.lifecycle })`
  (APIClient is exported from mobile/src/api/client.ts; constructor is
  `(baseUrl, fetchImpl, clock: ClientClock = {})`, ClientClock has `lifecycle?`). All three call
  sites (around lines 572, 614, 824). Do not change mobile/src.

Then:
- Confirm with the existing [DIAG] lines that the listener registers, the stalled body's init.signal
  aborts on foreground, and the resume GET is made within 2 s of the foreground call (AC 2b).
- Scenario B: trigger Stop at the 5th content event delivered after the foreground (per M4c-T2).
  Log the cancel POST's response status and body. If the cancel response is "already_complete"
  while timestamps show the generation could not have finished, that is a PRODUCT DEFECT: do not
  change mobile/src or the server, do not bend the assertion, return FAIL with the evidence.
  You may lengthen scenario B's count (e.g. 1 to 1000) only if timestamps show the reply genuinely
  finishes before Stop can land.
- The script must pass `bun run typecheck` and `bun run lint`.

Files Allowed To Change:
- mobile/scripts/background-proof.sh (new, untracked)
- mobile/scripts/background-proof.ts (new, untracked)

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2/mobile && bun run typecheck && bun run lint && bash scripts/background-proof.sh
Run it to completion once the fix is in; save full output to .harness/evidence/M4c-T3-worker.log.
Keep turns low: the diagnosis is done, do not re-derive it. If you near your turn limit, return
CONTINUE with a handoff at .harness/tasks/M4c-T3-handoff-1.md.

Return: Summary (with timestamps: foreground call, listener notify count, resume GET, first resumed
event, stop trigger, cancel response status+body, done), Files changed, Tests run, Test result with
exit status, Unresolved issues.
