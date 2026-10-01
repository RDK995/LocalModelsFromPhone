# M15 review, cycle 1 (full milestone scope)

Diff: `git diff b48673499df9aa0d846bad7bbefe1548d57cb272 HEAD` on m15-deep-research-skeleton.
Validation re-run by the reviewer: `cd server && bun test && bun run typecheck` -> 209 pass, 0 fail,
tsc clean (full output: .harness/evidence/M15-review.log).

Verdict: CHANGES REQUIRED

## Acceptance criteria

Acceptance Criterion:
M15-AC1 - POST /v1/chat with web on and deep research requested runs brief -> plan (server-set count) -> per sub-question at least the minimum searches (normalised repeats skipped), reads chosen only from server-parsed URLs, notes -> gap check -> one write call; ends `complete` with the report as the answer; phases stream as web steps; sources are the pages read.

Implementation Evidence:
server/src/http/server.ts parseChatRequest (`deep_research` boolean); server/src/generations/manager.ts startGeneration/runDeepResearch; server/src/generations/research.ts runResearch (lines 263-438); step kinds `plan`/`write` in server/src/web/tools.ts and shared/api.ts.

Test Evidence:
server/src/generations/research.test.ts "runs brief -> plan -> searches -> reads -> notes -> gap -> write..." (count cut to 2, run-wide normalised dedup, reads by index, step order, sources = reads in first-read order, `complete`); server/src/http/deepResearch.test.ts "runs the research module and streams steps, sources, report and done" (real POST /v1/chat over SSE).

Result:
PASS (happy path proven; see Finding 1 for an edge case where a sub-question's results are never read)

Acceptance Criterion:
M15-AC2 - every Ollama request carries JSON-schema `format`, the same explicit `num_ctx`, keeps the model resident, contains only stable instructions/brief/plan/capped notes/latest result, no other raw page text, no thinking; enough may end a sub-question early but a server cap bounds it.

Implementation Evidence:
research.ts modelStep (207-250), context()/notesBlock() (178-201), gap loop (374-404); server/src/ollama/client.ts passes format/options/think/keep_alive.

Test Evidence:
research.test.ts "every request is a narrow, schema-constrained request...", "caps the rolling notes...", "gap check enough:true immediately still runs the minimum...", "enough:false forever is stopped by the server cap", "enough:false with only repeated queries..."; client.test.ts "sends format, options, think, and keep_alive..." and backward-compat test; deepResearch.test.ts num_ctx/format checks.

Result:
PASS

Acceptance Criterion:
M15-AC3 - malformed or empty JSON step retried a bounded number of times then skipped, run continues to a report; page text instructions can only influence notes and choice among server-parsed URLs.

Implementation Evidence:
research.ts modelStep retry loop (223-249); select by index only (340-343); untrusted() wrapper (136-139).

Test Evidence:
research.test.ts "a malformed reply is retried a bounded number of times...", "a model that fails every step (or throws)...", "page text carrying an instruction cannot make the run read a URL outside...".

Result:
PASS

Acceptance Criterion:
M15-AC4 - each distinct page read gets a number in first-read order (FR31 numbering and distinctness); unread `[n]` and typed URLs removed before final; non-matching quote dropped.

Implementation Evidence:
research.ts cleanReport (145-154), readKeys/readNumbers dedup (328, 347-356), quote check (365-369); createPageNumberer reused.

Test Evidence:
research.test.ts first test (n = 1..4 in read order) and "removes citations to pages not read, URLs typed in the report, and notes whose quote is not on the page"; deepResearch.test.ts CLEANED content. None found for distinctness: no test has the same page reached twice (by two searches, two sub-questions, or a read whose final URL is an already-read page).

Result:
FAIL (distinctness half not proven by any test - Finding 2)

## Findings

### Finding 1

Severity:
IMPORTANT

Problem:
When a sub-question runs out of new queries before reaching `minSearches`, the loop breaks before `readChosen()` is ever called, so the search results it did collect are never read and the sub-question gets no notes.

Evidence:
server/src/generations/research.ts:374-404 - `const query = await nextQuery(); if (query === null) break;` (376) exits before `if (searches < s.minSearches) continue;` (391) lets execution reach `yield* readChosen();` (393). Reviewer probe (temporary test, removed) confirmed two cases with default settings: (a) every model step fails -> 1 search ("Q") with 2 results, 0 reads, answer = NO_REPORT_NOTE; (b) sub-question 2 whose proposed queries all repeat sub-question 1's (repeats are skipped run-wide) -> 1 search, 0 reads although 2 candidates were parsed. The existing "fails every step" test sets `minSearches: 1`, which hides this.

Why it matters:
FR35 step 3 is search, then choose pages from the parsed results and read them. Run-wide repeat skipping makes exhausting distinct queries a realistic case for a small local model, and this path turns results already fetched into nothing, and in the all-steps-skipped case it throws away material the documented fallback ("a skipped select step reads the top unread results") was meant to use.

Suggested correction:
After the per-sub-question while loop, if `searches > 0` and no read pass has run for this sub-question (e.g. track a `readPassDone` flag, or call `readChosen()` when the loop exits via `query === null` with `candidates` non-empty), run `yield* readChosen()` once. Add a research.test.ts case with default `minSearches: 2` where (a) every model step fails and (b) the second sub-question proposes only already-run queries, asserting reads happen from the parsed results.

### Finding 2

Severity:
IMPORTANT

Problem:
M15-AC4's "distinctness" clause (a page read once gets one number; reaching it again does not re-read, re-number or re-note it) has implementation but no test in the research loop.

Evidence:
server/src/generations/research.ts:328, 347-356 (readKeys and readNumbers guards); research.test.ts fake search returns URLs unique per query slug, so no test ever presents the same page twice.

Why it matters:
A criterion with no test proving it is not proven; a regression in these guards would duplicate numbers/notes or re-read pages silently.

Suggested correction:
Add a research.test.ts case where two queries (or two sub-questions) return an overlapping result URL, and one where `read()` returns a final URL equal to an already-read page; assert one read per page, sequential distinct `n` in first-read order, one sources item per page, and no second note step for the duplicate.

### Finding 3

Severity:
OPTIONAL

Problem:
`cleanReport` leaves unread numbers inside grouped citations (`[1, 9]`, `[1-9]`) and scheme-less URLs (`www.example.com/x`).

Evidence:
server/src/generations/research.ts:145-154 (only `\[(\d+)\]` and `https?://` patterns).

Why it matters:
FR37 says only read-page `[n]` may remain and the model never types a URL into the report; models commonly emit grouped citations and bare domains.

Suggested correction:
Split grouped brackets into individual `[n]` before filtering (or drop unread members), and strip `www.`-prefixed hosts; add cases to the citation-removal test.

### Finding 4

Severity:
OPTIONAL

Problem:
The quote check lowercases both sides (`normaliseText`), so a quote that differs from the page only in letter case is accepted.

Evidence:
server/src/generations/research.ts:131-133, 357, 367.

Why it matters:
FR35/FR37 specify a verbatim quote checked by substring match after whitespace normalisation only; case-folding is slightly looser than agreed.

Suggested correction:
Use a whitespace-only normaliser for the quote match (keep the lowercase one for query repeats), or record the case-insensitive choice as a decision.

## Notes (no finding)

- Architecture: D-M15-1 is recorded in .harness/architecture.md under Deviations; the loop lives in C6 using C7 and C12 as recorded. No undeclared drift.
- No scope creep; ordinary web and non-web paths unchanged (execute() return shape test).
