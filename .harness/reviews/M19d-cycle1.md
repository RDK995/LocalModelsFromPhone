# M19d review, cycle 1

Verdict: CHANGES REQUIRED (Scope: SUBSTANTIVE)

Diff: `git diff 4f0953ed372dad6716122c5f9491353006a57039 HEAD` on m19d-breadth-first-prefetch (HEAD d615923).

Validation re-run by the reviewer: `cd server && bun test && bunx tsc --noEmit` gave 336 pass, 0 fail, 2211 expect() calls; tsc exit 0. Full log: `.harness/evidence/M19d-review.log`.

Architectural drift: none found. The research loop stays in C6 (`server/src/generations/research.ts`). C12 web tools are unchanged and still own the FR24 per-request time limit.

## Acceptance criteria

Acceptance Criterion:
M19d-AC1: Server tests through POST /v1/chat with a scripted fake Ollama and fake search/page backends: every sub-question gets its searches and its first page before any sub-question gets a second page, and a sub-question ends early when a search round adds no new URLs.

Implementation Evidence:
`server/src/generations/research.ts`: the round-1 loop over `subs` (`firstRoundSearches`, `choosePages`, `noteNext` in plan order), the later-rounds loop (at most one note decision per sub-question per round), and `searchOnce`, which returns the count of new URLs. `added === 0` sets `searchOver`.

Test Evidence:
`server/src/http/deepResearchBreadthFirst.test.ts`: AC1a has two tests, covering the order of the first three note decisions and searches before the 4th note, including the case where the first chosen read fails. AC1b has two tests: no new URLs ends searching with no gap check, and a later empty search ends searching.

Result:
PASS

Acceptance Criterion:
M19d-AC2: Server tests: chosen pages start fetching in parallel as soon as page choice returns, each keeping its FR24 time limit, while model calls never overlap; Stop or the deadline with several prefetched reads in flight cancels all of them through the run's one signal (FR36).

Implementation Evidence:
- `research.ts` `startRead`: `webTools.read(url, phaseSignal(), numberPage)` starts without being awaited, and a rejection handler is attached right away.
- `untilPhaseEnd` waits for a read but gives up when the phase ends. `drainReads` collects reads that finished but were never noted.
- The FR24 limit is applied per request inside `server/src/web/tools.ts` `post` (`AbortSignal.timeout`), so each prefetched read keeps its own limit.

Test Evidence:
- `deepResearchBreadthFirst.test.ts` AC2a: max concurrent model calls is 1, at least 2 reads are in flight, and reads start before the first note request.
- AC2b: the research deadline aborts every hanging read's signal.
- AC2c: a first Stop aborts every in-flight read.
- `research.test.ts`: the FR36 budget test now sees `[true, true, true]`.
- `server/src/web/tools.test.ts:308`: per-request client timeout.

Result:
PASS

Acceptance Criterion:
M19d-AC3: Server tests: when the deadline cuts a note call, every complete note already present in its partial output is kept and still quote-checked; a run that ends with no notes because research time ran out ends `failed` with the sentence "The research ran out of time before it could take notes." instead of blaming the pages.

Implementation Evidence:
`research.ts`: `sendAttempt` throws `PhaseTimeUp(content)` for a cut-off `notes` call. `completeNotesFromPartial` pulls out the complete notes, `noteNext` passes them through `keepNotes` (quote check against the full page text), and the end-of-run sentence choice (`failureNote`) uses `RAN_OUT_OF_TIME_NOTE`.

Test Evidence:
`server/src/http/deepResearchPartialNotes.test.ts` covers AC3a, AC3b, and two AC3c regression tests (could-not-read and could-not-search). `research.test.ts` has the `completeNotesFromPartial` unit tests.

Result:
PASS

## Findings

Severity:
IMPORTANT

Problem:
A search that **failed** is treated as "a search round that adds no new URLs", and that ends the sub-question's searching. Failures include an FR24 timeout, a 5xx response, a network error, or a backend that is unavailable. `webTools.search` returns `results: []` on failure (`server/src/web/tools.ts` `webSearch`, failure branch). So `searchOnce` returns `added = 0`, and round 1 runs `sq.searchOver = true; break` after that one search. If it was the sub-question's first search, there are no candidates: `choosePages` returns at once and the sub-question ends with no page read. Before M19d the loop moved on to the next query until the FR35 server-set minimum was reached (`if (searches < s.minSearches) continue;`).

Evidence:
- `server/src/generations/research.ts` round-1 loop: `if (added === null || added === 0) { sq.searchOver = true; break; }`.
- The later-rounds loop: `if (added === 0) { sq.searchOver = true; continue; }`.
- `searchOnce` counts `added` without checking whether the search succeeded.
- The only test of this path is `server/src/http/deepResearchBreadthFirst.test.ts` AC1b, "a later search that returns nothing ends that sub-question's searching", and it uses a search that succeeded with no results. No test covers a failed search.

Why it matters:
FR35 requires a server-set minimum number of searches per sub-question, and the gap model is never the only stopping rule. FR44's early end is a redundancy rule: the round found nothing new. A temporary search failure says nothing about redundancy. As written, one transient timeout or backend error leaves a whole sub-question unresearched. Reports get thinner in exactly the live conditions FR24 and FR39 describe, and this is a regression from the baseline.

Suggested correction:
Apply the FR44 early end only to a search that succeeded: its search step status is `done`, or more simply `results.length > 0` and every result was already known. A failed search should still count toward `maxSearches` but should not set `searchOver`, so the `minSearches` floor still applies. Add a POST /v1/chat test where a sub-question's first search fails (status `failed` or `unavailable`) and its next query succeeds. The test should show that the sub-question searches again, gets its first page, and breadth-first order still holds.
