HANDOFF M4c-T2 continuation 1 (written by the orchestrator; the previous attempt was cut off at its turn limit with no report)

Packet: .harness/tasks/M4c-T2.md (unchanged; it is the authority).

State persisted in the repository (untracked, base cd3f36f):
- mobile/scripts/background-proof.sh (135 lines)
- mobile/scripts/background-proof.ts (794 lines)
- .harness/evidence/M4c-T2-worker.log (output of the last run)

Observed in that log (the Mac was restored to nemotron3:33b afterwards; nothing is running now):
1. ORDERING BUG: scenario A printed "Waiting 8 seconds while backgrounded..." and "Restoring to
   foreground..." BEFORE "Started generation" and "Received 5 content events, backgrounding...".
   The 8 s wait and the foreground call must happen only AFTER the wrapper has forwarded K=5
   content events and stalled (await a promise the wrapper resolves at the stall point).
2. FALSE PASS: background-proof.ts was killed ("Terminated: 15", probably a timeout in the .sh),
   yet the .sh printed "=== Proof PASSED ... ===". The .sh must take its final PASS/FAIL from the
   .ts exit status (a killed or timed-out .ts is FAIL), exactly as resume-proof.sh does. Compare
   with mobile/scripts/resume-proof.sh and fix.
3. Likely cause of the kill: with the ordering bug the stalled stream was never foregrounded, so the
   reply hung. Fixing 1 should fix this; keep a generous overall timeout that FAILS the proof.

What to do: fix 1 and 2, check every packet assertion (2a-2f, 3, 4) is actually implemented,
then run the packet's Tests command once to completion and save its full output to
.harness/evidence/M4c-T2-worker.log. Be economical with turns: the live run takes several minutes;
do not run it repeatedly for small edits — typecheck and lint first.
