# M19b review, cycle 1

Verdict: CHANGES REQUIRED (record-only)

Diff reviewed: `git diff ba44206 85836a9` (branch m19b-model-call-logging-thinking-caps).

## Validation (re-run independently at 85836a9)

- `cd server && bun test`: 290 pass, 0 fail (17 files)
- `bun run typecheck` (`tsc --noEmit`): clean
- `bun test src/http/deepResearchModelCalls.test.ts` x3: 16 pass, 0 fail each run
- Full output: `.harness/evidence/M19b-review.log`

## Acceptance criteria

Acceptance Criterion:
M19b-AC1: every deep research model call writes exactly one structured log line with the FR41 fields; loading/warming the deep-research model sends the research `num_ctx`; no global Ollama context setting changed; ordinary replies' requests unchanged.

Implementation Evidence:
`server/src/generations/research.ts` `sendAttempt` writes one `log(...)` per request in its `finally` (step, think, attempt, wall_ms, load_duration, prompt_eval_count, prompt_eval_duration, eval_count, eval_duration, thinking_chars, thinking_detected, outcome); `logModelCall` is the default stdout logger. `server/src/generations/manager.ts` adds `researchNumCtx()` and log injection. `server/src/models/manager.ts` calls `load(name, {num_ctx})` only for the configured research model. `server/src/http/server.ts` passes `{model: researchModel, numCtx: genManager.researchNumCtx()}` into ModelManager. `server/src/ollama/client.ts` `load(name, options?)`. The only load path is `ModelManager.load` (grep). No env or global context change.

Test Evidence:
`server/src/http/deepResearchModelCalls.test.ts`: "writes exactly one log line per model request, with every field" (logs.length == requests.length, every field asserted); invalid->retry and stream-error log tests; "loading the deep-research model sends the research num_ctx; another model sends no options"; "ordinary web and switch-off replies send no new request fields and write no research log line". `client.test.ts` load body test; `models/manager.test.ts` num_ctx only for the research model.

Result:
PASS

Acceptance Criterion:
M19b-AC2: routine steps sent with `think:false`, `num_predict` (200 / 800 notes, settings), sampling 0.7/0.8/20; plan and write think, streamed, never `num_predict`; `format` and `num_ctx` as before; thinking text on a thinking-off reply detected, logged, used only if content validates.

Implementation Evidence:
`research.ts` `modelStep`: `thinks = plan|write`; routine options `{num_ctx, num_predict, ...routineSampling}`, plan/write options `{num_ctx}`; `format` unchanged; `thinking_detected = request.think === false && thinkingChars > 0`; only `message.content` is parsed and validated.

Test Evidence:
`deepResearchModelCalls.test.ts` request-shape test (all seven steps observed, non-default numCtx), settings test (123/456), "thinking-off reply that also carries thinking text is detected, logged and still used", "JSON only in thinking is not used: invalid, thinking detected, step retried"; `research.test.ts` per-step think test.

Result:
PASS

Acceptance Criterion:
M19b-AC3: a thinking-off call past its hard wall-clock cap (default about 30 s) is cancelled, counts as a failed attempt under FR35, and the run carries on.

Implementation Evidence:
`research.ts` `sendAttempt`: timer at `routineCapMs` (default 30000) aborts an attempt-owned controller combined via `AbortSignal.any` with the phase signal; classified after hard-cancel and phase checks as outcome `timeout`, returned as a failed attempt; `modelStep` retries up to `retries + 1` then returns null (skip).

Test Evidence:
"AC3: a thinking-off call past its cap is aborted, logged 'timeout', retried and the run completes"; "AC3: a thinking-off step that hits its cap on every attempt is skipped after retries + 1 and the run carries on" (gap attempts `[1,2,3,1,2,3]`, run complete).

Result:
PASS

Acceptance Criterion:
M19b-AC4: plan/write thinking past its guard (30 s / 60 s defaults, write guard inside the FR36 reserve) is cancelled and re-issued once with `think:false`, never truncating an answer; a failed re-issue falls to FR35/FR36 rules and the run still ends complete/partial/failed.

Implementation Evidence:
`research.ts`: guard timer at `planGuardMs` / `writeGuardMs`, stopped on the first answer-content chunk; `guardFired` -> exactly one re-issue `{...request, think:false, options:{num_ctx}}`, returning its value or null; a null write falls to the existing notes write-up.

