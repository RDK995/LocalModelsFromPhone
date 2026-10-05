M1-T6 handoff 2 (orchestrator, from repository state; the second worker also hit
its turn limit without reporting). This is the LAST continuation for this task.

On disk, uncommitted, relative to HEAD d87a597:
- SDK upgrade in place: expo ^57, expo-router ~57.0.23, react-native 0.86.3
  (package.json, bun.lock, app.json, tsconfig.json).
- mobile/src/api/client.ts now imports `fetch as expoFetch` from "expo/fetch"
  with an injectable fetch; mobile/src/api/client.test.ts has ~286 lines of new
  behavioural tests. token.test.ts and src/ui/ui.test.ts are still placeholders.
- Gate status observed by the orchestrator:
  * `bun run typecheck` exit 0
  * `bun test src/api src/ui`: "Unhandled error between tests / error: Unexpected
    typeof", 1 fail, only 3 tests ran. Probable cause (verify, do not trust): the
    test imports client.ts, which imports "expo/fetch", which pulls react-native's
    Flow-typed source that bun cannot parse. Likely fix: keep the testable client
    logic in a module that does NOT import expo/fetch (fetch is injected), and put
    the `expo/fetch` default wiring in a thin separate module that the app uses;
    or use bun's `mock.module("expo/fetch", ...)` in a preload. Either is fine.
  * `bun run lint`: 4 errors, `quotes` (single vs double) in client.ts/client.test.ts
    — fix the code (e.g. `bunx eslint --fix src`), not the rule.
  * `npx expo export --platform ios`: not yet run by anyone on SDK 57.

Order of work, and report whatever state you reach:
1. Make bun test run all files with no unhandled error.
2. Lint clean.
3. expo export ios exit 0 (then rm -rf dist). Also run `npx expo-doctor` and report.
4. Replace token.test.ts placeholder with a real test of token save/read
   (mock expo-secure-store); ui.test.ts may test the extracted pure logic used by
   chat.tsx (e.g. applying stream events to displayed text), or be removed only
   if replaced by an equivalent real test elsewhere under src/ui or src/api.
If you run low on turns, stop and return CONTINUE with a handoff artifact.
