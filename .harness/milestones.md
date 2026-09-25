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

cd /Users/ryankenny/Projects/CodingHarnessv2 && bash ops/scripts/e2e-tailnet-proof.sh && (cd server && bun test && bun run typecheck && bash scripts/entry-smoke.sh) && (cd ops && bun test src/token && bash scripts/verify-ops-install.sh) && (cd mobile && bun run typecheck && bun test src/api src/ui && bun run lint && npx expo export --platform ios && rm -rf dist)

Needs the live LaunchAgents, Tailscale and Ollama. Artifacts: .harness/evidence/M1-T5b-verifier.log, .harness/evidence/M1-T7-verifier.log

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

### Review Cycles

1

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
- Cycle-1 server API changes: invalid chat body code is now bad_request; SSE streams begin with ": connected"; client disconnect no longer cancels a reply (Stop POSTs cancel).

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
