# M1 review, cycle 1

Verdict: CHANGES REQUIRED
Diff: `git diff 04bb92b7be06984856c1dd1c34b52e2533f656e3 68ec7e2` (branch m1-authenticated-tailnet-chat-stream)

## Validation (re-run by reviewer at 68ec7e2, 2026-09-25 08:52 BST)

Milestone validation command exited 0. Full output: `.harness/evidence/M1-review.log`.

- e2e-tailnet-proof.sh: all automated checks PASS. AC1: 80 content events over the tailnet URL, first at 0.647s and last at 6.556s, then `done` with status complete. AC2: all 7 routes returned 401 with no token and with a wrong token. The token command created a 0600 file and refused 644/640/604. AC3: cancel gave `done` with status cancelled, Ollama logged "stop: cancel task", and runner CPU fell from 2.01 to 0.01. AC4: 7789 is bound to loopback only, and LAN 7789 and 8443 refuse connections. **LAN 8081 answered HTTP 200 (the script treats this as informational only).**
- server: 29 tests pass, typecheck passes, entry-smoke 7/7. ops: 14 token tests pass, verify-ops-install passes. mobile: typecheck passes, 15 tests pass, lint is clean, iOS export succeeds.

Extra reviewer probe (scratchpad `wedge.test.ts`, fake Ollama on port 0): see F4.

## Acceptance criteria

```
Acceptance Criterion:
M1-AC1: With a model already resident in Ollama, sending a prompt from the Expo Go app over Tailscale Serve renders the reply incrementally, token by token, ending in a terminal complete state.

Implementation Evidence:
Server side: server/src/http/server.ts:261-327, server/src/generations/manager.ts, server/src/ollama/client.ts:127-190. App side: mobile/src/app/chat.tsx, which is broken: base URL http://localhost:7789 (line 43) and model "default" (line 97). See F1 and F2.

Test Evidence:
Server path: e2e-tailnet-proof.sh (80 content events over the tailnet, done/complete); server.test.ts "POST /v1/chat streams content events...". App path: none. The app cannot reach the server and would request a model that does not exist.

Result:
FAIL
```

```
Acceptance Criterion:
M1-AC2: A request to any server route without the correct bearer token returns 401; the Mac-side command produces the token, refuses to run if the token file is group- or world-readable, and the app's settings screen accepts a pasted token and uses it on the next request.

Implementation Evidence:
server/src/http/server.ts:83-92,380-384 (auth runs before routing); server/src/index.ts:30-54; ops/src/token.ts; mobile/src/app/settings.tsx:25-45, setup.tsx:31, chat.tsx:89-94 (token re-read before each request).

Test Evidence:
Server 401 on all 7 routes (e2e live and server.test.ts:211). Token command mode and refusal (e2e, ops/src/token.test.ts, entry-smoke 0644 case). App token store and setToken are unit-tested (token.test.ts, client.test.ts:125). But the "next request" goes to localhost:7789 on the phone (F1), so the pasted token is never used against the server. The server and Mac parts pass. The app part is not demonstrated.

Result:
FAIL
```

```
Acceptance Criterion:
M1-AC3: Stop cancels generation on the Mac, verified against Ollama, and streaming output halts on the phone.

Implementation Evidence:
Server: POST /v1/generations/{id}/cancel (server.ts:353-368), manager.cancelGeneration. App: chat.tsx:165-182. Here generationId is null for the whole stream, so Stop returns early (F3). The app's abort-then-cancel path also wedges the server (F4).

Test Evidence:
Server cancel was proven live against Ollama (log "stop: cancel task", CPU 2.01 -> 0.01) and in server.test.ts:397. On the phone: none. The client.test.ts cancel tests exercise APIClient in isolation, not the screen.

Result:
FAIL
```

```
Acceptance Criterion:
M1-AC4: The server and the app bundle are reachable from the phone over the tailnet and are not reachable from a device on the LAN or the public internet.

Implementation Evidence:
Server: 127.0.0.1:7789 bind (index.ts, server.ts:371-374), Serve :8443 tailnet-only, no Funnel. Bundle host: binds *:8081, and the pf mechanism is not implemented (F5). The shipped anchor is unsafe (F6).

Test Evidence:
Re-run: LAN 192.168.0.27:8081 REACHABLE (HTTP 200).

Result:
FAIL
```

## Findings

### F1
Severity:
BLOCKER

Problem:
The app's API client uses a hardcoded base URL of `http://localhost:7789`. On the phone, localhost is the phone itself, and 7789 on the Mac is loopback-only. The app therefore cannot reach the server over the tailnet at all.

Evidence:
mobile/src/app/chat.tsx:43 `createAPIClient("http://localhost:7789")`. The architecture (I4) requires `https://ryans-mac-studio.tailc3648a.ts.net:8443`.

Why it matters:
M1-AC1, AC2 (app half) and AC3 (phone half) cannot pass. The milestone outcome ("from Expo Go on the phone ... watch the reply stream") is not achievable.

