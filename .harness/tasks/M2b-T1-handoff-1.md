M2b-T1 handoff 1 (written by the orchestrator; the previous worker was INTERRUPTED at its turn limit with no report).

Persisted state in the working tree (uncommitted, from the interrupted attempt — treat as unverified draft work, not as done):
- modified: server/src/http/server.ts, server/src/http/server.test.ts, server/src/models/manager.ts,
  server/src/models/manager.test.ts, server/src/ollama/client.ts, server/src/ollama/client.test.ts

M2b-T2 (mobile) is already committed (a3576a7); do not touch mobile/.

Next: read the packet, review the draft against every acceptance criterion in it, complete or correct what is missing, then run the packet's Tests command in full and write its output to .harness/evidence/M2b-T1-worker.log. Keep turns lean: do not re-read unchanged files repeatedly; run the test command once near the end rather than after every edit.
