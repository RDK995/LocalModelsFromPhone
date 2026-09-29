# Milestones

## M1 — Authenticated tailnet chat stream proof

Status: DONE

### Outcome

From Expo Go on the phone, over the tailnet only, a user can send one prompt to the currently resident Ollama model and watch the reply stream in token by token, protected by a bearer token, with Stop working.

Detail: `.harness/archive/M1.md`

## M2a — Installed models and true resident state on the phone

Status: DONE

### Outcome

The phone's model screen lists every model installed in Ollama by its real name and size, and shows the true resident model (including one loaded by another tool on the Mac) or an explicit nothing-loaded state, served by GET /v1/state. Split from M2 at pickup (5 criteria, within size) because of operational-complexity signals CONCURRENCY_LIFECYCLE + IMPLEMENTATION_PLUS_LIVE_PROOF (a required split), plus MULTIPLE_OUTCOMES, SUBSYSTEMS_GT_3 and PRODUCTION_FILES_GT_8; parts: M2a model list and resident state, M2b swap-load/unload that stays resident, M2c busy confirmation.

Detail: `.harness/archive/M2a.md`

## M2b — Swap-load and unload from the phone, staying resident

Status: DONE

### Outcome

From the phone a user can load a model (a swap: every other resident model is unloaded first) or unload the resident one; the operation runs asynchronously while the app polls GET /v1/state through loading to ready or a specific failure reason, and a model loaded from the phone stays resident indefinitely (keep_alive -1), including across chat replies. The confirmation rule for a reply in flight or a resident model not loaded by this server belongs to M2c.

Detail: `.harness/archive/M2b.md`

## M2c — Busy confirmation before a swap or unload

Status: DONE

### Outcome

Before a swap or unload, the server answers 409 confirmation_required with its reasons when a reply is in flight or the resident model was not loaded by this server; the app shows that warning (the other-tool case labelled as a best approximation), confirming cancels any in-flight reply and proceeds, and cancelling the confirmation leaves state unchanged.

Detail: `.harness/archive/M2c.md`

## M3 — Persisted multi-turn conversations with model attribution

Status: DONE

### Outcome

The phone keeps a list of conversations, each with full multi-turn history sent on every prompt, each reply labeled with the model that produced it, and conversations survive an app restart.

Detail: `.harness/archive/M3.md`

## M4a — Thinking shown collapsed, prompt shown on Send, reply streams in place

Status: DONE

### Outcome

In the chat screen the user's prompt appears as soon as Send is pressed, the reply streams into its own final place in the conversation (no separate streaming area), and a model's reasoning output is shown in a collapsed, expandable section separate from the answer. Split from M4 at pickup (5 criteria, within size) because of operational-complexity signals CONCURRENCY_LIFECYCLE + IMPLEMENTATION_PLUS_LIVE_PROOF (a required split), plus SUBSYSTEMS_GT_3 and MULTIPLE_OUTCOMES; parts: M4a chat display (thinking, prompt on Send, reply streams in place), M4b dropped-connection and backgrounding resume.

Detail: `.harness/archive/M4a.md`

## M4b — Dropped-connection resume

Status: DONE

### Outcome

A transport drop mid-reply resumes the same reply once the phone reconnects (Last-Event-ID replay with backoff), with no gaps or duplicated text and its terminal state received. Second part of the M4 split (see M4a). Split from the original M4b (dropped-connection and backgrounding resume) at pickup (2 criteria, within size) because of operational-complexity signals CONCURRENCY_LIFECYCLE + IMPLEMENTATION_PLUS_LIVE_PROOF (a required split), plus MULTIPLE_OUTCOMES; parts: M4b dropped-connection resume (M4-AC2), M4c backgrounding resume with Stop-only cancel (M4-AC3).

Detail: `.harness/archive/M4b.md`

## M4c — Backgrounding resume, only Stop cancels

Status: DONE

### Outcome

Backgrounding the app mid-reply and returning to the foreground resumes the same reply and receives its terminal state; only an explicit Stop cancels generation. Third part of the M4 split; split from M4b at pickup (see M4b).

Detail: `.harness/archive/M4c.md`

## M5b — Plain-language error messages

