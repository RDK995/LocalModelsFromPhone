TASK M4c-T2 — Live proof over the tailnet: backgrounding mid-reply and returning to the foreground resumes the same reply to its terminal state; only Stop cancels

Routing: tier Cheap, model haiku, reason_code BOUNDED_LOW_RISK
  detail: a proof script in the established mobile/scripts/*-proof.{sh,ts} pattern (a near copy of resume-proof) over already-built modules against the live server; the script's assertions against an independent full server replay are the oracle.

Goal:
A live proof script mobile/scripts/background-proof.{sh,ts}, modelled on
mobile/scripts/resume-proof.{sh,ts} (read both first and reuse their token reading, LaunchAgent
restart / wait-for-401 / restore-original-resident-model trap, model selection, swap-load, poll
helpers, wrapping fetchImpl and independent-replay oracle), that drives the app's own code
(`sendInConversation` in mobile/src/chat/conversationSession.ts, the conversation store over the
file-backed StoragePort in mobile/src/store/fileStorage.ts, `stopGeneration` in
mobile/src/chat/chatController.ts, and `APIClient` in mobile/src/api/client.ts, which as of task
M4c-T1 accepts an injectable `lifecycle { isForeground(); onForeground(listener) }`) against the
real server at https://ryans-mac-studio.tailc3648a.ts.net:8443 and asserts M4-AC3.

Relevant Requirements:
M4-AC3: "Backgrounding the app mid-reply and returning to foreground resumes the same reply and
receives its terminal state, with only an explicit Stop cancelling generation." FR11
(.harness/requirements.md lines 47-50).

The simulated background: a fake lifecycle object you control (`foreground` boolean + listeners
set), passed to the APIClient. "Background" = set foreground=false AND make the wrapping fetch
STALL the current /v1/chat body: stop forwarding bytes, raise no error (this is how a suspended iOS
socket looks). "Return to foreground" = set foreground=true and call every registered listener.

Acceptance Criteria (the script prints PASS/FAIL per check and exits non-zero on any FAIL):
1. Model selection and swap-load exactly as resume-proof.ts. Print the model.
2. Scenario A (background then foreground, reply completes). Prompt
   "Count from 1 to 80 as digits separated by commas and spaces. Output only the numbers." in a new
   conversation via `sendInConversation`. The wrapper forwards the first /v1/chat body until K=5
   complete `event: content` events have been forwarded, then goes "background": forwards nothing
   more and never errors that stream on its own. Wait 8 seconds of real time (the generation keeps
   running on the Mac), then "foreground". Record every request (method, URL, Last-Event-ID) and
   every StreamEvent the session's onEvent sees. Assert:
   a. exactly K content events were forwarded before the stall, and no done before it;
   b. after foreground, at least one `GET /v1/generations/<genId>/events` with Last-Event-ID
      matching /^<genId>-\d+$/ was made, and it was made within 2 s of the foreground call;
   c. no request to any URL containing `/cancel` was made in scenario A;
   d. exactly one `done` event, status "complete", onComplete (not onError) ran;
   e. independent oracle: a plain-fetch full replay (bearer token, no Last-Event-ID) of
      `GET /v1/generations/<genId>/events`; the concatenation of the session's content texts equals
      the replay's, and the content event counts are equal (no gaps, no duplicates);
   f. the replay's own terminal event is `done` with status "complete" (backgrounding did not
      cancel the generation on the Mac); the stored assistant message equals the expected text and
      has status "complete"; expected contains "80".
3. Scenario B (only Stop cancels). New conversation, prompt
   "Count from 1 to 400 as digits separated by commas and spaces. Output only the numbers."
   Background after K=5 content events as in A, wait 3 s, foreground, then once at least 5 more
   content events have been delivered after the foreground, call `stopGeneration(client, genId)`
   (the app's Stop). Assert: exactly one POST to `/v1/generations/<genId>/cancel` in scenario B
   and it came from the Stop call (none before it); exactly one `done` event with status
   "cancelled"; onComplete ran; the stored assistant message has status "stopped"; the replay's
   terminal event is `done` "cancelled".
4. Print the first 200 characters of scenario A's reply and all counts. The .sh wrapper restores
   the originally resident model (or nothing resident) on every exit path, exactly like
   resume-proof.sh, and prints a final PASS/FAIL line.

Relevant Files:
- mobile/scripts/resume-proof.sh, mobile/scripts/resume-proof.ts (pattern to copy)
- mobile/src/api/client.ts (APIClient constructor, lifecycle option, FetchImpl type)
- mobile/src/chat/conversationSession.ts, mobile/src/chat/chatController.ts
- mobile/package.json (read only; do not add scripts)

Files Allowed To Change:
- mobile/scripts/background-proof.sh (new)
- mobile/scripts/background-proof.ts (new)

Constraints:
- Follow existing repository patterns.
- Do not modify mobile/src, the server, or other scripts.
- Do not introduce dependencies.
- Do not weaken tests.
- Run nothing else against the Mac concurrently; the proof restarts com.harness.server and
  com.harness.bundle-host.
- Do not use git stash, and do not commit (the orchestrator commits).

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2/mobile && bun run typecheck && bun run lint && bash scripts/background-proof.sh

Return:
- Summary
- Files changed
- Tests run
- Test result
- Unresolved issues

Previous Attempt (cumulative):
- Attempt 1 (Cheap, haiku) + continuation 1 — FAIL. Scripts exist untracked in the tree
  (mobile/scripts/background-proof.{sh,ts}); ordering bug and .sh false-PASS were fixed in
  continuation 1. Scenario A: all assertions PASS. Scenario B FAILS: after background 3 s and
  foreground, stopGeneration was called at the 50th content event after resume (the packet says
  "at least 5"), exactly one POST /cancel was made, but the stream's done and the oracle replay's
  done both had status "complete". Log order: "calling stopGeneration" -> "onComplete called" ->
  "Send completed" -> "stopGeneration completed". The worker attributed this to the model producing
  all 1889 content events within ~3 s; that is NOT plausible for a 24B model (~tens of tokens/s)
  and is unproven. The cancel response body was never logged.

Escalated: tier Mid (attempt 3). Reason: the failure is unexplained behaviour (either a proof-script
bug or a real product defect in Stop after a foreground resume), not a mechanical slip.
What this attempt must do first: DIAGNOSE with evidence before changing the proof. Log wall-clock
timestamps for: chat start, 5th content event, stall, foreground, first resumed event, the stop
trigger, the cancel POST send and its response status+body ({status:"cancelled"} vs
"already_complete"), and the done event; and the generation's total content event count. If the
cancel response is "already_complete" while the generation demonstrably could not have finished
(timestamps), or the server ignores a cancel of an in-flight generation, that is a PRODUCT DEFECT:
do not change mobile/src or the server; do not bend the assertion; return FAIL with the evidence
under Unresolved Issues. If it is a script bug (e.g. Stop fired after the reply had already
finished, the wrong generation id, counting replayed events wrongly), fix the script. Trigger Stop
at the 5th content event after the foreground, per the packet. You may lengthen the prompt's count
(e.g. 1 to 1000) only if timestamps show the reply genuinely finishes before Stop can land.
