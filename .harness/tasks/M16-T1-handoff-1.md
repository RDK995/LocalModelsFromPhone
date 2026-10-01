HANDOFF for M16-T1 (continuation 1 of 2; not a failed attempt)

State observed by the orchestrator at handoff time (2026-10-02):
- `ollama pull qwen3.5:35b-a3b` is ALREADY RUNNING in the background (two processes, PIDs 16455 and 17443, started by earlier attempts), log at /tmp/qwen_pull.log, ~52% (12/23 GB, ~18 MB/s, ~10 min left). Do not kill them.
- To wait for completion, run `ollama pull qwen3.5:35b-a3b` in ONE foreground Bash call with timeout 600000 (it shares/resumes the same blobs); repeat once more if it has not finished. Then `ollama list`.
- The server is already running (previously PID 42026 on :7789); you did not start it, do not stop it.
- The previous attempt reported the installed-model list may not be at "GET /v1/models" exactly (it cited GET /v1/state and POST /v1/models/load). Read the server's route table under server/src to find the actual installed-model list route and the swap-load route; use them and record in the evidence file exactly which routes you called and why they are the installed-model list and swap-load.
- No evidence file exists yet; create .harness/evidence/M16-T1-live.log.
