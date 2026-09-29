TASK M5c-T1 — Retire the old PWA (LaunchAgent + Tailscale Serve /app) and prove it live

Routing: tier Mid, model sonnet, reason_code ORDINARY_IMPLEMENTATION
  detail: live, outward-facing change on the human's Mac (removes a LaunchAgent and a Serve
  handler); being wrong (e.g. dropping the :443 "/" handler) is expensive, so not low risk; no
  structural/architectural risk, bounded to two ops scripts.
Depends on: none. The human approved performing this retirement now (2026-09-29); FR17's
"after this app's acceptance criteria pass" ordering is waived by the human for M5c.

Goal:
An idempotent ops script that retires the old phoneToLocalModel PWA from this Mac, a proof script
for M5-AC4, and both run live for real: afterwards `/app` on the Mac's tailnet HTTPS :443 no
longer resolves, the PWA LaunchAgent is gone, the harness's own `/` handler on :443 still works,
the :8443 phone-models mapping is untouched, and the phoneToLocalModel repository is unchanged.

Relevant Requirements:
- FR17 (.harness/requirements.md line 68-70): "the PWA's LaunchAgent and its Tailscale Serve
  `/app` handler are removed, leaving the harness's own `/` handler intact. The
  `phoneToLocalModel` repository is left on disk untouched."
- M5-AC4: "After retirement, /app no longer resolves, the PWA's LaunchAgent is gone, and the
  harness's / handler still works."
- Architecture C9/I14 (.harness/architecture.md lines 117-126, 181-184): retirement belongs to
  C9 in `ops/`; the agreed command is `tailscale serve --set-path=/app off` (on the :443 config).

Acceptance Criteria:
1. `ops/scripts/retire-pwa.sh`:
   - Before changing anything, saves a backup to `~/.phone-models/retired-pwa/`: a copy of
     `~/Library/LaunchAgents/com.ryankenny.phone-pwa.plist` and the full `tailscale serve status
     --json` output (timestamped file). Never overwrites an existing backup.
   - Removes ONLY the :443 `/app` handler (`tailscale serve --https=443 --set-path=/app off` or the
     exact equivalent the installed CLI accepts). Never `tailscale serve reset`, never touches
     `/` on :443 or anything on :8443, never enables Funnel.
   - `launchctl bootout gui/$(id -u)/com.ryankenny.phone-pwa` (it has KeepAlive, so kill is not
     enough), then moves (not deletes) the plist out of ~/Library/LaunchAgents into the backup dir.
   - Idempotent: a second run reports "already retired" for each part and exits 0.
   - Prints, at the end, the exact undo commands (restore plist + `launchctl bootstrap`, and the
     `tailscale serve` command that re-adds /app with the original target read from the backup).
   - Never touches /Users/ryankenny/Projects/phoneToLocalModel (no writes, no git commands that
     modify it). Never uses sudo.
2. `ops/scripts/retire-pwa-proof.sh` asserts, and exits 0 only if all hold, printing
   `PASS <check>` / `FAIL <check>` lines:
   a. `/app` no longer resolves: `curl --max-time 10` to `https://<mac tailnet name>/app` does not
      reach the PWA (record the status code / body head; it must not be the PWA's content — compare
      against what the pre-retirement request returned, captured in the evidence log) AND
      `tailscale serve status --json` has no `/app` handler on :443.
   b. LaunchAgent gone: `launchctl print gui/$(id -u)/com.ryankenny.phone-pwa` fails, the plist is
      absent from ~/Library/LaunchAgents, and nothing listens on 127.0.0.1:7788.
   c. Harness `/` handler still works: `tailscale serve status --json` still has :443 `/` → its
      original target (127.0.0.1:7787 per the architecture; read the actual value from the backup),
      and `curl --max-time 10 https://<mac tailnet name>/` returns the same status it returned
      before retirement (captured in the evidence log).
   d. :8443 mapping unchanged: `curl --max-time 10 https://<mac tailnet name>:8443/v1/state`
      returns 401 (the live phone-models server).
   e. phoneToLocalModel untouched: `git -C /Users/ryankenny/Projects/phoneToLocalModel rev-parse
      HEAD` is 5c866080fbf58da3b5cf38a736536db29760cc7c and `status --porcelain` is empty.
3. Run order (live): capture the pre-retirement state (serve status JSON, curl status + first 200
   bytes of `/app` and `/`, launchctl print of the PWA agent) into the evidence log; run
   retire-pwa.sh; run it a second time (idempotence); run retire-pwa-proof.sh.

Relevant Files:
- ops/scripts/configure-tailscale-serve.sh (conventions: header comment, set -euo pipefail,
  TAILSCALE env override, how it reads `serve status --json` and the Mac's tailnet name)
- ops/scripts/install-server-agent.sh, ops/scripts/verify-ops-install.sh (launchctl conventions)
- ~/Library/LaunchAgents/com.ryankenny.phone-pwa.plist (Label com.ryankenny.phone-pwa, port 7788)
- Tailscale CLI: /usr/local/bin/tailscale. Note: GNU `timeout` is NOT installed on this Mac; use
  `curl --max-time` for network calls and do not wrap commands in `timeout`.

Files Allowed To Change:
- ops/scripts/retire-pwa.sh (new)
- ops/scripts/retire-pwa-proof.sh (new)
- Live Mac state outside the repo, limited to: the :443 /app Serve handler, the
  com.ryankenny.phone-pwa LaunchAgent and its plist, and ~/.phone-models/retired-pwa/ (new).

Constraints:
- Follow existing ops/scripts patterns. Do not change unrelated behaviour.
- Never `tailscale serve reset`; never modify :443 `/` or :8443; never Funnel; never sudo; never reboot.
- Never touch /Users/ryankenny/Projects/phoneToLocalModel.
- Foreground `sleep` is forbidden by hooks; if you must wait for the agent to exit, poll with a
  bounded loop over `launchctl print` / `lsof` without sleep, or just check after bootout returns.
- If the live serve config does not match expectations (e.g. no /app handler on :443, or `/` is not
  7787), do not improvise a broader change: return FAIL/BLOCKED with the observed JSON.
- Never git stash, commit, or push.

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2 && bash -n ops/scripts/retire-pwa.sh && bash -n ops/scripts/retire-pwa-proof.sh && bash ops/scripts/retire-pwa.sh && bash ops/scripts/retire-pwa-proof.sh
Save the full output of step 3 (pre-state capture, first run, second run, proof) to
.harness/evidence/M5c-T1-worker.log. If you near your turn limit, return CONTINUE with a handoff at
.harness/tasks/M5c-T1-handoff-1.md describing exactly which live changes have been made.

Return:
- Summary (pre-retirement serve JSON for :443, what /app and / returned before and after, the
  exact undo commands the script printed, backup paths)
- Files changed
- Tests run
- Test result (with exit status)
- Unresolved issues
