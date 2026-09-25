TASK M2b-T1 — Server swap-load and unload: asynchronous operation in the model manager behind POST /v1/models/load and /unload

Routing: tier Mid, model sonnet, reason_code ORDINARY_IMPLEMENTATION
  detail: extends an existing component (C5) behind the agreed I4/I6 interface with one background operation guarded by a single-flight flag in single-threaded Bun; not difficult concurrency.

Goal:
The server performs swap-load and unload for real. `POST /v1/models/load {name}` starts an
asynchronous swap (unload every other resident model, wait until Ollama reports them gone, then
load `name` with `keep_alive: -1`) and returns `202` immediately; `POST /v1/models/unload` starts
an asynchronous unload of every resident model. While an operation runs, `GET /v1/state` reports
it (`operation.kind` "loading"/"unloading" with `model`); when it ends, `operation.kind` is
"idle", and a failed load leaves `operation.error` set to a specific plain-language reason.
The server remembers which model it loaded, so `resident.loaded_by_server` becomes truthful.

Relevant Requirements:
FR3, FR4, FR5 — /Users/ryankenny/Projects/CodingHarnessv2/.harness/requirements.md lines 23-29.
Edge case "A load fails (e.g. out of memory)" — same file lines 134-135.
Architecture: /Users/ryankenny/Projects/CodingHarnessv2/.harness/architecture.md — C5 (lines 84-90),
C7 (lines 100-106), interfaces table and notes (lines 143-184): routes
`POST /v1/models/load {name, confirm?}` → `202 {operation}` | `404 unknown_model` | `409 operation_in_progress`;
`POST /v1/models/unload {confirm?}` → `202 {operation}` | `409 operation_in_progress`;
`POST /v1/chat` also fails `409 operation_in_progress`. I9/I10: load = `POST /api/generate {model, keep_alive:-1}`,
unload = `POST /api/generate {model, keep_alive:0}`. Types in shared/api.ts (`Operation`, `OperationResponse`,
`LoadRequest`, `UnloadRequest`) already exist — do not change their shape.

Current state (context not obvious from the code):
- server/src/models/manager.ts has only `state()`; `operation` is hardcoded idle and
  `loaded_by_server` is hardcoded false. Both become real here.
- server/src/http/server.ts lines ~330-345: load/unload routes are stubs returning 202 idle.
- server/src/ollama/client.ts `generate()` throws `Error("Ollama /api/generate failed: <status>")`
  and discards Ollama's error body. Ollama returns failures as JSON `{"error": "<text>"}`
  (e.g. out of memory: "model requires more system memory (...) than is available (...)";
  unknown model: 404 with "model '<x>' not found"). The reason must reach the phone, so C7 must
  surface it: throw an exported `OllamaError` carrying `status` and Ollama's `error` text.
  A network failure (fetch rejects) must stay distinguishable (it is "Ollama unreachable").
- `/v1/chat` already sends `keep_alive:-1` (FR4 for chat is done; keep it).
- The confirmation rule (`confirm`, `409 confirmation_required`, cancelling an in-flight reply)
  belongs to milestone M2c. Accept and ignore `confirm` here. Do NOT implement confirmation.

Acceptance Criteria:
- C7 (`server/src/ollama/client.ts`): add `load(name)` = `POST /api/generate {model:name, keep_alive:-1}`
  and `unload(name)` = `POST /api/generate {model:name, keep_alive:0}` (may be built on `generate()`).
  A non-OK response throws exported `OllamaError {status, message}` where `message` is Ollama's
  `error` field when the body is JSON with one, else the status text. Existing callers keep working.
