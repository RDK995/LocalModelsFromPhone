TASK — M7b-C1: browser fallback must keep Microsoft-hosted results (review finding F1)

Routing: Cheap (haiku), reason_code BOUNDED_LOW_RISK, detail: one condition in a small pure function
(decode_bing_href) with a stated input/output and offline unit tests that settle it.

Finding: .harness/reviews/M7b-cycle1.md, section "### F1" (read it). In search/helper/search.py,
`decode_bing_href` returns None for any host ending ".microsoft.com", so browser-fallback searches
silently drop e.g. https://support.microsoft.com/en-us/excel/functions/vlookup-function.

Goal / Acceptance Criteria:
1. Remove the `.microsoft.com` exclusion from `decode_bing_href`. Keep the `bing.com` / `*.bing.com`
   exclusion exactly as it is. Do NOT add any other host exclusion (no go.microsoft.com rule — nothing
   in the requirements asks for one).
2. Add a unit test in search/helper/test_search.py (stdlib unittest, no network), e.g.
   `test_decode_bing_keeps_microsoft_hosts`, asserting that for
   https://support.microsoft.com/en-us/excel/functions/vlookup-function and
   https://learn.microsoft.com/en-us/azure/ both
   (a) the direct URL is returned unchanged, and
   (b) the URL wrapped in a Bing redirect `https://www.bing.com/ck/a?...&u=a1<urlsafe-base64 of the URL, padding stripped>`
       decodes back to the URL.
   Build the wrapped form the same way the existing test_decode_bing_redirect does.
3. Red → Green: run the new test against the unchanged code first and report that it FAILS, then make
   the change and report it passes.
4. All existing tests pass unchanged:
   `cd /Users/ryankenny/Projects/CodingHarnessv2 && search/helper/.venv/bin/python -m unittest discover -s search/helper -p 'test_*.py'`
   (26 tests before your change; expect 27 after).

Tests:
`cd /Users/ryankenny/Projects/CodingHarnessv2 && search/helper/.venv/bin/python -m unittest discover -s search/helper -p 'test_*.py'`

Relevant Files:
- search/helper/search.py (decode_bing_href, ~line 55-77)
- search/helper/test_search.py (test_decode_bing_redirect, ~line 150-160)

Files Allowed To Change:
- search/helper/search.py
- search/helper/test_search.py

Constraints:
- Change only the one condition in decode_bing_href; no other behaviour change.
- Do not weaken or edit existing tests' assertions.
- Do not touch search/scripts/**, search/src/**, ops/**, requirements.txt, .harness/**.
- No network needed; do not run live proofs.
- Do not git commit, push, or stash.