Suggested correction:
Put the server base URL in configuration (for example `app.json` `expo.extra.serverUrl`, or a constant in `shared/`) set to `https://ryans-mac-studio.tailc3648a.ts.net:8443`, and build the client from it. Add a test that asserts the configured URL is used.

### F2
Severity:
BLOCKER

Problem:
The app sends every chat with `model: "default"`. Ollama has no such model, so /api/chat fails and the server emits an `error` event. The app never reads the resident model.

Evidence:
mobile/src/app/chat.tsx:97.

Why it matters:
M1-AC1 fails even once F1 is fixed. FR8 says "each prompt is sent to the currently resident model; if none, sending is blocked".

Suggested correction:
Call `GET /v1/state` before sending (or on screen focus), and use `resident.name` as the model. If `resident` is null, block sending and show "no model loaded". Cover this with a unit test of the extracted send logic.

### F3
Severity:
BLOCKER

Problem:
Stop does nothing while a reply is streaming. `APIClient.chat()` only returns the generation id after the stream has ended. `chat.tsx` sets `generationId` state only after that return, and the `finally` block resets it to null straight away. `handleStop` returns early when `!generationId`.

Evidence:
mobile/src/api/client.ts:134-210 (the id is returned after the read loop); mobile/src/app/chat.tsx:108-135, 158-161, 165-168.

Why it matters:
M1-AC3 ("streaming output halts on the phone") cannot pass. Generation continues on the Mac.

Suggested correction:
Expose the `x-generation-id` header to the caller as soon as the response headers arrive (for example an `onStart(id)` callback or a ref), and set it before reading the body. Stop should POST the cancel route and keep reading until the terminal `done {status:"cancelled"}` rather than aborting the fetch first (see F4). Add a test.

### F4
Severity:
BLOCKER

Problem:
A client disconnect during a reply permanently wedges the server. The generation only advances when the /v1/chat ReadableStream is pulled. On disconnect, the stream's `cancel()` aborts the controller, but nothing resumes or `return()`s the suspended async generator. Its `finally` block (which clears `activeGenId`) never runs.

Evidence:
server/src/http/server.ts:304-316; server/src/generations/manager.ts:70-203 (finally at 190-202). Reproduced with a fake Ollama on port 0: after the client aborts mid-stream, `/v1/state` still reports the generation 1.5s later. A second `POST /v1/chat` returns `409 generation_in_flight`. `POST /v1/generations/{id}/cancel` returns `200 {"status":"cancelled"}`, but the generation is still reported afterwards.

Why it matters:
Any phone network drop, app backgrounding, or the app's own Stop path (chat.tsx:172 aborts the fetch before cancelling) leaves the server refusing every chat until it is restarted. The e2e cancel check did not catch this because it keeps reading the stream after cancelling. It also contradicts C6 (the generation manager owns the reply and its event log for resume).

Suggested correction:
Decouple the generation from the HTTP consumer. The manager should run the Ollama loop itself, append to the event log, and notify subscribers, with the /v1/chat stream acting as one subscriber. At minimum, call `generator.return()` from the stream's `cancel()` so `finally` runs. Add a server test that aborts the client fetch mid-stream and asserts that `generation` becomes null and a new chat returns 200.

### F5
Severity:
BLOCKER

Problem:
The bundle host on 8081 is reachable from the LAN. The agreed mitigation (C9: a pf anchor loaded at boot by a LaunchDaemon, passing 8081 only on lo0 and the Tailscale utun resolved by tailnet IP; risk R1) is not implemented. There is only a printed one-shot `sudo pfctl` command with utun4 hardcoded, and it does not survive a reboot. The e2e script reports LAN 8081 as informational, so validation passes anyway.

Evidence:
Re-run output: "bundle host 8081 on the LAN IP 192.168.0.27: REACHABLE (HTTP 200) [informational ...]". ops/scripts/e2e-tailnet-proof.sh (AC4 section). The architecture's `## Deviations` section is empty.

Why it matters:
M1-AC4 fails and FR14 is violated. This is also undeclared architectural drift, because C9 no longer does what the architecture says.

Suggested correction:
Conform to the architecture. Implement the C9 pf install and uninstall: a port-scoped anchor plus a LaunchDaemon that loads it at boot, with the interface resolved from the Mac's tailnet IP. The human runs it once with the admin password. Make the e2e LAN 8081 check a hard FAIL, then re-prove from the Mac and a LAN device.

### F6
Severity:
BLOCKER

Problem:
The shipped pf anchor is unsafe and ineffective:

- It has `block all`, then passes lo0 and utun0-4, then `pass proto tcp flags S/SA`. Last match wins, so all TCP is still allowed on every interface (8081 is not blocked), while non-TCP/ICMP traffic is blocked machine-wide.
- It loads into anchor `harness.bundle-host`, which the default pf.conf never evaluates.
- It tells the user to edit /etc/pf.conf.

verify-ops-install.sh only checks that the file exists.

