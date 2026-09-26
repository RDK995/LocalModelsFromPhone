TASK M4a-T3 — Chat screen: the prompt shows the moment Send is pressed, the reply streams into its own place in the conversation list, and each reply's thinking is a collapsed "Show thinking" section

Routing: tier Mid, model sonnet, reason_code ORDINARY_IMPLEMENTATION
  detail: ordinary UI rewiring of one screen onto already-tested pure logic; oracle is typecheck/lint/tests plus the runtime smoke (a later task M4a-T4 adds the drive that asserts the new behaviour).

Goal:
Rewire mobile/src/app/chat.tsx onto the pure logic committed in M4a-T2
(mobile/src/ui/chatItems.ts: `buildChatItems`, `PendingTurn`, `ChatItem`, `thinkingToggleLabel`,
`toggleExpanded`; mobile/src/chat/conversationSession.ts: `newMessageId()` and the new
`options {userMessageId, assistantMessageId}` parameter of `sendInConversation`).

Today (read chat.tsx first): the prompt is not shown until `sendInConversation` settles (the screen
only reloads from the store in `finally`), the reply streams in separate `thinking`/`response`
blocks rendered after the message list, and those are cleared and replaced by the persisted
message on completion — the text visibly jumps. Replace that with:

1. On Send: mint `userMessageId` and `assistantMessageId` with `newMessageId()`, set a `pending`
   `PendingTurn` state `{userMessageId, prompt, assistantMessageId, accumulator:
   initialStreamAccumulator, blocked:false}` **synchronously, before any await** (before the token
   re-read), and pass the two ids to `sendInConversation` via its options.
2. In `onEvent`, update `pending.accumulator` with `applyStreamEvent` (functional state update).
   In `onBlocked`, set `pending.blocked = true` (plus the existing blocked banner).
3. Render the list from `buildChatItems(conversation?.messages ?? [], pending)` — one `.map` over
   the items, `key={item.key}`. Delete the separate `thinking`/`response` state and their render
   blocks. An item with `streaming: true` shows a small ActivityIndicator inside its own bubble
   (and while its content is still empty, that indicator is the bubble's only content — no
   separate "Loading response..." block outside the list).
4. In `finally`: reload the conversation from the store FIRST, then clear `pending` (so there is
   never a render where the turn is missing). Keep isLoading/generationId handling as is.
5. Thinking: for any item with `thinking`, render — above the answer bubble, separate from it — a
   touchable row whose text is `thinkingToggleLabel(expanded)` where expanded =
   `expandedKeys.has(item.key)`; pressing it sets `expandedKeys` via `toggleExpanded`. The thinking
   text itself is rendered only when expanded. Default is collapsed (empty set). Keep the existing
   thinking styles for the expanded text; give the toggle row an accessibilityRole="button".
6. Keep: per-reply model label, blocked banner + "Load a model", Stop, header links,
   KeyboardAvoidingView, scroll-to-end on content. Update the file's doc comment to describe the
   new flow (prompt shown at Send, reply streams in its final place, thinking collapsed).

Relevant Requirements:
FR10 (lines 45-46), FR9 (42-44) — /Users/ryankenny/Projects/CodingHarnessv2/.harness/requirements.md.
Milestone criteria M4-AC1, M4-AC4, M4-AC5 — .harness/milestones.md "## M4a".

Context not obvious from the code:
- `.tsx` cannot be unit tested with bun; the behaviour-bearing logic is already tested in
  chatItems.test.ts. Keep chat.tsx thin: no new logic that is not in chatItems/streamReducer.
- The runtime smoke (mobile/scripts/runtime-smoke.mjs) drives this screen and looks for texts such
  as "Chat" and "Send"; keep those texts and keep "Type a message..." as the input placeholder.
- The store appends the persisted user message before sending, under `userMessageId`; buildChatItems
  dedupes by id, so reloading mid-flight is safe but not required.

Acceptance Criteria:
- chat.tsx implements 1-6; `thinking`/`response` states are gone; there is exactly one list of
  rendered messages.
- Typecheck, all mobile unit tests, lint, and `bun run smoke:runtime` (3/3) pass.

Relevant Files:
- mobile/src/app/chat.tsx
- mobile/src/ui/chatItems.ts, mobile/src/ui/streamReducer.ts, mobile/src/chat/conversationSession.ts (read only)
- mobile/scripts/runtime-smoke.mjs (read only)

Files Allowed To Change:
- mobile/src/app/chat.tsx

Constraints:
- Follow existing repository patterns. Do not change unrelated behaviour. No new dependencies.
- Do not change server/, shared/, ops/, or other mobile files. Another worker is concurrently
  adding mobile/scripts/thinking-proof.* and restarting Mac services; do not touch those.
- Do not weaken tests. No git stash, no commits (the orchestrator commits).

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2/mobile && bun run typecheck && bun test src/store src/api src/ui src/chat src/app-routing && bun run lint && bun run smoke:runtime

Return:
- Summary
- Files changed
- Tests run
- Test result
- Unresolved issues
