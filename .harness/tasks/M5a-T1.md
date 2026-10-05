TASK M5a-T1 — Live proof that killing the server or the bundle host restarts it (M5-AC2)

Routing: tier Mid, model sonnet, reason_code ORDINARY_IMPLEMENTATION
  detail: live process-lifecycle proof against launchd; the bundle host is a process tree
  (bun x expo -> node/metro), so a kill may orphan the port listener or leave launchd's tracked
  parent alive with a dead child — the diagnosis and any plist fix need judgement.

Goal:
A repeatable live script, ops/scripts/restart-proof.sh, proves that killing either the server
process or the bundle host process on this Mac causes launchd to restart it and that the restarted
instance actually serves again. If the proof exposes a real restart defect, fix it in the LaunchAgent
definition/installer (not in server/ or mobile/ source) and re-prove.

Relevant Requirements:
- FR15 (.harness/requirements.md lines 61-64): per-user macOS LaunchAgents keep both the server and
  the process that serves the app bundle to Expo Go running, and restart them after a crash or reboot.
- M5-AC2: Killing either the server process or the bundle host process causes it to restart
  automatically.
- Architecture (.harness/architecture.md): C8 lines 108-115, C9 lines 117-126, I12-I14 lines 181-184.

Current live state (verified by orchestrator, 2026-09-26):
- Installed and loaded: ~/Library/LaunchAgents/com.harness.server.plist and
  com.harness.bundle-host.plist, byte-identical to ops/scripts/com.harness.server.plist and
  ops/scripts/com.harness.bundle-host.plist. Both RunAtLoad + KeepAlive true, ThrottleInterval 10.
- `launchctl print gui/$(id -u)/com.harness.server` -> running; same for com.harness.bundle-host.
- Server: `bun src/index.ts` in server/, binds 127.0.0.1:7789; unauthenticated GET
  http://127.0.0.1:7789/v1/models -> 401. Token at ~/.phone-models/token (never print it).
- Bundle host: `bun x expo start --no-dev --minify --port 8081` in mobile/,
  REACT_NATIVE_PACKAGER_HOSTNAME=ryans-mac-studio.tailc3648a.ts.net;
  GET http://127.0.0.1:8081/status -> "packager-status:running".
- Logs: ~/Library/Logs/phone-models/{server,bundle-host}.log.

Acceptance Criteria (for this task):
1. restart-proof.sh, for each of the two services, and with no sudo:
   a. asserts the agent is loaded and healthy before the kill;
   b. records the launchd-tracked PID (from `launchctl print gui/<uid>/<label>`), sends it
      SIGKILL, and waits (bounded, e.g. <= 60 s) until launchd reports a DIFFERENT pid in state
      running AND the service is healthy again;
   c. health for the server = unauthenticated /v1/models returns 401 AND an authenticated request
      (token read from ~/.phone-models/token into a private temp header file, never echoed) returns
      200; health for the bundle host = /status says packager-status:running AND an iOS manifest
      request (GET http://127.0.0.1:8081/ with headers `expo-platform: ios` and
      `accept: application/expo+json,application/json`) returns 200 JSON whose launch asset / bundle
      URL names ryans-mac-studio.tailc3648a.ts.net (so Expo Go on the phone could load it).
2. For the bundle host it ALSO kills the process actually listening on TCP 8081 (find it with
   `lsof -nP -iTCP:8081 -sTCP:LISTEN -t`) when that differs from launchd's tracked pid, and proves the
   service recovers from that too (healthy again within the bound, exactly one listener on 8081
   afterwards, no orphaned listener from the previous instance). "The bundle host process" is
   whichever one a person would reasonably kill; both must lead to recovery.
3. Prints timestamped lines (kill time, new pid, time healthy) and ends with a clear
   PASS/FAIL summary; exits 0 only if every check passed.
4. If a check genuinely fails (e.g. killing the metro child leaves bun alive and 8081 dead, or an
   orphan keeps 8081 so the restart crash-loops), fix the LaunchAgent: change the plist(s) in
   ops/scripts (e.g. run a small exec wrapper, ops/scripts/run-bundle-host.sh, that makes the
   listener and launchd's tracked process the same lifetime / kills its process group on exit), then
   reinstall via the existing installer (ops/scripts/install-bundle-host-agent.sh or
   install-server-agent.sh) and re-run. Keep production mode (--no-dev --minify), port 8081 and
   REACT_NATIVE_PACKAGER_HOSTNAME unchanged. Record the defect and fix in your Summary.
5. `bash ops/scripts/verify-ops-install.sh` still exits 0; if you changed a plist or added a
   wrapper, update verify-ops-install.sh so it checks the new shape (do not remove existing checks
   other than ones made false by your plist change, and say which).
6. Leaves both services running and healthy when it finishes (pass or fail).

Relevant Files:
- ops/scripts/com.harness.server.plist, ops/scripts/com.harness.bundle-host.plist
- ops/scripts/install-server-agent.sh, ops/scripts/install-bundle-host-agent.sh
- ops/scripts/verify-ops-install.sh
- ops/scripts/e2e-tailnet-proof.sh (existing live-proof style, token handling pattern)

Files Allowed To Change:
- ops/scripts/restart-proof.sh (new)
- ops/scripts/run-bundle-host.sh (new, only if needed for criterion 4)
- ops/scripts/com.harness.bundle-host.plist, ops/scripts/com.harness.server.plist (only if criterion 4)
- ops/scripts/install-bundle-host-agent.sh, ops/scripts/install-server-agent.sh (only if criterion 4)
- ops/scripts/verify-ops-install.sh (only per criterion 5)
- .harness/evidence/M5a-T1-worker.log (output)
Installing into ~/Library/LaunchAgents via the existing installers is allowed and expected if you
change a plist.

Constraints:
- Follow existing repository patterns (bash, `set -u`, style of e2e-tailnet-proof.sh).
- Never sudo, never touch pf, Tailscale Serve, the PWA agent (com.ryankenny.phone-pwa), Ollama,
  or server/ and mobile/ source. Never reboot. Never print the token.
- Do not weaken or delete existing checks. No new dependencies.
- Do not git commit, stash, reset or push.

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2 && bash ops/scripts/verify-ops-install.sh && bash ops/scripts/restart-proof.sh
Save the full output of the final restart-proof run to .harness/evidence/M5a-T1-worker.log.
If you near your turn limit, return CONTINUE with a handoff at .harness/tasks/M5a-T1-handoff-1.md
(what is done, what remains, what you learned).

Return:
- Summary (per service: old pid, kill signal, new pid, seconds to healthy; any defect found + fix)
- Files changed
- Tests run
- Test result (with exit status)
- Unresolved issues
