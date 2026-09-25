# Milestones

## M1 — Authenticated tailnet chat stream proof

Status: BLOCKED

### Outcome

From Expo Go on the phone, over the tailnet only, a user can send one prompt to the currently resident Ollama model and watch the reply stream in token by token, protected by a bearer token, with Stop working.

### Architecture

C1, C2, C4, C6, C7, C8, C9, C10, C11

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M1-AC1**: With a model already resident in Ollama, sending a prompt from the Expo Go app over Tailscale Serve renders the reply incrementally, token by token, ending in a terminal complete state.
- [ ] **M1-AC2**: A request to any server route without the correct bearer token returns 401; the Mac-side command produces the token, refuses to run if the token file is group- or world-readable, and the app's settings screen accepts a pasted token and uses it on the next request.
- [ ] **M1-AC3**: Stop cancels generation on the Mac, verified against Ollama, and streaming output halts on the phone.
- [ ] **M1-AC4**: The server and the app bundle are reachable from the phone over the tailnet and are not reachable from a device on the LAN or the public internet.

### Baseline

04bb92b7be06984856c1dd1c34b52e2533f656e3 on m1-authenticated-tailnet-chat-stream

### Evidence

Tasks (structured detail in state.json):
- M1-T1 server HTTP + Ollama client + bearer auth — Mid, attempt 3, PASS; verified; commit 7d22640
- M1-T2 generation manager (SSE, resume, cancel) — Mid, attempt 3, PASS; verified; commit c7fd15b (its curl proof skipped: no live server)
- M1-T3 Mac ops tooling — Mid, attempt 3, PASS; verified; commit 01f4b1d
- M1-T4 Expo Go app (SDK 51) — Mid, 2 runtime interruptions then attempt 3 PASS; verifier PASS (typecheck, tests, lint, ios export exit 0); commit d87a597
- M1-T6 current Expo SDK 57 + expo/fetch + real tests — Mid, attempt 3 (three turn-limit interruptions, then finish-only worker PASS); verifier PASS (typecheck, 15 tests, lint, ios export exit 0; expo-doctor 21/21); commit a8ca44e
- M1-T5 split into T5a (code) and T5b (live) to fit a worker's turn limit
- M1-T5a server entry point, LaunchAgent plists, 8443 Serve script, entry smoke — Top (SECURITY), attempt 4, PASS; verifier PASS (server 25 tests, entry-smoke 7/7, ops token 14, bash -n, plutil); no live changes; commit 0cce5e1
- M1-T7 wire HTTP routes to generation manager + Ollama — Mid (ORDINARY_IMPLEMENTATION), attempt 3 INTERRUPTED at turn limit, then continuation 1 PASS; verifier PASS (server 29 tests, typecheck, entry-smoke 7/7; tests not weakened); live-loopback curl proof exit 0 but no model resident, so token streaming left to T5b; commit 69dc85f
- M1-T5b live install + e2e tailnet proof — Top (SECURITY), attempt 4 PASS; verifier PASS (e2e-tailnet-proof.sh live exit 0, server 29 tests, typecheck, ops token 14, verify-ops-install); commit 88ebde6. Live: token file 0600, both LaunchAgents running, Serve 8443 -> 127.0.0.1:7789 added with / and /app unchanged, no Funnel, no sudo

Per criterion (full detail in state.json criteria[].evidence):
- M1-AC1: 80 content events over the tailnet URL in ~6.5s, ending done/complete (.harness/evidence/M1-T5b-verifier.log); on-phone render is a human check
- M1-AC2: 7 routes 401 with no and wrong token via tailnet; token command 0600, refuses 644/640/604 (T5b log); route auth tests (.harness/evidence/M1-T7-verifier.log); on-phone token paste is a human check
- M1-AC3: cancel over tailnet ends cancelled, Ollama log "stop: cancel task", runner CPU to 0 (T5b log); on-phone Stop is a human check
- M1-AC4: 7789 loopback-only, LAN refuses 7789/8443, 8081 manifest via tailnet (T5b log). GAP: LAN 8081 is reachable until the human runs the sudo pf command

### Validation

