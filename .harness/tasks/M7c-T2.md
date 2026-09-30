TASK — M7c-T2: test-only hooks that force the browser step to fail or to hang holding a real browser

Routing: Cheap (haiku), reason_code BOUNDED_LOW_RISK, detail: two env-var branches beside the
existing SEARCH_HELPER_FORCE_DDGS hook, with stated unit tests; no change to normal behaviour.

Context:
- `search/helper/search.py` (C14) already has a test-only hook: env `SEARCH_HELPER_FORCE_DDGS`
  (`fail` | `empty`) read in `_ddgs_step` (around line 147). `run()` calls `browser_search(query,
  max_results)` when ddgs fails; `browser_search(query, max_results, sync_playwright=None)` (line 79)
  launches headless Chromium via Playwright (`pw.chromium.launch(headless=True)`) and closes it in a
  `finally`. Offline tests drive it with a fake Playwright harness in `search/helper/test_search.py`
  (see the `FallbackTests` class and the fake PW/Browser/Ctx/Page classes around lines 176-350).
- Milestone M7c must prove, through the real service, (1) that when BOTH backends fail the service
  answers 503 search_unavailable, and (2) that a search which runs too long is killed together with
  any browser it started. These hooks are the forcing seams for that proof; another task handles the
  service side.

Goal:
Add an env var `SEARCH_HELPER_FORCE_BROWSER`, read only when the browser step runs:
- `fail`: the browser step behaves as if it raised — no browser is launched — so with
  `SEARCH_HELPER_FORCE_DDGS=fail` the helper prints `{"error":"search_failed","detail":"ddgs: forced
  failure; browser: forced failure"}` and exits 0 (the existing `run()` detail format).
- `hang`: inside `browser_search`, right AFTER `pw.chromium.launch(headless=True)` succeeds, sleep for
  a long time (e.g. `time.sleep(3600)`) before doing anything else — simulating a slow search that is
  holding a live browser. (The existing `finally: browser.close()` stays as it is.)
- Unset or any other value: behaviour unchanged.

Acceptance Criteria (for this task):
1. `SEARCH_HELPER_FORCE_BROWSER=fail` handled so that the browser is never launched and the result is
   `search_failed` with detail containing `browser: forced failure`. Put the check where the browser
   step is invoked (in `run()` before calling `browser_search`, or at the top of `browser_search`
   before launch) — either is fine as long as no browser launches.
2. `SEARCH_HELPER_FORCE_BROWSER=hang` sleeps after launch, using a sleep function that tests can
   replace (e.g. module-level `_sleep = time.sleep`, or a parameter) so the unit test does not block.
3. Unit tests in `search/helper/test_search.py` (Red first — show they fail before the change):
   a. env FORCE_DDGS=fail + FORCE_BROWSER=fail, `run(q, 5, ddgs_factory=..., browser_search=<spy>)`
      or `main([...])` → `{"error":"search_failed", ...}` with `browser: forced failure` in detail,
      and the spy/fake launch is never called.
   b. env FORCE_BROWSER=hang with the fake Playwright harness: the fake `launch` is called, then the
      replaced sleep is called with a long duration (≥ 600 s) before any `new_page`/`goto`.
   c. env unset → existing tests unchanged and passing.
   Tests must restore/clear both env vars (setUp/tearDown like FallbackTests does for FORCE_DDGS).
4. Update the module docstring's "Test-only hook" paragraph to document the new variable.
5. Full helper suite passes:
   `search/helper/.venv/bin/python -m unittest discover -s search/helper -p 'test_*.py'`.

Relevant Files:
- search/helper/search.py, search/helper/test_search.py

Files Allowed To Change:
- search/helper/search.py
- search/helper/test_search.py

Constraints:
- Follow existing repository patterns. Do not change unrelated behaviour. Do not weaken tests.
- Do not touch search/src/**, search/scripts/** (another task is editing search/src/** in parallel —
  ignore any changes you see there), ops/**.
- No network in unit tests; never launch a real browser in unit tests.
- Do not git commit, push, or stash.

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2 && search/helper/.venv/bin/python -m unittest discover -s search/helper -p 'test_*.py'

Return:
- Summary
- Files changed
- Tests run
- Test result (include the Red run and the Green run)
- Unresolved issues
