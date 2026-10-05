TASK M2b-C1 — Close the race in ModelManager.unload(): claim the operation before any await (review finding F1)

Routing: tier Mid, model sonnet, reason_code NOT_LOW_RISK
  detail: a single-threaded async race in C5's single-flight operation; the fix is specified and has a
  deterministic test oracle, but a wrong fix is hard to notice live, so not Cheap. Not difficult
  concurrency (one event loop, one flag), so not Top.

Goal:
Two overlapping calls into the model manager can no longer both be accepted. `ModelManager.unload()`
must claim the operation synchronously, in the same tick as its `isBusy()` check, before any `await`.
After the fix, starting `m.unload()` and `m.unload()` without awaiting in between, or `m.load(x)` and
`m.unload()` without awaiting in between, results in exactly one fulfilled call and the other rejecting
with `OperationInProgressError`.

Finding:
F1 (IMPORTANT) in /Users/ryankenny/Projects/CodingHarnessv2/.harness/reviews/M2b-cycle1.md lines 32-64.
Read it: it states the defect, the reviewer's reproduction, and the suggested correction.

Relevant Requirements:
FR3, FR5 — /Users/ryankenny/Projects/CodingHarnessv2/.harness/requirements.md lines 23-29.
Architecture: /Users/ryankenny/Projects/CodingHarnessv2/.harness/architecture.md — C5 (lines 84-90) owns
serialising load/unload; interfaces I4/I5 promise `409 operation_in_progress` (lines 143-184).

Current state (context not obvious from the code):
- `unload()` in server/src/models/manager.ts does: `isBusy()` check → `await this.ollama.ps()` to find the
  resident name → sets `operation = {kind:"unloading", model}` → `void this.runUnload()`. The window is
  the `await ps()`.
- `load()` already runs its busy check and its claim synchronously after its only await (the tags
  lookup). Keep that property; do not reorder `load()` so its busy check moves before an await without
  the claim also moving with it.
- The operation shape is `Operation` in shared/api.ts (do not change it): `{kind:"unloading", model?}`
  is valid without `model`.

Acceptance Criteria:
- `unload()`: after `isBusy()` passes, set `this.operation = {kind:"unloading"}` synchronously (no await
  between the check and the assignment). Then resolve the resident name (for example by awaiting
  `ps()` and filling in `operation.model`, or by moving the lookup into `runUnload()`), and start the
  background unload. Either shape is acceptable.
- If the resident-name lookup fails after the claim, the operation must not stay stuck at "unloading":
  it ends `{kind:"idle", error:<reason>}` using the existing reason mapping (for example "Ollama
  unreachable"), consistent with how `runUnload()` failures are reported today; and `unload()`'s
  resolved/rejected behaviour for callers stays as it is today for that case (read the current code and
  the existing tests; do not change the HTTP route's status codes).
- The value `unload()` returns (the operation passed to `202 {operation}`) is still
  `{kind:"unloading", ...}`, with `model` set when a model was resident, as today.
- No existing behaviour covered by the current tests changes.
- Tests first (Red → Green) in server/src/models/manager.test.ts, using the file's existing fake Ollama
  with an injected delay so each call really awaits (for example 20 ms latency on `ps`/`tags`):
  - `Promise.allSettled([m.unload(), m.unload()])` → exactly one fulfilled, the other rejected with
    `OperationInProgressError`; the fake saw one unload sweep, not two.
  - `Promise.allSettled([m.load(x), m.unload()])` (x a model in tags, another model resident) → exactly
    one fulfilled, the other rejected with `OperationInProgressError`; after the accepted operation
    settles, state is consistent with that operation alone (if the unload won: nothing resident; if the
    load won: only x resident) and `operation` is `{kind:"idle"}` with no error.
  - Confirm the two new tests FAIL against the current code before you fix it, and record that in your
    log.
  - If the unload resident lookup failure path is new behaviour, add a test for it.
- Optionally, in server/src/http/server.test.ts, one test firing two `POST /v1/models/unload` requests
  concurrently (no await between) and asserting one 202 and one 409 `operation_in_progress`.

Relevant Files:
- server/src/models/manager.ts, server/src/models/manager.test.ts
- server/src/http/server.ts, server/src/http/server.test.ts (context; optional test)
- shared/api.ts (read only)

Files Allowed To Change:
- server/src/models/manager.ts, server/src/models/manager.test.ts
- server/src/http/server.test.ts

Constraints:
- Bun, bun:test, TypeScript strict, existing patterns; no new dependencies.
- Do not change shared/api.ts or the HTTP routes' status codes. Do not implement the confirmation rule
  (milestone M2c).
- Do not touch mobile/, ops/, shared/, .harness/ (except your log). Do not commit. Do not restart any live
  service and do not call the live Ollama.
- Do not weaken or delete existing tests.

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2/server && bun test && bun run typecheck && bash scripts/entry-smoke.sh
Write complete output to /Users/ryankenny/Projects/CodingHarnessv2/.harness/evidence/M2b-C1-worker.log
(include the Red run of the new tests against the unfixed code).

Return: the worker return contract (Summary, Files changed, Tests run, Test result, Unresolved issues).