Status: DONE

### Outcome

The app shows a distinct plain-language message for each failure mode: Mac or server unreachable, Ollama down, wrong password, model failed to load, model no longer installed, and a reply already in progress. Second part of the M5 split (see M5a). Operational-complexity signal: IMPLEMENTATION_PLUS_LIVE_PROOF (one signal; seam check: the live proof is the criterion itself, so separating it would leave a component-only half — not split).

### Architecture

C1, C2, C4

### As-Built

.harness/as-built/M5b.md — RECORDED — 15/17 files attributed; components C1,C2,C5; 7 edges; 2 claim mismatches (C4 claimed but not modified; C5 modified but not claimed, covered by D-M5b-1)

### Acceptance Criteria

- [x] **M5-AC3**: The app shows a distinct message for each of: Mac or server unreachable, Ollama down, wrong password, model failed to load, model no longer installed, and reply already in progress.

### Baseline

69aed5333cdee09d7d1c38aa73fcfa06f2ff3c16 on m5b-plain-errors

### Evidence

Tasks (packets under .harness/tasks/):
- M5b-T1 — error mapping + client/server/screens + unit tests: Mid (ORDINARY_IMPLEMENTATION). Attempt 3 CONTINUE (turn limit, handoff-1) → continuation 1 PASS; verifier PASS exit 0 (server 109, mobile 167 tests; typecheck, lint clean), tests weakened NO — .harness/evidence/M5b-T1-verifier.log. Accepted. Architecture deviation D-M5b-1 (operation.error_code, Material: no) recorded.
- M5b-T2 — live six-failure proof script: Mid (ORDINARY_IMPLEMENTATION). Attempt 3 INTERRUPTED (turn limit, no report; services checked healthy; fresh resume, no rung) → attempt 3 FAIL: 5/6 PASS, scenario 6 exposed a product defect in client.ts (Tailscale proxy answers bodiless 502 when the server is down; client threw TypeError instead of UnreachableError) — script not at fault, correction routed as M5b-T3 → after T3, verifier re-run PASS exit 0, 6/6 PASS, pairwise distinct, services restored — .harness/evidence/M5b-T2-verifier.log. Accepted, f0dd837.
- M5b-T3 — correction: bodiless/null-body gateway 502/503/504 → UnreachableError (getState, load/unload, chat start); JSON error bodies and resume retry unchanged: Mid (ORDINARY_IMPLEMENTATION), attempt 3 PASS; verifier PASS exit 0 (mobile 173 tests, typecheck, lint), tests weakened NO — .harness/evidence/M5b-T3-verifier.log. Accepted, e82554a.

