TASK — M7b-T1: headless-browser fallback in the search helper (C14)

Routing: Mid (sonnet), reason_code ORDINARY_IMPLEMENTATION, detail: new fallback path with a stated
I17 contract; live search-results scraping and browser lifecycle are not low risk to get wrong, but
there is no structural risk.

Goal:
Extend `search/helper/search.py` so that when ddgs raises OR returns zero usable results, the helper
starts headless Chromium via Playwright (already installed in `search/helper/.venv`, playwright
1.63.0, Chromium downloaded by `ops/scripts/install-search-helper.sh`), loads a search-engine results
page for the query, scrapes result links, CLOSES THE BROWSER, and prints
`{"results":[...], "backend":"browser"}`. Also add a test-only fault-injection hook so the live
proof (a later task) can force ddgs to fail or to return nothing through the real HTTP service.

Relevant Requirements (read them yourself):
- FR20 (.harness/requirements.md lines 86-92): ddgs primary; if it errors or returns zero results, a
  headless real browser on the Mac (started on demand, closed afterwards) performs the search. No
  hosted search/fetch API (not Ollama web search, Exa, Parallel, Tavily, Jina, Brave API or similar).
  Region UK / English, never "all languages".
- Architecture (.harness/architecture.md): C14 lines 184-191; I17 lines 272-274; I19 lines 282-283.
  I17 verbatim: "`helper/.venv/bin/python helper/search.py --query <q> --max <n>`; stdout one JSON
  object `{results:[{title,url,snippet}], backend}` or `{error, detail}`; exit 0 either way; killed
  by C13 on timeout or abort." I19 verbatim: "`ddgs` text search, region `uk-en`; fallback
  Playwright headless Chromium loading a search-engine results page and scraping result links."
- Milestone criterion M7b-AC1: "With ddgs forced to fail or to return nothing, the same request
  returns results with backend browser, and no headless Chromium process remains afterwards."

Acceptance Criteria (for this task):
1. Fallback trigger: ddgs raises, or the normalised ddgs result list is empty → browser fallback.
   ddgs returning ≥1 result → browser is NOT started (output unchanged from today, backend "ddgs").
2. Browser search: Playwright sync API, `chromium.launch(headless=True)`, a context with
   `locale="en-GB"` and a normal desktop user agent, one page, load a results page for the query
   with UK/English parameters, e.g. Bing `https://www.bing.com/search?q=<urlencoded>&cc=GB&setlang=en-GB`
   (or DuckDuckGo HTML `https://html.duckduckgo.com/html/?q=<q>&kl=uk-en`). You choose the engine
   that actually returns results headlessly from this Mac; you may try a second engine if the first
   yields zero results. Use a bounded navigation timeout (e.g. 20 s). No API key, no hosted API.
3. Results: each `{title, url, snippet}`; `url` must be the REAL destination, absolute http(s) —
   decode engine redirect wrappers (e.g. Bing `/ck/a?...&u=a1<base64url>`, DDG `//duckduckgo.com/l/?uddg=<pct-encoded>`);
   drop results that are ads, the engine's own domain, or that cannot be decoded; dedupe by url;
   cap at `--max` (already clamped 1..10).
4. Lifecycle: the browser (and Playwright) are closed in a `finally`/context manager on every path
   — success, zero results, navigation error, scrape exception. No Chromium process may outlive the
   helper process on any of these paths.
5. Outputs: browser success with ≥1 result → `{"results":[...],"backend":"browser"}`. Browser fails
   or yields zero results → `{"error":"search_failed","detail":"ddgs: <why>; browser: <why>"}`
   (where ddgs "why" is the exception text or "no results"). Still exactly one JSON object on
   stdout, exit 0, nothing else on stdout (Playwright/Chromium noise must not reach stdout).
6. Test hook: environment variable `SEARCH_HELPER_FORCE_DDGS` — `fail` makes the ddgs step behave as
   if it raised (detail "forced failure"); `empty` makes it behave as if it returned zero results;
   unset/any other value → normal behaviour. It only affects the ddgs step, never the browser.
   Document it in the module docstring as a test-only hook.
7. Injectable: keep `run(query, max_results, ddgs_factory=None)` working for existing tests and add
   an injectable browser search function (e.g. `browser_search=None` parameter, default the real
   Playwright implementation) so unit tests need no network or browser.
8. `search/helper/test_search.py` (stdlib unittest, no network) adds tests: ddgs raises → fake browser
   called, backend browser; ddgs empty → browser called; ddgs ok → browser not called; browser raises
   → search_failed with both reasons in detail; browser returns [] → search_failed; env hook `fail`
   and `empty` each route to the browser (with a ddgs fake that would otherwise succeed); redirect
   decoding for the engine(s) you use (pure-function test with a sample wrapped href); and a test that
   the real browser function closes the browser when scraping raises (use a fake Playwright object or
   structure the code so close is in a context manager that a test can observe). All 8 existing
   tests must still pass unchanged.
9. Live check (network required), run and report output verbatim:
   `SEARCH_HELPER_FORCE_DDGS=fail search/helper/.venv/bin/python search/helper/search.py --query "Ada Lovelace" --max 5`
   and the same with `=empty` → each prints backend browser with ≥1 result whose url is an external
   https URL (not the engine's domain). Then `pgrep -fl 'chrom.*headless'` shows no process left from
   these runs (list what it shows before and after; if something unrelated was already running before,
   say so). Engines may be flaky from a home IP; retry with other queries before concluding failure,
   and report exactly what you saw.

Relevant Files:
- search/helper/search.py (54 lines, current ddgs-only helper)
- search/helper/test_search.py (79 lines, existing tests)
- search/src/search/runHelper.ts (the caller; accepts any backend string — do not change it)

Files Allowed To Change:
- search/helper/search.py
- search/helper/test_search.py

Constraints:
- Follow existing repository patterns. Do not change unrelated behaviour. Do not weaken tests.
- Do not change search/helper/requirements.txt (playwright 1.63.0 is already pinned) or anything
  under search/src/, ops/, or search/scripts/.
- No timeout/kill handling beyond the navigation timeout (overall time limits are milestone M7c).
- Do not git commit, push, or stash.

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2 && search/helper/.venv/bin/python -m unittest discover -s search/helper -p 'test_*.py' -v && SEARCH_HELPER_FORCE_DDGS=fail search/helper/.venv/bin/python search/helper/search.py --query "Ada Lovelace" --max 5 && SEARCH_HELPER_FORCE_DDGS=empty search/helper/.venv/bin/python search/helper/search.py --query "Ada Lovelace" --max 5 && (cd search && bun test && bun run typecheck)

Return:
- Summary
- Files changed
- Tests run
- Test result
- Unresolved issues
