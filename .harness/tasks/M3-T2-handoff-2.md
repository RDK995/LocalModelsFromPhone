# M3-T2 handoff (attempt 2, turn-limit CONTINUE)

Continuation of attempt 1 (see M3-T2-handoff-1.md). Attempt 1's work was
verified against the repo (still uncommitted, matches its description) and
kept as-is: `mobile/src/chat/chatController.ts` (additive `onModelResolved`),
`mobile/src/chat/conversationSession.ts` (new), and
`mobile/src/chat/conversationSession.test.ts` (new) — 33/33 passing,
unchanged in this attempt.

## Done this attempt

1. `mobile/src/ui/conversationList.ts` (new) + `conversationList.test.ts`
   (new): pure view-model for the Conversations screen list rows —
   `toConversationListView(conversations)` returns `{ rows: [{id, title,
   updatedLabel}] }`, newest-updated-first (defensive re-sort), and
   `formatUpdatedAt(iso)` slices the ISO timestamp to `"YYYY-MM-DD HH:MM"`
   (deterministic, no fake "now" needed). 4/4 tests pass.
2. `mobile/src/app/conversations.tsx` (new route): lists conversations from
   `createConversationStore(asyncStoragePort)`, refreshes on
   `useFocusEffect` (same pattern as `models.tsx`), own header (title +
   Models/Settings links, mirroring chat.tsx's in-app header pattern) plus a
   "New chat" button that creates a conversation and pushes to
   `/chat?id=...`. Tapping a row opens it; long-press opens an `Alert.alert`
   delete confirmation (no swipe library available, no new deps allowed).
3. `mobile/src/app/chat.tsx` (rewritten): reads `id` via
   `useLocalSearchParams<{id: string}>()`, loads the conversation from the
   store on mount, renders persisted messages (each assistant message shows
   `message.model` as small grey text underneath), keeps the existing
   thinking/response streaming scratch-state during an in-flight send, calls
   `sendInConversation` (not `chatController.sendMessage` directly), and in
   `finally` always reloads the conversation from the store — this covers
   every outcome (complete/stopped/error/blocked/unauthorized) since
   `sendInConversation` persists before resolving in all of them. Blocked
   state shows `BLOCKED_MESSAGE` plus a "Load a model" button
   (`router.push("/models")`). Stop/generationId handling is unchanged from
   before. Kept the header's static "Chat" title (not the conversation's own
   title) — carried forward from attempt 1's judgment call, and the packet's
   orchestrator note says this is open ("your call").
   - **Beyond the literal AC**: added a "Conversations" link next to
     Models/Settings in chat.tsx's own header. Chat hides the Stack header
     (`headerShown: false`), so without this there is no explicit on-screen
     way back to the list (only an OS edge-swipe-back gesture, which is not
     guaranteed obvious). Flagging this as a small addition past the AC
     wording, not a redesign — reviewer's call whether to keep it.
4. `mobile/src/app/setup.tsx`: `router.replace("/chat")` →
   `router.replace("/conversations")` after saving the token.
5. `mobile/src/app/_layout.tsx`: added
   `<Stack.Screen name="conversations" options={{title: "Conversations",
   headerShown: false}} />` as a direct (unconditional, non-Fragment) child
   of `<Stack>`, same pattern as the other four screens.
6. `mobile/src/app-routing/initialRoute.ts` + `.test.ts`: token-present
   branch now returns `/conversations` instead of `/chat`.
7. `mobile/src/app-routing/stackChildren.test.ts`: screen count 4 → 5, added
   `"conversations"` to the declared-name list; the "not Fragment-wrapped /
   not conditional" assertions are untouched (still pass against the new
   5-screen `_layout.tsx`).

## Test status (this attempt)

- `bun run typecheck` → clean, exit 0.
- `bun test src/store src/api src/ui src/chat src/app-routing` → **102
  pass, 0 fail** (includes the new conversationList tests and the updated
  app-routing tests).
