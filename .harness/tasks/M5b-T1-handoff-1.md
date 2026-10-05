# M5b-T1 handoff (attempt 3, mid-task turn-limit stop)

## Status by Acceptance Criteria

1. **DONE.** `mobile/src/api/errorMessages.ts` created with all constants/functions:
   `UNREACHABLE_MESSAGE`, `OLLAMA_DOWN_MESSAGE`, `UNAUTHORIZED_MESSAGE`,
   `REPLY_IN_PROGRESS_MESSAGE`, `loadFailedMessage`, `notInstalledMessage`,
   `describeError`, `describeOperationFailure`. Verified against the exact
   strings in the task packet.

2. **DONE.** `mobile/src/api/client.ts`:
   - New exported `UnreachableError` class.
   - `getState`, `loadModel`, `unloadModel`, `chat` (initial POST),
     `cancelGeneration` each wrap their initial `fetchImpl` call in an inline
     `try/catch` (NOT a shared async helper -- see note below) that rethrows
     as `UnreachableError` unless the request's own `signal` was already
     aborted (helper: private `rethrowFetchFailure(error, signal?)`).
   - `getState` and `chat` non-OK handling rewritten to parse the JSON
     `{error, message}` body and throw `ServerError(code, message)`; 401
     still throws `UnauthorizedError`; chat's 409 `model_not_resident` still
     throws `ModelNotResidentError` (checked before the generic ServerError
     fallback, using the same parsed body -- important: the body is only
     read once via `parseErrorBody`, do not call `response.json()` a second
     time on the same response).
   - Resume/retry loop (`resumeStream`, `readSSEStream`) left untouched, per
     the packet's explicit scope limit.

   **IMPORTANT gotcha hit and fixed:** an earlier version of this used a
   shared `private async fetchOrUnreachable(...)` helper that all five
   methods awaited. That extra async-function hop shifts microtask timing by
   one tick and broke 5 of the existing foreground/resume tests in
   `client.test.ts` (tests literally titled "unsubscribes from the lifecycle
   on completion", "(g) foreground events never POST /cancel...", etc.) --
   they use a zero-flush `waitFor` that is sensitive to exact tick counts.
   Fixed by inlining the `try { await this.fetchImpl(...) } catch { this.rethrowFetchFailure(error, signal) }`
   pattern directly in each method instead of factoring it into a separate
   `async` method. **If resuming work touches client.ts again, keep this
   inline pattern -- do not reintroduce a wrapping async helper for the
   fetch call itself.** Confirmed green after the fix: `bun test
   src/api/client.test.ts src/api/errorMessages.test.ts` -> 51 pass, 0 fail.

3. **DONE.** `shared/api.ts`: `Operation` gained optional
   `error_code?: "ollama_down" | "unknown_model" | "load_failed"`.
   **`server/src/models/manager.ts` is NOT yet touched** -- this is the
   biggest remaining piece of AC3. Still needed:
   - Add a helper (e.g. `errorCodeForLoadFailure(error): "ollama_down" |
     "unknown_model" | "load_failed"`) mirroring `reasonForError`'s branches
     (see manager.ts ~line 113): OllamaError with status 404 or /not found/i
     -> `"unknown_model"`; other OllamaError or `WaitTimeoutError` ->
     `"load_failed"`; anything else (network reject) -> `"ollama_down"`.
   - In `runLoad` (manager.ts ~line 214-247), add `error_code:
     errorCodeForLoadFailure(error)` to **both** `this.finish({...})` calls
     that end a LOAD with an error (the `stopActiveReply` catch, and the main
     try/catch around unload-sweep + load).
   - Do **not** touch `runUnload`'s `finish(...)` call -- unload failures
     must leave `error_code` unset, per the packet.

4. **PARTIALLY DONE.**
   - `mobile/src/ui/modelList.ts`: DONE -- `failureMessage` now computed via
     `describeOperationFailure(state.operation)` (guarded by `isBusy` as
     before). Import added: `import { describeOperationFailure } from
     "@/api/errorMessages";`.
   - `mobile/src/chat/chatController.ts`: DONE -- `UNAUTHORIZED_MESSAGE` now
     imported from `@/api/errorMessages` and re-exported (`export {
     UNAUTHORIZED_MESSAGE };`) so existing importers (models.tsx, chat.tsx)
     keep working unchanged. Text unchanged ("Password wrong or changed").
   - `mobile/src/app/models.tsx`: PARTIALLY DONE.
     - Import changed: removed `ServerError` from the `@/api/client` import
       (now just `UnauthorizedError`), added `import { describeError } from
       "@/api/errorMessages";`.
     - First catch block (in `load()`, the general `getState` refresh
       failure): DONE -- `setErrorMessage(describeError(error))`.
     - `runAction`'s signature: DONE -- gained a 4th optional param
       `loadingModelName?: string`.
     - `runAction`'s catch block: DONE -- `setErrorMessage(describeError(error,
       loadingModelName))`. This fixed a compile break (the old ternary
       referenced the now-unimported `ServerError`).
     - **STILL TODO:** `handleLoad(name)` does not yet pass `name` as the 4th
       argument to `runAction(...)`, so `loadingModelName` is always
       `undefined` there right now (not a compile error, just an incomplete
       AC: the load-failure messages that name the model --
       `notInstalledMessage`/`loadFailedMessage` -- will currently render
       with their "unknown model" fallback text instead of naming the
       model). Fix: in `handleLoad`, change the `runAction(...)` call to add
       `name` as a 4th argument (mirrors the packet's "model name being
       loaded, if any"). `handleUnload`'s call should NOT pass a model name
       (leave its `runAction(...)` call as-is, 3 args).
   - `mobile/src/app/chat.tsx`: **NOT STARTED.** `onError` (around original
     line 171) is still `Alert.alert("Error", error.message);` and must
     become `Alert.alert("Error", describeError(error));` with `import {
     describeError } from "@/api/errorMessages";` added. Title stays
     `"Error"` per the packet.

5. **NOT DONE / NOT STARTED for these pieces:**
   - `errorMessages.test.ts` (new): DONE -- covers all six messages, the
     ServerError-code switch, the fallback branch, and pairwise-distinctness.
     Passing (see `bun test` result above).
   - `client.test.ts`: NOT extended yet with the specific tests the packet
     calls out: "throws UnreachableError when fetch rejects with a
     TypeError" (pick any one of getState/loadModel/chat -- e.g. `getState`
     with `fetchImpl: mock(async () => { throw new TypeError("fetch
     failed"); })`, `await expect(client.getState()).rejects.toBeInstanceOf(UnreachableError)`),
     "ServerError('ollama_down') for a 503 `/v1/state`" (jsonResponse({error:
     "ollama_down", message: "..."}, 503) from getState), "ServerError('generation_in_flight')
     for a 409 chat with that code" (jsonResponse({error:
     "generation_in_flight", message: "..."}, 409) from the initial chat
     POST -- the existing `sseResponse`/fake-fetch helpers in that file are
     the pattern to copy). All existing tests in this file currently pass
     unmodified (51 pass, 0 fail with errorMessages.test.ts included) -- no
     before/after changes needed there.
   - `modelList.test.ts`: NOT extended yet. Needs at least one test giving
     `operation.error_code` (e.g. `"unknown_model"`) alongside `error` and
     asserting `view.failureMessage` equals `notInstalledMessage(...)`'s
     output, to prove the mapping (not just the raw string) is now used.
     The existing test at ~line 175 ("reports the failure reason from a load
     that ended idle with an error...") has NO `error_code` set on its
     operation fixture, so it still asserts the raw string unchanged --
     that's correct per the packet (error_code absent -> raw error), do not
     modify that test.
   - `manager.test.ts`: NOT extended yet. Needs `error_code` assertions
     added to the existing load-failure tests (~lines 305, 320, 334, 348) and
     to the `"while cancelling a confirmed reply the operation stays
     claimed"` parameterized test (~line 590, only for `label === "load"`;
     for `label === "unload"` assert `error_code` stays `undefined`).

## Files changed so far
- `mobile/src/api/errorMessages.ts` (new)
- `mobile/src/api/errorMessages.test.ts` (new)
- `mobile/src/api/client.ts`
- `mobile/src/chat/chatController.ts`
- `mobile/src/ui/modelList.ts`
- `mobile/src/app/models.tsx`
- `shared/api.ts`

Files touched by the packet but NOT yet changed: `mobile/src/app/chat.tsx`,
`server/src/models/manager.ts`, `mobile/src/api/client.test.ts`,
`mobile/src/ui/modelList.test.ts`, `server/src/models/manager.test.ts`.

## Last test commands run and results
- `cd mobile && bun test src/api/client.test.ts src/api/errorMessages.test.ts`
  -> **51 pass, 0 fail** (this was run AFTER the tick-timing fix described
  under AC2; it is the last thing verified).
- `cd mobile && bun run typecheck` -> was run once, BEFORE the `shared/api.ts`
  `error_code` field existed and BEFORE the models.tsx fixes in this
  handoff's last two edits. It reported 4 errors, all expected at that point
  (missing `error_code` on `Operation`, since `shared/api.ts` hadn't been
  edited yet): `errorMessages.test.ts` x3 and `errorMessages.ts` x1, all
  `TS2353`/`TS2339` on `error_code`. **`bun run typecheck` has NOT been
  re-run since** the `shared/api.ts` edit (which should fix those 4) or since
  the two `models.tsx` edits in this handoff's final steps. **Re-run
  `bun run typecheck` first thing** on resume to see current true state --
  it may well be clean now, or may surface something in models.tsx/chat.tsx.

## Recommended next steps, in order
1. `cd mobile && bun run typecheck` -- confirm clean (or fix what it shows;
   `chat.tsx` not having been touched yet should not itself cause new
   errors, since `describeError` isn't imported there).
2. Finish `models.tsx`: pass `name` into `runAction(...)` from `handleLoad`.
3. Finish `chat.tsx`: import `describeError`, change `onError`.
4. Implement the `server/src/models/manager.ts` `error_code` change (AC3)
   exactly as described above.
5. Extend the four test files listed under AC5 above.
6. Run the full validation command from the task packet:
   `cd /Users/ryankenny/Projects/CodingHarnessv2 && (cd server && bun test &&
   bun run typecheck) && (cd mobile && bun run typecheck && bun test
   src/store src/api src/ui src/chat src/app-routing && bun run lint)`
   and save output to `.harness/evidence/M5b-T1-worker.log`.
7. Return the packet's before/after list: none expected (no existing test
   currently asserts the old raw "Can't reach the Mac" fallback string or any
   other superseded message -- verified by grep during this attempt).

## Unresolved issues / judgment calls made (confirm or revisit on resume)
- `describeError`'s final fallback for a thrown non-`Error` value returns
  `String(error)` (not literally specified by the packet, which only says
  "the error's own message" for the ServerError/Error cases). This is an
  edge case unlikely to be exercised; flagged here rather than treated as
  settled.
- Chose to re-export `UNAUTHORIZED_MESSAGE` from `chatController.ts` (rather
  than move all its usages) to minimize churn in `models.tsx`/`chat.tsx`,
  which both still import it from `@/chat/chatController`. This matches the
  packet's "re-export or move it" option.
