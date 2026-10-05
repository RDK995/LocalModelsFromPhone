TASK M5c-T2 — Prove the :443 "/" handler still routes end to end after PWA retirement

Routing: tier Cheap, model haiku, reason_code BOUNDED_LOW_RISK
  detail: one added check in an existing proof script; stated oracle (a sentinel string round-trips
  through Tailscale Serve); touches no live config.
Depends on: M5c-T1 (accepted, commit c4e3e33). The PWA is already retired on the Mac; do NOT run
ops/scripts/retire-pwa.sh changes — it is idempotent but not part of this task's edit.

Background (the non-obvious constraint):
Tailscale Serve :443 "/" proxies to http://127.0.0.1:7787 ("the harness", an external service not in
this repo). That service is currently NOT running (nothing listens on 7787), so `curl https://<mac>/`
returns a bodiless 502 before and after retirement. The existing proof (check 2c in
ops/scripts/retire-pwa-proof.sh) therefore only shows the Serve config still maps "/" -> 7787. M5-AC4
requires "the harness's / handler still works", so we need an end-to-end routing proof.

Goal:
Add a check to ops/scripts/retire-pwa-proof.sh that proves requests to https://<mac tailnet name>/
are still routed by Tailscale Serve to 127.0.0.1:7787:
- If something is already listening on 127.0.0.1:7787 (`lsof -nP -iTCP:7787 -sTCP:LISTEN`), do not
  start anything: require `curl --max-time 10 https://<mac>/` to return a status other than 502/000
  and print `PASS / handler reaches the live harness on 7787 (got <code>)`.
- Otherwise start a temporary sentinel HTTP responder bound to 127.0.0.1:7787 ONLY (e.g.
  `/opt/homebrew/bin/bun -e 'Bun.serve({hostname:"127.0.0.1",port:7787,fetch:()=>new Response("m5c-root-sentinel-<random>")})'`
  in the background), wait for it with a bounded poll loop (no `sleep` builtin in the foreground is
  allowed by hooks — poll with curl --max-time 1 against 127.0.0.1:7787 up to ~50 tries), then
  `curl --max-time 10 https://<mac>/` must return 200 with body equal to the sentinel. Print
  `PASS / handler routes through Tailscale Serve to 127.0.0.1:7787 (sentinel round-trip)`.
  The responder MUST be killed on every exit path (trap), and after the check the proof must confirm
  nothing listens on 7787 again.
- Also check `https://<mac>/app` while the sentinel is up: it must NOT return the PWA (it may return
  the sentinel, since "/" now catches /app — that is expected and fine; record what it returned).

Relevant Requirements:
- FR17 / M5-AC4 "... and the harness's / handler still works." (.harness/requirements.md 68-70)

Relevant Files:
- ops/scripts/retire-pwa-proof.sh (edit; read it fully first — reuse its tailnet-name discovery,
  PASS/FAIL printing and exit logic)

Files Allowed To Change:
- ops/scripts/retire-pwa-proof.sh

Constraints:
- Do not change Tailscale Serve config, LaunchAgents, or anything outside the one file. No sudo.
- Bind the sentinel to 127.0.0.1 only, never 0.0.0.0.
- Do not remove or weaken any existing check in the proof script.
- Network calls always use `curl --max-time`. GNU `timeout` is not installed.
- Never git stash, commit, or push.

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2 && bash -n ops/scripts/retire-pwa-proof.sh && bash ops/scripts/retire-pwa-proof.sh && ! lsof -nP -iTCP:7787 -sTCP:LISTEN
Save full output to .harness/evidence/M5c-T2-worker.log.

Return:
- Summary (the new PASS line(s), what /app returned while the sentinel was up)
- Files changed
- Tests run
- Test result (with exit status)
- Unresolved issues

Previous Attempt(s):
- Attempt 1 (Cheap, haiku): added check_root_routing() to ops/scripts/retire-pwa-proof.sh; the
  proof ran green (log kept at .harness/evidence/M5c-T2-attempt1-worker.log) but the orchestrator
  rejected it on reading the diff, and the change has been reverted (file is back at commit c4e3e33):
  (a) it installed `trap "kill $responder_pid ...; trap - EXIT" EXIT`, which REPLACES the script's
      existing `trap 'rm -rf "$WORK"' EXIT` (line 29), so the mktemp work dir leaked on every run.
      The responder cleanup must be combined with the existing WORK cleanup (e.g. a single cleanup
      function that removes $WORK and kills the responder pid if set, installed once).
  (b) the sentinel suffix was empty: `od -An -tx1 /dev/urandom | head -c 8 | tr -d ' '` yields only
      spaces on macOS because BSD od pads with leading spaces, so the body was the fixed string
      "m5c-root-sentinel-". Generate a real non-empty random suffix (e.g. `openssl rand -hex 8`, or
      `LC_ALL=C tr -dc 'a-f0-9' </dev/urandom | head -c 16`) and assert it is non-empty.
  Also: attempt 1 left leaked mktemp dirs; do not hunt for them outside the script.
  Keep what worked: the two-branch design (live listener vs sentinel), bun on 127.0.0.1:7787 only,
  bounded curl poll loop, exact status-200 + exact-body equality, /app info line, and the final
  "nothing listens on 7787" check. Also make /app returning PWA markers while the sentinel is up a
  FAIL, not an info line.
