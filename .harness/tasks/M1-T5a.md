TASK M1-T5a — Server entry point and corrected ops config (code only, no live changes)

Routing: tier Top, model opus, reason_code SECURITY
  detail: wires bearer-token authentication into the server entry point and
  defines the LaunchAgents and Tailscale Serve mapping that decide network
  exposure. No live-system changes in this task (those are M1-T5b).

Goal:
The repository contains everything needed to run the M1 server and bundle host
under LaunchAgents and expose the server over the tailnet on its own HTTPS port,
correct per the agreed architecture, proven by local commands. M1-T5b will then
install it live and run the end-to-end proof.

Why this task exists (verify each yourself, do not trust):
Earlier accepted tasks left integration gaps that make a live proof impossible:
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

Current Tailscale Serve config the scripts must preserve (do not change it in
this task; you may run `tailscale serve status` read-only):
  https://ryans-mac-studio.tailc3648a.ts.net (tailnet only)
  |-- /    proxy http://127.0.0.1:7787
  |-- /app proxy http://127.0.0.1:7788
configure-tailscale-serve.sh must ADD only the 8443 mapping (background /
persistent), must never call `tailscale serve reset`, `--remove` on / or /app,
or Funnel, and must be idempotent.

What to do:
1. server/src/index.ts: read the token from the token file the ops token command
   writes (see ops/src/token.ts for its path and mode rules; refuse to start if
   the file is missing or group/world-readable), call setValidToken, construct
   the Ollama client for 127.0.0.1:11434, createServer, bind 127.0.0.1:7789 with
   idleTimeout 255. Allow PORT and token-path overrides via env for tests only.
2. Fix both plists (bun at /opt/homebrew/bin/bun; bundle host = Expo dev server
   in mobile/ with `--no-dev --minify`, port 8081, REACT_NATIVE_PACKAGER_HOSTNAME
   = ryans-mac-studio.tailc3648a.ts.net), and the install scripts to match.
3. Fix configure-tailscale-serve.sh to: tailnet HTTPS 8443 -> http://127.0.0.1:7789.
4. Make server/scripts/curl-chat-stream-proof.sh FAIL (non-zero) rather than skip
   when no server is listening. Do not weaken its checks.
5. Add server/scripts/entry-smoke.sh: start `bun src/index.ts` on a spare
   loopback port with a temp 0600 token file, assert: listens on 127.0.0.1 only;
   a route without token -> 401; wrong token -> 401; correct token -> not 401;
   starting with a 0644 token file exits non-zero. Always kill the server.
6. Keep ops/scripts/verify-ops-install.sh consistent with the fixes without
   weakening it. If it checks live-installed state, it is not part of this
   task's gate; say so.

Relevant Requirements:
FR12, FR13, FR14 — /Users/ryankenny/Projects/CodingHarnessv2/.harness/requirements.md lines 42-62.
Architecture: C4, C8, C9, C10 — /Users/ryankenny/Projects/CodingHarnessv2/.harness/architecture.md (C8 at 108-115, C9 at 117-124, C10 at 126-131).

Acceptance Criteria (parts this task owns): M1-AC2 (server side, entry point
enforces token), M1-AC4 (configuration: loopback bind, 8443 tailnet-only mapping).

Files Allowed To Change:
- server/src/index.ts (new)
- server/package.json (only if a script needs to change)
- server/scripts/curl-chat-stream-proof.sh
- server/scripts/entry-smoke.sh (new)
- ops/scripts/com.harness.server.plist
- ops/scripts/com.harness.bundle-host.plist
- ops/scripts/install-server-agent.sh
- ops/scripts/install-bundle-host-agent.sh
- ops/scripts/configure-tailscale-serve.sh
- ops/scripts/verify-ops-install.sh

Constraints:
- NO live-system changes: do not load LaunchAgents, do not run
  configure-tailscale-serve.sh, do not modify ~/Library/LaunchAgents or
  Tailscale config, do not run sudo, do not touch pf.
- Do not touch mobile/, shared/, or .harness/. Do not print a real token.
- Neither source repo (phoneToLocalModel, OpenCodeOpenWeightHarness) is modified.
- Follow existing patterns. Do not weaken tests. Do not commit; do not git stash.
- Limited turn budget: if running low, return CONTINUE with exactly what passes
  and what remains.

Tests (all must exit 0, from /Users/ryankenny/Projects/CodingHarnessv2):
(cd server && bun test && bun run typecheck && bash scripts/entry-smoke.sh) && (cd ops && bun test src/token) && for f in ops/scripts/*.sh server/scripts/*.sh; do bash -n "$f" || exit 1; done && plutil -lint ops/scripts/*.plist

Return:
- Result: PASS | FAIL | CONTINUE
- Summary; Files changed
- Tests run (each command + exit status)
- Unresolved issues
