TASK M5b-T1 — Plain-language error mapping, end to end in code (server code field + app client + screens)

Routing: tier Mid, model sonnet, reason_code ORDINARY_IMPLEMENTATION
  detail: ordinary feature work across the app client, two screens and one small server field;
  every outcome has a stated string and a unit-test oracle, but it spans ~8 files.

Goal:
Every one of six failure modes reaches the user as its own fixed plain-language sentence, produced
by ONE mapping module in the app client, and the Models and Chat screens show that sentence instead
of raw error text.

Relevant Requirements:
- FR16 (.harness/requirements.md line 65): distinct user-facing messages for Mac/server
  unreachable, Ollama down, wrong password, model failed to load, model no longer installed, and a
  reply already in progress.
- Architecture (.harness/architecture.md lines 58-66, 143-176): C2 "maps every error to a typed,
  user-facing outcome"; I1 typed errors include `unreachable`, `ollama_down`, `unknown_model`,
  `generation_in_flight`, `load_failed`, `unauthorized`. Error bodies are `{error, message, ...}`.

The six messages (use these EXACT strings, exported as constants from the new module):
- UNREACHABLE_MESSAGE      = "Can't reach the Mac. Check that it's on and that this phone is connected to Tailscale."
- OLLAMA_DOWN_MESSAGE      = "The Mac is reachable, but Ollama isn't running on it."
- UNAUTHORIZED_MESSAGE     = "Password wrong or changed"   (already exists in mobile/src/chat/chatController.ts;
                             keep that export working — re-export or move it, do not change its text)
- loadFailedMessage(model) = `Couldn't load ${model}. Ollama failed to start it.`
                             (model unknown → "Couldn't load the model. Ollama failed to start it.")
- notInstalledMessage(model) = `${model} is no longer installed on the Mac. Pull down to refresh the list.`
                             (model unknown → "That model is no longer installed on the Mac. Pull down to refresh the list.")
- REPLY_IN_PROGRESS_MESSAGE = "A reply is already being written. Wait for it to finish, or stop it first."

Acceptance Criteria:
1. New module `mobile/src/api/errorMessages.ts` exports the constants/functions above plus:
   - `describeError(error: unknown, model?: string): string` —
     UnauthorizedError → UNAUTHORIZED_MESSAGE; UnreachableError (new, see 2) → UNREACHABLE_MESSAGE;
     ServerError code `ollama_down` → OLLAMA_DOWN_MESSAGE; code `unknown_model` →
     notInstalledMessage(model); code `generation_in_flight` → REPLY_IN_PROGRESS_MESSAGE;
     code `load_failed` → loadFailedMessage(model); anything else → the error's own message
     (fallback unchanged from today's behaviour).
   - `describeOperationFailure(operation: Operation): string | null` — null when no `error`;
     otherwise by `operation.error_code` (see 3): `ollama_down` → OLLAMA_DOWN_MESSAGE,
     `unknown_model` → notInstalledMessage(operation.model), `load_failed` →
     loadFailedMessage(operation.model); if `error_code` is absent, return `operation.error`
     unchanged (unload failures and older servers).
2. `mobile/src/api/client.ts`: a fetch that rejects for a network reason (not an abort caused by
   the caller's signal) in `getState`, `loadModel`, `unloadModel`, `chat` (initial POST) and
   `cancelGeneration` is rethrown as a new exported `UnreachableError`. Non-OK responses from
   `getState` and `chat` with a JSON `{error, message}` body throw `ServerError(code, message)`
   (401 stays `UnauthorizedError`; chat 409 `model_not_resident` stays `ModelNotResidentError`).
   Resume/retry-after-drop behaviour (M4b/M4c) must not change: the streaming reader's own
   drop/resume paths are out of scope — only the initial request of each method.
3. Server: `shared/api.ts` `Operation` gains optional
   `error_code?: "ollama_down" | "unknown_model" | "load_failed"`. In
   `server/src/models/manager.ts`, wherever a LOAD ends with `error` set, also set `error_code`
   per `reasonForError`'s branch: network/unreachable → `ollama_down`; 404/"not found" →
   `unknown_model`; memory or any other failure → `load_failed`. `error` strings stay exactly as
   they are. Unload failures may leave `error_code` unset.
4. Screens: `mobile/src/ui/modelList.ts` `failureMessage` uses `describeOperationFailure`.
   `mobile/src/app/models.tsx` sets `errorMessage` via `describeError(error, <model name being
   loaded, if any>)` in both catch blocks (the "Can't reach the Mac" literal fallback is replaced by
   the mapping). `mobile/src/app/chat.tsx` `onError` shows `describeError(error)` (title may stay
   "Error"). `mobile/src/chat/chatController.ts` behaviour is otherwise unchanged.
5. Unit tests (bun test) prove: each of the six failure inputs maps to its exact string; all six
   strings are pairwise distinct; the client throws `UnreachableError` when fetch rejects with a
   TypeError, and `ServerError('ollama_down')` for a 503 `/v1/state`, and
   `ServerError('generation_in_flight')` for a 409 chat with that code; the server sets
   `error_code` for each load-failure branch (extend the existing manager tests); modelList's
   failureMessage uses the mapping. Existing tests keep passing unmodified except where a test
   asserted the old raw message for exactly these paths — any such change must be listed in your
   return with before/after.

Relevant Files:
- mobile/src/api/client.ts (UnauthorizedError ~171, ServerError ~197, assertOk ~266, assertLoadUnloadOk ~279, chat ~348)
- mobile/src/api/client.test.ts
- mobile/src/chat/chatController.ts (UNAUTHORIZED_MESSAGE line 27)
- mobile/src/ui/modelList.ts (failureMessage ~71), mobile/src/ui/modelList.test.ts
- mobile/src/app/models.tsx (catch blocks ~91-104, ~152-163), mobile/src/app/chat.tsx (onError ~171)
- shared/api.ts (Operation line 17)
- server/src/models/manager.ts (reasonForError ~113, finish calls ~219 and in runLoad), server/src/models/manager.test.ts
- server/src/http/server.ts (read only; ollama_down/unknown_model/generation_in_flight codes already emitted)

Files Allowed To Change:
- mobile/src/api/errorMessages.ts (new), mobile/src/api/errorMessages.test.ts (new)
- mobile/src/api/client.ts, mobile/src/api/client.test.ts
- mobile/src/chat/chatController.ts, mobile/src/chat/chatController.test.ts
- mobile/src/ui/modelList.ts, mobile/src/ui/modelList.test.ts
- mobile/src/app/models.tsx, mobile/src/app/chat.tsx
- shared/api.ts
- server/src/models/manager.ts, server/src/models/manager.test.ts

Constraints:
- Follow existing repository patterns (error classes in client.ts, pure helpers under mobile/src/ui).
- Do not change unrelated behaviour. Do not introduce dependencies. Do not weaken tests.
- Do not touch any live service (no launchctl, no ollama commands). This task is code + unit tests only.
- Never git stash, commit, or push; leave changes in the working tree.

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2 && (cd server && bun test && bun run typecheck) && (cd mobile && bun run typecheck && bun test src/store src/api src/ui src/chat src/app-routing && bun run lint)
Save the full output to .harness/evidence/M5b-T1-worker.log.
If you near your turn limit, return CONTINUE with a handoff at .harness/tasks/M5b-T1-handoff-1.md.

Return:
- Summary
- Files changed
- Tests run
- Test result (with exit status)
- Unresolved issues
