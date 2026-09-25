TASK M2a-T2 — Phone model screen: installed models by real name and size, and the resident model

Routing: tier Mid, model sonnet, reason_code ORDINARY_IMPLEMENTATION
  detail: new expo-router screen plus a pure view-model and a navigation entry; ordinary UI implementation over an existing typed client call.

Goal:
The phone app gains a Models screen, reachable from Chat, that calls the existing
`APIClient.getState()` (GET /v1/state) and shows every installed model by its real name with a
human-readable size, marks the resident model, and shows an explicit "Nothing loaded" state when
`resident` is null — including a resident model the phone never loaded (another tool on the Mac).
It refreshes each time the screen gains focus and on pull-to-refresh.

Relevant Requirements:
FR1, FR2 — /Users/ryankenny/Projects/CodingHarnessv2/.harness/requirements.md lines 17-21; edge
case at lines 128-129 ("Another tool loads a different model behind the phone's back: the app
shows the true resident model on its next refresh"). Architecture C1/C2:
/Users/ryankenny/Projects/CodingHarnessv2/.harness/architecture.md lines 50-66.

Context not obvious from the code:
- `/v1/state` returns `{models:[{name,size_bytes}], resident:{name,loaded_by_server}|null, operation, generation}` (type `StateResponse` in shared/api.ts, already imported by mobile/src/api/client.ts; `getState()` exists at client.ts ~line 119).
- Load/Unload buttons are NOT part of this task (milestone M2b). Show no load/unload controls.
- chat.tsx already shows the house pattern for building the client (`createAPIClient()` from
  `@/api/expoFetchClient`), for `UnauthorizedError` (route to Settings with the token form open,
  chat.tsx ~lines 130-145), and for header links (the Settings link ~line 199). Reuse those
  patterns; do not invent new ones.
- The root layout (`mobile/src/app/_layout.tsx`) declares every screen unconditionally as a direct
  child of `<Stack>`, never in a Fragment (see its comment and `src/app-routing/stackChildren.test.ts`).

Acceptance Criteria:
- New pure module `mobile/src/ui/modelList.ts` exporting:
  - `formatSize(bytes: number): string` — decimal units: >= 1e9 → `"<x.y> GB"` (one decimal),
    >= 1e6 → `"<n> MB"`, else `"<n> KB"`-or-bytes (your choice, tested).
  - `toModelListView(state: StateResponse)` returning `{ rows: {name, sizeLabel, isResident}[], residentLabel: string }`
    where rows are `state.models` in the same order with names verbatim, `isResident` is true
    only for the row whose name equals `state.resident?.name`, and `residentLabel` is
    `"Loaded: <name>"` when resident is non-null (even if that name is not in `models`) and
    `"Nothing loaded"` when resident is null.
- `mobile/src/ui/modelList.test.ts` (write first): rows mirror an arbitrary made-up models list
  (names verbatim, order kept, size labels), resident marking, a resident not in the list still
  produces `"Loaded: <name>"`, null resident gives `"Nothing loaded"` and no row marked, empty
  models list gives no rows.
- New screen `mobile/src/app/models.tsx`: calls `getState()` on focus (expo-router
  `useFocusEffect`) and on pull-to-refresh (`RefreshControl`); renders `residentLabel`
  prominently, then a `FlatList` of rows showing name and size, with a visible resident marker;
  shows a loading indicator on first load; on `UnauthorizedError` follows chat.tsx's 401 pattern;
  on any other error shows a plain message on screen (e.g. "Can't reach the Mac" /
  the error's message) with the list kept empty. No model name is written anywhere in app source.
- `_layout.tsx` declares `<Stack.Screen name="models" options={{ title: "Models", headerShown: true }} />`
  as a direct child of Stack; `stackChildren.test.ts` is extended (not weakened) to also expect
  `name="models"`.
- Chat's in-screen header gains a "Models" link beside Settings that does `router.push("/models")`.

Relevant Files:
- mobile/src/api/client.ts, mobile/src/api/expoFetchClient.ts
- mobile/src/app/chat.tsx, mobile/src/app/_layout.tsx, mobile/src/app/settings.tsx
- mobile/src/app-routing/stackChildren.test.ts
- mobile/src/ui/streamReducer.ts, mobile/src/ui/ui.test.ts (existing pure-module/test conventions)
- shared/api.ts (read only)
- mobile/scripts/runtime-smoke.sh / runtime-smoke.mjs (read only — must keep passing)

Files Allowed To Change:
- mobile/src/ui/modelList.ts (new), mobile/src/ui/modelList.test.ts (new)
- mobile/src/app/models.tsx (new)
- mobile/src/app/_layout.tsx, mobile/src/app/chat.tsx (header link only)
- mobile/src/app-routing/stackChildren.test.ts (extend only)

Constraints:
- Follow existing patterns; no new dependencies (expo-router and react-native already provide
  useFocusEffect, FlatList, RefreshControl). Do not weaken tests.
- Do not touch server/, ops/, shared/, mobile/src/api/, .harness/ (except your log). Do not commit.
- Another worker is concurrently editing server/; do not run server tests or restart services.
- Leave no `dist/` directory behind.

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2/mobile && bun run typecheck && bun test src/api src/ui src/chat src/app-routing && bun run lint && bun run smoke:runtime
Write complete output to /Users/ryankenny/Projects/CodingHarnessv2/.harness/evidence/M2a-T2-worker.log.

Return: the worker return contract (Summary, Files changed, Tests run, Test result, Unresolved issues).
