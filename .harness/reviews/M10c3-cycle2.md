# M10c3 review, cycle 2 (correction diff 949dd2d..HEAD, all ACs graded)
Validation: typecheck, bun test (380 pass, 0 fail), lint all exit 0 (run by reviewer).

| AC | Result | Evidence |
|---|---|---|
| M10c3-AC1 | PASS | markdown.test.ts: merged-cell row stays whole in column 1, padded, last column empty; pinning test fails on baseline (per T1 RED log). |
| M10c3-AC2 | PASS | markdown.test.ts pad/surplus " | "; tableLayout.test.ts defensive rows; tableLayout.ts normaliseRow now joins " | " like fitRow. |
| M10c3-AC3 | PASS (unit level) | tableLayout.test.ts grid/cards; MarkdownText.tsx lines 120-158 card branch uses heading: value. Owner phone contradicts at runtime, see AC5. |
| M10c3-AC4 | PASS (unit level) | markdown.test.ts streaming prefixes; saved = live via single MarkdownText path. |
| M10c3-AC5 | FAIL | Owner phone observation FAIL (.harness/evidence/M10c3-AC5-owner-phone-1.log/.png). |

## Finding 1
Severity: BLOCKER

Problem: AC5 failed. The owner saw a 3-column table as a side-by-side grid with unequal column starts, no "heading: value" labels and mid-word breaks, plus a last row that never "snapped" into place.

Evidence: .harness/evidence/M10c3-AC5-owner-phone-1.png and .log. At HEAD 5ccf325, tableLayout() returns kind "cards" for 3+ columns and MarkdownText.tsx renders tableCard with "heading: value" lines; no other renderer of tables exists in the diff scope. The screenshot is therefore inconsistent with HEAD code (card branch never produces a flex:1 row grid). Reviewer could not reproduce on the Mac and did not inspect the running bundle. Candidate causes, unverified: Expo Go running a stale/cached bundle predating 30fa036, OR a real runtime path that bypasses the card branch (e.g. streaming or a column count other than the header's, such as a 2-column header with 3-cell rows, which would render as grid and be parsed as 2 columns). The "snaps into place once the next item starts" remark suggests per-row cell-count differences, i.e. old pre-T1 parsing behaviour.

Why it matters: AC5 is the only real-device proof of the milestone outcome; unit tests pass but the owner-visible outcome is not demonstrated.

Suggested correction: (1) Have the owner restart Metro with cache clear (expo start -c) and force-reload, confirm the bundle includes 30fa036 (e.g. temporary visible marker or log), and re-observe with the same web-table prompt; record as attempt 2. (2) If it still fails, capture the raw markdown of that answer from the saved message and add it as a test fixture (parseMarkdown + tableLayout) to find the diverging path (check header column count, leading/trailing pipes, and header-with-fewer-columns cases). (3) Keep AC5 open until the owner records PASS.

## Optional
None.
