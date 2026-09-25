TASK M2c-T2 — Phone busy warning: Load/Unload show the server's confirmation reasons, confirming retries with confirm:true, cancelling changes nothing

Routing: tier Mid, model sonnet, reason_code ORDINARY_IMPLEMENTATION
  detail: extends the existing typed client, the pure model-action helper and the Models screen with one confirmation round-trip against a fixed server contract; ordinary implementation with a clear test oracle.

Goal:
When the user taps Load or Unload and the server answers `409 confirmation_required`, the app
shows a warning built from the server's reasons and asks the user to confirm. Confirm → the app
repeats the same request with `confirm: true` and polls to the end as today. Cancel → the app
sends nothing more, leaves the screen as it was (no busy label, no error), and the server state is
untouched. The "not loaded by this app" case is labelled in the UI as a best guess, because
Ollama cannot tell whether another tool is using the model.

Relevant Requirements:
FR6 — /Users/ryankenny/Projects/CodingHarnessv2/.harness/requirements.md lines 30-34
("Ollama exposes no 'in use' signal, so (b) is the best available approximation and is labelled
as such in the UI").
Milestone criterion M2-AC4 — .harness/milestones.md, section "## M2c".
Architecture: /Users/ryankenny/Projects/CodingHarnessv2/.harness/architecture.md — C1 (50-56),
C2 (58-66), interfaces (143-184; C2 maps errors to typed outcomes incl. `confirmation_required`).

Server contract (being implemented in parallel by another task; code against it, not the server):
- `POST /v1/models/load {name, confirm?: boolean}` and `POST /v1/models/unload {confirm?: boolean}`
  may answer `409 {error:"confirmation_required", message:<sentence>, reasons:[...]}` where
  `reasons` ⊆ `["reply_in_progress", "not_loaded_by_server"]` (non-empty, may hold both).
- The same request with `confirm: true` answers `202 {operation}` (or the other existing errors).
- Types: shared/api.ts already has `LoadRequest.confirm?`, `UnloadRequest.confirm?`,
  `ConfirmationRequiredError {reasons}` — read only, do not change shared/.

Current state (context not obvious from the code):
- mobile/src/api/client.ts: `loadModel`/`unloadModel` throw `ServerError(code, message)` for
  non-OK non-401 responses, dropping any extra body fields such as `reasons`.
- mobile/src/ui/modelActions.ts `runModelAction({start, getState, onPoll, ...})` calls `start()`
  once and propagates its errors.
- mobile/src/app/models.tsx `runAction(start, startingBusyLabel)` sets the busy label before
  starting and shows `ServerError.message` on failure; it already uses `Alert.alert`.
- `.tsx` modules cannot be imported by bun tests: keep logic in pure `.ts` modules under
  mobile/src/ui/ or mobile/src/api/ and test those.

Acceptance Criteria:
- C2: a 409 whose body `error` is `confirmation_required` throws an exported typed error (e.g.
  `ConfirmationRequiredError extends ServerError`, `code` "confirmation_required", plus
  `reasons`), so existing `instanceof ServerError` handling still works. Other errors unchanged.
  `loadModel`/`unloadModel` send `confirm` in the body only as given by the caller.
- Pure warning text (e.g. in mobile/src/ui/): given the reasons (and the resident model name when
  known), returns a title and a message in plain words. `reply_in_progress` says a reply is still
  being written and continuing will stop it. `not_loaded_by_server` says the loaded model was not
  loaded by this app so another program on the Mac may be using it, and explicitly says this is a
  best guess because Ollama cannot tell whether it is in use. Both reasons → both sentences.
- Confirmation flow (pure, testable; e.g. extend `runModelAction` with an injected
  `confirm(reasons) => Promise<boolean>` and a `start(confirm: boolean)`): first call unconfirmed;
  on `ConfirmationRequiredError`, ask; if the user confirms, call start again with confirm true,
  then poll as today; if the user declines, make no further call, do not poll, and resolve to a
  distinct "cancelled" outcome (not an error). Any other error propagates unchanged.
- Screen: the busy label must not appear while the dialog is up or after a cancel; Cancel leaves
  rows, resident label, busy label and failure/error messages as they were before the tap. The
  dialog is an `Alert.alert` with a Cancel button (style "cancel") and a confirm button that says
  what will happen ("Load anyway" / "Unload anyway").
- mobile/scripts/model-swap-proof.ts and mobile/scripts/model-failed-load-proof.ts are live proofs
  that deliberately swap/unload; after this change an unconfirmed request can be refused (e.g. a
  model resident since before a server restart). Make them pass confirm so they still perform
  their swap. Do not run them (they call the live server).
- Tests first (Red → Green): client.test.ts (typed error with reasons from a 409 body; confirm sent
  in body), modelActions.test.ts (confirm path retries with confirm true then polls; decline makes
  exactly one start call, zero polls, returns cancelled; other errors propagate), a test for the
  warning text (each reason, both, best-guess wording present). Existing tests pass unchanged.

Relevant Files:
- mobile/src/api/client.ts, mobile/src/api/client.test.ts
- mobile/src/ui/modelActions.ts, mobile/src/ui/modelActions.test.ts
- mobile/src/app/models.tsx
- mobile/scripts/model-swap-proof.ts, mobile/scripts/model-failed-load-proof.ts

Files Allowed To Change:
- mobile/src/api/client.ts, mobile/src/api/client.test.ts
- mobile/src/ui/modelActions.ts, mobile/src/ui/modelActions.test.ts
- mobile/src/ui/confirmation.ts (new), mobile/src/ui/confirmation.test.ts (new)
- mobile/src/app/models.tsx
- mobile/scripts/model-swap-proof.ts, mobile/scripts/model-failed-load-proof.ts

Constraints:
- Existing patterns (Expo, expo-router, TypeScript strict, bun test); no new dependencies.
- No hardcoded model names in mobile/src.
- Do not touch server/, ops/, shared/, .harness/ (except your log). Do not commit.
- Do not restart any live service and do not call the live server or Ollama.
- Do not weaken or delete existing tests. Do not change how a stale `operation.error` is shown
  (a separate follow-up).

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2/mobile && bun run typecheck && bun test src/api src/ui src/chat src/app-routing && bun run lint && bun run smoke:runtime
Write complete output to /Users/ryankenny/Projects/CodingHarnessv2/.harness/evidence/M2c-T2-worker.log.

Return: the worker return contract (Summary, Files changed, Tests run, Test result, Unresolved issues).
