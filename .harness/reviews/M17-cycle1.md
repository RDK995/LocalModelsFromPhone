# M17 review cycle 1 - CHANGES REQUIRED

Validation re-run at fa2ee80: server bun test 239 pass 0 fail; server typecheck exit 0; mobile typecheck exit 0. Log: .harness/evidence/M17-review.log

Acceptance Criterion: M17-AC1
Implementation Evidence: server/src/generations/research.ts:248-279 (budget, research/final deadlines, per-phase AbortSignal.any, checkDeadline), :329/:455/:488 (checks before model/read/search), :524-529 (deadline -> write), :270-271 and :576-580 (elapsed_ms/budget_ms on steps, research{status,elapsed_ms,budget_ms} on done); shared/api.ts DoneEvent.research, StepEventData.elapsed_ms/budget_ms
Test Evidence: research.test.ts "AC1: once research time has passed, no further search, read or research model request starts..." and "a run inside its budget ends complete; every step and the done event carry elapsed..."; deepResearch.test.ts "AC1: a slow step uses up research time..."
Result: PASS

Acceptance Criterion: M17-AC2
Implementation Evidence: research.ts:535 (failed = searches run, none with results, no page read), :556 COULD_NOT_SEARCH_NOTE, :567-568 content + sources, :577 research.status failed
Test Evidence: research.test.ts "AC2: with every search failed or unavailable..." (both statuses, within budget+500ms, steps present); deepResearch.test.ts "AC2: every search failing ends within budget..."
Result: PASS

Acceptance Criterion: M17-AC3
Implementation Evidence: research.ts:460/:493/:332 pass phaseSignal() to every read/search/model call; :341-344 deadline abort never retried; :549-552 write cut by final deadline -> writeCutShort; :556-566 notes-gathered / NO_REPORT_NOTE fallback; web/tools.ts post() keeps its own AbortSignal.timeout (FR24) combined with caller signal
Test Evidence: research.test.ts AC3 tests (hanging search, long-delayed search, hanging read, hanging model request not retried, hanging write with notes, hanging write with no notes); deepResearch.test.ts AC3a (search, read, model) and AC3b
Result: PASS

Finding 1
Severity: IMPORTANT
Problem: A run that read no pages and gathered no notes (searches returned results but every read failed or produced nothing) still asks the model to write a report from "(none yet)" notes and labels the run research.status "complete". FR36 defines complete as finished normally, partial as including "with gaps", and failed as "no usable material". Zero pages read is no usable material, yet the status says complete and the answer is whatever the model invents.
Evidence: server/src/generations/research.ts:535 (`failed` requires searchesWithResults === 0, so results-but-no-reads is never failed) and :577 (status only partial on deadline cut or empty write). Reproduced at fa2ee80 with a scratch run (search returns 1 result, read returns page null, write returns "Made-up answer with no sources."): done.research = {"status":"complete",...}, sources [].
Why it matters: M17 owns FR36's status; the phone (M18) shows this label. A sourceless, model-invented report shown as "complete" is the misleading outcome the status exists to prevent.
Suggested correction: Classify by usable material, not only by search results: if no page was read (readNumbers.size === 0), or no verified note survived, end as failed (skip the write and give a plain sentence - the could-not-search note, or a sibling "could not read any pages" sentence) or at minimum as partial. Add a research.test.ts case (results returned, every read fails) asserting the chosen status and that no uncited report is labeled complete.

Finding 2
Severity: OPTIONAL
Problem: parseResearchBudget (the PHONE_MODELS_RESEARCH_BUDGET_MS server setting) has no test; valid, absent, zero, negative, non-numeric and oversized values are unproven.
Evidence: server/src/index.ts:72-76, :86-87; no reference to parseResearchBudget in any *.test.ts.
Why it matters: FR36 makes the budget a server setting; a parse regression would silently fall back to 480000 or pass a bad value.
Suggested correction: Add a small unit test for parseResearchBudget covering "600000" -> 600000, undefined/""/"0"/"-5"/"abc"/"1e3" -> undefined, and " 1000 " -> 1000.

## Checklist notes
- Architectural drift: changes match D-M17-1 (recorded, Material: no); no undeclared drift.
- Regressions: ordinary replies untouched; full server suite green; mobile typecheck green with the additive optional fields.
- Security / scope creep: none found.

## Verdict
CHANGES REQUIRED (1 IMPORTANT, 1 OPTIONAL). All three acceptance criteria PASS; the IMPORTANT finding is the FR36 status for a run that read no pages.
