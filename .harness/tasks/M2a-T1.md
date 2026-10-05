TASK M2a-T1 — Model manager reports installed and resident models; GET /v1/state goes through it

Routing: tier Mid, model sonnet, reason_code ORDINARY_IMPLEMENTATION
  detail: new server component (C5) behind an agreed interface (I6 state()), re-wiring an existing route; ordinary implementation, not structurally risky.

Goal:
GET /v1/state is served by a new Model manager (architecture component C5, `server/src/models/`)
instead of inline code in the HTTP layer. It reports every model installed in Ollama
(`/api/tags`) by its real name and size, and the true resident model from `/api/ps` (including
one loaded by another tool), or `resident: null` when nothing is loaded. The response shape is
unchanged.

Relevant Requirements:
FR1, FR2 — /Users/ryankenny/Projects/CodingHarnessv2/.harness/requirements.md lines 17-21.
Architecture: /Users/ryankenny/Projects/CodingHarnessv2/.harness/architecture.md — C5 (lines 84-90),
interfaces table and I6/I8/I9 (lines 143-184). The /v1/state response shape is
`200 {models:[{name,size_bytes}], resident:{name,loaded_by_server}|null, operation:{kind,...}, generation:{id,model}|null}`, failure `503 {error:"ollama_down", message}`.

Current state (context not obvious from the code):
- server/src/http/server.ts lines ~313-345 already implement /v1/state inline by calling
  `ollama.tags()` and `ollama.ps()` directly. That bypasses C5; move the logic into C5.
- The load/unload routes are stubs; do NOT implement them (that is milestone M2b).
- `loaded_by_server` is always `false` in this milestone (tracking what the server loaded lands in
  M2b). `operation` is always `{kind:"idle"}` here.

Acceptance Criteria:
- New `server/src/models/manager.ts` exports a `ModelManager` class. Its constructor takes its
  dependencies as narrow interfaces (an Ollama dependency with `tags()` and `ps()`, and a
  generations dependency with `getActiveGeneration()`), so tests inject fakes. It exposes
  `async state(): Promise<StateResponse>` (type from `shared/api.ts`).
- `state().models` is exactly Ollama `/api/tags` `models`, in the same order, mapped to
  `{name: m.name, size_bytes: m.size}`. No model name appears anywhere in non-test server source.
- `state().resident` is `{name: <first /api/ps model's name>, loaded_by_server: false}` when
  `/api/ps` lists a model (regardless of who loaded it), and `null` when it lists none.
- If `tags()` or `ps()` throws, `state()` rejects with an exported `OllamaDownError`; the route
  maps that to `503 {error:"ollama_down", message}` exactly as today.
- `state().generation` is the generation manager's active generation (or null), as today.
- `createServer` accepts an optional `models?: ModelManager`; when absent it constructs one from
  `ollama` and the generation manager. The `/v1/state` handler calls `models.state()` and contains
  no direct `tags()`/`ps()` calls. `server/src/index.ts` keeps working (update only if needed).
- Tests (write them first, Red → Green):
  - `server/src/models/manager.test.ts`: models mapped verbatim from a fake tags list of
    arbitrary made-up names and sizes (proves nothing is hardcoded); resident reported when the
    fake ps lists a model the server never loaded (`loaded_by_server:false`); `resident:null`
    when ps is empty; `OllamaDownError` when tags throws and when ps throws; generation
    passthrough.
  - `server/src/http/server.test.ts`: existing /v1/state tests still pass unchanged; add one test
    that a request with a valid token returns the manager's state for a fake with a resident
    model, and one that nothing-loaded returns `resident: null`, if not already covered.

Relevant Files:
- server/src/http/server.ts, server/src/http/server.test.ts
- server/src/ollama/client.ts (types OllamaTagsResponse, OllamaPsResponse)
- server/src/generations/manager.ts (getActiveGeneration, line ~263)
- server/src/index.ts
- shared/api.ts

Files Allowed To Change:
- server/src/models/manager.ts (new), server/src/models/manager.test.ts (new)
- server/src/http/server.ts, server/src/http/server.test.ts
- server/src/index.ts (only if needed to construct the manager)

Constraints:
- Follow existing patterns (Bun, bun:test, TypeScript strict). No new dependencies.
- Do not change unrelated behaviour; do not implement load/unload. Do not weaken tests.
- Do not touch mobile/, ops/, shared/, .harness/ (except your log). Do not commit.
- Do not restart any live service.

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2/server && bun test && bun run typecheck && bash scripts/entry-smoke.sh
Write complete output to /Users/ryankenny/Projects/CodingHarnessv2/.harness/evidence/M2a-T1-worker.log.

Return: the worker return contract (Summary, Files changed, Tests run, Test result, Unresolved issues).
