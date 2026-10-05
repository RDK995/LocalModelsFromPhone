HANDOFF M4c-T2 continuation of attempt 3 (Mid) (written by the orchestrator; the attempt-3 worker hit its turn limit with no report)

Packet: .harness/tasks/M4c-T2.md (authority, including its Previous Attempt / Escalated sections).
Untracked in the tree: mobile/scripts/background-proof.{sh,ts} (attempt-3 version with [TIMING] logs),
.harness/evidence/M4c-T2-worker.log (its last run). Nothing is running against the Mac; the log shows
the Mac restored.

Diagnosis evidence from that log (scenario B; scenario A assertions all PASS, 309 events):
  5th content event (background)   893 ms
  stall confirmed                  972 ms
  foreground call                 3988 ms
  FIRST content event after fg  147842 ms   <-- 144 s gap
  stop trigger / cancel POST    147843 ms -> 200 {"status":"already_complete"}
  done (status complete)        147873 ms
So Stop was not the problem: nothing was delivered for 144 s after the foreground, by which time
the generation had finished. The foreground did NOT produce an immediate resume. Scenario A only
passed because it waits for completion; packet assertion 2b "GET events made within 2 s of the
foreground call" must be checked explicitly — verify it is implemented and log the GET's timestamp.

Find which of these it is, with timestamps (log when the wrapper sees each request, and when the
stalled body's cancel/abort happens):
 (1) SCRIPT BUG (most likely): the stalling wrapper's returned ReadableStream never ends when the
     request's init.signal (the client's internal per-transport AbortController, linked from
     M4c-T1) aborts. A real fetch body rejects reader.read() with an AbortError when its signal
     aborts; the wrapper must do the same: on init.signal "abort", abort the real request AND error
     the returned stream (controller.error(new DOMException("Aborted","AbortError")) or similar),
     and also implement the stream's cancel(). Fix the wrapper to be faithful and re-run.
 (2) PRODUCT DEFECT: the wrapper faithfully rejects on abort, yet the client does not issue the
     resume GET within 2 s of onForeground (e.g. the listener never fires, the abort is not
     wired to the chat POST's signal, or the resume waits a backoff delay). Then do NOT change
     mobile/src; return FAIL with the timestamped evidence under Unresolved Issues.
Then trigger Stop at the 5th content event after the foreground (per packet), and run the packet's
Tests command once to completion; save the full output to .harness/evidence/M4c-T2-worker.log.
