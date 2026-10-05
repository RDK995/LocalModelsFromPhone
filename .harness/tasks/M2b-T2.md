TASK M2b-T2 — Phone Models screen: Load and Unload buttons that poll GET /v1/state to ready or a failure reason

Routing: tier Mid, model sonnet, reason_code ORDINARY_IMPLEMENTATION
  detail: extends the existing Models screen, typed client and view-model with actions and a polling helper; ordinary implementation.

Goal:
On the phone's Models screen (Chat > Models) a user can tap Load on any installed model that is
not resident, or Unload when a model is resident. The app calls the server, then polls
`GET /v1/state` until the operation finishes, showing "Loading <name>…" / "Unloading <name>…"
meanwhile, then the new resident state — or, when a load failed, the server's failure reason.

Relevant Requirements:
FR3, FR4, FR5 — /Users/ryankenny/Projects/CodingHarnessv2/.harness/requirements.md lines 23-29.
Edge case "A load fails ... the app shows nothing loaded plus the failure reason" — lines 134-135.
Architecture: /Users/ryankenny/Projects/CodingHarnessv2/.harness/architecture.md — C1 (lines 50-56),
C2 (lines 58-66), interfaces (lines 143-184).

Server contract (being implemented in parallel by another task; code against it, not the server):
- `POST /v1/models/load {name}` → `202 {operation:{kind:"loading", model}}`;
  `404 {error:"unknown_model", message}`; `409 {error:"operation_in_progress", message}`;
  `503 {error:"ollama_down", message}`; `401` → unauthorized.
- `POST /v1/models/unload {}` → `202 {operation:{kind:"unloading", model?}}`; `409 operation_in_progress`.
- `GET /v1/state` → `operation: {kind:"idle"|"loading"|"unloading", model?, error?}`. After a failed
  load: `{kind:"idle", model, error:"<plain-language reason>"}` and `resident: null`; the error
  stays until the next operation starts. `resident.loaded_by_server` is true for a model this
  server loaded.
- Types: shared/api.ts (`Operation`, `OperationResponse`, `StateResponse`) — read only.
- Confirmation (`confirm`, `409 confirmation_required`) is milestone M2c: do not implement it.

Current state (context not obvious from the code):
- mobile/src/api/client.ts `loadModel`/`unloadModel` exist but map every non-OK, non-401
  response to a generic `Error(statusText)` and drop the server's `{error, message}` body.
- mobile/src/app/models.tsx is read-only (its header comment says Load/Unload are M2b).
- `.tsx` modules cannot be imported by bun tests; put logic in pure `.ts` modules under
  mobile/src/ui/ (as modelList.ts and streamReducer.ts already are) and test those.

Acceptance Criteria:
- C2 client: `loadModel`/`unloadModel` throw an exported typed error (e.g. `ServerError` with
  `code` = body `error` and `message` = body `message`) for non-OK responses other than 401; 401
  still throws `UnauthorizedError`. `getState` behaviour unchanged.
- New pure helper (e.g. mobile/src/ui/modelActions.ts): given a client, a start call (load or
  unload), and injectable `sleep`/interval/max-wait, calls start, then polls `getState()` until
  `operation.kind === "idle"`, reporting each polled state through a callback, and returns the
  final state. Errors from start propagate unchanged. Exceeding max wait rejects with a clear error.
- View-model (mobile/src/ui/modelList.ts) additionally yields: a busy label ("Loading <model>…" /
  "Unloading <model>…") or null when idle; a failure message (the `operation.error` text, when
  idle with an error) or null; per row, whether Load is available (not resident, not busy);
  whether Unload is available (something resident, not busy). Existing fields unchanged.
- Screen (mobile/src/app/models.tsx): Load button on each eligible row, one Unload button when
  something is resident, both disabled while busy; busy label and failure message rendered;
  `ServerError` messages shown to the user; 401 behaves as today (route to setup). Update the
  header comment.
- Tests first (Red → Green): client.test.ts (typed error from `{error,message}` body for 404/409;
  401 unchanged), modelActions.test.ts (polls until idle with fake sleep; returns final state with
  error; propagates start errors; max-wait rejection), modelList.test.ts (busy labels, failure
  message, load/unload availability). Existing tests pass unchanged.

Relevant Files:
- mobile/src/api/client.ts, mobile/src/api/client.test.ts
- mobile/src/ui/modelList.ts, mobile/src/ui/modelList.test.ts
- mobile/src/app/models.tsx
- mobile/src/chat/chatController.ts (context: existing error-wording pattern, UNAUTHORIZED_MESSAGE)

Files Allowed To Change:
- mobile/src/api/client.ts, mobile/src/api/client.test.ts
- mobile/src/ui/modelList.ts, mobile/src/ui/modelList.test.ts
- mobile/src/ui/modelActions.ts (new), mobile/src/ui/modelActions.test.ts (new)
- mobile/src/app/models.tsx

Constraints:
- Existing patterns (Expo, expo-router, TypeScript strict, bun test); no new dependencies.
- No hardcoded model names in mobile/src.
- Do not implement the confirmation rule (M2c). Do not change shared/api.ts.
- Do not touch server/, ops/, shared/, .harness/ (except your log). Do not commit. Do not restart
  any live service and do not call the live server or Ollama.
- Do not weaken or delete existing tests.

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2/mobile && bun run typecheck && bun test src/api src/ui src/chat src/app-routing && bun run lint && bun run smoke:runtime
Write complete output to /Users/ryankenny/Projects/CodingHarnessv2/.harness/evidence/M2b-T2-worker.log.

Return: the worker return contract (Summary, Files changed, Tests run, Test result, Unresolved issues).
