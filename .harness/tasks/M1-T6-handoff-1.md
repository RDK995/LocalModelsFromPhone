M1-T6 handoff 1 (written by the orchestrator from repository state; the previous
worker hit its turn limit without reporting — nothing it said is known).

On disk, uncommitted, relative to HEAD d87a597:
- mobile/package.json: expo ^57.0.0, expo-router ~57.0.23, react-native 0.86.3 (dependency upgrade appears started/done; eslint still ^8.53.0)
- mobile/bun.lock, mobile/app.json, mobile/tsconfig.json modified
- mobile/src/** untouched: client.ts has NOT been switched to expo/fetch; placeholder tests NOT replaced.

Continue from this state. Do not assume the upgrade is complete or correct:
re-run `npx expo install --check` / `npx expo-doctor` and every gate. Then do
packet steps 2 and 3. Budget your turns: get the gates green first, write the
behavioural tests second, and report even if something remains.
