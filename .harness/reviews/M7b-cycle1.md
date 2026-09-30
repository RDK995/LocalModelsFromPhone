# M7b review — cycle 1

Verdict: CHANGES REQUIRED
Tier: Top (opus). Diff: `git diff ad7570f5e0777549fb0f9b9607d4982575c4f4e6 HEAD` on m7b-search-browser-fallback.

## Validation (re-run by reviewer)

Full milestone validation command, exit 0 — `.harness/evidence/M7b-review.log`:
- helper unittest: Ran 26 tests, OK
- bun test: 127 pass / 0 fail; typecheck clean
- fallback-proof.sh: ALL CASES PASSED (fail and empty: HTTP 200, backend browser, 5 results, no new headless Chromium after the request or after the service stopped)
- search-proof.sh: ALL CASES PASSED
- `! pgrep -f 'chrom.*headless'`: true

Extra reviewer checks:
- The `chrom.*headless` detector is not vacuous: sampled during a forced-fail helper run it saw 4 headless Chromium processes, and 0 once the helper exited.
- A live `browser_search("Excel VLOOKUP function", 10)` run with a spy on `decode_bing_href` showed two support.microsoft.com results being dropped (see F1).

## Acceptance criteria

Acceptance Criterion:
M7b-AC1: With ddgs forced to fail or to return nothing, the same request returns results with backend browser, and no headless Chromium process remains afterwards.

Implementation Evidence:
search/helper/search.py — `_ddgs_step` (SEARCH_HELPER_FORCE_DDGS fail|empty, declared as D-M7b-1), the `run()` fallback to `browser_search`, `browser_search()` (`browser.close()` in `finally` inside the `sync_playwright` with-block), and `main()` passing the real `browser_search`.

Test Evidence:
search/scripts/fallback-proof.sh re-run by the reviewer: ALL CASES PASSED for both modes through the real POST /v1/search. search/helper/test_search.py FallbackTests, including test_env_fail_and_empty_route_to_browser and test_browser_closed_when_scrape_raises. The detector was confirmed live (see above).

Result:
PASS

## Architectural drift

The code matches C13/C14/C15 and I17/I19. The env hook and the choice of Bing are recorded as D-M7b-1. No drift was found. The Microsoft domain filter (F1) is not an architecture matter; it is a behaviour defect.

## Findings

### F1

Severity:
IMPORTANT

Problem:
`decode_bing_href` drops every result whose host is under `.microsoft.com`. Legitimate, often top-ranked results are silently removed from browser-fallback searches.

Evidence:
search/helper/search.py, `decode_bing_href`:
`if h == "bing.com" or h.endswith(".bing.com") or h.endswith(".microsoft.com"): return None`.
A live reviewer run of `browser_search("Excel VLOOKUP function", 10)` dropped
https://support.microsoft.com/en-us/excel/functions/vlookup-function and
https://support.microsoft.com/en-us/excel/look-up-values-with-vlookup-index-or-match, which are Bing's authoritative results for that query. No test covers the exclusion (test_decode_bing_redirect checks only bing.com hosts).

Why it matters:
This is incorrect behaviour. Any query about Windows, Excel, Azure, Teams and similar products loses Microsoft's own documentation in the fallback path, and the caller gets no signal that anything was removed. Nothing in FR20 or I19 asks for a domain filter.

Suggested correction:
Remove the `.microsoft.com` exclusion and keep the bing.com one. If a specific Microsoft-owned ad or tracking redirect host really must be filtered (for example go.microsoft.com), exclude that exact host only. Add a `decode_bing_href` test asserting that support.microsoft.com and learn.microsoft.com URLs, both direct and wrapped in a Bing /ck/ redirect, are kept.

### F2

Severity:
OPTIONAL

Problem:
The scraping loop in `browser_search` has no unit test. That loop covers href decode and dedup, the empty-title drop, the max_results cut, the query-word relevance guard with one reload, and the `wait_for_url("**rdr=1**")` wait (whose timeout silently adds up to 20 s per attempt if Bing stops redirecting). Only the close-on-exception path is unit-tested.

Evidence:
search/helper/search.py, `browser_search` loop. In search/helper/test_search.py, only test_browser_closed_when_scrape_raises drives `browser_search`.

Why it matters:
The loop encodes several Bing-specific heuristics that will drift over time. Regressions would show up only in the network-dependent fallback-proof.sh.

Suggested correction:
Extend the existing fake PW/Browser/Page harness with an `evaluate` that returns canned rows. Assert that an unrelated first page triggers exactly one reload, that duplicates and empty-title rows are dropped, and that results are capped at max_results.

## Notes (not findings)

- If C13 kills the helper on abort or timeout while a browser search is running, Chromium may be left behind. This is already recorded as an M7c follow-up and is outside M7b-AC1.