M5-AC3 evidence (for the reviewer's table): unit — M5b-T1 and M5b-T3 verifier logs; live — mobile/scripts/error-messages-proof.sh against the Mac Studio over the tailnet and live Ollama, six exact pairwise-distinct sentences, exit 0 (.harness/evidence/M5b-T2-verifier.log).

### Validation

`cd /Users/ryankenny/Projects/CodingHarnessv2 && (cd server && bun test && bun run typecheck) && (cd mobile && bun run typecheck && bun test && bun run lint && bash scripts/error-messages-proof.sh)`

The live proof temporarily stops Ollama and the server LaunchAgent and restores both via trap (about 4 minutes). Never reboot the Mac. Scenario 3's mismatched-LoRA failed load was once seen to load successfully (pre-existing flake shared with model-failed-load-proof.sh); one rerun is reasonable if only scenario 3 fails.

### Review

Cycle 1: PASS, tier Mid (sonnet, MID_TIER_DIFF), full-milestone scope 69aed5333cdee09d7d1c38aa73fcfa06f2ff3c16..a664ee2; M5-AC3 PASS; 0 BLOCKER, 0 IMPORTANT, 0 OPTIONAL; no report file (PASS). Reviewer re-ran server tests + typecheck and mobile typecheck, 173 unit tests, lint and the live six-scenario error-messages-proof against the real Mac; exit 0, services and resident model restored. D-M5b-1 matches the diff. — .harness/evidence/M5b-review.log

### Review Cycles

0

### Follow-ups

- New feature requested by the human 2026-09-26, out of scope for current requirements: internet (web) search for the models, e.g. via Ollama's web search / tool calling. Needs roast-requirements (search provider and privacy, which models, how the app shows searching and sources) before any implementation.
- Scenario 3 of error-messages-proof.sh (and model-failed-load-proof.sh) relies on a mismatched LoRA adapter failing to load; the M5b-T2 worker saw it load successfully once. A more deterministic failed-load induction would make both proofs less flaky.

## M5c — PWA retirement

Status: REVIEW

### Outcome

The old PWA's LaunchAgent and its Tailscale Serve /app handler are removed, leaving the harness's own / handler intact and the phoneToLocalModel repository untouched on disk. Third part of the M5 split (see M5a); runs last because FR17 requires this app's acceptance criteria to pass first.

### Architecture

C9

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M5-AC4**: After retirement, /app no longer resolves, the PWA's LaunchAgent is gone, and the harness's / handler still works.

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

Pending.

### Review Cycles

0

### Follow-ups

- Reordered 2026-09-29 by the human: M5c runs before M5a while M5a still awaits reboot attempt 2 for M5-AC1 (human busy on the Mac). FR17's ordering ('after this app's acceptance criteria pass') is waived by the human for this milestone only, accepting the risk that there is no fallback PWA if reboot attempt 2 fails. M5a stays BLOCKED until the reboot evidence exists.
- ops/scripts/verify-ops-install.sh does not list retire-pwa.sh / retire-pwa-proof.sh in required_scripts. Not needed for M5-AC4; left out of scope.
- retire-pwa-proof.sh check_root_routing: the readiness poll is 50 `curl --max-time 1` tries with no delay; connection-refused returns instantly, so the wait is bounded by count (well under a second), not ~50s. Passed twice live; could spuriously fail on a slow bun start. Consider a time-based bound.

## M5a — Always-on server and bundle host

Status: BLOCKED

### Outcome

The server and the app bundle host run under per-user LaunchAgents that restart them after a crash or a Mac reboot, so opening the project in Expo Go on the phone needs no manual step on the Mac. Split from M5 at pickup (4 criteria, within size) because of operational-complexity signals CONCURRENCY_LIFECYCLE + IMPLEMENTATION_PLUS_LIVE_PROOF (a required split), plus MULTIPLE_OUTCOMES; parts: M5a always-on LaunchAgents for server and bundle host (M5-AC1, M5-AC2), M5b plain-language error messages (M5-AC3), M5c PWA retirement (M5-AC4).

### Architecture

C8, C9

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M5-AC1**: After a Mac reboot, opening the project in Expo Go on the phone works with no manual step on the Mac.
- [x] **M5-AC2**: Killing either the server process or the bundle host process causes it to restart automatically.

### Baseline

296b9e5b87b04a92fcac5ad92df442366f636454 on m5a-always-on

### Evidence

- M5a-T1 live restart proof ops/scripts/restart-proof.sh — Mid (ORDINARY_IMPLEMENTATION: live launchd lifecycle proof), attempt 3 PASS; verifier PASS — .harness/evidence/M5a-T1-verifier.log. Commit 6322847.
- M5a-T2 read-only post-reboot readiness check ops/scripts/boot-readiness-check.sh (+1 entry in verify-ops-install.sh) — Mid (ORDINARY_IMPLEMENTATION: must be right on the single human reboot), attempt 3 PASS; verifier PASS — .harness/evidence/M5a-T2-verifier.log. Commit 3fe0ae2.
- M5-AC2: SIGKILL of launchd's tracked pid — server 88260->89022 healthy in 1 s (unauth 401, auth /v1/state 200); bundle host 88461->89068 healthy in 3 s (/status running, iOS manifest 200 naming ryans-mac-studio.tailc3648a.ts.net); SIGKILL of the TCP 8081 listener (lsof) 89068->89216 healthy in 10 s; exactly one 8081 listener after each; exit 0. No plist change needed: `bun x expo` execs into node, so launchd's pid is the listener.
- M5-AC1: NOT YET PROVEN. Mac-side check passes pre-reboot (current boot 2026-08-22). Needs the human reboot below.

### Validation