- C5 `ModelManager`:
  - Its Ollama dependency interface gains `load(name)` and `unload(name)`; tests inject fakes.
    Timing (poll interval, max wait for unloads to clear) is injectable so tests do not sleep.
  - `load(name)`: rejects with an exported `UnknownModelError` if `name` is not in `/api/tags`
    (`OllamaDownError` if tags cannot be read); rejects with exported `OperationInProgressError`
    if an operation is running; otherwise sets `operation = {kind:"loading", model:name}`,
    returns that operation synchronously-after-validation, and continues in the background:
    unload every resident model whose name is not `name`, poll `/api/ps` until none of them is
    listed (bounded wait), then `ollama.load(name)`. Success: `loadedByServer = name`,
    `operation = {kind:"idle"}`.
  - Failure anywhere in a load: `loadedByServer = null`; best-effort unload of `name` if `/api/ps`
    lists it; `operation = {kind:"idle", model:name, error:<reason>}` with reason:
    fetch/network failure → "Ollama unreachable";
    OllamaError status 404 or message containing "not found" → `Model not found: <name>`;
    message containing "memory" (case-insensitive) → `Not enough memory to load <name>: <ollama message>`;
    anything else → `Load failed: <ollama message>`.
    The error stays in `state().operation` until the next operation starts.
  - `unload()`: `OperationInProgressError` if running; else `operation = {kind:"unloading", model:<resident name if any>}`,
    background: unload every model `/api/ps` lists, poll until ps is empty (bounded), `loadedByServer = null`,
    `operation = {kind:"idle"}`; on failure `operation = {kind:"idle", error:<reason as above, "Unload failed: ..." for the else case>}`.
  - `isBusy()` (or equivalent) exposes whether an operation is running.
  - `state()`: `operation` is the current operation; `resident.loaded_by_server` is true exactly
    when the resident name equals `loadedByServer`.
  - An unhandled rejection must never escape the background task.
- C4 (`server/src/http/server.ts`):
  - `POST /v1/models/load`: malformed JSON or missing/non-string `name` → `400 bad_request`;
    `UnknownModelError` → `404 {error:"unknown_model", message}`; `OperationInProgressError` →
    `409 {error:"operation_in_progress", message}`; `OllamaDownError` → `503 ollama_down`;
    success → `202 {operation}`.
  - `POST /v1/models/unload`: `409 operation_in_progress` or `202 {operation}`. Body optional.
  - `POST /v1/chat`: returns `409 {error:"operation_in_progress", message}` while an operation
    runs, checked before the residency check.
- Tests first (Red → Green), with fakes (no live Ollama):
  - server/src/ollama/client.test.ts: `load`/`unload` send the stated bodies; `OllamaError` carries
    status and Ollama's error text (use a local `Bun.serve` fake or injected fetch, following the
    file's existing pattern).
  - server/src/models/manager.test.ts: swap unloads every other resident model before loading
    (order asserted), leaves only the target in the fake's ps; loading the already-resident model
    does not unload it; unload empties ps; state reports loading/unloading while the fake is held
    and idle after; `loaded_by_server` true after a load, false for a model the server did not load;
    `UnknownModelError`; `OperationInProgressError` on a second load/unload while one runs;
    a failed load (fake `load` throws OllamaError 500 "model requires more system memory ...")
    leaves ps empty and `operation.error` starting "Not enough memory to load"; the not-found and
    unreachable reasons.
  - server/src/http/server.test.ts: load 202/400/404/409, unload 202/409, chat 409
    operation_in_progress; existing tests pass unchanged.

Relevant Files:
- server/src/models/manager.ts, server/src/models/manager.test.ts
- server/src/ollama/client.ts, server/src/ollama/client.test.ts
- server/src/http/server.ts, server/src/http/server.test.ts
- server/src/index.ts, server/src/generations/manager.ts (context only)
- shared/api.ts (read only)

Files Allowed To Change:
- server/src/models/manager.ts, server/src/models/manager.test.ts
- server/src/ollama/client.ts, server/src/ollama/client.test.ts
- server/src/http/server.ts, server/src/http/server.test.ts
- server/src/index.ts (only if construction must change)

Constraints:
- Bun, bun:test, TypeScript strict, existing patterns; no new dependencies.
- No model name may appear in non-test server source.
- Do not implement the confirmation rule (M2c). Do not change shared/api.ts.
- Do not touch mobile/, ops/, shared/, .harness/ (except your log). Do not commit. Do not restart
  any live service and do not call the live Ollama (it is in use).
- Do not weaken or delete existing tests.

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2/server && bun test && bun run typecheck && bash scripts/entry-smoke.sh
Write complete output to /Users/ryankenny/Projects/CodingHarnessv2/.harness/evidence/M2b-T1-worker.log.

Return: the worker return contract (Summary, Files changed, Tests run, Test result, Unresolved issues).
