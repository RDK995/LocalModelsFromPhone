TASK — M7c-T3: proof through the real service that "both backends fail" gives 503 and "too slow" gives 504 with the helper and its browser killed

Routing: Mid (sonnet), reason_code ORDINARY_IMPLEMENTATION, detail: proof script with process-lifecycle
assertions; follows the existing search/scripts/fallback-proof.sh pattern.

Context (already committed on this branch):
- Service (`search/src/index.ts`, Bun, run as `bun run src/index.ts` from search/) spawns the Python
  helper `search/helper/search.py` per POST /v1/search; the helper inherits the service's environment.
  Test-only env overrides now available:
  - `SEARCH_PORT` — listen port (host always 127.0.0.1).
  - `SEARCH_TIMEOUT_MS` — the service's search time limit (default 25000). On timeout the service
    answers `504 {"error":"timeout"}` and SIGKILLs the helper's whole process group (helper is
    spawned detached, in its own group).
  - `SEARCH_HELPER_FORCE_DDGS=fail` — ddgs step behaves as if it raised (no network).
  - `SEARCH_HELPER_FORCE_BROWSER=fail` — browser step behaves as if it raised, no browser launched.
    With FORCE_DDGS=fail too, helper returns `{"error":"search_failed",...}` → service answers
    `503 {"error":"search_unavailable","detail":...}`.
  - `SEARCH_HELPER_FORCE_BROWSER=hang` — helper launches real headless Chromium via Playwright, then
    sleeps 3600 s holding it (a forced slow helper with a live browser).
- `search/scripts/fallback-proof.sh` (M7b) is the pattern: own service per case on a dedicated port
  under `env -i HOME="$HOME" PATH="/usr/bin:/bin:/opt/homebrew/bin" ...`, curl --retry readiness,
  PASS/FAIL lines, cleanup trap that stops only what it started, headless Chromium PID snapshot via
  `pgrep -f 'chrom.*headless'` before and after.

Goal:
A new script `search/scripts/failure-proof.sh` proving milestone criterion M7c-AC1 verbatim:
"With both backends forced to fail, the service returns 503 search_unavailable; a search exceeding its
time limit returns 504 timeout and its helper process is killed." — through POST /v1/search, with no
public-network dependency.

Acceptance Criteria (for this task):
1. Own service instance per case on a dedicated port (default 7792, override FAILURE_PROOF_PORT; fail
   clearly if in use). Never touches 7790/7791. Stops only what it started, also on failure.
2. Case "unavailable": env SEARCH_HELPER_FORCE_DDGS=fail SEARCH_HELPER_FORCE_BROWSER=fail. POST
   `{"query":"Ada Lovelace","max_results":5}` (check server.ts for exact request shape). Assert HTTP
   503, body `error == "search_unavailable"`, `detail` is a non-empty string. Print the body.
3. Case "timeout": env SEARCH_TIMEOUT_MS=8000 SEARCH_HELPER_FORCE_DDGS=fail
   SEARCH_HELPER_FORCE_BROWSER=hang. Before the request snapshot pre-existing headless Chromium PIDs
   and pre-existing `search.py` helper PIDs (`pgrep -f 'helper/search.py'`). Send the request in the
   background; while it is in flight (poll, e.g. up to 6 s) record the NEW helper PID and assert at
   least one NEW headless Chromium PID appeared (proves the browser was really running when the limit
   hit — if none appeared, FAIL rather than pass vacuously). Then assert: HTTP 504, body exactly
   `{"error":"timeout"}`, and the elapsed time is ≥ 8 s and < 15 s.
4. After the 504 (poll up to ~3 s): the recorded helper PID no longer exists, and no headless Chromium
   PID exists that was not pre-existing. Check again after stopping the service. PASS/FAIL per check.
5. search/scripts/search-proof.sh has a static check (around line 183-189) that fails on env reads
   other than an allow-list (`SEARCH_PORT|SEARCH_HELPER_FORCE_DDGS`). This milestone added reads of
   `SEARCH_TIMEOUT_MS` (search/src/index.ts) and `SEARCH_HELPER_FORCE_BROWSER`
   (search/helper/search.py). Extend ONLY that allow-list and its PASS text to name them as test
   hooks. Change nothing else in search-proof.sh.
6. Ends with "ALL CASES PASSED" exit 0, or "<n> CASE(S) FAILED" exit 1. Run it (and search-proof.sh,
   and fallback-proof.sh to show no regression) and report full output verbatim.

Relevant Files:
- search/scripts/fallback-proof.sh (pattern), search/scripts/search-proof.sh
- search/src/index.ts, search/src/http/server.ts, search/src/search/runHelper.ts (read only)
- search/helper/search.py (read only)

Files Allowed To Change:
- search/scripts/failure-proof.sh (new, executable)
- search/scripts/search-proof.sh (allow-list line and its PASS text only)

Constraints:
- Follow existing repository patterns. Do not change unrelated behaviour. Do not weaken tests.
- Do not change search/src/**, search/helper/**, ops/**. If the service or helper appears defective,
  report it with evidence instead of working around it.
- No `sleep`-based readiness waits (curl --retry); short polling loops for process checks are fine.
- search-proof.sh and fallback-proof.sh need public network; failure-proof.sh must not.
- Do not git commit, push, or stash.

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2/search && bash scripts/failure-proof.sh && bash scripts/search-proof.sh && bash scripts/fallback-proof.sh

Return:
- Summary
- Files changed
- Tests run
- Test result
- Unresolved issues
