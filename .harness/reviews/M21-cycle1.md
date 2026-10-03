# M21 Review — cycle 1

Verdict: CHANGES REQUIRED
Scope: RECORD_ONLY
Diff: `git diff 6d89bfe98a3e3738c194926b432f77787f808c7b 00611bc` (branch m21-live-research-proof)
Validation log: .harness/evidence/M21-review.log

## Validation run

- The command recorded under M21 ### Validation was run exactly as written. It **exits 1**: `ac29-live-run.ts` exited 2 with `tool error: ENOENT: no such file or directory, open '../.harness/evidence/validation/M21-review-q1-check.log'`.
- I then ran it again with the FR41 input logs swapped in (`--log ../.harness/evidence/M21-T6-<id>-fr41.log`):
  - The four check-only runs (q1, q2, q3, heat) each exited 0 with `pass true`.
    - Wall times: 211.278, 196.081, 201.342 and 215.144 s (limit 540).
    - `final_status` was `complete` for all four.
    - Each run read 6 distinct pages and cited 6 read pages.
    - `unresolved_citations` was `[]` for all four.
  - `shasum -a 256` gave identical hashes for each pair (9898539e... and 14bf64ee...).
  - `cd server && bun test` passed 380, failed 0. `bun run typecheck` exited 0.

## Acceptance criteria

Acceptance Criterion:
M21-AC1 — Live on the Mac with `qwen3.5:35b-a3b` resident, 3 real research-style questions plus the 2026-10-02 heat-pump question each end within budget plus a small margin, with status complete/partial, a report citing at least 3 distinct read pages, and no unresolved citation number. The owner's opinion is recorded (not a gate).

Implementation Evidence:
- Live run streams and results: .harness/evidence/M21-T6-{q1,q2,q3,heat}-stream.txt and -result.json.
- In-milestone fix at server/src/web/tools.ts:188-190: the read `done` step now carries `finalUrl`, the same URL as the `source` event and `page.url`. This matches FR31 (pages are identified by their final URL after redirects).
- Owner opinion: the "OWNER OPINION 2026-10-03" entry in the M21 Evidence of .harness/milestones.md.

Test Evidence:
- The reviewer re-ran check-only on all four T6 streams, with results as above (.harness/evidence/M21-review.log).
- New test in server/src/web/tools.test.ts: "M21-T5: a redirected read's done step and its saved source name the same final URL". One existing expectation was updated to the final URL. This is consistent with the fix and does not weaken the test.
- Full server suite green.

Result:
PASS

Acceptance Criterion:
M21-AC2 — The owner's phone screenshot of a finished deep research reply showing its steps, status, logo citations and "Sources (n)" is saved under .harness/evidence/.

Implementation Evidence:
- .harness/evidence/M21-AC2-phone-screenshot-1.png and -2.png. Both are byte-identical to the uploaded originals; I re-checked the sha256 hashes.
- I viewed both images:
  - Image 2 shows "Deep research: complete" and the web steps (Planning, Searching..., Reading: bbc.co.uk, ... Writing report).
  - Images 1 and 2 show inline site-logo citations.
  - Image 1 shows "Sources (6)" expanded with six entries.

Test Evidence:
- shasum output in .harness/evidence/M21-review.log.
- .harness/evidence/M21-T4-verifier.log.
- The reviewer's own viewing of both images.

Result:
PASS

## Findings

Severity:
IMPORTANT

Problem:
The M21 validation command fails as recorded, with exit 1. `ac29-live-run.ts` exits 2 with ENOENT. In `--check-only` mode, `--log` names an **input** FR41 log that the script reads (`readFileSync(logFile)` at server/scripts/ac29-live-run.ts:307-308). It is not an output path. The recorded command points it at the file that does not exist, `../.harness/evidence/validation/M21-review-$id-check.log`.

Evidence:
- .harness/milestones.md, M21 ### Validation.
- .harness/state.json:13681, the M21 validation command.
- The first lines of .harness/evidence/M21-review.log.
- Earlier milestones use this script correctly, for example .harness/state.json:12356 (M19g) with `--log ../.harness/evidence/M19g-T7-$id-fr41.log`.

Why it matters:
The milestone's acceptance command cannot reproduce the result it claims. Anyone who re-runs it, such as a later reviewer, a regression check or the completion gate, gets a failure. The substance is sound: with the right inputs, all four runs pass.

Suggested correction:
In both .harness/milestones.md (M21 ### Validation) and .harness/state.json:13681, replace `--log ../.harness/evidence/validation/M21-review-$id-check.log` with `--log ../.harness/evidence/M21-T6-$id-fr41.log`. No production code or test change is needed.

Severity:
OPTIONAL

Problem:
The fix changes what the user sees, beyond deep research. The finished read step for a redirected page now shows the final host in web chat too. mobile/src/api/client.ts:1008 merges `url` per step_id, so the finished step's URL replaces the requested one. This is recorded as a side effect in the M21-T5 evidence, but no mobile test pins the behaviour.

Evidence:
server/src/web/tools.ts:190 and mobile/src/api/client.ts:1008.

Why it matters:
It is low risk and consistent with FR31. It is noted only so that the UI change is a known one.

Suggested correction:
None required. Optionally, record it in M21 As-Built.
