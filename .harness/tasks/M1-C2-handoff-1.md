# M1-C2 handoff (attempt 3, turn-limit CONTINUE)

## Files changed so far (all within Files Allowed To Change)

- `mobile/app.json` — added `expo.extra.serverUrl` =
  `https://ryans-mac-studio.tailc3648a.ts.net:8443`.
- `mobile/src/api/config.ts` (new) — `DEFAULT_SERVER_URL` constant and pure
  `resolveServerUrl(extra)` helper (no expo-constants import, so it is bun-test
  safe).
- `mobile/src/api/config.test.ts` (new) — asserts `app.json`'s
  `expo.extra.serverUrl` equals `DEFAULT_SERVER_URL`, `resolveServerUrl`
  behaviour, and that an `APIClient` built with the resolved URL actually
  sends requests there (F1). Passing.
- `mobile/src/api/expoFetchClient.ts` — now imports `expo-constants`, exports
  `SERVER_URL = resolveServerUrl(Constants.expoConfig?.extra)`, and
  `createAPIClient(baseUrl = SERVER_URL)` defaults to it.
- `mobile/src/api/client.ts` — added optional `onStart?: (generationId) =>
  void` to `StreamOptions`; `chat()` now calls it right after the
  `x-generation-id` header is read, before the body is read (F3). Existing
  tests in `client.test.ts` untouched and still pass.
- `mobile/src/chat/chatController.ts` (new) — the extracted testable
  send/stop module: `sendMessage(client, messages, callbacks)` calls
  `GET /v1/state` first, sends to `resident.name` if present, otherwise
  calls `callbacks.onBlocked(NO_MODEL_LOADED_MESSAGE)` and makes no
  `/v1/chat` call (F2). `stopGeneration(client, id)` only POSTs the cancel
  route; it does not touch the fetch (F3).
- `mobile/src/chat/chatController.test.ts` (new) — unit tests for the above.
  **One test is currently failing, see below.**
- `mobile/src/app/chat.tsx` — rewritten to be thin wiring over
  `chatController`: `createAPIClient()` (no hardcoded localhost URL), token
  is still re-read before every send (AC2 preserved), `onStart` sets
  `generationId` as soon as it arrives, `onBlocked` sets a new
  `blockedMessage` state rendered as a banner ("No model loaded"), `handleStop`
  now just calls `stopGeneration` (no `AbortController` any more — it was only
  used for the old abort-then-cancel Stop path, which F3 explicitly forbids).
  `generationId`/`isLoading` are cleared only in the `finally` after
  `sendMessage` resolves, i.e. once the stream has actually ended.

## Acceptance criteria status

- F1 (configured URL, no localhost outside tests): **done**. `config.test.ts`
  passes; grepped `mobile/src` for `localhost` — only remaining hit is in
  `client.test.ts` (a test file, allowed).
- F2 (resident model / blocked state, unit tested): **implemented**, one of
  its two `chatController.test.ts` cases passes (resident model is sent); the
  "blocks sending" case passes too. Both are in the "F2" describe block and
  were green in the last run.
- F3 (`onStart` header exposure, Stop does not abort, cancel POST with right
  id, terminal `done{status:"cancelled"}`, no content after): **implemented**
  in `client.ts` and `chatController.ts`, but **its unit test
  (`chatController.test.ts`, "stopGeneration (F3: ...)" describe block) is
  currently failing** — see "Known failure" below. The production code path
  (chat.tsx, chatController.ts, client.ts) looks correct on inspection; the
  bug is most likely in the test's synchronization, not the implementation.
- chat.tsx thin wiring / AC2 token re-read preserved: **done** (see above).
- mobile typecheck / tests / lint / iOS export all passing: **not yet** — see
  exact command output below.

## Exact validation state (this commit, working tree as described above)

Commands run from `/Users/ryankenny/Projects/CodingHarnessv2/mobile`:

1. `bun run typecheck` → **exit 0**, no errors.
2. `bun test src` → **22 tests, 21 pass, 1 fail**:
   - Failing test: `src/chat/chatController.test.ts` →
     `stopGeneration (F3: Stop cancels without aborting the fetch) > POSTs
     cancel with the right id; the stream keeps reading to the terminal
     cancelled event; no content applied after it`
   - Failure: `expect(result.started).toBe("gen-7")` — received `null`.
   - Likely cause: the test's `await Promise.resolve()` x4 spin is not enough
     microtask turns for `sendMessage`'s two sequential awaited fetches
     (`GET /v1/state` then `POST /v1/chat`, each itself an `await
     this.fetchImpl(...)` inside `APIClient`) plus the `onStart` callback to
     have fired before the assertion. The `client.test.ts` "Stop" test in the
     existing suite uses two `await Promise.resolve()` calls but only waits
     on a *single* fetch (the chat POST directly), not a state call followed
     by a chat call — this new test has one more async hop
     (`getState()` fetch  chat() fetch) than that pattern accounted for.
     The fix is almost certainly to await the mock's own promise resolution
     more directly (e.g. have the test `await` a deferred that resolves when
     `onStart` fires, or increase/replace the `Promise.resolve()` spin with a
     `setTimeout(resolve, 0)` as the same test already does later for the
     content push) rather than to change production code. Do **not** change
     `client.ts`/`chatController.ts` production logic to chase this — inspect
     the test's synchronization first.
3. `bun run lint` → **exit 1**, 3 errors, all in the new
   `chatController.test.ts`, all "Strings must use doublequote quotes"
   (single-quoted SSE literal strings like `'event: content\ndata:
   ...\n\n'`). Fix: change those three single-quoted string literals to
   double quotes (or backticks per the file's existing convention — the rest
   of the repo's test files use double quotes for these SSE literal strings,
   see `client.test.ts` chunk1/chunk2/chunk3). Lines (may drift slightly if
   the file is edited): 114, 211, 230 in
   `mobile/src/chat/chatController.test.ts`.
4. `npx expo export --platform ios` → **not yet run** (blocked behind the
   above two fixes; no reason to expect it to fail once tests/lint are green,
   since it did not touch anything export-relevant, but it has not been
   validated this attempt).

## Exact next steps for whoever picks this up

1. Fix the 3 lint errors in `mobile/src/chat/chatController.test.ts` (quote
   style only, mechanical).
2. Fix the failing `chatController.test.ts` F3 test's synchronization (see
   above) so `result.started` is `"gen-7"` before the assertion — most likely
   by awaiting more microtasks/a macrotask tick after the `sendMessage` call
   starts and before asserting `onStart` fired, consistent with how
   `client.test.ts`'s own cancellation test already uses `await new
   Promise((r) => setTimeout(r, 0))` for exactly this kind of "let the event
   loop catch up" wait.
3. Re-run, in order, from `/Users/ryankenny/Projects/CodingHarnessv2/mobile`:
   `bun run typecheck && bun test src && bun run lint && npx expo export
   --platform ios && rm -rf dist`. Capture full output to
   `.harness/evidence/M1-C2-worker.log` per the task packet.
4. Double check `mobile/src` still has no `localhost` base URL outside test
   files (`grep -rn "localhost" mobile/src`) — it did not as of this
   handoff.
5. Nothing in `server/`, `ops/`, or `.harness/` (other than this handoff and
   the eventual evidence log) was touched or should be.

## Notes

- `.harness/milestones.md` shows as modified in `git status` but was not
  touched by this task; that appears to be pre-existing working-tree state
  from before this task started (not this worker's change) — do not revert
  it without checking with the orchestrator, per the "never discard another
  agent's uncommitted work" rule.
- `server/`, `ops/` changes visible in `git status` are from a concurrent
  worker per the task packet's constraints; not touched here.
