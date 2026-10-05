M1-C11 handoff 1 (written by the orchestrator; the attempt-4 worker hit its 40-turn limit with no report)

Persisted state in the repository at interruption:
- mobile/scripts/runtime-smoke.mjs (new, 12.7 KB, untracked): a Node `vm` harness that executes a
  production iOS bundle with fake Fabric / TurboModules / Expo modules, calls
  RN$AppRegistry.runApplication("main"), and fails on any JS exception or if the first screen does
  not render. Usage: `node scripts/runtime-smoke.mjs <bundle.js> --token=present|absent`.
  Unknown whether it runs, whether it reproduces the crash, or whether it is complete. Treat it as
  a draft: run it first; keep it if it works, fix it if it nearly does, replace it if it does not.
- No source change under mobile/src, no evidence log, no diagnosis recorded.

What remains: all of packet steps 1-5 (diagnosis recorded in the log, RED/GREEN of the runtime
check, the fix, tests, bundle host restart and served-bundle evidence).

Turn discipline for the continuation: append to .harness/evidence/M1-C11-worker.log as you go
(diagnosis first, as soon as you have it). If you reach ~30 turns without finishing, stop, write
.harness/tasks/M1-C11-handoff-2.md with what is diagnosed/changed/remaining, and return CONTINUE.
