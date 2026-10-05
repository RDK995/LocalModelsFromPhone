# M3-T2 handoff (attempt 1, turn-limit CONTINUE)

## Done so far

1. `mobile/src/chat/chatController.ts`: added an optional
   `onModelResolved?: (model: string) => void` field to `SendMessageCallbacks`,
   invoked right after the resident model is confirmed (before `POST /v1/chat`).
   Additive/backward-compatible; existing chatController.test.ts still passes.
2. `mobile/src/chat/conversationSession.ts` (new): pure `sendInConversation`
   function wrapping `chatController.sendMessage`. Builds full history (prior
   messages role/content + new prompt), persists the user message *before*
   calling `sendMessage` (design decision: prompt is always kept in the
   conversation, even when blocked — documented in the file's doc comment;
   the alternative of returning it to the input box was rejected because the
   store has no "remove one message" operation and would make "was this ever
   sent" ambiguous later). Renames the conversation from the prompt on the
   first message (also unconditional). Persists the assistant reply with
   `status: "complete"|"stopped"|"error"` and `model` from the `done` event,
   falling back to the model the send targeted (via `onModelResolved`) if the
   done event's model is empty. A stream `error` SSE event is turned into a
   thrown `Error` inside `onEvent` (same trick `chat.tsx` uses today) so
   `client.chat`'s catch routes it to `onError` with partial content already
   accumulated. Exports `BLOCKED_MESSAGE` ("No model loaded — load one on the
   Models screen to send.") and `titleFromPrompt` (trim + cap at 40 chars).
3. `mobile/src/chat/conversationSession.test.ts` (new): covers all of the
   above (history order, title-from-first-prompt, no-rename-on-later-send,
   model attribution across two sends incl. fallback when done.model is
   empty, stopped-on-cancelled, error-keeps-partial-content, blocked
   persists-prompt-no-reply-no-request).

Validation run so far: `cd mobile && bun test src/chat/conversationSession.test.ts src/chat/chatController.test.ts src/store` → **33 pass, 0 fail**. Nothing else has been run yet (no typecheck, no full test suite, no lint, no smoke).

## Not started yet (remaining work)

- `mobile/src/ui/conversationList.ts` (+ test): pure view-model for the
  Conversations screen list rows (newest-first — defensive re-sort even
  though the store already sorts — plus a formatted "last updated" label,
  e.g. slicing the ISO `updated_at` string to `"YYYY-MM-DD HH:MM"`, kept
  deterministic/timezone-free rather than a locale/relative format so it's
  testable without injecting a fake "now").
- `mobile/src/app/conversations.tsx` (new route): lists conversations from
  a `createConversationStore(asyncStoragePort)` instance (constructed the
  same way `chat.tsx` builds its API client via `useRef`; do **not** add
  anything under `mobile/src/store/`, it's read-only for this task). Header
  mirrors chat.tsx's own in-app header pattern (title + Models/Settings
  links) per the AC, plus a "New chat" action. Refresh on focus
  (`useFocusEffect`, same pattern as `models.tsx`). Tap a row → push to
  `/chat` with `id` param. Delete via swipe/long-press + `Alert.alert`
  confirm → `store.delete(id)` → refresh.
- `mobile/src/app/chat.tsx` rewrite: read `id` from
  `useLocalSearchParams<{id: string}>()`, load the conversation via the
  store on mount/focus, render its persisted messages (each assistant
  message shows small grey model-name text under it), keep the existing
  streaming/thinking/response scratch-state rendering for the in-flight
  reply, call `sendInConversation` instead of `sendMessage` directly, and
  after it settles reload the conversation from the store (single source of
  truth — simpler than trying to merge a returned message into React
  state). Blocked state: show the `BLOCKED_MESSAGE` text plus a button that
  does `router.push("/models")`. Stop/generationId handling stays as today.
  Keep the header's static "Chat" title text as-is (do not switch to the
  conversation's own title) — this keeps the existing runtime-smoke text
  assertions ("Chat" in rendered text) valid and keeps this diff smaller;
  not required by the AC either way.
- `mobile/src/app/setup.tsx`: change `router.replace("/chat")` →
  `router.replace("/conversations")` after saving the token (AC: "After
  setup / a valid token, the app lands here instead of directly in a
  chat").
- `mobile/src/app/_layout.tsx`: add a `<Stack.Screen name="conversations" .../>`
  entry (title "Conversations", `headerShown: false` to match chat.tsx's
  own-header pattern) as a direct child of `<Stack>` (never conditional,
  never Fragment-wrapped — see the existing comment block in that file for
  why, M1-C11/M1-C12 regressions).
- `mobile/src/app-routing/initialRoute.ts` (+ test): change the token-present
  branch from `"/chat"` to `"/conversations"`.
- `mobile/src/app-routing/stackChildren.test.ts`: update the expected screen
  count (currently hardcoded to 4: chat/settings/setup/models) to 5 and add
  `"conversations"` to the name list, keeping the same "not Fragment-wrapped,
  not conditionally declared" assertions.
- `mobile/scripts/runtime-smoke.mjs` / `.sh`: **read the doc comment at the
  top of runtime-smoke.mjs in full before touching it** — it drives real UI
  interaction (typing + tapping) inside a sandboxed bundle VM, not just a
  landing-route string check.
  - **Important finding**: `@react-native-async-storage/async-storage`'s
    native module is *not* faked anywhere in `runtime-smoke.mjs`. Calling
    into it (`TurboModuleRegistry.get("RNCAsyncStorage")` →
    `global.__turboModuleProxy("RNCAsyncStorage")` → the script's generic
    `getModule()`/`makeModule()` fallback) returns a Proxy whose unknown
    methods are `() => undefined` — i.e. `multiGet(keys, callback)` returns
    immediately without ever invoking `callback`, so any `AsyncStorage`
    Promise (and therefore any conversation-store call: `list`, `get`,
    `create`, `appendMessage`, ...) **hangs forever** in the smoke sandbox.
    This is confirmed by reading `TurboModuleRegistry.js` and
    `AsyncStorage.native.ts`'s `getItem`, not just theorized.
  - Consequence: once the landing screen becomes Conversations, the smoke
    script's `driveToChat` (types a token on Setup, taps Continue, expects
    to reach "Chat") can still reach Conversations (its header renders
    unconditionally, independent of the store call, so `reachedFirstScreen`
    and the M1-C12 "single top bar, not double" check still work) — but
    tapping "New chat" would hang forever (it awaits `store.create()`), so
    there is **no way to drive from Conversations into Chat** in this
    sandbox without also faking `RNCAsyncStorage`, which is out of scope
    (`Files Allowed To Change` restricts script edits to "only the
    landing-route expectation").
  - Planned adaptation (not yet implemented — needs a decision check before
    or during implementation, and must be called out clearly in the return):
    - `expectedScreen`: `"Conversations"` instead of `"Chat"` when a token is
      stored (present or wrong).
    - `driveToChat` (absent-token flow): keep the same mechanism, just check
      for `"Conversations"` mounted instead of `"Chat"` after Setup's
      Continue is tapped; `singleTopBar`/`backOnSetup` checks unchanged.
    - `driveChat401` (wrong-token flow, FR13/M1-C15): **cannot** reach Chat's
      message input/Send button at all now (blocked by the AsyncStorage
      hang described above). Retarget it to tap the "Models" link in
      Conversations' own header instead (no store access, pure
      `router.push("/models")`) — Models screen's `useFocusEffect` already
      calls `GET /v1/state` on mount and has its own `routeToUnauthorized`
      (Alert "Password wrong or changed" + push to Settings with
      `updateToken=1`), nearly identical to chat.tsx's. This proves the same
      FR13 regression (a real 401 in a real bundle routes correctly) via a
      different, reachable screen, dropping the "type message + tap Send"
      step entirely (no TextInput needed). This is more than a one-line
      "landing route expectation" tweak, so it needs to be flagged
      explicitly to the orchestrator/reviewer as a scope judgment call, with
      the reasoning above, rather than silently done.
  - Also update the stale prose in the file's top-of-file doc comment
    (references to "Chat when a token is stored", "drive Setup -> Chat",
    "drives Chat's Send button") to match whatever is actually implemented.
- Full validation (none run yet beyond the one focused `bun test` above):
  ```
  cd /Users/ryankenny/Projects/CodingHarnessv2/mobile && bun run typecheck \
    && bun test src/store src/api src/ui src/chat src/app-routing \
    && bun run lint && bun run smoke:runtime
  ```

## Files touched so far

- `mobile/src/chat/chatController.ts` (edited — additive)
- `mobile/src/chat/conversationSession.ts` (new)
- `mobile/src/chat/conversationSession.test.ts` (new)

No other files have been modified yet.

## Test status

- `bun test src/chat/conversationSession.test.ts src/chat/chatController.test.ts src/store` → 33 pass, 0 fail (only this focused subset run so far).
- Not yet run: full `bun test src/store src/api src/ui src/chat src/app-routing`, `bun run typecheck`, `bun run lint`, `bun run smoke:runtime`.

## Decisions taken (carry these forward, do not redecide)

- Blocked send: the user's prompt is always persisted to the conversation
  (title also set on first message) even when blocked; no assistant message
  is stored; `onBlocked` is called with `BLOCKED_MESSAGE` from
  `conversationSession.ts` (not chatController's shorter internal message).
- `chatController.ts`'s new `onModelResolved` hook is the mechanism for the
  "fall back to the model the send targeted" requirement — do not duplicate
  a `GET /v1/state` call inside `conversationSession.ts` to get this.
- Chat screen keeps a static "Chat" header title (not the conversation's own
  title) to minimize smoke-test churn; this is a judgment call, not an AC
  requirement either way.