cd /Users/ryankenny/Projects/CodingHarnessv2 && bash ops/scripts/e2e-tailnet-proof.sh && (cd server && bun test && bun run typecheck && bash scripts/entry-smoke.sh) && (cd ops && bun test src/token && bash scripts/verify-ops-install.sh) && (cd mobile && bun run typecheck && bun test src/api src/ui src/chat src/app-routing && bun run lint && npx expo export --platform ios && rm -rf dist)

Needs the live LaunchAgents, Tailscale and Ollama. Artifacts: .harness/evidence/M1-T5b-verifier.log, .harness/evidence/M1-T7-verifier.log; cycle 2: .harness/evidence/M1-C7-verifier-2.log (e2e exit 0), M1-C6-verifier.log (mobile 0), M1-C8-verifier.log (ops 0)

### Review

Cycle 1: CHANGES REQUIRED (SUBSTANTIVE) — .harness/reviews/M1-cycle1.md (F1-F6 BLOCKER, F7-F8 IMPORTANT, F9-F11 OPTIONAL)
Pre-correction: 7263d6338e07fe9d0a3302154bc685c594d6b6ec
Corrections (each verifier-confirmed, committed):
- M1-C1 server F4/F7/F9/F11-stats — Top (DIFFICULT_CONCURRENCY), attempt 4 PASS; server 39 tests, typecheck, entry-smoke; e876590
- M1-C2 app F1/F2/F3/F8 — Mid, attempt 3 INTERRUPTED (turn limit, handoff .harness/tasks/M1-C2-handoff-1.md) → continuation 1 PASS; typecheck, 24 tests, lint, iOS export; c3210f3
- M1-C3 pf anchor F5/F6/F8-e2e — Top (SECURITY), attempt 4 PASS; verify-ops-install incl. check-pf-rules.sh, pfctl -n parse; 9a2eeb8
- M1-C4 token F10 + .gitignore F11 — Cheap, attempt 1 PASS; ops token tests; cf31dd3
- M1-C5 live LaunchAgents reloaded onto c3210f3 — Cheap, attempt 1 PASS; live SSE begins ": connected" (new code confirmed)
Cycle-1 validation: .harness/evidence/M1-cycle1-validation.log — server 0, ops 0, mobile 0; e2e exit 1 on one check only: LAN 192.168.0.27:8081 REACHABLE (pf anchor not yet installed)
Correction diff: git diff 7263d6338e07fe9d0a3302154bc685c594d6b6ec HEAD
Files changed by corrections: .gitignore; mobile/app.json; mobile/src/api/{client.ts,client.test.ts,config.ts,config.test.ts,expoFetchClient.ts}; mobile/src/app/chat.tsx; mobile/src/chat/{chatController.ts,chatController.test.ts}; ops/scripts/{check-pf-rules.sh,com.harness.pf-bundle-host.plist,e2e-tailnet-proof.sh,install-pf-anchor.sh,pf-bundle-host-load.sh,uninstall-pf-anchor.sh,verify-ops-install.sh} (deleted: com.harness.pf.anchor, create-pf-anchor.sh); ops/src/{token.ts,token.test.ts}; server/scripts/curl-chat-stream-proof.sh; server/src/generations/{manager.ts,manager.test.ts}; server/src/http/{server.ts,server.test.ts}; server/src/ollama/client.ts. No file outside the findings' scope.

Problem:
Cycle-1 corrections are done and validated, but M1-AC4 (bundle host unreachable from the LAN) can only pass once the human installs the pf anchor with the admin password. The second and final review would otherwise fail AC4 and spend the last cycle.

Requirement/milestone affected:
M1-AC4, FR14 (finding F5).

Attempts made:
1. M1-C3 (Top) built install-pf-anchor.sh, uninstall-pf-anchor.sh and a boot LaunchDaemon; the no-sudo safety check (port-8081-only inbound rules, anchor com.apple/harness.bundle-host, no pfctl -d, no main-ruleset flush/load, no pf.conf edit) and a pfctl -n parse check pass.
2. M1-C5 live validation: every check passes except "LAN 192.168.0.27:8081 REACHABLE".

