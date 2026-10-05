# M1 review, cycle 2

Verdict: CHANGES REQUIRED
Scope reviewed: correction diff `git diff 7263d6338e07fe9d0a3302154bc685c594d6b6ec HEAD` (HEAD c763b9f, branch m1-authenticated-tailnet-chat-stream). All four acceptance criteria re-graded.

## Validation (re-run by reviewer at c763b9f, 2026-09-25 12:45 BST)

Full output: `.harness/evidence/M1-review-cycle2.log`. Each stage was run on its own so a failure in one stage did not stop the others. The recorded command chains them with `&&`, so as recorded it stops after e2e.

- e2e-tailnet-proof.sh: **exit 1**. Every check passed except one: "LAN 192.168.0.27:8081 (bundle host) is blocked from the LAN: REACHABLE (HTTP 200)".
  - AC1: 80 content events over the tailnet URL (first 0.612s, last 6.747s), ending `done` complete. `eval_count` is now Ollama's value (81).
  - AC2: all 7 routes return 401 with no token and with a wrong token. The token command writes mode 600 and refuses 644/640/604.
  - AC3: cancel ends with `done` cancelled, no bytes arrive after it, generation is null afterwards, Ollama logs "stop: cancel task", and runner CPU drops from 2.47 to 0.01.
  - AC4: 7789 listens on loopback only. 8443 through the tailnet returns 200. LAN 7789 and 8443 refuse connections. The 8081 manifest loads through the tailnet name.
- server: 39 pass / 0 fail. Typecheck and entry-smoke pass.
- ops: token tests pass. verify-ops-install passes, including check-pf-rules.sh.
- mobile: typecheck passes. 24 tests pass (src/api src/ui src/chat). Lint is clean and the iOS export succeeds.

Read-only reviewer probes (no sudo):
- `route -n get 192.168.0.27` reports `interface: lo0`.
- `route -n get 100.82.139.85` reports `interface: utun4`.
- `launchctl print system/com.harness.pf-bundle-host` reports runs = 6 and last exit code = 0.
- `/var/run/com.harness.pf-bundle-host.iface` contains `utun4`, and the recorded tailnet IP is `100.82.139.85`, which is the IP on utun4. The loader writes this iface file only after `pfctl -a com.apple/harness.bundle-host -f` succeeds.

## Cycle-1 findings: status

| Finding | Status |
|---|---|
| F1 base URL | Fixed. `mobile/src/api/config.ts` and `app.json` `extra.serverUrl` point at the tailnet :8443 URL. config.test.ts checks that the two match, and client.test.ts checks that requests go to that URL. |
| F2 model | Fixed. `mobile/src/chat/chatController.ts` `sendMessage` calls GET /v1/state and uses `resident.name`. Sending is blocked when no model is resident or on 409 model_not_resident. Tested. |
| F3 Stop | Fixed. `onStart` fires with `x-generation-id` before the body is read (client.ts). `stopGeneration` POSTs cancel without aborting the fetch. Tested. |
| F4 wedge | Fixed. The manager runs the Ollama loop itself (`manager.ts` `run`), and HTTP responses are subscribers (`server.ts` `sseResponse`). A disconnect only drops the subscription. Cancel wins by `Promise.race` even when the upstream stream ignores the signal. Server tests cover abort mid-stream, cancel after abort, and resume. |
| F5 pf anchor | Code fixed and installed live. Blocking was confirmed by a human LAN-device check. The e2e check added for it is wrong: see finding A. |
| F6 unsafe anchor | Fixed. Rules are port-scoped, the anchor is `com.apple/harness.bundle-host`, and the legacy files are gone. check-pf-rules.sh enforces this. |
| F7 explicit request | Fixed. `ollama/client.ts` sends `{model, messages, keep_alive:-1, stream:true}`, the body is validated, and the server returns 409 model_not_resident. Tested. |
| F8 tests | Mostly fixed (see A). |
| F9 constant-time compare | Fixed (`tokensMatch`). |
| F10 token | Fixed: mkdir 0700 and `--copy`. |
| F11 stats and .gitignore | Fixed. |

Architecture: C6 ownership and C9/I12-I14 now match the agreed design. The `## Deviations` section is not needed for these changes. No drift found.