`cd /Users/ryankenny/Projects/CodingHarnessv2 && bash ops/scripts/verify-ops-install.sh && bash ops/scripts/restart-proof.sh && bash ops/scripts/boot-readiness-check.sh && (cd ops && bun test src/token)` — reviewer runs once; restart-proof kills and restarts the live services (no sudo); boot-readiness-check is read-only. M5-AC1 also needs .harness/evidence/M5a-AC1-reboot.log and the phone observation.

### Review

Pending.

Human Escalation (BLOCKED):

Problem:
M5-AC1 needs a real Mac reboot and an Expo Go check on the phone; agents may not reboot. Also, FileVault is On and auto-login is off (`fdesetup status`; loginwindow autoLoginUser unset), so after a reboot the per-user LaunchAgents, Tailscale and Ollama start only once the user types the Mac password at the unlock screen.

Requirement/milestone affected:
M5a / M5-AC1 (FR15, AC11).

Attempts made:
1. M5a-T1: live kill/restart proof for both services — PASS (M5-AC2 proven).
2. M5a-T2: read-only post-reboot readiness check — PASS pre-reboot.
3. Checked boot behaviour: FileVault On, no auto-login.

Remaining issue:
The reboot itself, the phone check, and the post-reboot readiness log; plus a decision on whether the unlock-screen login counts as a "manual step on the Mac".

Recommended decision:
Treat logging in at the unlock screen as part of the reboot (no change), then do: (1) reboot the Mac; (2) log in at the password screen and do nothing else on the Mac — no Terminal, no starting anything; (3) wait about two minutes; (4) on the iPhone with Tailscale connected, force-quit Expo Go, reopen it, open the project (exp://ryans-mac-studio.tailc3648a.ts.net:8081), confirm the app loads, the Models screen lists models, and a short message gets a reply — take a screenshot; (5) only then, on the Mac: `cd ~/Projects/CodingHarnessv2 && bash ops/scripts/boot-readiness-check.sh 2>&1 | tee .harness/evidence/M5a-AC1-reboot.log` and confirm it ends "PASS: ALL CHECKS PASSED" with a boot time from today. Then set M5a to REVIEW. Not recommended: disabling FileVault for auto-login (security cost), or moving to system-level daemons (a material architecture change to C9).

### Review Cycles

0

### Follow-ups

- FileVault login after reboot: resolved 2026-09-26 by the human — typing the Mac password at the unlock screen counts as part of rebooting, not a manual step. No change to FileVault or architecture. Reboot itself still pending.
- Reordered 2026-09-26 by the human: M5b runs before M5a while M5a waits on the human-performed reboot for M5-AC1 (human not at the Mac). M5a stays BLOCKED until the reboot evidence exists; M5c still runs last.
- R3 still applies: the bundle host serves the working tree, so a mid-edit checkout reaches the phone after any restart.
- Reboot attempt 1 (2026-09-28, boot 18:35:40 BST): FAIL. Human reported the app opened in Expo Go after the reboot, but boot-readiness-check.sh failed one check -- authenticated GET /v1/state over the tailnet -> 503 (not 200) because Ollama (C11) was not running: it had no login LaunchAgent and had only ever been started by hand. Evidence: .harness/evidence/M5a-AC1-reboot-attempt1-FAIL.log.
- Fix approved by the human 2026-09-28: Ollama starts at login. `brew services start ollama` was blocked (Xcode license not accepted, needs sudo), so Homebrew's own plist was installed the same way brew services would: cp /opt/homebrew/opt/ollama/homebrew.mxcl.ollama.plist ~/Library/LaunchAgents/ && launchctl bootstrap gui/$UID (label homebrew.mxcl.ollama, RunAtLoad + KeepAlive, env OLLAMA_FLASH_ATTENTION=1, OLLAMA_KV_CACHE_TYPE=q8_0). Undo: launchctl bootout gui/$UID/homebrew.mxcl.ollama && rm the plist. Pre-reboot re-run of boot-readiness-check.sh: PASS: ALL CHECKS PASSED. M5-AC1 still needs reboot attempt 2 (same steps as above, including a model reply on the phone) with its log at .harness/evidence/M5a-AC1-reboot.log.