Test Evidence:
Defaults test (60000 < 480000 x 0.25); plan guard re-issue test; write guard re-issue used as the answer; write guard plus invalid re-issue -> exactly two write requests, `partial` with notes; answer started before the guard and finishing after it is never aborted.

Result:
PASS

## Findings

### F1

Severity:
IMPORTANT

Problem:
Undeclared architectural deviation. The recorded interface I9/I10 (`.harness/architecture.md` line 242) defines `load(name)` = `POST /api/generate {model, keep_alive:-1}`. This milestone changes it to `load(name, options?)`, which sends `options: {num_ctx}` for the deep-research model. C5 (Model manager) is now built with the research model name and C6's `researchNumCtx()`. FR41/FR42 are now realised across C5, C6 and C7. None of this is recorded under `## Deviations`. Every earlier deep research milestone recorded its equivalent change there (D-M15-1, D-M17-1, D-M18-1, D-M19-1), and there is no D-M19b-1.

Evidence:
`server/src/ollama/client.ts` `load(name, options?)`; `server/src/models/manager.ts` constructor `research` parameter and conditional `load(name, {num_ctx})`; `server/src/http/server.ts` line 420; `.harness/architecture.md` I9/I10 at line 242 and `## Deviations` (line 384 onward, no M19b entry).

Why it matters:
The architecture no longer describes the C5->C7 load contract or which component owns FR41/FR42. Later milestones (M19c-M19h) build on these seams and will be judged against a stale document.

Suggested correction:
Record the deviation; do not conform. The change is the smallest seam that satisfies FR41 and was correct to make. Add `D-M19b-1` under `## Deviations` (Material: no). It should cover: I9 `load(name, options?)` sending `options.num_ctx` on `/api/generate` for the deep-research model only; C5 receiving the research model and C6's research `num_ctx` at construction; FR41 -> C5, C6, C7 and FR42 -> C6 (with C7 for `think`/`num_predict`/sampling); the new research settings (`routineNumPredict`, `notesNumPredict`, `routineSampling`, `routineCapMs`, `planGuardMs`, `writeGuardMs`, the `think` setting removed); and the `deep_research_model_call` stdout log line. Why: no component boundary, technology or ownership changes.

### F2

Severity:
OPTIONAL

Problem:
`writeGuardMs` (60 s) is not kept inside the write reserve when the budget is configured. `index.ts` passes an env-configured `budgetMs`. With a budget under 240 s the reserve (`budgetMs * writeReserveFraction`) is shorter than the guard. The write phase deadline then fires first, and the think:false re-issue never happens.

Evidence:
`server/src/generations/research.ts` `limit` computation in `modelStep`; `server/src/index.ts` line 97.

Why it matters:
FR42 says write's guard fits inside the FR36 write reserve. This holds only for the defaults.

Suggested correction:
Use `Math.min(s.writeGuardMs, writeReserveMs / 2)` (or similar) for the write guard, with a test using a small `budgetMs`.

### F3

Severity:
OPTIONAL

Problem:
The case where the plan guard fires and the plan re-issue also fails (FR35 skip of plan) is not tested. Only the write version of that path is covered.

Evidence:
`server/src/http/deepResearchModelCalls.test.ts`: the plan guard test always has a valid re-issue.

Why it matters:
AC4's "if the re-issue also fails" applies to plan as well. The code path is shared (`return again.ok ? again.value : null`), so the risk is low.

Suggested correction:
Add a test where the plan re-issue returns invalid JSON. Assert exactly two plan requests, logs `guard` then `invalid`, and the run reaching `done`.

### F4

Severity:
OPTIONAL

Problem:
Callers of `runResearch` that pass no `log` (for example `research.test.ts`) fall back to the default `console.log`. As a result, the full test run prints many `deep_research_model_call` JSON lines.

Evidence:
`server/src/generations/research.ts` `const log = opts.log ?? logModelCall`; `.harness/evidence/M19b-review.log` head.

Why it matters:
This is noise in the test output only. Behaviour is correct.

Suggested correction:
Pass a no-op `log` in the `research.test.ts` helper.
