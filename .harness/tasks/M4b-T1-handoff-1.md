HANDOFF M4b-T1 continuation 1 (written by the orchestrator from repository state; the previous
worker hit its turn limit without a report).

State on disk (uncommitted, on branch m4b-dropped-connection-resume, base 309f9e7):
- modified: mobile/src/api/client.ts (+~360 lines), mobile/src/api/client.test.ts (+~800 lines)
- new: mobile/src/api/resume.ts, mobile/src/api/resume.test.ts
- `bun run typecheck` exits 0; `bun test src/api` 37 pass / 0 fail (orchestrator observation).

Not yet established:
- whether every packet acceptance criterion 1-9 is implemented and every test case (a)-(k) of
  criterion 10 exists and asserts what the packet says;
- whether any existing test assertion was changed beyond the one class the packet permits;
- the full packet Tests command (src/chat src/store src/ui src/app-routing, lint, smoke:runtime).

What to do: review the existing work against the packet (do not start over), fill any gap, keep
the change inside Files Allowed To Change, run the packet's full Tests command, and return the
packet's Return fields. Be economical with turns: read client.ts and the new tests once each.
