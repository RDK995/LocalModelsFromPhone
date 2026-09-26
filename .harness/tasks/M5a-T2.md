TASK M5a-T2 — Read-only post-reboot readiness check for the always-on services (evidence for M5-AC1)

Routing: tier Mid, model sonnet, reason_code ORDINARY_IMPLEMENTATION
  detail: live, read-only bash check across launchd, the tailnet and pf state; it must be right on
  the first real reboot (the human performs it once), so ordinary implementation, not Cheap.

Goal:
A read-only script, ops/scripts/boot-readiness-check.sh, that a human runs AFTER rebooting the Mac,
logging in, and opening the project in Expo Go on the phone. It proves from the Mac side that
everything the phone needed was started automatically by launchd after this boot — nobody started
anything by hand — and that it is reachable over the tailnet. It is the Mac-side evidence for
M5-AC1; the phone-side evidence is the human's Expo Go observation.

Relevant Requirements:
- FR15 (.harness/requirements.md lines 61-64); M5-AC1: After a Mac reboot, opening the project in
  Expo Go on the phone works with no manual step on the Mac.
- Architecture (.harness/architecture.md): C8 lines 108-115, C9 117-126, I3 line 150,
  I12-I14 lines 181-184, risk R1 lines 231-236.

Facts (verified by orchestrator):
- LaunchAgents (gui/<uid>): com.harness.server (bun src/index.ts, 127.0.0.1:7789) and
  com.harness.bundle-host (Expo on :8081). Task M5a-T1 (running before you, may have changed the
  bundle-host plist to use ops/scripts/run-bundle-host.sh) — read the current plists, do not assume.
- LaunchDaemon com.harness.pf-bundle-host (system domain, RunAtLoad + StartInterval 60) runs
  ops/scripts/pf-bundle-host-load.sh; it records the interface it loaded in
  /var/run/com.harness.pf-bundle-host.iface and the tailnet IP in
  "/Library/Application Support/com.harness.pf-bundle-host/tailnet-ip".
  `bash ops/scripts/pf-bundle-host-load.sh --resolve <IP>` (no root) prints the utun carrying IP.
- Tailnet name ryans-mac-studio.tailc3648a.ts.net. Serve maps https :8443 -> http://127.0.0.1:7789.
  Expo Go opens exp://ryans-mac-studio.tailc3648a.ts.net:8081.
- Token at ~/.phone-models/token (never print it).
- The PWA agent com.ryankenny.phone-pwa exists and is unrelated; ignore it.

Acceptance Criteria (for this task):
1. Prints the boot time (from `sysctl -n kern.boottime`) and, for each of com.harness.server and
   com.harness.bundle-host: loaded + state running (launchctl print gui/<uid>/<label>), its pid,
   its parent pid is 1 (launchd, i.e. not started from a shell), and its process start time
   (`ps -o lstart= -p <pid>`) is after the boot time. Also, for the bundle host, the pid listening
   on TCP 8081 belongs to that agent's process tree (it or a descendant).
2. Server reachable: unauthenticated GET http://127.0.0.1:7789/v1/models -> 401; authenticated
   GET https://ryans-mac-studio.tailc3648a.ts.net:8443/v1/models (token via a private temp header
   file) -> 200.
3. Bundle reachable over the tailnet: GET http://ryans-mac-studio.tailc3648a.ts.net:8081/status ->
   packager-status:running, and the iOS manifest (GET http://ryans-mac-studio.tailc3648a.ts.net:8081/
   with `expo-platform: ios` and `accept: application/expo+json,application/json`) -> 200 JSON whose
   bundle/launch-asset URL names the tailnet host; then fetch that bundle URL and confirm 200 with a
   non-trivial body (report its size).
4. pf: the LaunchDaemon com.harness.pf-bundle-host is loaded (`launchctl print
   system/com.harness.pf-bundle-host`, readable without sudo — if it is not readable without sudo,
   report SKIPPED for that line instead of failing), and the interface recorded in
   /var/run/com.harness.pf-bundle-host.iface equals the utun that --resolve reports for the current
   tailnet IP (`tailscale ip -4`). A mismatch is a FAIL with a message that the phone would be
   blocked.
5. Timestamped PASS/FAIL line per check, a final summary, exit 0 only if nothing FAILed. It changes
   nothing: no kill, no launchctl load/unload/kickstart, no sudo, no writes except a temp header
   file it deletes.
6. `bash ops/scripts/verify-ops-install.sh` still exits 0; add an existence/executable check for
   boot-readiness-check.sh to it in the same style as existing script checks.
7. Run it now (pre-reboot); it must exit 0 on the current healthy machine (the "after boot" checks
   hold trivially now). Save the output to .harness/evidence/M5a-T2-worker.log.

Relevant Files:
- ops/scripts/e2e-tailnet-proof.sh (style, token handling, tailnet URLs)
- ops/scripts/pf-bundle-host-load.sh, ops/scripts/check-pf-rules.sh
- ops/scripts/com.harness.*.plist, ops/scripts/verify-ops-install.sh
- ops/scripts/restart-proof.sh (from M5a-T1; reuse its health-check shape if helpful, do not modify)

Files Allowed To Change:
- ops/scripts/boot-readiness-check.sh (new)
- ops/scripts/verify-ops-install.sh (criterion 6 only)
- .harness/evidence/M5a-T2-worker.log (output)

Constraints:
- Follow existing repository patterns (bash, style of e2e-tailnet-proof.sh). No new dependencies.
- Strictly read-only against the system (criterion 5). Never sudo, never reboot, never print the token.
- Do not weaken or delete existing checks. Do not git commit, stash, reset or push.

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2 && bash ops/scripts/verify-ops-install.sh && bash ops/scripts/boot-readiness-check.sh
If you near your turn limit, return CONTINUE with a handoff at .harness/tasks/M5a-T2-handoff-1.md.

Return:
- Summary (each check and its result)
- Files changed
- Tests run
- Test result (with exit status)
- Unresolved issues
