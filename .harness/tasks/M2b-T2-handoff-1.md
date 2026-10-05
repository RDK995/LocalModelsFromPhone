M2b-T2 handoff 1 (written by the orchestrator; the previous worker was INTERRUPTED at its turn limit with no report).

Persisted state in the working tree (uncommitted, from the interrupted attempt — treat as unverified draft work, not as done):
- modified: mobile/src/api/client.ts, mobile/src/api/client.test.ts, mobile/src/app/models.tsx,
  mobile/src/ui/modelList.ts, mobile/src/ui/modelList.test.ts
- new: mobile/src/ui/modelActions.ts, mobile/src/ui/modelActions.test.ts

server/ files may be changing concurrently under another task; ignore and do not touch them.

Next: read the packet, review the draft against every acceptance criterion in it, complete or correct what is missing, then run the packet's Tests command in full and write its output to .harness/evidence/M2b-T2-worker.log. Keep turns lean: do not re-read unchanged files repeatedly.
