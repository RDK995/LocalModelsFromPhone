TASK — M7a-T1: search helper venv installer (C9) + ddgs search helper script (C14)

Routing: Mid (sonnet), reason_code ORDINARY_IMPLEMENTATION, detail: new installer + Python helper with a stated JSON contract; live install proves risk R7 (not low risk to get wrong, but no structural risk).

Goal:
(a) An idempotent ops installer that creates the search helper's Python venv at
`search/helper/.venv` from Homebrew Python 3.14 (`/opt/homebrew/bin/python3.14`), installs `ddgs`
and `playwright` into it (pinned in `search/helper/requirements.txt`), then runs
`search/helper/.venv/bin/python -m playwright install chromium`.
(b) The helper `search/helper/search.py` implementing interface I17 using ddgs only (the
headless-browser fallback is a LATER milestone, M7b — do not implement it).

Relevant Requirements (read them yourself):
- FR20 (.harness/requirements.md lines 86-92): ddgs primary, no account/key/payment, region UK/English (never "all languages").
- .harness/requirements.md lines 185-189: Python 3.14 is the available Python; ddgs compatibility unverified.
- Architecture (.harness/architecture.md): C9 lines 139-149, C14 lines 184-190,
  I17 lines 272-274, I19 lines 282-283, I20-I21 lines 285-287, risk R7 lines 369-372. Verbatim I17:
  "`helper/.venv/bin/python helper/search.py --query <q> --max <n>`; stdout one JSON object
  `{results:[{title,url,snippet}], backend}` or `{error, detail}`; exit 0 either way; killed by
  C13 on timeout or abort." I19: "`ddgs` text search, region `uk-en`".
- R7 fallback: if ddgs does NOT install/run on Python 3.14, do not silently switch Python: return
  BLOCKED with the exact pip/import error (a different Python is a decision to record).

Acceptance Criteria (for this task):
- `ops/scripts/install-search-helper.sh` (bash, `set -euo pipefail`, style like the other
  ops/scripts/*.sh installers): resolves the repo root from its own location; fails clearly if
  `/opt/homebrew/bin/python3.14` is missing; creates the venv only if absent (re-running is safe
  and quick); `pip install -r search/helper/requirements.txt`; installs Chromium via playwright;
  prints a final line like `search helper ready: <python version>, ddgs <ver>, playwright <ver>`.
  No account, API key, token or payment is requested or read anywhere.
- `search/helper/requirements.txt` pins exact versions of `ddgs` and `playwright` (whatever
  current versions install on 3.14).
- `.gitignore` (repo root) ignores `search/helper/.venv/` and `__pycache__/`.
- `search/helper/search.py`: argparse `--query` (required, non-empty after strip) and `--max`
  (int, default 5, clamp to 1..10). Calls `DDGS().text(query, region="uk-en", safesearch="moderate",
  max_results=max)`. Normalises each hit to `{title, url, snippet}` (ddgs keys are `title`,
  `href`, `body`; skip hits with no url). Prints exactly one JSON object on stdout:
  `{"results":[...], "backend":"ddgs"}` on success (including zero results — an empty list is
  still backend ddgs; M7b decides fallback), or `{"error":"search_failed","detail":"<exception
  class: message>"}` if ddgs raises; `{"error":"bad_request","detail":...}` for invalid args.
  Always exit 0 (argparse errors must also produce the JSON error object and exit 0, so override
  argparse's error behaviour). Nothing else on stdout (no logging/prints; warnings to stderr only).
  Structure it so the ddgs client is injectable (e.g. `run(query, max, ddgs_factory=DDGS)`) for tests.
- `search/helper/test_search.py` (stdlib `unittest`, no network): with a fake DDGS asserts the
  call used `region="uk-en"` and the requested max; normalisation of href/body → url/snippet;
  zero results → `{"results":[],"backend":"ddgs"}`; exception → search_failed JSON; and a
  subprocess test that running the script with no `--query` prints one JSON error object and exits 0.
- Live check (network required): run the installer, then
  `search/helper/.venv/bin/python search/helper/search.py --query "Ada Lovelace" --max 5` prints
  JSON with backend ddgs and ≥1 result with non-empty title/url. Engines may intermittently return
  nothing from a home IP; retry a couple of times with different queries before concluding it fails,
  and report exactly what you saw.

Relevant Files:
- ops/scripts/install-server-agent.sh, ops/scripts/install-bundle-host-agent.sh (installer style)
- .gitignore

Files Allowed To Change:
- ops/scripts/install-search-helper.sh (new)
- search/helper/requirements.txt, search/helper/search.py, search/helper/test_search.py (new)
- .gitignore
- (search/helper/.venv/ is created by running the installer; it must be git-ignored, never committed)

Constraints:
- Follow existing repository patterns. Do not change unrelated behaviour. Do not weaken tests.
- Do NOT touch search/src/** (another task is changing it concurrently) or search/package.json.
- No browser fallback, no timeout handling in the helper (later milestones M7b/M7c).
- Do not git commit, push, or stash.

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2 && bash ops/scripts/install-search-helper.sh && search/helper/.venv/bin/python -m unittest discover -s search/helper -p 'test_*.py' -v && search/helper/.venv/bin/python -c "from playwright.sync_api import sync_playwright; import os; p=sync_playwright().start(); e=p.chromium.executable_path; p.stop(); assert os.path.exists(e), e; print('chromium', e)" && search/helper/.venv/bin/python search/helper/search.py --query "Ada Lovelace" --max 5

Return:
- Summary
- Files changed
- Tests run
- Test result
- Unresolved issues
