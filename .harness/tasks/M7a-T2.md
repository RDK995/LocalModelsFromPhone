TASK — M7a-T2: POST /v1/search on the search service (C13), calling the helper subprocess (I17)

Routing: Mid (sonnet), reason_code ORDINARY_IMPLEMENTATION, detail: new route + subprocess runner in an existing Bun service, tested against a fake helper.

Goal:
Add `POST /v1/search` to the existing search service in `search/` (Bun.serve on 127.0.0.1:7790,
built in M6 — read search/src/http/server.ts, server.test.ts and search/src/index.ts first). The
route runs the Python helper once per request as a subprocess per interface I17 and returns its
results per I16. The helper itself is being written concurrently by another task at
`search/helper/search.py` with venv `search/helper/.venv`; you do NOT write or run the real
helper — test against a fake helper script.

Relevant Requirements (read them yourself):
- FR20 (.harness/requirements.md lines 86-92).
- Architecture .harness/architecture.md: C13 lines 175-182; I16 table lines 261-270 (verbatim row:
  `POST /v1/search` `{query, max_results?≤10}` → `200 {results:[{title,url,snippet}], backend:"ddgs"|"browser"}`;
  failures `503 {error:"search_unavailable", detail}`, `504 {error:"timeout"}`);
  I17 lines 272-274 (verbatim: "`helper/.venv/bin/python helper/search.py --query <q> --max <n>`;
  stdout one JSON object `{results:[{title,url,snippet}], backend}` or `{error, detail}`; exit 0
  either way; killed by C13 on timeout or abort.").

Acceptance Criteria (for this task):
- New module (e.g. `search/src/search/runHelper.ts`) that spawns the helper with an argv ARRAY
  (never a shell string; the query is passed as one argv element, so shell metacharacters are
  inert): default command `<search dir>/helper/.venv/bin/python <search dir>/helper/search.py
  --query <q> --max <n>`, paths resolved from the module's location (import.meta.dir), not the cwd.
  The command is injectable (options object) so tests can point at a fake helper.
- Request validation: body must be JSON with `query` a non-empty (after trim) string of at most
  500 characters; `max_results` optional integer 1..10 (default 5). Invalid → 400
  `{error:"bad_request"}`.
- Helper stdout parsed as one JSON object. `{results, backend}` with results an array → 200
  `{results:[{title,url,snippet}], backend}` (keep only string title/url/snippet fields; drop
  entries without a url; at most max_results). `{error, detail}` → 503
  `{error:"search_unavailable", detail}`. Non-zero exit, unparsable stdout, or spawn failure
  (e.g. venv missing) → 503 `{error:"search_unavailable", detail:<short reason>}`.
- If the client disconnects (`req.signal` aborts) the helper process is killed.
  Time limits / 504 are a LATER milestone (M7c) — do not add a search timeout now.
- `search/src/index.ts` wires the real default helper with no override; the existing
  `/v1/read`, `/v1/health`, 404/405 behaviour is unchanged (existing tests stay green, unmodified).
- bun:test tests over real HTTP on an ephemeral port using fake helper scripts (small scripts
  written to a temp dir, run with `bun` or `/bin/sh` — not Python): success mapping with
  backend ddgs; the argv received by the fake contains `--query`, the exact query (include one
  with `; rm -rf /` and `$(whoami)` to prove it is passed literally) and `--max` with the value;
  default max 5; `{error}` → 503; garbage stdout → 503; missing helper binary → 503; bad bodies
  (missing query, empty query, max_results 11, non-JSON) → 400; client abort kills the helper
  (fake helper sleeps and writes its pid; after abort the pid is gone).

Relevant Files:
- search/src/http/server.ts, search/src/http/server.test.ts, search/src/index.ts
- search/package.json, search/tsconfig.json

Files Allowed To Change:
- search/src/search/** (new)
- search/src/http/server.ts, search/src/http/server.test.ts (add tests only; do not modify or delete existing ones)
- search/src/index.ts

Constraints:
- Follow existing repository patterns (response helpers, error JSON style). Do not change unrelated
  behaviour. Do not weaken tests. No external network in tests. No new dependencies.
- Do NOT touch search/helper/**, ops/**, or .gitignore (another task is writing them concurrently).
- Do not git commit, push, or stash.

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2/search && bun install && bun test && bun run typecheck

Return:
- Summary
- Files changed
- Tests run
- Test result
- Unresolved issues
