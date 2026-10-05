# M20-T4 handoff 1 (written by the orchestrator after attempt 1 was INTERRUPTED)

Attempt 1 ran out of turns while repeatedly checking on web-chat-proof.sh. It left these
(unverified, uncommitted) logs under .harness/evidence/:

- M20-T4-server-tests.log, M20-T4-search-tests.log, M20-T4-helper-tests.log (step 1)
- M20-T4-restart.log (step 2: com.harness.search restarted, health 200)
- M20-T4-cache-live.log (step 3: second search `x-cache: hit`)
- M20-T4-web-chat-proof.log (step 4, PARTIAL — the run was cut off at "AC2 attempt 1 of 3")

What remains for you:

1. Quick re-check of steps 1-3 (do NOT re-run the long suites): confirm
   `git diff --stat 7adc092e938134a3455fabdf19f1f02043f381d2 HEAD -- server/` is empty, and one
   bounded health check `curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:7790/v1/health`
   prints 200. Append both outputs to M20-T4-restart.log.
2. Re-run `bash server/scripts/web-chat-proof.sh` from scratch, overwriting the partial log.
3. Then run `bash server/scripts/web-failure-proof.sh`.

How to run each proof WITHOUT burning your turns (this is what failed last time):

- Run it as ONE Bash call with `run_in_background: true`, writing output and exit status to the log:
  `cd /Users/ryankenny/Projects/CodingHarnessv2 && bash server/scripts/web-chat-proof.sh > .harness/evidence/M20-T4-web-chat-proof.log 2>&1; echo "EXIT_STATUS=$?" >> .harness/evidence/M20-T4-web-chat-proof.log`
- Then STOP and end your turn. You will be re-invoked automatically when the command exits.
  Do NOT check the log, sleep, tail, ps or curl while it runs. Zero tool calls while waiting.
- When re-invoked, read only the last ~40 lines of the log and the EXIT_STATUS line.
- Only then start web-failure-proof.sh the same way (log M20-T4-web-failure-proof.log).

If a proof exits non-zero, stop and report the failing output; do not fix anything.
