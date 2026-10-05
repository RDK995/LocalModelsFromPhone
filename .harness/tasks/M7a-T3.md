TASK — M7a-T3: live end-to-end proof script for POST /v1/search (search/scripts/search-proof.sh)

Routing: Mid (sonnet), reason_code ORDINARY_IMPLEMENTATION, detail: live-network proof script against real ddgs; flaky external dependency makes it not trivially verified.

Goal:
Write `search/scripts/search-proof.sh`, modelled on the existing `search/scripts/read-proof.sh`
(read it first: its start-service-if-port-free / EXIT-trap-kill pattern, PASS/FAIL lines, final
summary), that proves milestone criterion M7a-AC1 against the real service and real ddgs.

Criterion (verbatim, M7a-AC1): "POST /v1/search {query} returns 200 with results
[{title,url,snippet}] and backend ddgs, requested for region UK/English, using a helper venv
created by an ops installer (Python, ddgs, Playwright, Chromium); no account, API key or payment
is involved."

Already built (committed on this branch — read them):
- ops/scripts/install-search-helper.sh (creates search/helper/.venv, installs ddgs + playwright + Chromium)
- search/helper/search.py (+ test_search.py): I17 helper, ddgs region uk-en
- search/src/search/** and search/src/http/server.ts: POST /v1/search route (I16)

Acceptance Criteria (for this task) — the script must, each as a PASS/FAIL line:
1. Venv exists: `search/helper/.venv/bin/python` present; it imports `ddgs` and `playwright`;
   Playwright's Chromium executable exists on disk (print versions).
2. Start the service (`bun run src/index.ts` from search/) on 127.0.0.1:7790 only if nothing is
   listening there, with a MINIMAL environment: `env -i HOME="$HOME" PATH="/usr/bin:/bin:/opt/homebrew/bin"`
   plus nothing else — proving no API key/token/account variable is needed. Wait for /v1/health.
   Kill it via EXIT trap if the script started it.
3. POST /v1/search {"query":"Ada Lovelace"} → HTTP 200; JSON `backend` == "ddgs"; `results` is a
   non-empty array (≤ 5, the default); every result has non-empty string `title` and `url`
   (url starting http) and a string `snippet`. Engines may intermittently return nothing from a
   home IP: allow up to 3 attempts with different queries (e.g. "Ada Lovelace", "Bletchley Park",
   "River Thames") before FAIL, and print which attempt passed.
4. POST with {"query":"...","max_results":3} → ≤ 3 results.
5. Region UK/English: assert statically that the helper requests region "uk-en"
   (`grep -q 'region="uk-en"' search/helper/search.py` or equivalent) AND run the helper's unit
   tests (`search/helper/.venv/bin/python -m unittest discover -s search/helper -p 'test_*.py'`),
   which assert the fake DDGS received region uk-en.
6. No account/key: grep the helper, search/src and the installer for API-key/token env reads
   related to search (e.g. `API_KEY`, `os.environ`, `process.env` usages other than SEARCH_PORT)
   and report; the minimal-env start in (2) is the main proof.
7. Bad body `{}` → 400.
End with "ALL CASES PASSED" and exit 0 only if every case passed; nonzero otherwise. After the
script, nothing listens on 7790 if it started the service. Print the JSON of the passing search
response (truncated) so the evidence log shows real results.

Files Allowed To Change:
- search/scripts/search-proof.sh (new)

If a defect in already-built code blocks a case, do NOT fix it — return FAIL naming the file,
the observed response, and the case.

Constraints:
- Follow existing repository patterns. Do not weaken anything. Do not git commit, push, or stash.

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2/search && bash scripts/search-proof.sh && ! lsof -nP -iTCP:7790 -sTCP:LISTEN

Return:
- Summary
- Files changed
- Tests run
- Test result
- Unresolved issues
