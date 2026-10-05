TASK M3-T2b — Runtime smoke keeps all three token scenarios meaningful with the conversation list as the landing screen; lint clean

Routing: tier Mid, model sonnet, reason_code ORDINARY_IMPLEMENTATION
  detail: extends an existing from-scratch VM smoke harness with one more native-module fake and a longer drive path; clear oracle (smoke:runtime exit 0 with all three scenarios asserting what they asserted before).

Goal:
M3-T2 (committed) made the conversation list the landing screen after a valid token and moved
sending into a stored conversation backed by AsyncStorage. `bun run smoke:runtime` bundles the app
and runs it in a harness with faked native modules; it has no AsyncStorage fake, so store calls
hang there, and its expected landing screen / drive path still assume Chat is the landing screen.
Make the smoke pass again without dropping or loosening any of its three scenarios, and fix the
lint errors left behind.

Relevant Requirements:
FR7 (.harness/requirements.md lines 35-37); FR13 regression (the wrong-token scenario must still
prove a 401 on send routes to the password screen). Milestone "## M3" in .harness/milestones.md.

Context (from the M3-T2 handoffs; verify against the code, do not trust blindly):
- Read /Users/ryankenny/Projects/CodingHarnessv2/.harness/tasks/M3-T2-handoff-2.md, section
  "Remaining work", item 2, in full before editing. It says AsyncStorage's native module is looked
  up first as "PlatformLocalStorage" (then "RNCAsyncStorage") via TurboModuleRegistry.get, and
  that the harness's generic fallback answers that lookup first; confirm in
  mobile/node_modules/@react-native-async-storage/async-storage.
- Preferred approach: register an in-memory AsyncStorage native-module fake in
  mobile/scripts/runtime-smoke.mjs under the id(s) the library actually uses, then drive:
  landing = Conversations screen (token present), tap "New chat", land in Chat, and in the
  wrong-token scenario press Send as before so the 401 routes to the password screen.
- Existing scenarios: token present, token absent, token wrong. Each must still assert its
  landing screen, and the wrong-token one must still assert the 401 → password-screen route.
- Lint: 5 quote-style errors in mobile/src/chat/conversationSession.test.ts (lines ~297, 299, 329,
  360, 362). Fix the style only; do not change what any test asserts.

Acceptance Criteria:
- `bun run smoke:runtime` exits 0 with all three scenarios PASS, each asserting at least what it
  asserted before (token present lands on the conversation list; token absent lands on setup;
  token wrong: a send in a conversation gets a 401 and routes to the password screen).
- The script's doc comments describe the new drive path.
- `bun run lint` exits 0.
- Save the full Tests output to .harness/evidence/M3-T2b-worker.log.

Relevant Files:
- mobile/scripts/runtime-smoke.mjs, mobile/scripts/runtime-smoke.sh
- mobile/src/app/conversations.tsx, mobile/src/app/chat.tsx (read for labels/testIDs to drive)
- mobile/src/chat/conversationSession.test.ts
- .harness/tasks/M3-T2-handoff-2.md

Files Allowed To Change:
- mobile/scripts/runtime-smoke.mjs, mobile/scripts/runtime-smoke.sh
- mobile/src/chat/conversationSession.test.ts (quote style only)
- mobile/src/app/conversations.tsx, mobile/src/app/chat.tsx (only adding testIDs/accessibility
  labels the smoke needs to find controls; no behaviour change)

Constraints:
- Follow existing repository patterns. Do not change unrelated behaviour. No new dependencies.
- Do not drop or loosen any smoke scenario or assertion. Do not weaken tests.
- Budget your turns: if you approach your limit, write .harness/tasks/M3-T2b-handoff-1.md and
  return CONTINUE.

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2/mobile && bun run typecheck && bun test src/store src/api src/ui src/chat src/app-routing && bun run lint && bun run smoke:runtime

Return:
- Summary
- Files changed
- Tests run
- Test result
- Unresolved issues
