TASK M4a-T2 — Pure chat-display logic: the prompt and the in-flight reply are items of the conversation list from the moment Send is pressed, keyed by the ids they will be persisted under; thinking is collapsed by default

Routing: tier Mid, model sonnet, reason_code ORDINARY_IMPLEMENTATION
  detail: ordinary feature work in two small pure/testable mobile modules with unit tests as the oracle.

Goal:
On-device finding from M3: in mobile/src/app/chat.tsx the user's prompt is not shown until the
reply settles (the screen only reloads the conversation from the store after `sendInConversation`
resolves), and the reply streams in a separate `response` block below the list, then disappears
and reappears as a persisted message. This task builds the pure logic the screen will use (a later
task, M4a-T3, rewires chat.tsx — do NOT edit chat.tsx here).

1. mobile/src/chat/conversationSession.ts — let the caller choose the ids:
   add an optional last parameter `options?: { userMessageId?: string; assistantMessageId?: string }`
   to `sendInConversation`. When given, the persisted user message uses `userMessageId` and the
   persisted assistant reply (complete, stopped or error) uses `assistantMessageId`; when absent,
   behaviour is exactly as today (fresh ids). Also export the id generator as `newMessageId()` so
   the screen can mint ids the same way. Nothing else about the session changes (prompt still
   persisted before sending; blocked still persists the prompt with no reply).

2. New mobile/src/ui/chatItems.ts (+ mobile/src/ui/chatItems.test.ts) exporting:
   ```ts
   export interface PendingTurn {
     userMessageId: string;
     prompt: string;
     assistantMessageId: string;
     accumulator: StreamAccumulator;   // from src/ui/streamReducer.ts
     blocked: boolean;                 // send was blocked: no assistant item
   }
   export interface ChatItem {
     key: string;                      // the message id
     role: "user" | "assistant";
     content: string;
     thinking?: string;                // present only when non-empty
     model?: string;
     streaming: boolean;               // true only for the in-flight assistant item
   }
   export function buildChatItems(persisted: Message[], pending: PendingTurn | null): ChatItem[];
   ```
   Rules:
   - Persisted messages first, in stored order, `streaming: false`.
   - With `pending`: append a user item `{key: userMessageId, content: prompt}` unless a persisted
     message already has that id; then, unless `blocked`, append an assistant item
     `{key: assistantMessageId, content: accumulator.content, thinking: accumulator.thinking (if
     non-empty), streaming: true}` unless a persisted message already has that id.
   - Consequence the tests must pin down: the list rendered at Send (empty accumulator), while
     streaming, and after the store has both persisted messages (pending may still be set or be
     null) has the user item and the assistant item at the **same indices with the same keys**, and
     never contains either id twice.
   Also export the thinking-section helpers used by the screen:
   ```ts
   export function thinkingToggleLabel(expanded: boolean): string; // collapsed: "Show thinking", expanded: "Hide thinking"
   export function toggleExpanded(expanded: ReadonlySet<string>, key: string): Set<string>; // returns a new set
   ```
   Thinking is collapsed unless its key is in the expanded set (default: empty set → collapsed).

Relevant Requirements:
FR10 (lines 45-46), FR9 (lines 42-44), FR7 (35-37) — /Users/ryankenny/Projects/CodingHarnessv2/.harness/requirements.md.
Milestone criteria M4-AC1, M4-AC4, M4-AC5 — .harness/milestones.md "## M4a".

Context not obvious from the code:
- `.tsx` modules cannot be imported by bun test; that is why logic lives in src/ui/*.ts and
  src/chat/*.ts (see the doc comments in streamReducer.ts and conversationSession.ts). Follow the
  existing test style in src/ui/*.test.ts and src/chat/conversationSession.test.ts.
- `Message` type is in src/store/conversationStore.ts.

Acceptance Criteria:
- Tests written first and seen failing, then passing, covering: every rule above; the index/key
  stability across Send → streaming → persisted; blocked pending gives only the user item;
  thinking omitted when empty; conversationSession uses supplied ids for user and assistant (for
  complete, stopped and error outcomes) and fresh ids when none supplied.
- All existing mobile tests pass unchanged.

Relevant Files:
- mobile/src/chat/conversationSession.ts, mobile/src/chat/conversationSession.test.ts
- mobile/src/ui/streamReducer.ts, mobile/src/store/conversationStore.ts
- mobile/src/app/chat.tsx (read only, for context)

Files Allowed To Change:
- mobile/src/chat/conversationSession.ts
- mobile/src/chat/conversationSession.test.ts
- mobile/src/ui/chatItems.ts (new)
- mobile/src/ui/chatItems.test.ts (new)

Constraints:
- Follow existing repository patterns. Do not change unrelated behaviour. No new dependencies.
- Do not change server/, shared/, ops/, or mobile/src/app/.
- Do not weaken tests. No git stash, no commits (the orchestrator commits).
- Another worker is concurrently editing server/ files; do not touch or run anything against them.

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2/mobile && bun run typecheck && bun test src/store src/api src/ui src/chat src/app-routing && bun run lint

Return:
- Summary
- Files changed
- Tests run
- Test result
- Unresolved issues
