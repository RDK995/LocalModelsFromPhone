## M7a — The search service answers a web search through ddgs with no account

Status: DONE

### Outcome

POST /v1/search on the search service returns UK/English results from ddgs run in a short-lived Python helper (one subprocess per search, JSON on stdout per I17), using a helper venv the ops tooling installs (Python, ddgs, Playwright, Chromium). Proves risk R7 (ddgs on Python 3.14). Split 2026-09-29 from M7 ("The search service answers web searches with no account, falling back to a headless browser", 3 criteria) at pickup: operational-complexity signals CONCURRENCY_LIFECYCLE (per-search helper subprocess spawned, killed on timeout; Chromium started on demand and closed) + IMPLEMENTATION_PLUS_LIVE_PROOF (live ddgs/engine proof) require a split, and MULTIPLE_OUTCOMES (ddgs answer, browser fallback, failure/timeout handling are independently demonstrable). Criteria conserved unchanged in wording: M7a-AC1 = M7-AC1, M7b-AC1 = M7-AC2, M7c-AC1 = M7-AC3. This part keeps IMPLEMENTATION_PLUS_LIVE_PROOF only (spawn-and-wait; no timeout kill or browser lifecycle); seam check: the live ddgs search is the criterion itself - not split further.

Traces to: FR20 (ddgs path).

### Architecture

C9, C13, C14, C15

### As-Built

.harness/as-built/M7a.md — RECORDED — 9/9 files attributed; components C9,C13,C14,C15; 3 edges; no claim mismatches

### Acceptance Criteria

- [x] **M7a-AC1**: POST /v1/search {query} returns 200 with results [{title,url,snippet}] and backend ddgs, requested for region UK/English, using a helper venv created by an ops installer (Python, ddgs, Playwright, Chromium); no account, API key or payment is involved.

### Baseline

46a0750f19e47ee9ee3b7f6e7ee085f6cfdd194c on m7a-search-ddgs

### Evidence

- M7a-T1 — C9 installer ops/scripts/install-search-helper.sh (Homebrew Python 3.14 venv at search/helper/.venv, pinned ddgs 9.16.0 + playwright 1.63.0, Chromium) + C14 helper search/helper/search.py (ddgs region uk-en, I17 JSON, exit 0 always) + test_search.py: Mid (ORDINARY_IMPLEMENTATION), attempt 3, PASS. Verifier re-ran the packet command: exit 0; installer "search helper ready: python 3.14.7, ddgs 9.16.0, playwright 1.63.0"; 8 unittests OK; Chromium executable exists; live helper "Ada Lovelace" → 5 results backend ddgs; mutation region uk-en→all fails test_uses_uk_region_and_max; venv git-ignored; no key/token reads — .harness/evidence/M7a-T1-verifier.log. Commit b3692fb.
- M7a-T2 — C13 POST /v1/search (search/src/search/runHelper.ts, search/src/http/server.ts): argv-array spawn (query with `; rm -rf /`, `$(whoami)` passed literally), 400 bad_request validation, helper error/garbage/non-zero/spawn failure → 503 search_unavailable, client abort kills helper: Mid (ORDINARY_IMPLEMENTATION), attempt 3, PASS. Verifier re-ran `bun install && bun test && bun run typecheck`: exit 0, 127 pass / 0 fail; server.test.ts unchanged; files within allowlist — .harness/evidence/M7a-T2-verifier.log. Commit 7070a2f.
- M7a-T3 — search/scripts/search-proof.sh live proof: Mid (ORDINARY_IMPLEMENTATION), attempt 3, PASS. Verifier ran the packet command: exit 0, ALL CASES PASSED, nothing left on 7790 — .harness/evidence/M7a-T3-verifier.log. Per criterion M7a-AC1: venv python + ddgs 9.16.0 + playwright 1.63.0 + Chromium present (installer-created); service started under `env -i HOME PATH` (no key/account vars); POST /v1/search "Ada Lovelace" → 200, backend ddgs, 5 results with title/url/snippet; max_results 3 → 3; {} → 400; region uk-en asserted statically and by helper unit tests; only SEARCH_PORT env read. Commit 12b46c3.

Routing: T1 Mid attempt 3 PASS; T2 Mid attempt 3 PASS; T3 Mid attempt 3 PASS.

### Validation

`cd /Users/ryankenny/Projects/CodingHarnessv2 && bash ops/scripts/install-search-helper.sh && search/helper/.venv/bin/python -m unittest discover -s search/helper -p 'test_*.py' && (cd search && bun install && bun test && bun run typecheck && bash scripts/search-proof.sh) && ! lsof -nP -iTCP:7790 -sTCP:LISTEN` — needs public network (ddgs engines); installer idempotent; search-proof.sh starts/kills its own service on 7790 only if free. Confirmed by verifiers: installer + 8 helper unittests + Chromium + live helper; bun test 127 pass + typecheck; search-proof.sh ALL CASES PASSED.

### Review

Cycle 1: PASS — reviewer tier Mid (sonnet), full milestone scope, diff 46a0750..da0a8e6. M7a-AC1 PASS. Findings: 0 BLOCKER, 0 IMPORTANT, 0 OPTIONAL. Reviewer re-ran milestone validation: exit 0 (installer, 8 helper unittests, bun test 127 pass, typecheck, search-proof.sh ALL CASES PASSED, nothing on 7790) — .harness/evidence/M7a-review.log. Reviewer judged keeping results with empty title/snippet acceptable.

### Review Cycles

0

### Follow-ups

- R7 resolved 2026-09-29 (M7a-T1): ddgs 9.16.0 and playwright 1.63.0 install and run on Homebrew Python 3.14.7; live ddgs search returned results. No deviation needed.
- M7a-T2: helper {error} → 503 search_unavailable is implemented now (I17 contract); M7c's both-backends-fail criterion builds on it. No search time limit / 504 yet (M7c).
- M7a-T2: results missing a string title/snippet are kept with "" (entries without url dropped); reviewer to confirm acceptable.
- M7a-T1: Playwright downloaded Chromium plus the headless-shell variant; M7b should use p.chromium.executable_path, not a hard-coded path.
- M7a-T3: search-proof.sh depends on live ddgs results from a home IP (3 query attempts per case); engine blocking could make it flaky.
- milestones.md is ~658 lines but nothing is archivable: M6 is the most recently settled milestone (M5c already archived); the rest are TODO/active/BLOCKED.

