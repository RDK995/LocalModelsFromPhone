M1-C12 handoff 2 (written by the orchestrator; continuation 1 hit its turn limit with no report)

Done and recorded in .harness/evidence/M1-C12-worker.log:
- Static RED (stackChildren.test.ts, 1 fail) and runtime RED (token-absent drive Setup -> Chat
  reaches Chat with native header {"title":"chat","hidden":false}) on the unfixed layout.
- runtime-smoke.mjs dispatch-mechanism fix (events via instanceHandle; see the log).
- Packet step 1 applied in mobile/src/app/_layout.tsx (three unconditional screens, token read
  removed). Not yet validated.

Remaining — do only these, appending each result to the log:
1. GREEN: `cd mobile && bun test src/app-routing/stackChildren.test.ts` and `bun run smoke:runtime`
   (token-absent run must show driveToChat ok, Chat header hidden). If GREEN fails, diagnose briefly;
   do not widen scope.
2. The packet's Tests command.
3. Packet step 4 (bundle host kickstart, manifest + launchAsset http codes/sizes, served RootLayout
   excerpt, `scripts/runtime-smoke.sh <launchAsset.url>`).
4. Return the worker return contract. This is the last continuation allowed; if you cannot finish in
   ~20 turns, return what is done with Result FAIL and exactly what remains.
