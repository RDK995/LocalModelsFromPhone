## M5c — PWA retirement

Status: DONE

### Outcome

The old PWA's LaunchAgent and its Tailscale Serve /app handler are removed, leaving the harness's own / handler intact and the phoneToLocalModel repository untouched on disk. Third part of the M5 split (see M5a); runs last because FR17 requires this app's acceptance criteria to pass first.

### Architecture

C9

### As-Built

.harness/as-built/M5c.md — RECORDED: C9 observed, 2 of 2 files attributed, 2 edges, no claim mismatches

### Acceptance Criteria

- [x] **M5-AC4**: After retirement, /app no longer resolves, the PWA's LaunchAgent is gone, and the harness's / handler still works.

### Baseline

52bc8248c798fe91e1029cb27b7f28e60b881fbb on m5c-pwa-retirement

### Evidence

- T1 — PWA retirement scripts + live run: Mid (routed Mid: live outward-facing change, not low risk), attempt 3, PASS; commit c4e3e33. Verifier re-ran `bash ops/scripts/retire-pwa.sh && bash ops/scripts/retire-pwa-proof.sh` exit 0 (idempotent "already retired" x4, 9 PASS) — .harness/evidence/M5c-T1-verifier.log; worker live run incl. pre-retirement capture (/app 200 with PWA HTML; / 502 because nothing listens on 127.0.0.1:7787) — .harness/evidence/M5c-T1-worker.log. :443 now has only "/" -> http://127.0.0.1:7787; :8443 "/" -> 7789 unchanged (401 on /v1/state); phoneToLocalModel HEAD 5c86608, clean.
- T2 — end-to-end :443 "/" routing proof: Cheap attempt 1 FAIL (EXIT trap clobbered $WORK cleanup; empty sentinel suffix; reverted) → Cheap attempt 2 PASS; commit 7a1098b. Verifier re-ran the packet's Tests command, exit 0: sentinel responder on 127.0.0.1:7787 only, `https://<mac>/` returned 200 with the exact random sentinel body via Tailscale Serve; `/app` returned the sentinel (not the PWA); nothing listens on 7787 afterwards; no mktemp dir leaked; no existing check removed (only two info lines replaced) — .harness/evidence/M5c-T2-verifier.log.
- Undo (printed by retire-pwa.sh; backups in ~/.phone-models/retired-pwa/):
  `cp ~/.phone-models/retired-pwa/com.ryankenny.phone-pwa.plist ~/Library/LaunchAgents/com.ryankenny.phone-pwa.plist`
  `launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.ryankenny.phone-pwa.plist`
  `tailscale serve --bg --https=443 --set-path=/app http://127.0.0.1:7788`

### Validation

`cd /Users/ryankenny/Projects/CodingHarnessv2 && bash -n ops/scripts/retire-pwa.sh && bash -n ops/scripts/retire-pwa-proof.sh && bash ops/scripts/retire-pwa-proof.sh && ! lsof -nP -iTCP:7787 -sTCP:LISTEN`

Read-only against live config, except a temporary sentinel HTTP responder on 127.0.0.1:7787 (started only when nothing already listens there) that an EXIT trap kills. Takes seconds. Do not run the undo commands.

### Review

Cycle 1: PASS, tier Mid (sonnet, MID_TIER_DIFF), full-milestone scope 52bc8248c798fe91e1029cb27b7f28e60b881fbb..6a0c87a; M5-AC4 PASS; 0 BLOCKER, 0 IMPORTANT, 0 OPTIONAL; no report file (PASS). Full-milestone scope. Reviewer re-ran the recorded validation live (bash -n on both scripts, retire-pwa-proof.sh, no listener on 7787 after): exit 0, 12 checks PASS, sentinel round-trip through Tailscale Serve / confirmed; phoneToLocalModel HEAD 5c86608 with clean tree. Matches C9/I14; no drift. No review log file written.

### Review Cycles

0

### Follow-ups

- Reordered 2026-09-29 by the human: M5c runs before M5a while M5a still awaits reboot attempt 2 for M5-AC1 (human busy on the Mac). FR17's ordering ('after this app's acceptance criteria pass') is waived by the human for this milestone only, accepting the risk that there is no fallback PWA if reboot attempt 2 fails. M5a stays BLOCKED until the reboot evidence exists.
- ops/scripts/verify-ops-install.sh does not list retire-pwa.sh / retire-pwa-proof.sh in required_scripts. Not needed for M5-AC4; left out of scope.
- retire-pwa-proof.sh check_root_routing: the readiness poll is 50 `curl --max-time 1` tries with no delay; connection-refused returns instantly, so the wait is bounded by count (well under a second), not ~50s. Passed twice live; could spuriously fail on a slow bun start. Consider a time-based bound.
