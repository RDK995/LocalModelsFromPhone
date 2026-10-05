M2b-T3 handoff 1 (written by the orchestrator; the previous worker was INTERRUPTED at its 40-turn limit with no report).

What the interrupted attempt persisted: NOTHING in the repository — mobile/scripts/model-swap-proof.{sh,ts} do not exist.
What it left on the Mac (already cleaned up by the orchestrator): a temporary Ollama model `m2b-failed-load-probe`
(FROM the nemotron3:33b blob with `PARAMETER num_ctx 131072`) and nothing resident. The orchestrator ran
`ollama rm m2b-failed-load-probe` and restored `devstral:24b` resident with keep_alive -1 (the state at start).
Whether num_ctx 131072 actually fails to load on this 64 GB Mac is UNKNOWN — it likely does not; choose a larger value
(e.g. 1048576 or more on the largest installed model) and confirm the failure with ONE direct command before relying on it:
  ollama create <probe> -f <Modelfile>; curl -s --max-time 600 127.0.0.1:11434/api/generate -d '{"model":"<probe>","keep_alive":-1}'
A genuine failure prints {"error":"..."} (expected: a memory error). Then `ollama rm <probe>` and restore devstral:24b
if it was evicted.

Turn discipline (the previous attempt spent all 40 turns exploring and wrote nothing):
1. Within your first ~8 turns, write BOTH script files in full (copy structure from mobile/scripts/model-list-proof.{sh,ts}).
   Persisting early is what lets a further continuation pick up your work.
2. Do one quick run with IDLE_SECONDS=5, fix what fails.
3. Do exactly one final full run with the default IDLE_SECONDS=600 (Bash timeout >= 1200000 ms), tee'd to
   .harness/evidence/M2b-T3-worker.log, then typecheck and lint.
4. If you run low on turns, write .harness/tasks/M2b-T3-handoff-2.md stating what exists, what passed, what remains,
   and the live-Mac state you left, and return CONTINUE.
