# M2b review, cycle 1

Verdict: CHANGES REQUIRED
Scope: SUBSTANTIVE
Reviewed: `git diff c9fdd5e 72e781c` on m2b-swap-load-unload

## Validation

I ran the milestone Validation command once against 72e781c. It exited 0, and the full output is in `.harness/evidence/M2b-review.log`.

- Server: 73 pass, 0 fail. Typecheck and entry-smoke passed.
- Ops: token tests and verify-ops-install passed.
- Mobile: typecheck and 60 tests passed (0 fail). Lint, smoke:runtime and model-list-proof passed.
- model-swap-proof ran with IDLE_SECONDS=600 and passed.
- model-failed-load-proof passed.
- expo export passed.

Mac state afterwards: only `devstral:24b` is resident, with expires_at 2319 (keep_alive -1).

## Acceptance criteria

| Criterion | Implementation evidence | Test evidence | Result |
| --- | --- | --- | --- |
| M2-AC2 Loading A then B leaves only B resident; unload leaves nothing | `server/src/models/manager.ts` `load()`/`runLoad()`: unloads the other residents, waits for `/api/ps` to clear, then loads with keep_alive -1. `unload()`/`runUnload()`. `server/src/ollama/client.ts` `load`/`unload`. `server/src/http/server.ts` load and unload routes. `mobile/src/app/models.tsx` and `mobile/src/ui/modelActions.ts`. | Live `mobile/scripts/model-swap-proof.ts`, Steps 1, 2 and 5 in the review log: `/api/ps` was exactly `["devstral:24b"]`, then `["qwen3.6:27b"]`, then `[]`, and the view read "Nothing loaded". Unit tests in `manager.test.ts`: "swaps: unloads every other resident model..." and "unloads every resident model, emptying ps". | PASS |
| M2-AC3 A model loaded from the phone stays resident after 10 minutes idle and after a chat reply | `OllamaClient.load` sends keep_alive -1. Chat sends keep_alive -1 (I9/I10). | Live model-swap-proof Step 3: after the chat reply, `/api/ps` was exactly `[qwen3.6:27b]` with expires_at 2319. Step 4: after 600 s idle, still exactly `[qwen3.6:27b]`. Unit test in `ollama/client.test.ts`: "load() sends ... keep_alive:-1". | PASS |
| M2-AC5 A failed load leaves nothing resident and the app shows the reason | `manager.ts` `runLoad` catch calls `bestEffortUnload` and `reasonForError`, writing the reason to `operation.error`. `OllamaError` carries Ollama's error text. `mobile/src/ui/modelList.ts` builds `failureMessage`, and `models.tsx` renders it. | Live `mobile/scripts/model-failed-load-proof.ts`: a genuine runner failure. `operation.error` was "Load failed: llama-server process has terminated: exit status 1", resident was null, `/api/ps` was empty, and the view's failureMessage contained Ollama's reason. The out-of-memory reason is covered by the unit test "a failed load leaves ps empty and reports a memory reason". I read "such as out of memory" in the criterion as an example, and the proven failure is a real Ollama load failure. | PASS |

Architectural drift: none. The routes, error codes and ownership match I4-I10 and C5/C7. The Deviations section is empty, and no entry is needed.

## Findings

### F1

Severity:
IMPORTANT

Problem:
`ModelManager.unload()` checks the busy state before an `await`, but only claims the operation after it. It checks `isBusy()`, then awaits `ollama.ps()`, and only then sets `operation = unloading` and starts `runUnload()`. A load or unload that arrives during that await is not rejected:

- Two overlapping `POST /v1/models/unload` requests both get 202 and run two sweeps.
- A `POST /v1/models/load` followed at once by `POST /v1/models/unload` both get 202, and `runLoad` and `runUnload` run at the same time.

I reproduced this with a throwaway bun test against the real `ModelManager`, using a fake Ollama with 20 ms latency:

- `Promise.allSettled([m.unload(), m.unload()])`: both fulfilled.
- `Promise.allSettled([m.load("b"), m.unload()])`: both fulfilled. Ollama calls were `["unload a","unload a","load b"]`. The final state was resident `b`, operation `{kind:"idle"}` with no error. The unload was accepted, a model stayed resident, and the operation ended idle with no error.

Evidence:
`server/src/models/manager.ts`, `unload()`:
```ts
if (this.isBusy()) { throw new OperationInProgressError(); }
...
const ps = await this.ollama.ps();          // window: nothing claimed yet
...
this.operation = ... { kind: "unloading" ... };
void this.runUnload();
```
`load()` does not have this problem: its busy check and its assignment run synchronously after its only await. The existing tests only check sequential rejection. In `server/src/models/manager.test.ts`, "rejects a second unload with OperationInProgressError while one is running" awaits the first `unload()` before sending the second. In `server/src/http/server.test.ts`, the 409 tests await the first response before sending the second request.

Why it matters:
I4/I5 promise `409 operation_in_progress` for `/v1/models/load` and `/unload`, and C5 is responsible for serialising these operations. Overlapping sweeps can leave the Mac in a state that contradicts the request that was accepted. In the reproduction, an unload left a model resident and still reported success. Overlap can also interleave the unload-then-load ordering that M2-AC2 depends on. It can happen with two clients, or with the phone plus anything else calling the server. M2c's confirmation rule will build on this same operation state.

Suggested correction:
Claim the operation synchronously in `unload()` before any await. Set `this.operation = { kind: "unloading" }` right after the `isBusy()` check, then look up the resident name, fill in `operation.model` and start `runUnload()`. Alternatively, move the `ps()` lookup into `runUnload()`. Add manager tests that start two calls without awaiting in between: `Promise.allSettled([m.unload(), m.unload()])` and `Promise.allSettled([m.load(x), m.unload()])`. Assert that exactly one is fulfilled and the other rejects with `OperationInProgressError`.

### F2

Severity:
OPTIONAL

Problem:
A failed load's reason stays in server memory as `operation.error` until the next load or unload succeeds. The Models screen shows it on every refresh, even after the resident model has changed for other reasons. For example, if another tool later loads model X on the Mac, the screen shows "Loaded: X" and "Load failed: ..." together, with no time or model context.

Evidence:
In `server/src/models/manager.ts`, the `runLoad()` catch sets `{kind:"idle", model, error}`, and only another operation clears it. In `mobile/src/ui/modelList.ts`, `failureMessage = !isBusy && state.operation.error ? state.operation.error : null`.

Why it matters:
An old failure message looks like a current fault. It does not break M2-AC5, which only requires the reason to be shown after the failed load.

Suggested correction:
Show the failure only while `operation.model` is not the resident model. Alternatively, have the phone show it only for the action it just ran, keeping it in screen state from `runModelAction`'s final state rather than on every refresh.
