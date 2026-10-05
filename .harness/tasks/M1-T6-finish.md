TASK M1-T6 (finish) — Close out the Expo SDK 57 upgrade and behavioural tests

Routing: tier Mid, model sonnet, reason_code ORDINARY_IMPLEMENTATION
  detail: finish-only; the upgrade and most code are already on disk. Bounded to
  mobile/, settled by commands.

Original packet (read it for Goal, Why, contract and constraints):
  /Users/ryankenny/Projects/CodingHarnessv2/.harness/tasks/M1-T6.md
Previous handoff (context only):
  /Users/ryankenny/Projects/CodingHarnessv2/.harness/tasks/M1-T6-handoff-2.md

Goal:
Every gate below exits 0 on the work already in the tree, with no placeholder
tests left. This is a FINISH task: do NOT redo the SDK upgrade, do NOT rewrite
the client. Fix only what a gate reports.

Current disk state (uncommitted, relative to HEAD; verify, do not trust):
- expo ^57, react-native 0.86.x installed; client uses expo/fetch via an
  injectable fetch (src/api/client.ts + src/api/expoFetchClient.ts);
  src/api/secureStoreToken.ts; src/ui/streamReducer.ts.
- Previously observed: typecheck exit 0; `bun test src/api src/ui` 15 pass
  0 fail; lint exit 0. `npx expo export --platform ios` and `npx expo-doctor`
  have NOT been run by anyone on SDK 57.

What to do, in order (stop as soon as all gates pass):
1. Run the full Tests line below. Fix whatever fails, inside mobile/ only.
2. Run `cd mobile && npx expo-doctor`. Fix dependency-version problems it
   reports; anything you cannot fix inside mobile/ goes under Unresolved Issues.
3. Confirm no placeholder tests remain: grep mobile/src for tests asserting
   `true` / `toBe(true)` on a constant / `toBeDefined()` as the only assertion.
   token.test.ts must test save/read against a mocked expo-secure-store;
   ui.test.ts must test real logic (e.g. streamReducer applying token and
   terminal events). Report the test names.

Files Allowed To Change:
- mobile/** (never commit node_modules/ or dist/)

Constraints:
- Expo Go only: no custom native modules, no prebuild, no ios/ or android/.
- Do not change server/ or shared/.
- Do not disable lint rules, add eslint-disable comments, or loosen configs.
- Do not weaken tests. Do not commit; do not git stash; do not touch .harness/.
- You have a limited turn budget. If you are running low, stop and return
  CONTINUE listing exactly which gates pass and what remains.

Tests (all must exit 0, from /Users/ryankenny/Projects/CodingHarnessv2):
cd mobile && bun run typecheck && bun test src/api src/ui && bun run lint && npx expo export --platform ios && rm -rf dist

Return:
- Result: PASS | FAIL | CONTINUE
- Files changed (this attempt)
- Tests run (each command + exit status; test count and names)
- `npx expo-doctor` output (verbatim summary line and any failures)
- Unresolved issues