## Acceptance criteria

```
Acceptance Criterion:
M1-AC1: With a model already resident in Ollama, sending a prompt from the Expo Go app over Tailscale Serve renders the reply incrementally, token by token, ending in a terminal complete state.

Implementation Evidence:
Server: server/src/generations/manager.ts (run/subscribe), server/src/http/server.ts (sseResponse, parseChatRequest, model_not_resident), server/src/ollama/client.ts chat(). App: mobile/src/api/config.ts + app.json extra.serverUrl, mobile/src/api/expoFetchClient.ts, mobile/src/chat/chatController.ts sendMessage, mobile/src/app/chat.tsx:94-146.

Test Evidence:
Server path over the tailnet, re-run live: 80 content events from 0.612s to 6.747s, then done complete. App logic, with a fake fetch: chatController.test.ts (resident model used, blocked when none), client.test.ts (tailnet URL, ': connected' comment ignored). On the phone: none. state.json M1-AC1 evidence still says "On-phone Expo Go rendering: human check, not yet done". The unit tests use a fake fetch, so they cannot show that expo/fetch delivers tokens incrementally inside Expo Go, or that the app loads over the tailnet with pf active.

Result:
FAIL
```

```
Acceptance Criterion:
M1-AC2: A request to any server route without the correct bearer token returns 401; the Mac-side command produces the token, refuses to run if the token file is group- or world-readable, and the app's settings screen accepts a pasted token and uses it on the next request.

Implementation Evidence:
server/src/http/server.ts verifyAuth/tokensMatch; ops/src/token.ts; mobile/src/app/settings.tsx (unchanged); mobile/src/app/chat.tsx:83-91 (token re-read before every send) against the configured tailnet URL.

Test Evidence:
Re-run live: 7/7 routes return 401 with no token and with a wrong token, and the token command writes 0600 and refuses 644/640/604. server.test.ts "Bearer comparison (F9)". ops token.test.ts. client.test.ts setToken and configured URL. On the phone: none. state.json says "on-phone paste is a human check, not yet done". The server and Mac parts pass. The app half is still not demonstrated on the device.

Result:
FAIL
```

```
Acceptance Criterion:
M1-AC3: Stop cancels generation on the Mac, verified against Ollama, and streaming output halts on the phone.

Implementation Evidence:
server/src/generations/manager.ts cancelGeneration and Promise.race abort; server.ts cancel route; mobile/src/api/client.ts onStart; mobile/src/chat/chatController.ts stopGeneration; mobile/src/app/chat.tsx:153-167.

Test Evidence:
Re-run live over the tailnet: done cancelled, no bytes after it, generation null, Ollama logs "stop: cancel task", CPU 2.47 -> 0.01. server.test.ts F4 lifecycle tests. manager.test.ts "cancel stops a generation whose chat stream ignores the abort signal". chatController.test.ts stopGeneration (cancel POSTed with the id from onStart, stream read to the cancelled terminal event, no content applied after it). Phone halting: none. state.json says "Phone output halting: human check, not yet done".

Result:
FAIL
```

```
Acceptance Criterion:
M1-AC4: The server and the app bundle are reachable from the phone over the tailnet and are not reachable from a device on the LAN or the public internet.

Implementation Evidence:
Server: 127.0.0.1:7789 bind, Serve :8443 tailnet only, no Funnel. Bundle host: ops/scripts/pf-bundle-host-load.sh (three inbound TCP 8081 rules, pass lo0 and the utun resolved from the tailnet IP, drop elsewhere, anchor com.apple/harness.bundle-host, which the stock /etc/pf.conf evaluates via `anchor "com.apple/*"`), install-pf-anchor.sh, com.harness.pf-bundle-host.plist (RunAtLoad plus a 60s recheck). Live: the LaunchDaemon's last exit is 0, and the loaded iface utun4 carries tailnet IP 100.82.139.85.

Test Evidence:
Human check, recorded in state.json after the install: an iPhone with Tailscale off on the same Wi-Fi could not load http://192.168.0.27:8081. Re-run live: LAN 7789 and 8443 refuse. The tailnet :8443 and the 8081 manifest via the tailnet name return 200, and that traffic routes via utun4 (route get), which the utun4 pass rule covers. check-pf-rules.sh proves the rules are port-scoped. The Mac-local LAN 8081 probe reports REACHABLE, but `route get 192.168.0.27` shows it goes over lo0, which rule 0 passes by design, so it cannot test the LAN path (finding A). The human device check is the valid LAN evidence, and it passed.

Result:
PASS
```

