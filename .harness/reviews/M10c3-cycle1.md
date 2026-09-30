# M10c3 — Review cycle 1 (WHOLE_MILESTONE)

Diff: `d4a4e67..949dd2d` on m10c3-readable-tables. Reviewer tier Top (opus, AMBIGUOUS).

Validation re-run by reviewer: `cd mobile && bun run typecheck && bun test && bun run lint` — exit 0; 380 pass, 0 fail across 26 files; tsc and eslint clean. Full output: `.harness/evidence/M10c3-review.log`.

Verdict: **CHANGES REQUIRED**

## Acceptance criteria

```
Acceptance Criterion:
M10c3-AC1 — Unit tests: a table shaped like the 2026-09-30 phone screenshot (trend, description, source columns) renders each value under its own heading, and the diagnosed cause of that misalignment (model output shape vs. the FR26 renderer) is covered by a test that fails on the pre-fix code.

Implementation Evidence:
mobile/src/ui/markdown.ts fitRow (pads short rows to the header's width; surplus joined into the last column).

Test Evidence:
mobile/src/ui/markdown.test.ts "FR29: a trend / description / source table puts each value under its own heading" (uses a well-formed 3-cell row, which the baseline parser already handled correctly) and "FR29: a body row with fewer cells than the header is padded..." (the pinning test; fails on baseline, [3,2] vs [3,3]).

Result:
FAIL
```

Reason: the milestone's own diagnosis says the screenshot table had a body row with only two real cells ("trend — description | source"). For that shape, the pinning test asserts `rows[1][1]` is the Reuters link (i.e. the source sits under "What's happening") and `rows[1][2]` is empty (the Source column is blank). That is the owner's reported symptom, now rendered as a card reading "What's happening: Reuters" / "Source:". So, by the diagnosis, a screenshot-shaped table does not render each value under its own heading; the screenshot-shaped test that passes uses a well-formed row that already passed before the change. See Finding 1.

```
Acceptance Criterion:
M10c3-AC2 — Unit tests: a body row with fewer cells than the header row is padded with empty cells, and a body row with more cells keeps the surplus text joined into the last column; no text is dropped and no value moves to another column.

Implementation Evidence:
mobile/src/ui/markdown.ts fitRow, called from scanBlocks for every body row with header.length; mobile/src/ui/tableLayout.ts normaliseRow (defensive).

Test Evidence:
markdown.test.ts "…fewer cells than the header is padded…" ("| x |" -> [x], [], []), "surplus body cells are joined into the last column…" ("1 | 2 | 3 | 4" under 2 headings -> [1], ["2 | 3 | 4"]; pipe inside link label restored); tableLayout.test.ts short/long rows.

Result:
PASS
```

```
Acceptance Criterion:
M10c3-AC3 — Unit tests: a two-column table renders as a grid, and a table of three or more columns renders as one card per body row listing "heading: value" per column on its own line; inline formatting and links inside cells render as in FR26/FR27.

Implementation Evidence:
mobile/src/ui/tableLayout.ts (columns <= 2 -> grid, else cards of {heading, value}); mobile/src/ui/MarkdownText.tsx table case (grid rows with flex cells; cards as bordered Views with one Text line per column, bold heading + ": " + value, all through renderInline so bold/code/links/SourceLogo behave as FR26/FR27).

Test Evidence:
tableLayout.test.ts grid / cards / Inline pass-through (bold, link, code); markdownText.test.ts "MarkdownText renders tables through tableLayout (FR29)" source-text wiring checks (same static-inspection pattern as the existing markdownText.test.ts).

Result:
PASS
```

```
Acceptance Criterion:
M10c3-AC4 — Unit tests: a table still streaming (header only, or half a body row) renders without error, and a saved (reopened) reply's table renders the same way as a live one.

Implementation Evidence:
markdown.ts table scan + fitRow (half row padded); tableLayout.ts handles header-only and empty input; mobile/src/app/chat.tsx:415 renders both streaming and saved assistant messages through the same <MarkdownText text={item.content}> path.

Test Evidence:
markdown.test.ts "a table still streaming parses and keeps header width" and "every streamed prefix of a table parses with header-width rows…"; tableLayout.test.ts "header-only tables do not throw".

Result:
PASS
```

(The chunked-equals-whole half of the last test is tautological; see Finding 2. Saved-equals-live holds structurally because both use the same component and parser on the same text.)

