## M7b — When ddgs fails, a headless browser answers the search and is closed afterwards

Status: DONE

### Outcome

When ddgs errors or returns nothing, the search helper starts headless Chromium on demand via Playwright, performs the search on a search-engine results page, closes the browser, and the service returns results with backend browser. Second part of the M7 split (see M7a). Signals: IMPLEMENTATION_PLUS_LIVE_PROOF and the Chromium lifecycle (CONCURRENCY_LIFECYCLE) remain inside one criterion, which cannot be split further; the lifecycle is confined to one helper process and checked by process absence afterwards.

Owns: FR20. Traces to: AC16 (browser fallback).

### Architecture

C13, C14, C15

### As-Built

.harness/as-built/M7b.md — RECORDED; C14 observed, C13/C15 context; 1 claim mismatch: C13 claimed but not observed (no changes in search/src/)

### Acceptance Criteria

- [x] **M7b-AC1**: With ddgs forced to fail or to return nothing, the same request returns results with backend browser, and no headless Chromium process remains afterwards.

### Baseline

ad7570f5e0777549fb0f9b9607d4982575c4f4e6 on m7b-search-browser-fallback

### Evidence

- M7b-T1 search/helper/search.py headless Chromium (Playwright, Bing cc=GB setlang=en-GB, locale en-GB) fallback when ddgs raises or is empty; backend browser; browser closed in finally inside the Playwright with block; SEARCH_HELPER_FORCE_DDGS=fail|empty test hook — Mid (ORDINARY_IMPLEMENTATION), attempt 3 PASS; verifier PASS — .harness/evidence/M7b-T1-verifier.log. Commit 3e57675.
- M7b-T2 live proof search/scripts/fallback-proof.sh (own service on 7791, forced fail and empty through POST /v1/search, no new headless Chromium after each request and after stop) + search-proof.sh env-read allow-list admits SEARCH_HELPER_FORCE_DDGS — Mid attempt 3 FAIL (first run hit an empty Bing title; allow-list change absent from tree, search-proof.sh failed) → Top attempt 4 PASS (Escalated: tier); verifier PASS — .harness/evidence/M7b-T2-verifier.log. Commit f3235cb.
- M7b-T3 browser results never carry an empty title (pick_title innerText > textContent > aria-label > title attr, else row dropped) — Cheap (BOUNDED_LOW_RISK), attempt 1 PASS; verifier PASS incl. fallback-proof ALL CASES PASSED — .harness/evidence/M7b-T3-verifier.log. Commit 8c0bd3e. Raised by T2's live run.
- M7b-AC1: fallback-proof.sh ALL CASES PASSED for modes fail and empty (HTTP 200, backend browser, 5 results with titles and external https urls; pre-existing headless Chromium <none>; no new headless Chromium after request or after service stop) — .harness/evidence/M7b-T2-verifier.log.

### Validation

`cd /Users/ryankenny/Projects/CodingHarnessv2 && search/helper/.venv/bin/python -m unittest discover -s search/helper -p 'test_*.py' && (cd search && bun test && bun run typecheck && bash scripts/fallback-proof.sh && bash scripts/search-proof.sh) && ! pgrep -f 'chrom.*headless'` — reviewer runs once. Needs public network (Bing via headless Chromium, ddgs engines). fallback-proof.sh starts its own service on 127.0.0.1:7791 (FALLBACK_PROOF_PORT) under env -i with SEARCH_HELPER_FORCE_DDGS=fail then =empty, POSTs /v1/search, asserts backend browser + valid results, and asserts no new headless Chromium PID after each request and after stopping the service. Components confirmed exit 0 by verifiers: helper unittest 16 OK + forced live runs + bun test 127 + typecheck (.harness/evidence/M7b-T1-verifier.log); 26 unittests + fallback-proof ALL CASES PASSED (.harness/evidence/M7b-T3-verifier.log); fallback-proof + search-proof ALL CASES PASSED, no headless chromium, 7791 free (.harness/evidence/M7b-T2-verifier.log).

### Review

Cycle 1: CHANGES REQUIRED (SUBSTANTIVE), tier Top (opus) — .harness/reviews/M7b-cycle1.md (F1 IMPORTANT: decode_bing_href drops every *.microsoft.com result; F2 OPTIONAL: browser_search scraping loop has no unit test); M7b-AC1 PASS; reviewer validation exit 0 — .harness/evidence/M7b-review.log
Pre-correction: b4faa0af6742599abc6998e40e24a0d18232adaa (9b708b6 plus the committed review report and log; no code change)
Corrections (each verifier-confirmed, committed):
- M7b-C1 F1 decode_bing_href keeps *.microsoft.com hosts (bing.com / *.bing.com exclusion kept; no other host rule added); new test_decode_bing_keeps_microsoft_hosts (support.microsoft.com and learn.microsoft.com, direct and Bing /ck/ wrapped) Red on the old code (verifier: AssertionError None != support.microsoft.com URL) then Green; 27 unittests OK — Cheap (BOUNDED_LOW_RISK), attempt 1 PASS — .harness/evidence/M7b-C1-verifier.log; 4923d1f
- M7b-C2 F2 (OPTIONAL) six offline tests driving browser_search through a fake Playwright harness: dedup, empty-title drop, bing.com drop, max_results cap in order, relevance guard (exactly 2 gotos when first page irrelevant, exactly 1 when relevant), browser closed in each; tests only, search.py untouched; verifier broke dedup and relevance guard in scratch copies and the tests failed; 33 unittests OK — Cheap (BOUNDED_LOW_RISK), attempt 1 PASS — .harness/evidence/M7b-C2-verifier.log; e5e215c
Cycle-1 validation: `cd /Users/ryankenny/Projects/CodingHarnessv2 && search/helper/.venv/bin/python -m unittest discover -s search/helper -p 'test_*.py'` exit 0, 33 tests OK (verifier). Live fallback-proof.sh / search-proof.sh and bun suites not re-run this cycle (no TypeScript or script changed); the reviewer re-runs full milestone validation.
Correction diff: git diff b4faa0af6742599abc6998e40e24a0d18232adaa HEAD
Files changed by corrections: search/helper/search.py; search/helper/test_search.py (plus .harness/ records). No file outside the findings' scope: F1 names decode_bing_href in search.py and asks for a test; F2 names the test file.
Cycle 2: PASS, tier Mid (sonnet, review floor; correction diff b4faa0a..d15883e, Cheap-routed M7b-C1/C2 only); M7b-AC1 PASS; 0 findings; reviewer full validation exit 0 — .harness/evidence/M7b-review.log

### Review Cycles

1

### Follow-ups

- M7b-T3: (resolved in cycle 1 by M7b-C2 test_scrape_empty_title_row_dropped) no unit test drove the scraping loop to show an all-empty-title row is dropped.
- milestones.md is ~600 lines after archiving M6; nothing further is archivable (M7a is the most recently settled milestone; the rest are TODO/active/BLOCKED).
- M7c: when C13 kills the helper on timeout/abort mid-browser-search, Chromium children may outlive the killed helper (Playwright's finally will not run on SIGKILL). M7c's kill proof should also assert no headless Chromium remains.
- Browser fallback depends on Bing's live markup and behaviour from this IP (observed: unrelated result pages, empty title anchors, an rdr=1 redirect). search.py retries once with a query-word relevance guard; drift may break fallback-proof.sh.
- Opening brief: the M7a validation command exited 1 at baseline ad7570f although every sub-suite reported passing; the final `! lsof -nP -iTCP:7790 -sTCP:LISTEN` is the likely cause (something listening on 7790). Not investigated in M7b.
