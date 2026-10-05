TASK — M7c-T1: the search service enforces a time limit, answers 504 timeout, and kills the helper and everything it started

Routing: Top (opus), reason_code DIFFICULT_CONCURRENCY, detail: subprocess lifecycle — the helper's
whole process tree (Python + Playwright driver + Chromium) must die on timeout or client abort,
racing the helper's normal exit; a naive proc.kill() leaves grandchildren behind.

Context:
- C13 search service (Bun) lives in `search/`. `search/src/search/runHelper.ts` spawns one helper
  per request (`Bun.spawn`, argv array) and today kills only the direct child (`proc.kill()`, SIGTERM)
  on client abort. `search/src/http/server.ts` `handleSearch` maps helper failure to
  `503 {error:"search_unavailable", detail}` (already implemented and tested) and has NO time limit.
- The helper (`search/helper/search.py`, C14) may launch headless Chromium via Playwright (a Node
  driver child + Chromium children). Playwright's cleanup does not run if the Python process is
  SIGKILLed, so killing only the helper PID can leave Chromium running. The required outcome is
  that the helper AND every process it started are gone after a timeout or abort.
- Architecture I16: `POST /v1/search` failures are `503 {error:"search_unavailable", detail}` and
  `504 {error:"timeout"}`; "Client disconnect aborts the work (subprocess killed)". I17: the helper
  is "killed by C13 on timeout or abort". FR24: each search has a time limit; exceeding it fails.
- Existing test pattern: `search/src/search/search.test.ts` starts a real server via
  `startServer(0, {}, { command })` with fake helpers written as small bun scripts (`fake(name, script)`
  returns `["bun", path]`). Follow it.

Goal:
POST /v1/search returns `504 {"error":"timeout"}` when the helper has not finished within the
service's search time limit, and at that point the helper and all of its descendants are killed.
Client abort kills the same whole tree. Normal success and 503 behaviour are unchanged.

Relevant Requirements (read them yourself):
- FR20, FR24: .harness/requirements.md lines 86-92 and 113-114.
- Architecture C13 (.harness/architecture.md 175-182), I16/I17 (261-274).

Acceptance Criteria (for this task):
1. Time limit: default 25 000 ms for the whole helper run. Configurable through `HelperOptions`
   (e.g. `timeoutMs`) for tests, and through a test-only env var `SEARCH_TIMEOUT_MS` read ONLY in
   `search/src/index.ts` (alongside the existing `SEARCH_PORT` override; positive integer, else
   ignored → default) and passed into `startServer`'s helper options. Document it in index.ts's
   header comment like SEARCH_PORT.
2. On timeout: the response is exactly `504 {"error":"timeout"}` (content-type application/json),
   returned promptly (within ~1 s of the limit, not after the helper would have finished).
3. Process-tree kill: the helper is started so that it and its descendants can be killed together
   (e.g. in its own process group — `node:child_process` `spawn(..., {detached: true})` works in Bun
   and puts the child in a new session/group; then `process.kill(-pid, "SIGKILL")`), and on timeout
   or client abort the whole group is SIGKILLed. Keep argv-array spawning (never a shell string),
   stdin ignored, stderr ignored, stdout parsed exactly as today. Do not leave the group running if
   the helper exits normally but left a descendant behind (kill the group after normal exit too, ignoring ESRCH).
4. Tests (Red first — show each fails on the current code before implementing), in
   `search/src/search/search.test.ts` (or a new sibling test file under search/src/search/):
   a. A fake helper that prints its own pid to a file, spawns a long-lived grandchild (e.g.
      `Bun.spawn(["sleep","60"])` or a bun sleeper) that writes ITS pid to a file, then sleeps 60 s.
      With a server whose timeout is ~500 ms: response is 504 `{error:"timeout"}` within 3 s, and
      shortly afterwards (poll up to ~2 s) both the helper pid and the grandchild pid no longer exist
      (`process.kill(pid, 0)` throws ESRCH).
   b. Same fake, request aborted by the client (AbortController) before the limit: afterwards both
      pids are gone.
   c. A fake helper that sleeps briefly (e.g. 200 ms) then succeeds, with a 2 s limit → 200 as before
      (the limit does not cut off a normal search).
   d. The existing tests (including the helper `{error}` → 503 search_unavailable case) still pass.
5. `bun test` and `bun run typecheck` in search/ pass.

Relevant Files:
- search/src/search/runHelper.ts, search/src/http/server.ts, search/src/index.ts
- search/src/search/search.test.ts (pattern), search/src/http/server.test.ts

Files Allowed To Change:
- search/src/search/runHelper.ts
- search/src/http/server.ts
- search/src/index.ts
- search/src/search/search.test.ts
- search/src/search/timeout.test.ts (new, optional)

Constraints:
- Follow existing repository patterns. Do not change unrelated behaviour. Do not weaken tests.
- Do not touch search/helper/**, search/scripts/**, ops/**, app/**, server/**.
- Tests must not depend on the network or on the real Python helper.
- Tests must clean up any process they start even when an assertion fails.
- The server's `idleTimeout` (60 s) must stay above the search limit; do not lower it.
- Do not git commit, push, or stash.

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2/search && bun test && bun run typecheck

Return:
- Summary
- Files changed
- Tests run
- Test result (include the Red run output for 4a-4c and the Green run)
- Unresolved issues
