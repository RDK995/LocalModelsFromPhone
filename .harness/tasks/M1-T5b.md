TASK M1-T5b — Live install on this Mac, and the end-to-end tailnet proof

Prerequisite: M1-T5a (committed) already added server/src/index.ts, fixed both
plists, the install scripts, configure-tailscale-serve.sh (8443 -> 127.0.0.1:7789),
and made curl-chat-stream-proof.sh fail rather than skip. Verify, do not redo.
This task installs it live and writes/runs ops/scripts/e2e-tailnet-proof.sh.

Routing: tier Top, model opus, reason_code SECURITY
  detail: changes live network exposure on the user's Mac (Tailscale Serve,
  LaunchAgents, bundle host bound for tailnet access) where being wrong exposes an
  authenticated server or breaks the user's existing harness endpoint; also
  CROSS_CUTTING across server/, ops/ and the live environment.

Goal:
The M1 server and the app bundle host actually run on this Mac under per-user
LaunchAgents, the server is exposed over the tailnet through Tailscale Serve on
its own HTTPS port, and `bash ops/scripts/e2e-tailnet-proof.sh` proves, against
the live server and live Ollama (not mocks), everything about M1-AC1..AC4 that
can be proven from the Mac, and prints explicitly what remains for the human's
manual check on the phone.

Why this task is bigger than its original one-file scope (read this):
The orchestrator found that earlier accepted tasks left integration gaps that
make a live proof impossible as things stand. Verify each yourself:
1. There is no server entry point. server/package.json `dev` runs
   `src/index.ts`, and com.harness.server.plist runs `src/index.ts`, but the
   file does not exist. server/src/http/server.ts exports
   `createServer(ollamaClient)` and `setValidToken(token)`.
2. Both plists run `/usr/local/bin/bun`, which does not exist on this Mac; bun is
   at `/opt/homebrew/bin/bun`.
3. com.harness.bundle-host.plist runs `bundle-host/src/index.ts`, a directory
   that does not exist. Per the agreed architecture (C8, .harness/architecture.md
   lines 108-115) the bundle host is the Expo dev server in `mobile/`, in
   production mode (`--no-dev --minify`), with REACT_NATIVE_PACKAGER_HOSTNAME set
   to the Mac's tailnet name, port 8081.
4. ops/scripts/configure-tailscale-serve.sh runs
   `tailscale serve tcp/$PORT --set-path=/ ...`, which is not the agreed mapping.
   Per C10 (architecture lines 126-131) the server gets its own HTTPS port:
   tailnet HTTPS 8443 -> http://127.0.0.1:7789, in the background (persistent).
5. server/scripts/curl-chat-stream-proof.sh skips its integration checks when no
   server is listening, so it has never exercised a live server.

Current Tailscale Serve config (must be preserved exactly; do not reset or
remove it):
  https://ryans-mac-studio.tailc3648a.ts.net (tailnet only)
  |-- /    proxy http://127.0.0.1:7787
  |-- /app proxy http://127.0.0.1:7788
Capture `tailscale serve status` before and after; `/` and `/app` must be
unchanged afterwards. Never use `tailscale serve reset`, never Funnel.

Relevant Requirements:
FR9, FR12, FR13, FR14 — /Users/ryankenny/Projects/CodingHarnessv2/.harness/requirements.md lines 42-62.
Architecture: C4, C8, C9, C10 — /Users/ryankenny/Projects/CodingHarnessv2/.harness/architecture.md (C8 at 108-115, C9 at 117-124, C10 at 126-131).

Acceptance Criteria (what the proof script must demonstrate, live):
- M1-AC1: with a model resident in Ollama (pick one from GET /api/ps; if none is
  resident, load the smallest installed model via Ollama directly and say so),
  POST a prompt to the server THROUGH the tailnet URL
  (https://ryans-mac-studio.tailc3648a.ts.net:8443) and show multiple SSE token
  events arriving over time, ending in a terminal complete event.
- M1-AC2: requests to every server route without a token, and with a wrong
  token, return 401 via the tailnet URL; the token command produces a token and
  refuses a token file with group- or world-readable mode (show both).
- M1-AC3: start a long generation, call cancel, and show from Ollama's side that
  generation stopped (e.g. the stream ends with a cancelled terminal event and no
  further tokens arrive; Ollama is no longer generating) — not only that the
  server returned 200.
- M1-AC4: the server listens on 127.0.0.1:7789 only (show with lsof); it is
  reachable via the tailnet URL; the Mac's LAN IP on 7789 and 8443 refuses; the
  bundle host on 8081 serves the bundle manifest via the tailnet name. Blocking
  8081 from the LAN needs the pf anchor, which needs the human's admin password:
  do NOT run sudo. Report whether 8081 is currently reachable on the LAN IP and
  print the exact one-time sudo command the human must run.
- The script ends by printing a clearly labelled list of what remains for the
  human to check by hand on the phone in Expo Go (rendering token by token, Stop
  halting output, pasting the token in settings, LAN device unreachability).

Relevant Files:
- server/src/http/server.ts, server/src/generations/manager.ts, server/src/ollama/client.ts
- ops/src/token.ts, ops/scripts/*
- mobile/package.json, mobile/app.json (read-only: how to start the bundle host)
- server/scripts/curl-chat-stream-proof.sh

Files Allowed To Change:
- server/src/index.ts (new: entry point wiring token file -> setValidToken, OllamaClient, createServer)
- server/package.json (only if the entry point needs a script change)
- ops/scripts/com.harness.server.plist
- ops/scripts/com.harness.bundle-host.plist
- ops/scripts/install-server-agent.sh
- ops/scripts/install-bundle-host-agent.sh
- ops/scripts/configure-tailscale-serve.sh
- ops/scripts/verify-ops-install.sh (only to keep it consistent with the fixes; do not weaken checks)
- ops/scripts/e2e-tailnet-proof.sh (new)
- server/scripts/curl-chat-stream-proof.sh (may make it fail rather than skip when no server; do not weaken it)
Live-system changes you may make: install/load the two LaunchAgents under
~/Library/LaunchAgents, add the 8443 Tailscale Serve mapping, create the token
file via the ops token command. Nothing else on the system.

Constraints:
- Proven against the live Mac and Ollama, not mocks.
- Neither source repo (phoneToLocalModel, OpenCodeOpenWeightHarness) is modified.
- No Tailscale Funnel, no public exposure, no LAN-wide bind of the server.
- Do not run sudo. Do not modify pf.
- Do not print the bearer token value into any log or file under .harness/.
- Do not touch mobile/ source; do not touch .harness/.
- Follow existing repository patterns. Do not weaken tests. Do not commit; do not git stash.

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2 && bash ops/scripts/e2e-tailnet-proof.sh && (cd server && bun test && bun run typecheck) && (cd ops && bun test src/token && bash scripts/verify-ops-install.sh)

Return:
- Summary
- Files changed
- Live-system changes made (LaunchAgents loaded, Serve mapping added, before/after `tailscale serve status`)
- Tests run (each command and exit status), with the proof script's per-criterion output
- Test result
- Unresolved issues (including what remains for the human's phone check and the pf sudo command)