- `bun run lint` → **FAILS**, 5 errors, all pre-existing in
  `mobile/src/chat/conversationSession.test.ts` (attempt 1's file, not
  touched this attempt) at lines 297, 299, 329, 360, 362: `Strings must use
  doublequote`. These are the single-quoted raw SSE payload strings, e.g.
  `stream.push('event: content\ndata: {"text":"hi"}\n\n');` — eslint wants
  double-quoted strings project-wide, and these contain literal `"`
  characters so they were written with single quotes to avoid escaping.
  **Not yet fixed.** Fix is mechanical: switch each to a double-quoted
  string with `\"` escapes (or a template literal, matching the file's own
  `doneEvent()` helper style a few lines above, which already uses a
  template literal with escaped quotes) — do not change the SSE content
  itself.
- `bun run smoke:runtime` → **not yet run**. `mobile/scripts/runtime-smoke.mjs`
  and `.sh` have **not been touched yet** — they still assert the
  pre-M3-T2 world (landing screen "Chat" when a token is stored, and the
  wrong-token drive types into Chat's own message input). This will not
  pass until updated; expect failure if run as-is.

## Remaining work (in order)

1. Fix the 5 lint errors in `conversationSession.test.ts` (quote style
   only — do not touch the tests' logic/assertions). Re-run `bun run lint`
   to confirm clean.
2. Update `mobile/scripts/runtime-smoke.mjs` per the orchestrator decision
   block at the end of `.harness/tasks/M3-T2.md` (preferred approach: fake
   `AsyncStorage`'s native module). Key finding from this session's reading
   of `node_modules/@react-native-async-storage/async-storage/lib/module/
   {RCTAsyncStorage.js,AsyncStorage.native.js}` and
   `node_modules/react-native/Libraries/TurboModule/TurboModuleRegistry.js`:
   - `RCTAsyncStorage.js` resolves the native module via
     `TurboModuleRegistry.get("PlatformLocalStorage") ||
     TurboModuleRegistry.get("RNC_AsyncSQLiteDBStorage") ||
     TurboModuleRegistry.get("RNCAsyncStorage")` — **in that order**.
   - The smoke script's `__turboModuleProxy: name => getModule(name)`
     returns a **truthy** generic fallback Proxy for *any* name not matching
     `ABSENT` (`DevLauncher|DevMenu|Updates`), so `TurboModuleRegistry.get(
     "PlatformLocalStorage")` already resolves truthy today, and the code
     never even reaches `"RNCAsyncStorage"`. The previous attempt's finding
     ("RNCAsyncStorage is unfaked") named the wrong module id for the fix;
     the fake needs to be registered under **`"PlatformLocalStorage"`**
     (the first name tried), not `"RNCAsyncStorage"`.
   - The generic fallback's unknown methods are `() => undefined`, so
     `multiGet(keys, callback)` etc. never invoke `callback` — every
     `AsyncStorage` promise (and so every conversation-store call) hangs.
     Confirmed by reading the two files above, not theorized.
   - Fix: add `moduleOverrides["PlatformLocalStorage"]` (alongside the
     existing `AlertManager`/`ExceptionsManager` entries) backed by a plain
     in-memory `Map<string,string>`, implementing the exact contract
     `AsyncStorage.native.js` calls: `multiGet(keys, cb)` → `cb(null,
     keys.map(k => [k, map.get(k) ?? null]))`; `multiSet(pairs, cb)` → sets
     each pair then `cb(null)`; `multiRemove(keys, cb)` → deletes each key
     then `cb(null)`; `clear(cb)` → `map.clear(); cb(null)`;
     `getAllKeys(cb)` → `cb(null, [...map.keys()])`; `multiMerge` can be a
     thin JSON-merge or just alias to `multiSet` since the store never calls
     it. Callback signature is `(errors, result)`, `errors` must be
     `null`/falsy on success (see `convertErrors`/`convertError` in
     `.../lib/module/helpers.js` if the exact falsy-check shape needs
     confirming).
   - Then: `expectedScreen` becomes `"Conversations"` (not `"Chat"`) when a
     token is stored (present or wrong). `driveToChat` (absent-token flow):
     same drive mechanism through Setup, but check for `"Conversations"`
     mounted after Continue is tapped instead of `"Chat"`;
     `singleTopBar`/`backOnSetup` checks unchanged.
   - New step needed in the `absent`/`wrong` drives now that AsyncStorage
     works: after reaching Conversations, dispatch a `topClick` on the "New
     chat" pressable (found the same way `continueButton`/`sendButton` are
     found today — by walking the committed tree for a pressable whose text
     includes "New chat"), wait, then re-collect the tree to reach Chat.
     Only then can `driveChat401` (wrong-token flow, FR13/M1-C15) proceed to
     dispatch `topChange`/`topClick` on Chat's message input/Send button
     exactly as it does today — this restores the original "type message +
     tap Send" proof instead of the fallback (driving via the Models link)
     attempt 1's handoff proposed, since the AsyncStorage fake removes the
     blocker that fallback was working around.
   - Update the stale top-of-file doc comment (mentions "Chat when a token
     is stored", "drives Setup -> Chat", "drives Chat's Send button") to
     describe the new Conversations-first flow.
3. `mobile/scripts/runtime-smoke.sh`: optional prose-only update (its
   top comment says "first screen must be Chat"); cosmetic, allowed under
   `Files Allowed To Change`.
4. Re-run in order: `bun run lint`, then `bun run smoke:runtime` (this
   re-bundles via `npx expo export`, budget several minutes).
5. Final check: the packet's exact `Tests` command, run once, in full:
   ```
   cd /Users/ryankenny/Projects/CodingHarnessv2/mobile && bun run typecheck \
     && bun test src/store src/api src/ui src/chat src/app-routing \
     && bun run lint && bun run smoke:runtime
   ```

## Decisions carried forward (do not redecide)

- Blocked send: prompt always persisted (title set from it on first
  message) even when blocked; no assistant message stored; `onBlocked`
  reports `BLOCKED_MESSAGE` from `conversationSession.ts`.
- `chatController.ts`'s `onModelResolved` hook backs the "fall back to the
  model the send targeted" requirement; no duplicate `GET /v1/state` call
  in `conversationSession.ts`.
- Chat screen keeps a static "Chat" header title, not the conversation's own
  title — judgment call, AC leaves it open either way.
- Conversations screen delete: long-press + `Alert.alert` confirm (no swipe
  gesture library; no new deps).
- `conversationList.ts`'s `formatUpdatedAt`: direct ISO-string slice
  (`YYYY-MM-DD HH:MM`), deterministic, no injected clock needed.
- Chat header also links to `/conversations` (see item 3's "Beyond the
  literal AC" note above) — flag to reviewer, not silently assumed correct.

## Files touched (cumulative, both attempts)

- `mobile/src/chat/chatController.ts` (edited, attempt 1)
- `mobile/src/chat/conversationSession.ts` (new, attempt 1)
- `mobile/src/chat/conversationSession.test.ts` (new, attempt 1; **has the 5
  lint errors to fix**)
- `mobile/src/ui/conversationList.ts` (new, this attempt)
- `mobile/src/ui/conversationList.test.ts` (new, this attempt)
- `mobile/src/app/conversations.tsx` (new, this attempt)
- `mobile/src/app/chat.tsx` (rewritten, this attempt)
- `mobile/src/app/setup.tsx` (edited, this attempt)
- `mobile/src/app/_layout.tsx` (edited, this attempt)
- `mobile/src/app-routing/initialRoute.ts` (edited, this attempt)
- `mobile/src/app-routing/initialRoute.test.ts` (edited, this attempt)
- `mobile/src/app-routing/stackChildren.test.ts` (edited, this attempt)
- **Not yet touched**: `mobile/scripts/runtime-smoke.mjs`,
  `mobile/scripts/runtime-smoke.sh` — still describe/enforce the pre-M3-T2
  landing-screen behavior; will fail if run as-is until updated per item 2
  above.
