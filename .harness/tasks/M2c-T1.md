TASK M2c-T1 — Server confirmation rule: load/unload answer 409 confirmation_required with reasons; a confirmed request cancels any in-flight reply first

Routing: tier Top, model opus, reason_code DIFFICULT_CONCURRENCY
  detail: the confirmation check needs /api/ps (an await) between the busy check and the operation claim — the exact window that produced M2b's IMPORTANT race finding F1 — and a confirmed request must cancel C6's active generation and wait for its slot to release before swapping, while chat admission and a second load/unload stay correctly refused.

Goal:
Before a swap-load or unload, the server refuses with
`409 {error:"confirmation_required", message, reasons:[...]}` when (a) a reply is being generated
(`reply_in_progress`) or (b) a model is resident that this server did not load
(`not_loaded_by_server`). A refused request changes nothing: operation stays as it was, no Ollama
load/unload is issued, and the in-flight reply keeps streaming. The same request with
`confirm: true` proceeds: it cancels the in-flight reply (if any), waits for the generation slot
to release, then runs the existing swap-load/unload unchanged.

Relevant Requirements:
FR6 — /Users/ryankenny/Projects/CodingHarnessv2/.harness/requirements.md lines 30-34.
Milestone criterion M2-AC4 — .harness/milestones.md, section "## M2c".
Architecture: /Users/ryankenny/Projects/CodingHarnessv2/.harness/architecture.md — C4 (76-82),
C5 (84-90, "enforce the confirmation rule"), C6 (92-98), interfaces table and I6/I8 (143-184):
`POST /v1/models/load {name, confirm?}` / `POST /v1/models/unload {confirm?}` →
`409 confirmation_required {reasons:["reply_in_progress"|"not_loaded_by_server"]}`;
"Confirmed load/unload cancels any in-flight reply first"; I8 C5→C6 `active()`, `cancelActive()`.

Contract (exact):
- Reason (a) `reply_in_progress`: the generation manager has an active generation.
- Reason (b) `not_loaded_by_server`: /api/ps lists a resident model whose name is not the model
  this server itself loaded (the same test that sets `resident.loaded_by_server` false in
  `state()`). Nothing resident → no reason (b).
- Both reasons may apply; `reasons` lists every one that applies, in the order
  `["reply_in_progress", "not_loaded_by_server"]`.
- Precedence: 400 bad body → 404 unknown_model (load only) → 409 operation_in_progress →
  503 ollama_down → 409 confirmation_required. Confirmation is checked only when no other refusal
  applies.
- `confirm` must be the boolean `true` to confirm; absent/false means unconfirmed. A non-boolean
  `confirm` is a 400 bad_request. Unload's body stays optional (empty body = `{}`).
- Response body: `{error:"confirmation_required", message:<plain-language sentence>, reasons}`
  (shared/api.ts already declares `ConfirmationRequiredError {reasons}`; do not change shared/).
- Confirmed with a reply in flight: the reply ends with its normal terminal
  `done {status:"cancelled"}` event (existing cancel path), the generation slot is released before
  any Ollama unload/load is issued, and the load/unload then proceeds as today.
- Atomicity: once a load/unload has been accepted (202), a second load/unload gets
  `409 operation_in_progress` and a chat gets `409 operation_in_progress` for the whole of it,
  including the cancel-and-wait phase. Two overlapping requests must never both be accepted, and
  a request refused with confirmation_required must leave `operation` exactly as it was (idle).
  Mind the await on /api/ps between the busy check and the claim (see the comment in `unload()`
  about review finding F1). How you guard it is your design choice; keep it simple and explained
  in a comment.
- Waiting for the slot to release is bounded (reuse `ModelManagerTiming`); if it never releases,
  the operation ends idle with a plain-language `operation.error`, as other background failures do.

Current state (context not obvious from the code):
- server/src/models/manager.ts: `load(name)` / `unload()` take no confirm; `ModelManagerGenerations`
  only has `getActiveGeneration()`. `loadedByServer` is in-memory (a server restart makes the
  resident model count as not loaded by this server — that is intended behaviour).
- server/src/generations/manager.ts has `getActiveGeneration()`, `getActiveGenId()`,
  `cancelGeneration(genId)`; extend `ModelManagerGenerations` with what you need (I8 names it
  `cancelActive()`), keeping GenerationManager satisfying it structurally.
- server/src/http/server.ts: `parseLoadRequest` ignores `confirm` (comment says M2c); the unload
  handler ignores its body. Update those comments.
- Tests use fakes, never a live Ollama: see server/src/models/manager.test.ts and
  server/src/http/server.test.ts for the existing fake Ollama / fake generations patterns.

Acceptance Criteria:
- Unit (manager.test.ts): each reason alone and both together produce the refusal with the exact
  reasons; the refusal issues no Ollama load/unload, leaves `state().operation` idle, and does not
  cancel the active generation; nothing resident + no reply → no confirmation needed; resident
  loaded by this server + no reply → none needed; confirm:true with a reply in flight cancels it,
  waits for release, then loads/unloads (ordering asserted: cancel before any Ollama unload/load);
  overlapping requests around the /api/ps await are not both accepted.
- HTTP (server.test.ts, through the real routes with bearer auth): `POST /v1/models/load` and
  `POST /v1/models/unload` return `409 {error:"confirmation_required", message, reasons}` in both
  situations; the follow-up `GET /v1/state` shows operation idle and the same resident; with
  `confirm:true` they return 202; a streaming `/v1/chat` reply in flight ends with
  `done {status:"cancelled"}` after a confirmed load; non-boolean confirm → 400.
- Tests written first (Red → Green). All existing tests pass unchanged.

Relevant Files:
- server/src/models/manager.ts, server/src/models/manager.test.ts
- server/src/http/server.ts, server/src/http/server.test.ts
- server/src/generations/manager.ts (C6; add only if needed, e.g. a `cancelActive()`)
- shared/api.ts (read only)

Files Allowed To Change:
- server/src/models/manager.ts, server/src/models/manager.test.ts
- server/src/http/server.ts, server/src/http/server.test.ts
- server/src/generations/manager.ts, server/src/generations/manager.test.ts

Constraints:
- Existing patterns (Bun, TypeScript strict, bun test); no new dependencies.
- Do not touch mobile/, ops/, shared/, .harness/ (except your log). Do not commit.
- Do not restart any live service; do not call the live server or Ollama.
- Do not weaken or delete existing tests. Do not change the stale-error behaviour of
  `operation.error` (a separate follow-up).

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2/server && bun test && bun run typecheck && bash scripts/entry-smoke.sh
Write complete output to /Users/ryankenny/Projects/CodingHarnessv2/.harness/evidence/M2c-T1-worker.log.

Return: the worker return contract (Summary, Files changed, Tests run, Test result, Unresolved issues).
