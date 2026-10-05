TASK — M7b-T3: browser fallback must not return results with an empty title

Routing: Cheap (haiku), reason_code BOUNDED_LOW_RISK, detail: one small change inside the scraping
loop of an existing function, with a stated rule and a unit test plus a live command that settle it.

Context: M7b-T1 (committed 3e57675) added a headless-Chromium (Playwright, Bing) fallback to
`search/helper/search.py`. The live proof `search/scripts/fallback-proof.sh` (written by M7b-T2,
uncommitted in the working tree — do not modify it) asserts every returned result has a non-empty
title. It fails because Bing sometimes renders a result whose title anchor's `innerText` is empty;
observed live, three runs out of three:
`{"title":"","url":"https://www.unesco.org/en/virtual-science-museum/women-science/ada-lovelace","snippet":""}`.
The scraping loop is roughly lines 92-106 of search/helper/search.py (read it yourself).

Goal / Acceptance Criteria:
1. When scraping a browser result, derive the title in this order: the anchor's `innerText` stripped;
   else its `textContent` stripped (whitespace collapsed); else its `aria-label` / `title` attribute
   stripped. If still empty, DROP that result (do not invent a title from the URL).
2. Put the title-choosing rule in a small pure function (e.g. `pick_title(inner_text, text_content,
   aria_label, title_attr) -> str`) so it is unit-testable without a browser, and use it in the loop.
3. Add unit tests in search/helper/test_search.py (stdlib unittest, no network) for: innerText used
   when present; falls back to textContent; falls back to aria-label; all empty → "" (and the loop
   drops the row — test this through whatever seam the code offers, e.g. a pure row-normalising
   function, if one exists or you add one). All 16 existing tests must still pass unchanged.
4. Live: `SEARCH_HELPER_FORCE_DDGS=fail search/helper/.venv/bin/python search/helper/search.py --query "Ada Lovelace" --max 5`
   prints backend browser with ≥1 result and no result has an empty title. Report the output verbatim.
   Bing can be flaky from this IP; retry once if the result set is unrelated and report both runs.

Relevant Files:
- search/helper/search.py
- search/helper/test_search.py

Files Allowed To Change:
- search/helper/search.py
- search/helper/test_search.py

Constraints:
- Follow existing repository patterns. Do not change unrelated behaviour. Do not weaken tests.
- Do not touch search/scripts/**, search/src/**, ops/**, requirements.txt.
- Keep the browser closed in the existing finally/with structure — do not restructure the lifecycle.
- Do not git commit, push, or stash.

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2 && search/helper/.venv/bin/python -m unittest discover -s search/helper -p 'test_*.py' -v && cd search && bash scripts/fallback-proof.sh

Return:
- Summary
- Files changed
- Tests run
- Test result
- Unresolved issues
