TASK — M7b-T2: live proof that the browser fallback answers through the real service and leaves no Chromium behind

Routing: Mid (sonnet), reason_code ORDINARY_IMPLEMENTATION, detail: live proof script with a
process-lifecycle assertion; follows the existing search/scripts/search-proof.sh pattern.

Context (decided in M7b-T1, already committed): `search/helper/search.py` now falls back to headless
Chromium via Playwright when ddgs raises or returns zero results, returning
`{"results":[...],"backend":"browser"}`. Test-only hook: environment variable
`SEARCH_HELPER_FORCE_DDGS=fail` (ddgs step behaves as if it raised) or `=empty` (as if it returned
zero results). The service (`search/src/index.ts`, Bun) spawns the helper per POST /v1/search and the
helper inherits the service's environment. The service listen port can be overridden with the
test-only env var `SEARCH_PORT` (host is always 127.0.0.1).

Goal:
A new live proof script `search/scripts/fallback-proof.sh` that proves milestone criterion
M7b-AC1 verbatim: "With ddgs forced to fail or to return nothing, the same request returns results
with backend browser, and no headless Chromium process remains afterwards." — through the real HTTP
entry point (POST /v1/search), not by calling the helper directly.

Relevant Requirements (read them yourself):
- FR20 (.harness/requirements.md lines 86-92); AC16 (.harness/requirements.md lines 158-160).
- Architecture I16/I17 (.harness/architecture.md, grep -n 'I16\|I17'), C13 lines 175-183.
- Pattern to follow: search/scripts/search-proof.sh (201 lines) — PASS/FAIL per case, cleanup trap
  that preserves a caller's EXIT trap, curl --retry for readiness instead of sleep, python3 JSON checks.

Acceptance Criteria (for this task):
1. The script starts its OWN service instance for each forced mode, on a dedicated port
   (default 7791, overridable via FALLBACK_PROOF_PORT; fail clearly if that port is already in use),
   under `env -i HOME="$HOME" PATH="/usr/bin:/bin:/opt/homebrew/bin" SEARCH_PORT=<port>
   SEARCH_HELPER_FORCE_DDGS=<mode>` running `bun run src/index.ts` from search/. It never touches
   anything listening on 7790 and stops only what it started (kill + wait in cleanup, also on failure).
2. For mode `fail` and mode `empty`, POST /v1/search with the same body, e.g.
   `{"query":"Ada Lovelace","max":5}` (check search/src/http/server.ts for the exact request shape),
   and assert: HTTP 200; `backend == "browser"`; ≥1 result; every result has non-empty title and an
   absolute http(s) url that is not on the search engine's own domain. PASS/FAIL line per assertion.
   Print the returned JSON (truncated) for the record.
3. Chromium lifecycle: before the forced cases, record the PIDs from `pgrep -f 'chrom.*headless'`
   (pre-existing, not ours). After each request completes (and again after the service instance is
   stopped), assert no headless Chromium PID exists that was not in the pre-existing set. Also
   print the pre-existing set so a reviewer can see it. PASS/FAIL line for each check.
4. A control case: with no force variable (normal mode) the helper-level behaviour is unchanged is
   NOT required here (search-proof.sh covers ddgs); do not add network-heavy extra cases.
5. Ends with "ALL CASES PASSED" and exit 0, or "<n> CASE(S) FAILED" and exit 1. curl calls use
   --max-time 90 (browser fallback is slower than ddgs).
6. search/scripts/search-proof.sh has a static check that fails on any `os.environ`/`os.getenv`/
   `process.env` read other than SEARCH_PORT. M7b-T1 added a read of `SEARCH_HELPER_FORCE_DDGS` in
   search/helper/search.py, which that check will now flag. Change ONLY that allow-list so
   `SEARCH_HELPER_FORCE_DDGS` is also permitted (it is a non-credential test hook), and update the
   PASS message text to name both. Do not change any other case in search-proof.sh.
7. Both scripts pass live: run them and report the full output verbatim.

Relevant Files:
- search/scripts/search-proof.sh
- search/src/index.ts, search/src/http/server.ts (request/response shape of /v1/search)
- search/helper/search.py (read only)

Files Allowed To Change:
- search/scripts/fallback-proof.sh (new, executable)
- search/scripts/search-proof.sh (only the env-read allow-list and its PASS text, per AC6)

Constraints:
- Follow existing repository patterns. Do not change unrelated behaviour. Do not weaken tests.
- Do not change search/helper/**, search/src/**, ops/**.
- No `sleep`-based waiting for readiness; use curl --retry as search-proof.sh does.
- Needs public network. Engines may be flaky from a home IP; if a case fails for engine reasons,
  rerun once and report both runs exactly.
- Do not git commit, push, or stash.

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2/search && bash scripts/fallback-proof.sh && bash scripts/search-proof.sh

Return:
- Summary
- Files changed
- Tests run
- Test result
- Unresolved issues
