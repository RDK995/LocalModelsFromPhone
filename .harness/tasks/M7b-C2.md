TASK — M7b-C2: unit-test the browser_search scraping loop offline (review finding F2)

Routing: Cheap (haiku), reason_code BOUNDED_LOW_RISK, detail: tests only, written from assertions this
packet states, using a fake Playwright harness that already exists in the test file.

Finding: .harness/reviews/M7b-cycle1.md, section "### F2" (read it). search/helper/search.py
`browser_search(query, max_results, sync_playwright=None)` has a scraping loop (page.goto,
wait_for_url/wait_for_selector inside try/except, page.evaluate returning rows, decode_bing_href +
dedup, pick_title + empty-title drop, max_results cut, and a query-word relevance guard that reloads
the page once when no result mentions a query word). Only the close-on-exception path is tested
(test_browser_closed_when_scrape_raises in search/helper/test_search.py). Read the whole function.

Goal / Acceptance Criteria — add offline tests (stdlib unittest) that drive browser_search through the
existing fake PW/Browser/Page harness (extend it: `evaluate` returns canned rows, per call, from a list;
count `goto` calls; `wait_for_url`/`wait_for_selector` may no-op). Row dicts use the keys the page script
returns: innerText, textContent, ariaLabel, titleAttr, href, snippet. Assert:
1. Duplicates dropped: two rows with the same href yield one result.
2. Empty-title row dropped: a row whose innerText, textContent, ariaLabel and titleAttr are all empty
   is not in the results, while a neighbouring normal row is.
3. Rows whose href is a bing.com URL are dropped.
4. Results are capped at max_results (e.g. 5 relevant rows, max_results=3 → 3 results, in order).
5. Relevance guard: when the first evaluate returns only rows that mention no query word and the second
   returns relevant rows, goto is called exactly twice and the relevant rows are returned. When the first
   page is already relevant, goto is called exactly once.
6. The browser is closed in every one of these tests.
If the code's actual behaviour differs from any assertion above, do NOT change search.py — report the
difference verbatim under your result and leave that assertion out, stating why.

Tests:
`cd /Users/ryankenny/Projects/CodingHarnessv2 && search/helper/.venv/bin/python -m unittest discover -s search/helper -p 'test_*.py'`
All pre-existing tests must still pass unchanged.

Relevant Files:
- search/helper/search.py (browser_search — read only)
- search/helper/test_search.py (FallbackTests, fake PW harness)

Files Allowed To Change:
- search/helper/test_search.py

Constraints:
- Tests only. Do not modify search/helper/search.py.
- No network, no real Chromium.
- Do not weaken or edit existing tests' assertions (you may extend the shared fake classes as long as
  existing tests still pass unchanged).
- Do not touch search/scripts/**, search/src/**, ops/**, .harness/**.
- Do not git commit, push, or stash.
