## M7c — A search that cannot be answered or runs too long ends with a clear error and its helper killed

Status: DONE

### Outcome

When both search backends fail the service returns 503 search_unavailable, and a search exceeding the service's time limit returns 504 timeout with its helper process (and any browser it started) killed. Third part of the M7 split (see M7a). Signal: CONCURRENCY_LIFECYCLE (timeout kill); proof uses forced failures and a forced slow helper locally, so no live-environment dependency.

Traces to: FR20 (unavailable), FR24 (service time limit).

### Architecture

C13, C14

### As-Built

.harness/as-built/M7c.md — RECORDED; C13, C14 observed; 3 edges; 4 of 8 files attributed; no claim mismatches

### Acceptance Criteria

- [x] **M7c-AC1**: With both backends forced to fail, the service returns 503 search_unavailable; a search exceeding its time limit returns 504 timeout and its helper process is killed.

### Baseline

06aade1194d6fd1a010ed47697adf26f8a9d24c4 on m7c-search-unavailable-timeout

### Evidence

- M7c-T1 C13 search time limit (default 25 s; test-only SEARCH_TIMEOUT_MS in search/src/index.ts) -> 504 {"error":"timeout"}; helper spawned detached (own process group) and the whole group SIGKILLed on timeout, client abort and after normal exit; new search/src/search/timeout.test.ts (timeout kills helper + grandchild, abort kills both, 200 within limit, leftover descendant killed after normal exit), Red 3 fail — .harness/evidence/M7c-T1-red.log — Top (DIFFICULT_CONCURRENCY), attempt 4 PASS; verifier PASS (bun test 131 + typecheck exit 0) — .harness/evidence/M7c-T1-verifier.log. Commit f41e844.
- M7c-T2 C14 test-only SEARCH_HELPER_FORCE_BROWSER=fail (no browser launched, search_failed) | hang (sleeps 3600 s after launching real headless Chromium) with 2 offline unit tests — Cheap (BOUNDED_LOW_RISK), attempt 1 PASS; verifier PASS (35 unittests OK) — .harness/evidence/M7c-T2-verifier.log. Commit c3e514d.
- M7c-T3 search/scripts/failure-proof.sh (own service on 7792 under env -i; no public network) + search-proof.sh env allow-list admits SEARCH_HELPER_FORCE_BROWSER and SEARCH_TIMEOUT_MS — Mid (ORDINARY_IMPLEMENTATION), attempt 3 PASS; verifier PASS, each script exit 0 — .harness/evidence/M7c-T3-verifier.log. Commit 79def3c.
- M7c-AC1: failure-proof.sh ALL CASES PASSED: both backends forced to fail -> HTTP 503 {"error":"search_unavailable","detail":"ddgs: forced failure; browser: forced failure"}; SEARCH_TIMEOUT_MS=8000 with a forced hanging helper holding live headless Chromium (helper pid and 3 new Chromium pids seen in flight) -> HTTP 504 body exactly {"error":"timeout"} after 8.07 s; helper pid gone and no new headless Chromium after the 504 and after service stop — .harness/evidence/M7c-T3-verifier.log.
- Deviation recorded: D-M7c-1 (Material: no) in .harness/architecture.md.

### Validation

`cd /Users/ryankenny/Projects/CodingHarnessv2 && search/helper/.venv/bin/python -m unittest discover -s search/helper -p 'test_*.py' && (cd search && bun test && bun run typecheck && bash scripts/failure-proof.sh && bash scripts/fallback-proof.sh && bash scripts/search-proof.sh) && ! pgrep -f 'chrom.*headless' && ! pgrep -f 'helper/search.py'` — reviewer runs once. failure-proof.sh needs no public network (own service on 127.0.0.1:7792, FAILURE_PROOF_PORT, env -i; forced SEARCH_HELPER_FORCE_DDGS=fail + SEARCH_HELPER_FORCE_BROWSER=fail -> 503; SEARCH_TIMEOUT_MS=8000 + FORCE_BROWSER=hang with live headless Chromium -> 504, helper PID and new Chromium gone after the 504 and after stop). fallback-proof.sh / search-proof.sh (regression, allow-list) need public network. Components confirmed exit 0 by verifiers: bun test 131 + typecheck (.harness/evidence/M7c-T1-verifier.log); helper unittest 35 OK (.harness/evidence/M7c-T2-verifier.log); failure-proof, search-proof, fallback-proof each exit 0, no leftover chromium/helper, 7791/7792 free (.harness/evidence/M7c-T3-verifier.log).

### Review

Cycle 1: PASS, tier Top (opus, DIFFICULT_CONCURRENCY from M7c-T1; whole milestone 06aade1..5d7b75d); M7c-AC1 PASS; 0 BLOCKER, 0 IMPORTANT, 1 OPTIONAL (recorded under Follow-ups); reviewer full validation exit 0 — .harness/evidence/M7c-review.log

### Review Cycles

0

### Follow-ups

- M7c-T1: runHelper also SIGKILLs the helper's process group after a normal exit (to reap leftovers); after the helper is reaped its pgid could in theory be reused by an unrelated new group leader. Very unlikely; not fixed.
- M7c-T1: on client abort runHelper returns detail 'request aborted' mapped to 503; nobody receives it (client gone).
- D-M7c-1: search time limit default 25 s; the C12 client timeout planned for M9 must exceed it.
- Review cycle 1 OPTIONAL: runHelper.ts header comment (lines 4-5) and D-M7c-1 say the group SIGKILL kills Chromium, but Playwright launches Chromium in its own process group; Chromium exits because its pipe to the Playwright driver closes. Behaviour proven by failure-proof.sh; reword the comment and deviation note.