Evidence:
ops/scripts/com.harness.pf.anchor; ops/scripts/create-pf-anchor.sh (regenerates the same rules and prints the instructions); ops/scripts/verify-ops-install.sh:149-158.

Why it matters:
Following the repo's own instructions would break unrelated networking on the Mac and still leave 8081 exposed. The validation gives a false pass on it.

Suggested correction:
Replace it with port-scoped rules only: `pass in quick on lo0 proto tcp to any port 8081`, `pass in quick on <tailscale utun> proto tcp to any port 8081`, `block drop in quick proto tcp to any port 8081`. Load them under an anchor pf actually evaluates (for example `com.apple/harness.bundle-host`) via the LaunchDaemon from F5. Make verify-ops-install assert that the rules are port-scoped and contain no `block all`.

### F7
Severity:
IMPORTANT

Problem:
/v1/chat spreads the raw, unvalidated client JSON into the Ollama /api/chat request:

- `keep_alive: -1` is never set, so every chat resets the resident model to Ollama's 5-minute default idle timeout.
- Any client-supplied field (keep_alive, options, format) passes through, and message roles are not validated.
- There is no `model_not_resident` check, so a chat naming a non-resident model makes Ollama load a second model.

Evidence:
server/src/http/server.ts:264-292 (`startGeneration(genId, body)`); server/src/ollama/client.ts:136-139 (`...request`). The architecture (I10) says chat = `POST /api/chat {keep_alive:-1, ...}`, and I4 lists `409 model_not_resident`. FR4: "Chat requests sent by the server must preserve this, not reset it to Ollama's default idle timeout." The Deviations section is empty.

Why it matters:
This is undeclared drift from I10/I4 and breaks FR4 and FR3/FR8 (one resident model). The pass-through lets the client change Ollama behaviour.

Suggested correction:
Conform to the architecture. Build the Ollama request explicitly as `{model, messages: [{role in user|assistant, content: string}], keep_alive: -1, stream: true}`. Return `409 model_not_resident` when the model is not in `ps()`. Add a test that asserts the outgoing Ollama request body.

### F8
Severity:
IMPORTANT

Problem:
The tests and the validation pass while the app cannot talk to the server (F1-F3) and the server wedges after a disconnect (F4). The chat screen's wiring has no tests. The server has no client-disconnect test. The e2e proof is curl-only and does not fail on LAN 8081.

Evidence:
mobile/src/api/client.test.ts, mobile/src/ui/ui.test.ts (these test APIClient and the reducer in isolation; BASE_URL is localhost); server/src/http/server.test.ts (no disconnect case); ops/scripts/e2e-tailnet-proof.sh (8081 LAN is informational).

Why it matters:
The milestone reached REVIEW with every automated check green and none of the phone-facing criteria working. The test suite does not guard the milestone's outcome.

Suggested correction:
Move the send and stop logic out of chat.tsx into a testable module (base URL from config, model from /v1/state, generation id available at stream start, Stop calls cancel) and test it. Add the server disconnect test (F4). Make the e2e LAN 8081 check a hard FAIL (F5).

### F9
Severity:
OPTIONAL

Problem:
The bearer token is compared with `!==`, which is not constant-time.

Evidence:
server/src/http/server.ts:87.

Why it matters:
It is a small timing side channel on the only authentication check.

Suggested correction:
Compare with `crypto.timingSafeEqual` on equal-length buffers, after a length check.

### F10
Severity:
OPTIONAL

Problem:
FR13 says the Mac command copies the token to the clipboard, but ops/src/token.ts only prints it. It also does not create `~/.phone-models` (`dirname` is imported but unused), so the first run on a clean machine fails with ENOENT.

Evidence:
ops/src/token.ts:10, 48, 95-111.

Why it matters:
It adds setup friction and does not match what FR13 describes.

Suggested correction:
`mkdirSync(dirname(filePath), {recursive: true, mode: 0o700})` before writing. Add an optional `--copy` flag that pipes the token to `pbcopy`.

### F11
Severity:
OPTIONAL

Problem:
The `done` event's `eval_count` counts chunks, and `tokens_per_second` uses wall time including model load. There is also no .gitignore, so `server/node_modules/` shows as untracked.

Evidence:
server/src/generations/manager.ts:86, 111-119; `git status` shows `?? server/node_modules/`.

Why it matters:
The statistics are misleading, and node_modules could be committed by accident.

Suggested correction:
Use Ollama's final-chunk `eval_count` and `eval_duration`. Add a root `.gitignore` with `node_modules/` and `dist/`.

## Architectural drift summary

- C9/I12-I14: the pf anchor and LaunchDaemon are not implemented (F5, F6). Not recorded under Deviations.
- I10/I4: chat is sent without `keep_alive:-1` and without the `model_not_resident` check (F7). Not recorded.
- C6: the reply lifecycle is tied to the HTTP consumer, not owned by the manager (F4).
- C1 lives at `mobile/src/app/` rather than `mobile/app/`. This is naming only and not drift.
