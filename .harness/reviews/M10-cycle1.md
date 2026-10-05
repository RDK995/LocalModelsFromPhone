# M10 review, cycle 1 (full milestone)

Validation re-run: typecheck, bun test, lint, web-switch-proof.sh all exit 0, all proof checks PASS (.harness/evidence/M10-review.log).

## Criteria
- M10-AC1: PASS on Mac evidence. Implementation: conversationStore.ts (web_search optional = off, new chats false, setWebSearch, validation), chat.tsx Switch. Test: conversationStore.test.ts, proof persistence check. Force-quit in Expo Go is owner-only and not proven.
- M10-AC2: PASS with caveat (see finding 1). webSwitch.ts + webSwitch.test.ts + proof Check 3 (stubbed no-tools model); conversationSession.ts reads the flag once per prompt; proof Check 4 shows the flip applies from the next prompt.
- M10-AC3: PASS on Mac evidence. Live step/sources events in proof Check 5; chat.tsx renders steps while streaming and folds them into a "Show web steps (n)" toggle after. On-device visual look is owner-only.
- M10-AC4: PASS on Mac evidence. Sources list rendered, onPress calls Linking.openURL (Safari on iOS). Actually opening in Safari is owner-only.

## Finding 1
Severity: IMPORTANT

Problem: The web switch can get stuck on and still send web requests to a model with no tools. The Switch is `disabled={!webState?.enabled}` while `value` is `conversation.web_search`. If a chat had the switch on and the resident model is later one without tools (or the capability check fails), the switch shows ON but cannot be turned off. `sendInConversation` still sends `web: true`, because it never consults capability. The server (manager.ts line 116) only checks `request.web === true` and does not gate on the model, so Ollama will be asked for tools it does not support.

Evidence: mobile/src/app/chat.tsx (Switch, ~line 313-318); mobile/src/chat/conversationSession.ts (`const webSearch = conversation.web_search === true`); server/src/generations/manager.ts:116.

Why it matters: FR18 says the switch is unavailable for no-tools models. A disabled control that is stuck on, and that causes failing prompts, is a user-visible defect, and the tests only cover a fresh chat.

Suggested correction: Make the sent flag and the displayed value depend on the capability: pass `web: conversation.web_search && webState.enabled` from the screen, show the switch as off (or keep it operable for turning off: `disabled={!webState?.enabled && conversation?.web_search !== true}`) when disabled. Add a test for the switched-on chat plus no-tools model case.

## Finding 2
Severity: OPTIONAL

Problem: The capability check runs only on focus; a model change while the chat is open is not seen until refocus. Steps use array index keys. Neither blocks.
