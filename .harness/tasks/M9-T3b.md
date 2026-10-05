TASK M9-T3b — Tier: Cheap (haiku). Routing: reason_code BOUNDED_LOW_RISK — mechanical fixture update after a settled interface change; the typecheck settles it.

Goal:
Task M9-T3 made `Model.tools: boolean` required in shared/api.ts (architecture route table: `models:[{name,size_bytes,tools}]`). Two mobile test files build `Model` literals without it, so `cd mobile && npx tsc --noEmit` fails with 12 errors "Property 'tools' is missing in type '{ name: string; size_bytes: number; }' but required in type 'Model'". Add `tools: false` to each such literal.

Relevant Requirements:
- M9-AC1 (GET /v1/state reports each model's tools capability); the shared contract type is the source of truth.

Acceptance Criteria:
1. Every `Model` object literal in mobile/src/ui/modelList.test.ts (11 places) and mobile/src/ui/modelActions.test.ts (1 place) gains `tools: false`. Nothing else in those files changes — no assertion, test name, or other value.
2. `cd mobile && npx tsc --noEmit` exits 0.
3. The mobile tests for those two files still pass (use the repository's mobile test runner; find it in mobile/package.json "scripts").

Relevant Files:
- mobile/src/ui/modelList.test.ts, mobile/src/ui/modelActions.test.ts, shared/api.ts (read only), mobile/package.json

Files Allowed To Change:
- mobile/src/ui/modelList.test.ts
- mobile/src/ui/modelActions.test.ts

Constraints:
- Do not change shared/api.ts, server/, or any other file. Do not weaken tests. Never push, never git stash; do not commit.
- The working tree already contains uncommitted M9-T3 server/shared changes; leave them alone.

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2/mobile && npx tsc --noEmit && bun test src/ui/modelList.test.ts src/ui/modelActions.test.ts; then cd ../server && bun test && bun run typecheck
Save the full green output to .harness/evidence/M9-T3b-worker.log. (No Red step: this is a type-only fixture repair whose failing state is the current typecheck — save the current failing `npx tsc --noEmit` output first to .harness/evidence/M9-T3b-red.log.)

Return:
- Summary
- Files changed
- Tests run
- Test result
- Unresolved issues
(Use the full Return contract in your agent definition.)