```
Acceptance Criterion:
M10c3-AC5 — Owner's phone observation in Expo Go (recorded in evidence): an answer containing a three-or-more-column table shows one card per row with every value under its own heading, and a two-column table shows as an aligned grid, with no sideways scrolling.

Implementation Evidence:
MarkdownText.tsx table case (no ScrollView/horizontal container).

Test Evidence:
none found — milestones.md records it as OWED; no observation in .harness/evidence.

Result:
FAIL
```

Not a code defect: this needs the owner's phone check, recorded in evidence. It should be done after Finding 1 is settled, since the check itself ("every value under its own heading") depends on that decision.

## Findings

### Finding 1

Severity:
IMPORTANT

Problem:
The diagnosed cause of the 2026-09-30 misalignment is pinned but not fixed. According to the diagnosis, the model wrote "trend — description | source" under a 3-column header. After this change, that row still shows the source under "What's happening" and an empty "Source". The fix only changes the look (the cells no longer stretch to half-width). The follow-up says this is a "product decision left to owner", but no owner decision is recorded. Meanwhile the pinning test locks in the wrong placement as expected behaviour.

Evidence:
mobile/src/ui/markdown.test.ts, test "FR29: a body row with fewer cells than the header is padded, so cells stay under their headings": `expect(rows[1]?.[1]).toEqual([link("https://reuters.com", t("Reuters"))]); expect(rows[1]?.[2]).toEqual([]);`. .harness/milestones.md M10c3 Follow-ups (4th bullet); .harness/state.json line ~8128 ("product decision left to owner"). The milestone Outcome says "shows each body cell under its own column heading … nothing dropped or shifted", and requirements FR29 says "never … shifted".

Why it matters:
The owner asked for the screenshot table to line up. If the diagnosis is right, the table they will see after this milestone still has the source under the wrong heading. If the diagnosis is wrong, the real cause is not pinned. Either way AC1's intent ("a table shaped like the screenshot renders each value under its own heading") is not met. The milestone would close with the reported problem still there and the decision about it still unmade.

Suggested correction:
Put the open question to the owner and record the answer in milestones.md/requirements.md before this milestone is closed. The two options:
(a) Accept a padded row as the answer for badly written model output. Then amend FR29/AC23/M10c3-AC1 to say a row missing a separator is padded, not re-split, and keep the test as it is.
(b) Handle that shape. For example, when a row is exactly one cell short and its first cell contains a " — " / " – " / "：" / full-width "｜" separator, split there. Add a test showing the screenshot-shaped malformed row renders the source under "Source".
I lean to (a) plus a clear AC wording change, because re-splitting is heuristic. But this is the owner's call, and it cannot stay unrecorded while AC1 is marked met.

### Finding 2

Severity:
OPTIONAL

Problem:
The "whole text parses the same however it arrived" assertion is tautological. `streamed` is built by concatenating chunks of `full`, so `streamed === full` and `parseMarkdown(streamed)` equals `parseMarkdown(full)` trivially. It proves nothing about streaming or saved replies.

Evidence:
mobile/src/ui/markdown.test.ts, test "FR29: every streamed prefix of a table parses with header-width rows, and the whole text parses the same however it arrived" (the `chunks` / `streamed` lines).

Why it matters:
It reads as evidence for AC4's "saved renders the same as live", but it could never fail. The real guarantee is structural (chat.tsx uses one MarkdownText path for both).

Suggested correction:
Drop the chunk/concat lines, or replace them with a comment pointing at the single render path in chat.tsx.

### Finding 3

Severity:
OPTIONAL

Problem:
tableLayout.normaliseRow repeats the parser's row fitting with a different surplus join (" " text node versus the parser's " | "). Since fitRow already guarantees header-width rows, this path is unreachable from parseMarkdown. If it ever ran, it would join text differently.

Evidence:
mobile/src/ui/tableLayout.ts normaliseRow; mobile/src/ui/markdown.ts fitRow; recorded in milestones.md M10c3 Follow-ups (5th bullet).

Why it matters:
Two sources of truth for one rule (unnecessary complexity). If they diverge further, that is a latent inconsistency.

Suggested correction:
Either make normaliseRow join with `{ type: "text", text: " | " }` to match the parser, or drop the surplus branch and document that tableLayout expects header-width rows from parseMarkdown.
