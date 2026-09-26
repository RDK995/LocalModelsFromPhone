TASK M4a-T4 — Runtime smoke drives a streamed reply in the real bundled app: prompt visible at Send before any reply byte, reply grows in place and stays in place on completion, thinking collapsed until tapped

Routing: tier Mid, model sonnet, reason_code ORDINARY_IMPLEMENTATION
  detail: extends an existing in-process harness (fake native modules) with a controllable streamed response; assertions are stated here and are the oracle.

Goal:
mobile/scripts/runtime-smoke.mjs runs the real production iOS bundle in a Node vm with fake native
modules, and already drives Conversations -> New chat -> Chat -> Send (the `--token=wrong` run,
via a fake `ExpoFetchModule` returning 401). Add a fourth run, `--token=stream`, that stores a token
and makes the fake `ExpoFetchModule` answer:
- `GET /v1/state` → 200 with a resident model, e.g.
  `{"models":[{"name":"smoke-model:1b","size_bytes":1}],"resident":{"name":"smoke-model:1b","loaded_by_server":true},"operation":{"kind":"idle"},"generation":null}`
  (match shared/api.ts's StateResponse shape exactly);
- `POST /v1/chat` → 200 `text/event-stream` with header `x-generation-id: gen-smoke`, whose body the
  script **holds open and feeds step by step** (SSE frames `id: <n>\nevent: <type>\ndata: <json>\n\n`,
  the format mobile/src/api/client.ts parses).

Drive and assert, in order (print each as its own PASS/FAIL line):
1. Tap New chat, type the prompt "What is six times seven?" in Chat's TextInput, tap Send. With the
   chat response still holding back every byte (none sent yet — let the event loop settle), assert
   the committed tree contains the prompt text as a message (M4-AC4: prompt shown immediately,
   before any reply token).
2. Feed `thinking {"text":"SMOKE-THINKING-TEXT"}` and `content {"text":"Partial answer"}`; settle.
   Assert: "Partial answer" is present; a pressable with text "Show thinking" is present;
   "SMOKE-THINKING-TEXT" is NOT present (collapsed by default, M4-AC1). Record the ordered list of
   message texts and the Fabric node (tag / instance) that holds "Partial answer".
   Also assert there is exactly one node whose text contains "Partial answer".
3. Tap "Show thinking"; settle. Assert "SMOKE-THINKING-TEXT" is present and "Hide thinking" is
   present, and the thinking text is not inside the same text node as the answer (separate section).
4. Feed `content {"text":" 42"}` then `done {"status":"complete","model":"smoke-model:1b","eval_count":3,"tokens_per_second":1}`
   and close the body; settle until the send finishes (Send button back / Stop gone).
   Assert (M4-AC5): exactly one text node contains "Partial answer 42"; the order of message texts
   is [prompt, reply] with the reply at the same list position it had in step 2; and the reply text
   is held by the **same** Fabric node recorded in step 2 (updated in place, not unmounted and
   re-created — if the fake UI manager assigns new tags on re-creation, compare tags; if node
   identity cannot be established in this harness, say exactly why in the output and in your
   return, and assert position + single-copy only). Also assert the model label "smoke-model:1b"
   is shown and the prompt still appears exactly once.
Add `stream` to the token loop in scripts/runtime-smoke.sh so `bun run smoke:runtime` runs 4/4, and
update both files' header comments ("What this proves"/"What it cannot prove") accordingly.

Relevant Requirements:
FR10 (lines 45-46), FR9 (42-44) — /Users/ryankenny/Projects/CodingHarnessv2/.harness/requirements.md.
Milestone criteria M4-AC1, M4-AC4, M4-AC5 — .harness/milestones.md "## M4a".

Context not obvious from the code:
- mobile/src/app/chat.tsx was just rewired (M4a-T3): on Send it sets a pending turn synchronously so
  the prompt shows at once; the list comes from `buildChatItems` (mobile/src/ui/chatItems.ts) keyed
  by message ids that are the same ids the store persists under, so the reply bubble keeps its React
  key through completion; thinking renders behind a "Show thinking"/"Hide thinking" toggle.
- The fake ExpoFetchModule and the `dispatchFabricEvent`/`collectTree` helpers already exist; read
  node_modules/expo/src/winter/fetch/ to see how NativeResponse body chunks are pulled so you can
  deliver them on demand.
- If step 1, 2 or 4 fails because chat.tsx does not behave as described, that is a real finding:
  report it (FAIL, with what the tree showed) — do not change chat.tsx and do not loosen the
  assertion.

Acceptance Criteria:
- `bun run smoke:runtime` runs 4 runs and exits 0 with every step above PASS; the existing three
  runs' assertions are unchanged.
- Save the full output to .harness/evidence/M4a-T4-worker.log.
- typecheck and lint still pass.

Relevant Files:
- mobile/scripts/runtime-smoke.mjs, mobile/scripts/runtime-smoke.sh
- mobile/src/app/chat.tsx, mobile/src/ui/chatItems.ts, mobile/src/api/client.ts, shared/api.ts (read only)

Files Allowed To Change:
- mobile/scripts/runtime-smoke.mjs
- mobile/scripts/runtime-smoke.sh

Constraints:
- Follow existing repository patterns. Do not change unrelated behaviour. No new dependencies.
- Do not change mobile/src/, server/, shared/, ops/.
- Do not weaken tests or existing smoke assertions. No git stash, no commits.

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2/mobile && bun run typecheck && bun run lint && bun run smoke:runtime

Return:
- Summary
- Files changed
- Tests run
- Test result
- Unresolved issues
