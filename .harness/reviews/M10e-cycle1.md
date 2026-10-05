# M10e review, cycle 1 (whole milestone)

Verdict: CHANGES REQUIRED
Scope: RECORD_ONLY
Diff reviewed: `git diff 1b139be HEAD` (chat.tsx +5 lines, new answerLayout.test.ts, yoga-layout devDependency, .harness records/evidence)
Validation re-run by reviewer: `cd mobile && bun run typecheck && bun test && bun run lint` exit 0, 434 pass 0 fail; log at .harness/evidence/M10e-review.log.
Independent RED check: removing the `width: "85%"` line from chat.tsx assistantMessage made answerLayout.test.ts fail 4 of 7 (saved text bottom 1136 > 369.17; streaming 611.33 > 258.83; first-words width 46 vs 306.85; one-line 108 vs 306.85). With the line restored, all 7 pass. chat.tsx was restored afterwards.

## Acceptance criteria

Acceptance Criterion:
M10e-AC1: A test reproduces an answer shaped like the 2026-09-30 22:32 phone screenshot (a bulleted news-list web reply with a Sources list) and shows, for both the live-streaming and reopened-saved forms, that the answer takes the full bubble width and nothing overlaps the answer text, with "Sources (n)" and the model name below it; the diagnosed cause is recorded.

Implementation Evidence:
mobile/src/app/chat.tsx `styles.assistantMessage` now has `width: "85%"`, with a comment explaining the cause. The cause is also written up in .harness/milestones.md, M10e Evidence: a shrink-wrapped bubble plus `listText { flex: 1 }` under Yoga's errata mode (Errata.All).

Test Evidence:
mobile/src/ui/answerLayout.test.ts: "reopened from saved history ..." and "while streaming ..." both assert full bubble width, that the text bottom sits inside the bubble, and that the text sits above the Sources header, the spinner and the model label. Style values are read from the real StyleSheet blocks. The reviewer ran the RED/GREEN check independently (above).

Result:
PASS

Acceptance Criterion:
M10e-AC2: The existing FR26-FR31 rendering tests pass unchanged (none edited or weakened), and mobile typecheck, tests and lint pass.

Implementation Evidence:
The diff changes no existing test file. The only test file is the new answerLayout.test.ts.

Test Evidence:
Reviewer ran typecheck, tests and lint: exit 0, 434 pass, 0 fail (.harness/evidence/M10e-review.log).

Result:
PASS

Acceptance Criterion:
M10e-AC3: The owner's phone screenshot of a new web answer, taken after the phone has loaded the new code, shows the answer at full width, entirely inside its bubble, with "Sources (n)" and the model name below it.

Implementation Evidence:
.harness/evidence/M10e-AC3-owner-phone.png: a finished web reply with Web search on. The grey bubble is about 85% wide, every line is inside it, and "Sources (8)" is below the text inside the bubble.

Test Evidence:
The model name is not in the frame. The screenshot ends at the bubble's bottom edge, just above the input bar. The milestone's own Evidence line says the same thing. The coordinator relayed a statement from the owner that the model name does appear under the bubble on the phone. That statement is not in any .harness artifact and cannot be checked from the evidence. The criterion requires the screenshot itself to show the model name.

Result:
FAIL

## Findings

Severity:
IMPORTANT

Problem:
The M10e-AC3 evidence does not show the model name below the answer, and the criterion requires it ("with 'Sources (n)' and the model name below it"). The model label is the one element FR32 names that can still collide with or hide behind other content. It is drawn outside the bubble, in messageGroup, after the bubble's marginBottom. So it is the part a screenshot most needs to prove.

Evidence:
.harness/evidence/M10e-AC3-owner-phone.png: the bottom of the grey bubble meets the input bar and no model label is visible. .harness/milestones.md, M10e Evidence, AC3 bullet: "The model name line is not in frame". The AC3 checkbox is still unticked.

Why it matters:
AC3 is the only on-device proof for FR32/AC26. The computed-layout test uses an approximate text measure and says itself that it "reproduces the mechanism, not exact device pixels". The owner's verbal report, relayed by the coordinator, is not a recorded artifact, so the milestone cannot be closed on it as the criterion is written.

Suggested correction:
Preferred: have the owner take one more screenshot of the same (or a new) web answer, scrolled so that the bubble's bottom edge, "Sources (n)" and the model name below the bubble are all in frame. Save it as AC3 evidence (for example .harness/evidence/M10e-AC3-owner-phone-2.png) and update the M10e Evidence bullet. Alternative, only if the owner chooses it: record the owner's dated direct observation in the M10e Evidence as an owner-approved substitute for the model-name part of AC3. That is an owner decision to change the evidence the criterion requires, not something a fix cycle should do on its own.