## Findings

### A
Severity:
IMPORTANT

Problem:
The e2e check "LAN 192.168.0.27:8081 is blocked from the LAN" can never pass while the pf anchor is working correctly. It curls the Mac's own LAN IP from the Mac. macOS routes traffic to a local address over lo0 (`route -n get 192.168.0.27` reports `interface: lo0`), and the anchor's first rule is `pass in quick on lo0 proto tcp ... port 8081`. The probe therefore reports REACHABLE whether or not pf is blocking the LAN, and it tells the user the anchor "is not installed or not active" even though it is.

Evidence:
ops/scripts/e2e-tailnet-proof.sh AC4 section (the `check "LAN $LAN_IP:8081 (bundle host) is blocked from the LAN ..."` line and its "not installed or not active" message). Reviewer run: `.harness/evidence/M1-review-cycle2.log` gives E2E_EXIT=1 on this check alone, while the LaunchDaemon's last exit is 0, iface is utun4, and the human's LAN-device check found 8081 blocked.

Why it matters:
The milestone's recorded validation command is `e2e && (server) && (ops) && (mobile)`. It now always stops at e2e with exit 1, so it can never complete green, and the server, ops and mobile stages never run from it. A check that is always red gets ignored, and that hides real regressions in later milestones that reuse this script. It also gives the human false advice to re-run a sudo install.

Suggested correction:
Replace the Mac-local LAN probe with checks the Mac can actually make without sudo:
- the LaunchDaemon `com.harness.pf-bundle-host` is loaded with last exit code 0;
- `/var/run/com.harness.pf-bundle-host.iface` equals the utun currently carrying `tailscale ip -4`;
- `route -n get <LAN_IP>` is lo0, printed as an info line explaining why the local probe cannot test the LAN path.

Keep "a device on the LAN cannot load http://<LAN_IP>:8081" in the human-check list, and record its result. Then update the milestone's `### Validation` so it can pass once pf is installed.

### B
Severity:
IMPORTANT

Problem:
The on-phone checks that AC1, AC2 (app half) and AC3 (phone half) depend on have not been performed. These are: open the app in Expo Go over the tailnet, paste the token in Settings, watch a reply stream token by token, and tap Stop and see output halt. state.json still records each one as "human check, not yet done". Only the LAN-device check was done.

Evidence:
.harness/state.json milestones.M1.criteria M1-AC1/AC2/AC3 evidence entries; the e2e "REMAINING FOR THE HUMAN" item 2 in `.harness/evidence/M1-review-cycle2.log`.

Why it matters:
The milestone's outcome is phone-side behaviour. The code and unit tests for the app path now look correct, but they use a fake fetch. Only a real device run can show that expo/fetch streams incrementally inside Expo Go, that the bundle loads over utun4 with pf active, and that the pasted token reaches the server. Cycle 1 found the app path broken while every automated check was green, which is exactly why this evidence cannot be inferred.

Suggested correction:
The human runs e2e item 2 once on the iPhone, with Tailscale on:
1. Open `exp://ryans-mac-studio.tailc3648a.ts.net:8081`.
2. Paste the token in Settings.
3. Send a prompt and confirm the reply renders incrementally and ends.
4. Send a long prompt, tap Stop, and confirm output halts and does not resume.

Record the result in each criterion's evidence in state.json and milestones.md.

### C
Severity:
OPTIONAL

Problem:
Production code reads a test hook from a global: `(globalThis as any).tokenCopyCommand || defaultCopyCommand`.

Evidence:
ops/src/token.ts `main()` (the `--copy` branch); ops/src/token.test.ts:187-198 sets it.

Why it matters:
Anything in the process can replace what runs with the token. It is also untyped, and it is not how the rest of the codebase injects dependencies (for example `createAPIClient(baseUrl, fetchImpl)`).

Suggested correction:
Pass the copy function as an optional parameter, `main(args, copy = defaultCopyCommand)`, and inject it in the test.
