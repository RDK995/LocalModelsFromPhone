M1-T7 handoff 1 (orchestrator, from repository state; the first worker hit its
40-turn limit without reporting). Its work is on disk, UNCOMMITTED, relative to
HEAD 0cce5e1 (M1-T5a accepted):
  server/src/generations/manager.ts | +35 -? (small interface change)
  server/src/http/server.test.ts    | 481 lines changed
  server/src/http/server.ts         | 227 lines changed
  server/src/index.ts               | 30 lines changed
Nobody has run the Tests line against this state. Treat it as unverified.

Continue from it; do not start over. In order, report whatever state you reach:
1. Run `cd server && bun test && bun run typecheck && bash scripts/entry-smoke.sh`;
   fix what fails inside the packet's Files Allowed To Change.
2. Confirm packet steps 2-4 are met (createServer port option, no Bun.serve swap in
   index.ts, all four routes wired, behavioural tests on port 0 never 7789).
3. Run the live-loopback proof (packet step 5) and report its output.
If you run low on turns, stop and return CONTINUE with a handoff note of exactly
what passes and what remains.
