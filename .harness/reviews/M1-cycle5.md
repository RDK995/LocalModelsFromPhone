# M1 review, cycle 5 (final review after fix cycle 4)

Verdict: CHANGES REQUIRED
Scope reviewed: correction diff `git diff 5ec03b0 HEAD` (HEAD 5270074, branch m1-authenticated-tailnet-chat-stream), read in full: mobile/package.json, mobile/scripts/runtime-smoke.{mjs,sh}, mobile/src/app/{_layout,index,chat,setup,settings}.tsx, mobile/src/app-routing/*, ops/scripts/e2e-tailnet-proof.sh, ops/src/token{,.test}.ts, and the .harness records. Scope was widened to the app's 401 handling (chat.tsx, chatController.ts, client.ts) because of the human's wrong-token observation recorded during this review.

## Validation (re-run by reviewer at 5270074)

Full output: `.harness/evidence/M1-review.log` (cycle-5 section). Each stage was run separately.

- e2e-tailnet-proof.sh: **E2E_EXIT=0**, "ALL AUTOMATED CHECKS PASSED".
  - AC1: 80 content events (first 0.609s, last 6.789s), then `done` complete.
  - AC2: all 7 routes return 401 with no token and with a wrong token. The real token gets 200. The token command writes mode 600 and refuses 644/640/604.
  - AC3: cancel leads to `done` cancelled. No bytes arrive after it, generation is null, Ollama logs the request as finished, and runner CPU drops from 2.56 to 0.01.
  - AC4: 7789 listens on loopback only. LAN 7789 and 8443 refuse connections. The pf LaunchDaemon's last exit code is 0, and the iface file matches the current tailnet utun (utun4 == utun4). The lo0 info line is printed.
- server: 39 pass / 0 fail, typecheck passes, entry-smoke passes (SERVER_EXIT=0).
- ops: token tests pass and verify-ops-install passes (OPS_EXIT=0).
- mobile: typecheck passes, 35 tests pass, lint is clean, iOS export succeeds (MOBILE_EXIT=0).
- `bun run smoke:runtime`: SMOKE_EXIT=0.
  - Token present: Chat renders with the native header hidden.
  - Token absent: Setup renders, and the drive from Setup to Chat succeeds with one top bar.
- Runtime smoke against the bundle the tailnet actually serves (launchAsset URL taken from the live manifest): SERVED_SMOKE_EXIT=0, with the same results.

No sudo was used. Nothing was restarted, and no Serve, LaunchAgent, LaunchDaemon or pf configuration was changed.

## Cycle-2 findings: status

| Finding | Status |
|---|---|
| A (always-red Mac-local LAN 8081 probe) | Fixed by M1-C7. The check now uses the LaunchDaemon's last exit code and compares the iface file with the tailnet utun. The recorded validation passes end to end. |
| B (on-phone checks) | Closed by the human's cycle-4 re-test: all eight steps PASS, recorded in state.json. The code behind it (C9-C13) was reviewed, and runtime smoke passes on the served bundle. |
| C (global copy hook) | Fixed by M1-C8: `main(args, copy = defaultCopyCommand)`, with the copy function injected in the tests. |

Architecture: the corrections stay inside the C6 app (routes, layout, keyboard handling) and the ops e2e script. The runtime smoke is test tooling. No drift found.

## Acceptance criteria

```
Acceptance Criterion:
M1-AC1: With a model already resident in Ollama, sending a prompt from the Expo Go app over Tailscale Serve renders the reply incrementally, token by token, ending in a terminal complete state.

Implementation Evidence:
mobile/src/app/_layout.tsx: no Fragment in <Stack>; all screens are declared unconditionally; chat has headerShown false. mobile/src/app/index.tsx with app-routing/initialRoute.ts: the root route redirects. mobile/src/app/chat.tsx: KeyboardAvoidingView. The server stream path is unchanged since cycle 2.

Test Evidence:
e2e live run: 80 content events from 0.609s to 6.789s, then done complete. Unit tests: initialRoute.test.ts, stackChildren.test.ts, rootIndexRoute.test.ts. Runtime smoke passes on both the local and the served bundle. Human cycle-4 re-test steps 1-4 and 8 PASS, recorded in state.json.

Result:
PASS
```

```
Acceptance Criterion:
M1-AC2: A request to any server route without the correct bearer token returns 401; the Mac-side command produces the token, refuses to run if the token file is group- or world-readable, and the app's settings screen accepts a pasted token and uses it on the next request.

Implementation Evidence:
Server verifyAuth (unchanged). ops/src/token.ts main(args, copy). setup.tsx and settings.tsx both call saveToken. chat.tsx re-reads the token before every send.

Test Evidence:
e2e live run: 7 routes return 401 for no token and for a wrong token. Token file mode is 600, and the command refuses 644/640/604. ops token.test.ts covers the injected copy function. Human cycle-4 steps 6-7 PASS. Human observation during this review: a wrong token is accepted at Setup, and the next send shows a clear error on Chat. This confirms the pasted token is the one used on the next request. Not exercised on the phone: the Save path in Settings > Update Token (Cancel was tapped). Setup and Settings share the same saveToken.

Result:
PASS
```

```
Acceptance Criterion:
M1-AC3: Stop cancels generation on the Mac, verified against Ollama, and streaming output halts on the phone.

Implementation Evidence:
Server cancel and chatController stopGeneration are unchanged. The Stop button in chat.tsx is now inside the KeyboardAvoidingView.

Test Evidence:
e2e live run: done cancelled, no bytes after it, generation null, Ollama request finished, CPU 2.56 -> 0.01. Human cycle-4 step 5 PASS: output halted and did not resume.

Result:
PASS
```

```
Acceptance Criterion:
M1-AC4: The server and the app bundle are reachable from the phone over the tailnet and are not reachable from a device on the LAN or the public internet.

Implementation Evidence:
Loopback bind, Serve :8443 with no Funnel, and the pf anchor (all unchanged). ops/scripts/e2e-tailnet-proof.sh now checks the LaunchDaemon's health and that its interface matches the tailnet utun.

Test Evidence:
e2e live run: 7789 is loopback-only, LAN 7789 and 8443 are refused, tailnet :8443 and the 8081 manifest return 200, the pf daemon's last exit is 0, and utun4 == utun4. Human LAN-device check: 8081 did not load with Tailscale off.

Result:
PASS
```

## Findings

### 1
Severity:
IMPORTANT

Problem:
FR13 requires this: "A `401` shows a 'password wrong or changed' message and routes to the settings screen." The app does not route a 401 anywhere. When the token is wrong, `sendMessage` catches the `UnauthorizedError` from GET /v1/state and passes it to `onError`. chat.tsx then shows `Alert.alert("Error", error.message)`, which reads "Unauthorized: invalid or missing bearer token", and the user stays on Chat. This matches the human's observation: a wrong token is accepted at Setup, and every later send just shows an error.

Evidence:
- The alert: mobile/src/app/chat.tsx, the `onError` callback in handleSendMessage.
- The error message: mobile/src/api/client.ts:60-64 (UnauthorizedError).
- The catch: mobile/src/chat/chatController.ts:50-57 (getState catch).
- The requirement: .harness/requirements.md FR13 (l.54-58), acceptance item 9 ("the app routes a 401 to the password screen", l.89-90), and "Token changed on the Mac: 401 → password screen" (l.136).
- Ownership: .harness/state.json milestones.M1.requirements includes FR13.
- Coverage: no M1 criterion covers the routing, and no later milestone's criteria cover it either. M5-AC3 covers only a distinct wrong-password message.

Why it matters:
FR13 is assigned to M1, and this is the only part of it that is neither implemented nor planned elsewhere. If M1 closes as-is, the requirement is dropped without anyone deciding to drop it. The user-facing effect is that a changed or mistyped token leaves the user stuck on Chat, with a technical error on every send and no route back to where the token is entered. The only way out is to find Settings > Update Token (or Logout) on their own.

Suggested correction:
Preferred (small, code): distinguish `UnauthorizedError` in chatController.sendMessage. This covers both getState and chat. Surface it through a dedicated callback, for example `onUnauthorized`. In chat.tsx, show "Password wrong or changed", then `router.push("/settings")` with the token form open. Add a chatController test that a 401 from getState, and one from chat, calls onUnauthorized and not onError.
Alternative (record only, needs the human's decision): record in .harness/milestones.md and state.json that the 401 → settings routing moves to M5, by extending M5-AC3 or adding an M5 criterion. This is needed because FR13 is currently assigned to M1.
Validating the token at Setup (already logged as a follow-up) does not satisfy this on its own, because a token changed later on the Mac still produces a 401 on Chat.

### 2
Severity:
OPTIONAL

Problem:
The milestone's recorded validation command does not include `bun run smoke:runtime`. That command is in .harness/milestones.md `### Validation` and in state.json milestones.M1.validation[0].command. The runtime smoke is the only automated check that catches the launch-crash and double-header defects fixed in cycle 4. It currently appears only in the cycle-4 validation entry.

Evidence:
.harness/milestones.md `### Validation` (the mobile stage ends at `npx expo export --platform ios && rm -rf dist`); state.json milestones.M1.validation[0].command.

Why it matters:
Later milestones will reuse the recorded command, so a regression in the same class would pass it.

Suggested correction:
Add `&& bun run smoke:runtime` to the mobile stage in both records.

### 3
Severity:
OPTIONAL

Problem:
The new e2e check `test "$IFACE_FILE_CONTENT" = "$TS_IF"` passes when both values are empty. That happens when Tailscale has no IPv4 address and the iface file is missing.

Evidence:
ops/scripts/e2e-tailnet-proof.sh l.267-269.

Why it matters:
In that state other checks fail, so the overall result is not falsely green. This line, though, reports that the pf anchor is loaded for the tailnet interface when it is not.

Suggested correction:
`test -n "$TS_IF" -a "$IFACE_FILE_CONTENT" = "$TS_IF"`, or an equivalent `[[ -n ... && ... ]]`.