Remaining issue:
Human runs once: cd /Users/ryankenny/Projects/CodingHarnessv2 && sudo bash ops/scripts/install-pf-anchor.sh (undo: sudo bash ops/scripts/uninstall-pf-anchor.sh). Phone checks in Expo Go remain human checks.

Recommended decision:
Run the install command, re-run bash ops/scripts/e2e-tailnet-proof.sh (expect all PASS), then set M1 back to REVIEW for the scoped cycle-2 re-review.

Cycle 2: CHANGES REQUIRED (SUBSTANTIVE) — .harness/reviews/M1-cycle2.md (A, B IMPORTANT; C OPTIONAL); log .harness/evidence/M1-review-cycle2.log
Pre-correction: 5ec03b045788188acb8975ae6097190ed27f8dcf (c763b9f plus the committed review report and the human's on-phone result; no code change)
Corrections (each verifier-confirmed, committed):
- M1-C6 B: human's on-phone check showed "Unmatched Route"; cause: mobile/src/app had no index.tsx, so "/" matched no screen. Added index.tsx redirecting to /setup or /chat — Mid, attempt 3 PASS; typecheck, 27 tests, lint, iOS export; bundle host restarted (no sudo), tailnet bundle registers ./index.tsx; 1a7565e
- M1-C7 A: e2e checks pf LaunchDaemon last exit 0 and loaded iface == current tailnet utun; Mac-local LAN 8081 probe replaced by an info line — Cheap attempt 1 FAIL (dropped two human instructions) → Cheap attempt 2 PASS; live e2e exit 0; 1a248cf
- M1-C8 C: token main(args, copy = defaultCopyCommand), no globalThis — Cheap attempt 1 PASS; 85a6f41
Correction diff: git diff 5ec03b045788188acb8975ae6097190ed27f8dcf HEAD
Files changed by corrections: mobile/src/app/index.tsx; mobile/src/app-routing/{initialRoute.ts,initialRoute.test.ts,rootIndexRoute.test.ts}; ops/scripts/e2e-tailnet-proof.sh; ops/src/{token.ts,token.test.ts}. No file outside the findings' scope.

Problem:
Cycle-2 corrections are done and validated, including the fix for the "Unmatched Route" screen. Finding B (M1-AC1, AC2 app half, AC3 phone half) can only be closed by on-phone checks the human performs. The next review is the last the 2-cycle cap allows; without that evidence it would fail B again.

Requirement/milestone affected:
M1-AC1, M1-AC2, M1-AC3 (finding B).

Attempts made:
1. M1-C6 diagnosed the human's "Unmatched Route" (no root route) and added mobile/src/app/index.tsx; verifier confirmed the tailnet-served bundle contains the new route.
2. The ~20s "Opening project" wait matches the first production bundle build (bundle-host.log "iOS Bundled 23140ms"); a warm bundle now serves in <1s.

Remaining issue:
Human re-test on the iPhone, Tailscale ON:
1. Force-close Expo Go, reopen it, open exp://ryans-mac-studio.tailc3648a.ts.net:8081 (the first open may take ~20-30s while the bundle builds). Expect the Setup screen, not "Unmatched Route".
2. On the Mac run `pbcopy < ~/.phone-models/token`, then paste the token into Setup (it arrives via Universal Clipboard); tap Continue. Expect the Chat screen. Open Settings from Chat to confirm it opens.
3. Send a short prompt. Expect the reply to appear word by word and finish.
4. Send a long prompt, tap Stop while it is writing. Expect the text to stop and not resume.
Record pass/fail for each on M1-AC1 (step 3), M1-AC2 (step 2), M1-AC3 (step 4).

Recommended decision:
Do the re-test. If all four pass, record them and set M1 back to REVIEW for the scoped final review. If any fails, record exactly what the screen showed; the cap is then spent and the milestone needs a human decision.

Cycle 3 (human-authorised override, one extra fix cycle; answers cycle-2 finding B after the human's re-test: Setup keyboard covers Continue and cannot be dismissed)
Pre-correction: 811f5bed6d9a1d5eeccbcd842624f77fd8d5a9ba
Corrections (each verifier-confirmed, committed):
- M1-C9 B: Setup/Settings/Chat wrapped in KeyboardAvoidingView with ScrollView keyboardShouldPersistTaps + keyboardDismissMode and tap-outside Keyboard.dismiss; token fields single-line, returnKeyType done, onSubmitEditing; chat's Stack header hidden (chat renders its own) — Mid attempt 3 INTERRUPTED (turn limit, handoff .harness/tasks/M1-C9-handoff-1.md) → continuation 1 PASS; verifier: typecheck, 30 tests, lint, iOS export, new test RED on HEAD/GREEN now, tailnet bundle carries new Setup code, Serve mappings intact; 81d49c6
- M1-C10 B: Setup/Settings keyboardVerticalOffset = useHeaderHeight() (RN KeyboardAvoidingView measures its frame parent-relative, so offset 0 under a Stack header left ~header height of the view under the keyboard; found by the orchestrator reading RN source) — Cheap attempt 1 PASS; verifier: typecheck, 32 tests, lint, iOS export, served bundle carries the offset; 61421a3
Bundle host restarted (no sudo) after each; pf anchor and Tailscale Serve mappings untouched.
Validation artifacts: .harness/evidence/M1-C9-verifier.log, .harness/evidence/M1-C10-verifier.log
Correction diff: git diff 811f5bed6d9a1d5eeccbcd842624f77fd8d5a9ba HEAD
Files changed by corrections: mobile/src/app/{setup.tsx,settings.tsx,chat.tsx,_layout.tsx}; mobile/src/app-routing/keyboardHandling.test.ts. No file outside the finding's scope (_layout.tsx: chat route headerShown false only).

Problem:
Cycle-3 corrections are done, verified and served to the phone. Finding B (M1-AC1, AC2 app half, AC3 phone half) can only be closed by the human's on-phone checks. The review cap, including the one-cycle override, is now spent, so the final review needs that evidence first.

Requirement/milestone affected:
M1-AC1, M1-AC2, M1-AC3 (finding B).

Attempts made:
1. M1-C9 made all three screens move above the keyboard and let a tap or drag outside the input close it; the token field now has a Done key that submits.
2. M1-C10 corrected Setup/Settings so the lift includes the height of the top title bar.
3. Keyboard behaviour cannot be exercised by automated tests here (bun cannot render React Native; the simulator cannot be tapped without extra tooling); regression tests check the screen source statically.

Remaining issue:
Human re-test on the iPhone, Tailscale ON:
1. Force-close Expo Go, reopen it, open exp://ryans-mac-studio.tailc3648a.ts.net:8081 (the first open may take ~20-30s while the bundle builds). Expect the Setup screen.
2. Tap the token box: the keyboard opens and the Continue button stays visible above it. Tap an empty area of the screen: the keyboard closes. Tap the box again.
3. On the Mac run `pbcopy < ~/.phone-models/token`, paste into the box (Universal Clipboard), then tap Continue (or the keyboard's Done key). Expect the Chat screen, with a single top bar that has a Settings link.
4. On Chat, tap the message box: the message box and Send stay visible above the keyboard; dragging the message list down closes the keyboard.
5. Send a short prompt. Expect the reply word by word, finishing.
6. Send a long prompt, tap Stop while it is writing. Expect the text to stop and not resume.
7. Tap Settings, tap Update Token: the Save and Cancel buttons stay visible above the keyboard; tap Cancel; use the back arrow to return to Chat.
Record pass/fail on M1-AC1 (steps 1, 4, 5), M1-AC2 (steps 2, 3, 7), M1-AC3 (step 6).

Recommended decision:
Do the re-test. If all pass, record them and set M1 back to REVIEW for the scoped final review of cycle 3's corrections. If any fails, record exactly what the screen showed; the cap is spent, so the milestone needs a human decision.

Cycle 4 (human-authorised override, second extra fix cycle; answers cycle-2 finding B after the human's 15:51/15:53 re-test: fresh bundle crashes at launch in RootLayout 'Cannot convert Symbol to string'; Chat keyboard covered the message box on the cached bundle)
Pre-correction: e40f26ac82d8a330c1cfe473d8643a6abf2db5cf
Corrections (each verifier-confirmed, committed):
- M1-C11 B: launch crash. Cause: RootLayout wrapped its token-present Stack.Screens in a Fragment; expo-router's Stack does not flatten Fragments and interpolates the Fragment's Symbol type into a warning string, which throws "Cannot convert a Symbol value to a string" during render, on every launch with a stored token. Present since d87a597, not a cycle-3 regression; the 15:51 run most likely began with no stored token. Fix: no Fragment. Added a runtime check (mobile/scripts/runtime-smoke.sh + runtime-smoke.mjs, `bun run smoke:runtime`) that executes the production iOS bundle in Node with fake native modules and fails on any JS exception or a missing first screen — Top (AMBIGUOUS) attempt 4 INTERRUPTED (turn limit; handoff .harness/tasks/M1-C11-handoff-1.md) → continuation 1 PASS; verifier (interrupted, log written) tests 0, smoke GREEN; orchestrator reproduced RED on git archive e40f26a (token present: fatal Symbol exception; token absent: PASS); 6fec6a1
- M1-C12 B: Chat double top bar / keyboard over the message box. Cause: RootLayout read the token once at launch and declared chat/settings only if one existed, so after first-time Setup's router.replace("/chat") Chat was an undeclared screen with a default Stack header ("chat") above its own header, and chat.tsx's keyboardVerticalOffset={0} (premised on no Stack header) fell short by the header height. Fix: all three screens declared unconditionally (index.tsx and the screens already route by token); runtime check extended to drive Setup -> Chat and require one top bar — Mid attempt 3 INTERRUPTED → continuation 1 INTERRUPTED (handoffs .harness/tasks/M1-C12-handoff-{1,2}.md) → continuation 2 PASS; verifier PASS; orchestrator re-ran RED/GREEN with a cleared Metro cache (.harness/evidence/M1-C12-orchestrator-red.log): pre-fix header {chat, hidden false} FAIL, fixed PASS; 49bb53f
- M1-C13 B: runtime check exports with --clear (a stale Metro cache made a scratch export judge an older bundle) — Cheap attempt 1 PASS; verifier PASS; 0376cf3
What the runtime check proves: the bundled JS launches, RootLayout renders, the first screen appears without a JS exception (Chat with a token, Setup without), and Setup -> Chat reaches Chat with one top bar. What it cannot: Hermes-only behaviour (it runs on V8), native layout and keyboard geometry, the phone's Expo Go version, networking, anything past those screens.
Bundle host restarted (no sudo); the tailnet-served bundle (manifest 200, launchAsset 200) contains the fixed RootLayout and passes the runtime check. pf anchor and Tailscale Serve mappings untouched (/ -> 7787, /app -> 7788, :8443 -> 7789).
Validation artifacts: .harness/evidence/M1-C11-worker.log, M1-C11-verifier.log, M1-C12-verifier.log, M1-C12-orchestrator-red.log, M1-C13-verifier.log (mobile 0, 35 tests, smoke PASS)
Correction diff: git diff e40f26ac82d8a330c1cfe473d8643a6abf2db5cf HEAD
Files changed by corrections: mobile/src/app/_layout.tsx; mobile/src/app-routing/stackChildren.test.ts; mobile/scripts/{runtime-smoke.mjs,runtime-smoke.sh}; mobile/package.json (smoke:runtime script entry only). No file outside the finding's scope.

Problem:
Cycle-4 corrections are done, verified and served to the phone. Finding B (M1-AC1, AC2 app half, AC3 phone half) can only be closed by the human's on-phone checks. The review cap, including both override cycles, is now spent.

Requirement/milestone affected:
M1-AC1, M1-AC2, M1-AC3 (finding B).

Attempts made:
1. M1-C11 found the launch crash: the Chat and Settings screens were wrapped in a grouping element the navigation library cannot read, which crashed every launch where a token was already saved. Removed it.
2. M1-C12 found why Chat had two top bars and the keyboard covered the message box: after first-time Setup, Chat's settings were never applied. All screens are now always declared.
3. A new check runs the real app bundle on the Mac and would have caught both; it cannot measure the keyboard on a real phone.

Remaining issue:
Human re-test on the iPhone, Tailscale ON:
1. Fully force-close Expo Go (swipe it away in the app switcher), reopen it, open exp://ryans-mac-studio.tailc3648a.ts.net:8081 (first open may take ~20-30s while the bundle builds). A token is already saved, so expect the Chat screen, no error screen.
2. Check Chat has a single top bar (title "Chat" and a Settings link), not two.
3. Tap the message box: the box and Send stay visible above the keyboard; dragging the message list down closes the keyboard.
4. Send a short prompt. Expect the reply word by word, finishing.
5. Send a long prompt, tap Stop while it is writing. Expect the text to stop and not resume.
6. Tap Settings, tap Update Token: Save and Cancel stay visible above the keyboard; tap Cancel; use the back arrow to return to Chat.
7. In Settings tap Logout: expect Setup. Tap the token box: Continue stays visible above the keyboard; tap an empty area to close it. On the Mac run `pbcopy < ~/.phone-models/token`, paste, tap Continue. Expect Chat with a single top bar, and repeat step 3 there.
8. Force-close Expo Go again and reopen the project: expect Chat directly, no error screen.
Record pass/fail on M1-AC1 (steps 1-4, 8), M1-AC2 (steps 6-7), M1-AC3 (step 5).

Recommended decision:
Do the re-test. If all pass, record them and set M1 back to REVIEW for the scoped final review of cycle 4's corrections. If any fails, record exactly what the screen showed; both override cycles are spent, so the milestone needs a human decision.

### Review Cycles

4

### Follow-ups

- M1 was undersized at planning: IMPLEMENTATION_PLUS_LIVE_PROOF and CONCURRENCY_LIFECYCLE both apply. Found mid-flight, so noted, not split.
- M1-T2's curl proof skips when no server is listening; M1-T3's Serve script and plists did not match architecture C8/C10; no server entry point exists. Corrected under M1-T5a.
- M1-T4 was accepted with placeholder tests on Expo SDK 51 (latest is 57); corrected under M1-T6.
- M1-T1/M1-T2 were accepted with HTTP routes never wired to the generation manager (placeholders); found by M1-T5a, corrected under M1-T7.
- No .gitignore excludes server/node_modules/ (untracked); add one (node_modules/, dist/).
- Worker budget: 20 of 22 used (human raised it from 16).
- Bundle host binds *:8081, so LAN 8081 is reachable (M1-AC4 gap). Needs the human's sudo pf command, which e2e-tailnet-proof.sh prints; persistence across reboot and utun naming unsolved.
- ops/scripts/com.harness.pf.anchor and create-pf-anchor.sh (M1-T3) contain `block all` (only lo0/utun0-4 allowed) and load into an anchor pf.conf never evaluates: unsafe to load; needs correction.
- server/scripts/curl-chat-stream-proof.sh posts model "test-model", which does not exist in Ollama.
- Human phone checks pending: Expo Go over the tailnet (render token by token, paste token in settings, Stop halts output); LAN device cannot reach 7789/8443/8081.
- M1-T5b left devstral:24b loaded in Ollama (default keep-alive).
- pf loader loads nothing until Tailscale's utun resolves, so 8081 is unfiltered from boot until Tailscale is up (<=60s after). Stricter option: always load the lo0 pass + block.
- pf loader uses the tailnet IPv4 recorded at install; re-run install if it changes.
- I10 `think:true when supported` not sent on /v1/chat; belongs with thinking display (M4).
- Bundle host serves a production build that takes ~23s to build cold after each restart; Expo Go shows "Opening project" meanwhile (cycle 2, M1-C6 log).
- mobile/src/app-routing/rootIndexRoute.test.ts checks index.tsx statically (bun cannot import expo-router/react-native sources); a real route-resolution test needs a jest-expo style runner.
- Cycle-1 server API changes: invalid chat body code is now bad_request; SSE streams begin with ": connected"; client disconnect no longer cancels a reply (Stop POSTs cancel).
- Runtime smoke check (mobile/scripts/runtime-smoke.sh) runs on V8 with faked native modules; Hermes-only or native-layout defects pass it. An Expo Go-in-Simulator check would close more of the gap.
- Runtime smoke logs a harmless RNCMaskedView new-architecture console.error from a library.
- Served bundle is not minified despite minify=true in its URL; not investigated.
- Cycle 4: workers and verifiers hit turn limits repeatedly on mobile tasks (C11, C12 needed continuations).

## M2 — Model list, swap-load, and unload with busy confirmation

Status: TODO

### Outcome

The phone shows every installed Ollama model and the true resident state, can load (swap) or unload with a confirmation gate when busy or when another tool owns the resident model, and a loaded model stays resident indefinitely.

### Architecture

C1, C4, C5, C7

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M2-AC1**: The app's model list matches Ollama GET /api/tags by real name and size, with no hardcoded model names.
- [ ] **M2-AC2**: Loading model A then model B leaves only B resident in GET /api/ps; unloading leaves nothing resident.
- [ ] **M2-AC3**: A model loaded from the phone remains resident in GET /api/ps after 10 minutes idle and after a chat reply completes.
- [ ] **M2-AC4**: Swapping or unloading while a reply is in flight, or while the resident model was not loaded by this server, requires explicit confirmation, and cancelling the confirmation leaves state unchanged.
- [ ] **M2-AC5**: A failed load, such as out of memory, leaves nothing resident and the app shows the failure reason.

### Baseline

Pending.

### Evidence

Pending.

### Validation

Pending.

### Review

Pending.

### Review Cycles

0

### Follow-ups

None.

## M3 — Persisted multi-turn conversations with model attribution

Status: TODO

### Outcome

The phone keeps a list of conversations, each with full multi-turn history sent on every prompt, each reply labeled with the model that produced it, and conversations survive an app restart.

### Architecture

C1, C3

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M3-AC1**: Conversations can be created, opened and deleted, and are listed newest first.
- [ ] **M3-AC2**: A follow-up prompt in the same conversation demonstrably uses context from an earlier turn.
- [ ] **M3-AC3**: Each assistant reply displays the model name that produced it, including after a mid-conversation model switch.
- [ ] **M3-AC4**: Sending with no model resident is blocked with a prompt to load one.
- [ ] **M3-AC5**: Force-quitting and reopening Expo Go shows the same conversations and messages as before.

### Baseline

Pending.

### Evidence

Pending.

### Validation

Pending.

### Review

Pending.

### Review Cycles

0

### Follow-ups

None.

## M4 — Thinking display and dropped-connection resume

Status: TODO

### Outcome

Reasoning output appears collapsed and expandable, separate from the answer, and a transport drop or app backgrounding mid-reply resumes cleanly with no gaps or duplication once the phone reconnects.

### Architecture

C1, C2, C3, C6

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M4-AC1**: For a model that emits reasoning output, the app shows it in a collapsed, expandable section separate from the answer.
- [ ] **M4-AC2**: Killing the connection mid-reply and reconnecting yields the complete reply with no gaps and no duplicated text.
- [ ] **M4-AC3**: Backgrounding the app mid-reply and returning to foreground resumes the same reply and receives its terminal state, with only an explicit Stop cancelling generation.

### Baseline

Pending.

### Evidence

Pending.

### Validation

Pending.

### Review

Pending.

### Review Cycles

0

### Follow-ups

None.

## M5 — Always-on Mac tooling, plain-language errors, and PWA retirement

Status: TODO

### Outcome

The server and app bundle host survive a Mac reboot with no manual step, every failure mode shows a distinct plain-language message, and the old PWA is retired without disturbing the harness's own endpoint.

### Architecture

C4, C8, C9

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M5-AC1**: After a Mac reboot, opening the project in Expo Go on the phone works with no manual step on the Mac.
- [ ] **M5-AC2**: Killing either the server process or the bundle host process causes it to restart automatically.
- [ ] **M5-AC3**: The app shows a distinct message for each of: Mac or server unreachable, Ollama down, wrong password, model failed to load, model no longer installed, and reply already in progress.
- [ ] **M5-AC4**: After retirement, /app no longer resolves, the PWA's LaunchAgent is gone, and the harness's / handler still works.

### Baseline

Pending.

### Evidence

Pending.

### Validation

Pending.

### Review

Pending.

### Review Cycles

0

### Follow-ups

None.
