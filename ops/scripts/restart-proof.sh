#!/bin/bash
# Live restart proof for M5-AC2 (FR15): killing either the phone-models server
# process or the bundle host process on this Mac causes launchd to restart it,
# and the restarted instance actually serves again.
#
# For each of com.harness.server and com.harness.bundle-host this script:
#   1. asserts the LaunchAgent is loaded, running and healthy;
#   2. records launchd's tracked pid, sends it SIGKILL, and waits (bounded,
#      <= 60s) until launchd reports a DIFFERENT pid in state "running" and the
#      service is healthy again.
# For the bundle host it additionally finds whichever process is actually
# listening on TCP 8081 (which may or may not be the same process launchd
# tracks -- `bun x expo` execs into node, so today they are the same pid, but
# that is an implementation detail this script does not assume) and kills
# that, proving recovery from "kill whatever a person would reasonably call
# the bundle host process" too, with exactly one listener left afterwards.
#
# No sudo. Never touches pf, Tailscale Serve, the PWA agent, or Ollama. Never
# reboots. Never prints the bearer token. Does not modify server/ or mobile/.
#
# Exit status: 0 only if every check below passed. Leaves both services
# running and healthy when it finishes, whether it passed or failed.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BUN="${BUN:-/opt/homebrew/bin/bun}"
UIDN="$(id -u)"
TOKEN_FILE="$HOME/.phone-models/token"
TAILNET_NAME="ryans-mac-studio.tailc3648a.ts.net"
WAIT_BOUND=60

FAILURES=0
WORK="$(mktemp -d)"
chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT

section() { printf '\n==== %s ====\n' "$1"; }
pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
info() { printf '        %s\n' "$1"; }
check() { # check <description> <command...>
  local desc="$1"; shift
  if "$@"; then pass "$desc"; else fail "$desc"; fi
}
now() { date '+%Y-%m-%d %H:%M:%S'; }
json() { # json <js expression over `j`> < json
  "$BUN" -e "const j = JSON.parse(await Bun.stdin.text()); const r = ($1); console.log(typeof r === 'string' ? r : JSON.stringify(r));"
}

get_state() { launchctl print "gui/$UIDN/$1" 2>/dev/null | awk -F'= ' '/^\tstate = /{print $2; exit}'; }
get_pid()   { launchctl print "gui/$UIDN/$1" 2>/dev/null | awk -F'= ' '/^\tpid = /{print $2; exit}'; }

echo "M5a restart proof (M5-AC2 / FR15)  ($(now))"
echo "repo commit: $(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo NON-GIT)"

if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "FAIL: token file $TOKEN_FILE does not exist; cannot health-check the server."
  exit 1
fi
AUTH="$WORK/auth-header"
( umask 077; printf 'Authorization: Bearer %s\n' "$(tr -d '[:space:]' < "$TOKEN_FILE")" > "$AUTH" )

# ---------------------------------------------------------------------------
# Health predicates. Each prints nothing on its own; callers wrap them in
# `check` or poll them directly.

server_healthy() {
  local unauth auth
  unauth="$(curl -s --max-time 10 -o /dev/null -w '%{http_code}' http://127.0.0.1:7789/v1/models)"
  auth="$(curl -s --max-time 10 -o /dev/null -w '%{http_code}' http://127.0.0.1:7789/v1/state -H "@$AUTH")"
  LAST_SERVER_HEALTH="unauth /v1/models -> $unauth, auth /v1/state -> $auth"
  [[ "$unauth" == "401" && "$auth" == "200" ]]
}

bundle_healthy() {
  local status m_code manifest launch_url
  status="$(curl -s --max-time 10 http://127.0.0.1:8081/status)"
  manifest="$WORK/manifest.json"
  m_code="$(curl -s --max-time 30 -o "$manifest" -w '%{http_code}' \
    -H 'expo-platform: ios' -H 'accept: application/expo+json,application/json' \
    http://127.0.0.1:8081/)"
  launch_url="$(json "j.launchAsset?.url ?? ''" < "$manifest" 2>/dev/null)"
  LAST_BUNDLE_HEALTH="/status -> '$status', manifest -> $m_code, launchAsset.url -> $launch_url"
  [[ "$status" == "packager-status:running" && "$m_code" == "200" && "$launch_url" == *"$TAILNET_NAME"* ]]
}

listener_count_8081() { lsof -nP -iTCP:8081 -sTCP:LISTEN -t 2>/dev/null | wc -l | tr -d ' '; }

# wait_for_recovery <label> <old_pid> <health_fn>
# Sets RESULT_NEW_PID and RESULT_ELAPSED. Returns 0 if launchd shows a
# different pid, state running, and the health_fn passes, within WAIT_BOUND
# seconds; 1 on timeout.
wait_for_recovery() {
  local label="$1" old_pid="$2" health_fn="$3"
  local start elapsed state new_pid
  start="$(date +%s)"
  while :; do
    state="$(get_state "$label")"
    new_pid="$(get_pid "$label")"
    if [[ "$state" == "running" && -n "$new_pid" && "$new_pid" != "$old_pid" ]] && "$health_fn"; then
      RESULT_NEW_PID="$new_pid"
      RESULT_ELAPSED=$(( $(date +%s) - start ))
      return 0
    fi
    elapsed=$(( $(date +%s) - start ))
    if (( elapsed >= WAIT_BOUND )); then
      RESULT_NEW_PID="${new_pid:-<none>}"
      RESULT_ELAPSED="$elapsed"
      return 1
    fi
    sleep 1
  done
}

# ---------------------------------------------------------------------------
section "com.harness.server: precondition"

SERVER_STATE="$(get_state com.harness.server)"
check "com.harness.server loaded and running (state: ${SERVER_STATE:-not loaded})" test "$SERVER_STATE" = running
check "com.harness.server healthy before kill" server_healthy
info "$LAST_SERVER_HEALTH"

section "com.harness.server: kill launchd-tracked pid, prove restart"

SERVER_OLD_PID="$(get_pid com.harness.server)"
info "launchd-tracked pid: $SERVER_OLD_PID"
if [[ -z "$SERVER_OLD_PID" ]]; then
  fail "obtained a launchd-tracked pid for com.harness.server"
else
  info "$(now)  sending SIGKILL to pid $SERVER_OLD_PID"
  kill -9 "$SERVER_OLD_PID" 2>/dev/null
  if wait_for_recovery com.harness.server "$SERVER_OLD_PID" server_healthy; then
    info "$(now)  new pid $RESULT_NEW_PID, healthy after ${RESULT_ELAPSED}s ($LAST_SERVER_HEALTH)"
    pass "com.harness.server restarted with a new pid ($SERVER_OLD_PID -> $RESULT_NEW_PID) and is healthy within ${WAIT_BOUND}s (took ${RESULT_ELAPSED}s)"
  else
    info "$(now)  TIMEOUT after ${RESULT_ELAPSED}s, last observed pid $RESULT_NEW_PID ($LAST_SERVER_HEALTH)"
    fail "com.harness.server restarted with a new pid and is healthy within ${WAIT_BOUND}s"
  fi
fi

# ---------------------------------------------------------------------------
section "com.harness.bundle-host: precondition"

BUNDLE_STATE="$(get_state com.harness.bundle-host)"
check "com.harness.bundle-host loaded and running (state: ${BUNDLE_STATE:-not loaded})" test "$BUNDLE_STATE" = running
check "com.harness.bundle-host healthy before kill" bundle_healthy
info "$LAST_BUNDLE_HEALTH"
BEFORE_LISTENERS="$(listener_count_8081)"
check "exactly one listener on 8081 before kill (got $BEFORE_LISTENERS)" test "$BEFORE_LISTENERS" = "1"

section "com.harness.bundle-host: kill launchd-tracked pid, prove restart"

BUNDLE_OLD_PID="$(get_pid com.harness.bundle-host)"
LISTENER_BEFORE="$(lsof -nP -iTCP:8081 -sTCP:LISTEN -t 2>/dev/null | head -1)"
info "launchd-tracked pid: $BUNDLE_OLD_PID; TCP 8081 listener pid: ${LISTENER_BEFORE:-<none>}"
if [[ "$BUNDLE_OLD_PID" == "$LISTENER_BEFORE" ]]; then
  info "launchd's tracked pid IS the TCP 8081 listener (bun x expo execs into node, same pid)"
else
  info "launchd's tracked pid DIFFERS from the TCP 8081 listener"
fi

if [[ -z "$BUNDLE_OLD_PID" ]]; then
  fail "obtained a launchd-tracked pid for com.harness.bundle-host"
else
  info "$(now)  sending SIGKILL to pid $BUNDLE_OLD_PID"
  kill -9 "$BUNDLE_OLD_PID" 2>/dev/null
  if wait_for_recovery com.harness.bundle-host "$BUNDLE_OLD_PID" bundle_healthy; then
    info "$(now)  new pid $RESULT_NEW_PID, healthy after ${RESULT_ELAPSED}s ($LAST_BUNDLE_HEALTH)"
    pass "com.harness.bundle-host restarted with a new pid ($BUNDLE_OLD_PID -> $RESULT_NEW_PID) and is healthy within ${WAIT_BOUND}s (took ${RESULT_ELAPSED}s)"
    AFTER_A_LISTENERS="$(listener_count_8081)"
    check "exactly one listener on 8081 after restart A (got $AFTER_A_LISTENERS)" test "$AFTER_A_LISTENERS" = "1"
  else
    info "$(now)  TIMEOUT after ${RESULT_ELAPSED}s, last observed pid $RESULT_NEW_PID ($LAST_BUNDLE_HEALTH)"
    fail "com.harness.bundle-host restarted with a new pid and is healthy within ${WAIT_BOUND}s"
  fi
fi

section "com.harness.bundle-host: kill whichever process is actually listening on TCP 8081, prove restart"

TRACKED_PID="$(get_pid com.harness.bundle-host)"
LISTENER_PID="$(lsof -nP -iTCP:8081 -sTCP:LISTEN -t 2>/dev/null | head -1)"
info "launchd-tracked pid now: ${TRACKED_PID:-<none>}; TCP 8081 listener pid now: ${LISTENER_PID:-<none>}"
if [[ "$TRACKED_PID" == "$LISTENER_PID" ]]; then
  info "listener pid matches launchd's tracked pid on this run; killing it is still an independent proof via lsof discovery"
else
  info "listener pid DIFFERS from launchd's tracked pid: killing it proves recovery from that case too"
fi

if [[ -z "$LISTENER_PID" ]]; then
  fail "found a process listening on TCP 8081 to kill"
else
  info "$(now)  sending SIGKILL to TCP 8081 listener pid $LISTENER_PID"
  kill -9 "$LISTENER_PID" 2>/dev/null
  if wait_for_recovery com.harness.bundle-host "$TRACKED_PID" bundle_healthy; then
    info "$(now)  new pid $RESULT_NEW_PID, healthy after ${RESULT_ELAPSED}s ($LAST_BUNDLE_HEALTH)"
    pass "com.harness.bundle-host restarted with a new pid ($TRACKED_PID -> $RESULT_NEW_PID) and is healthy within ${WAIT_BOUND}s after killing the TCP 8081 listener (took ${RESULT_ELAPSED}s)"
    AFTER_B_LISTENERS="$(listener_count_8081)"
    check "exactly one listener on 8081 after restart B, no orphan from the previous instance (got $AFTER_B_LISTENERS)" test "$AFTER_B_LISTENERS" = "1"
  else
    info "$(now)  TIMEOUT after ${RESULT_ELAPSED}s, last observed pid $RESULT_NEW_PID ($LAST_BUNDLE_HEALTH)"
    fail "com.harness.bundle-host restarted with a new pid and is healthy within ${WAIT_BOUND}s after killing the TCP 8081 listener"
  fi
fi

# ---------------------------------------------------------------------------
section "Final: both services running and healthy"

check "com.harness.server state running" test "$(get_state com.harness.server)" = running
check "com.harness.server healthy" server_healthy
info "$LAST_SERVER_HEALTH"
check "com.harness.bundle-host state running" test "$(get_state com.harness.bundle-host)" = running
check "com.harness.bundle-host healthy" bundle_healthy
info "$LAST_BUNDLE_HEALTH"
check "exactly one listener on 8081 at the end (got $(listener_count_8081))" test "$(listener_count_8081)" = "1"

# ---------------------------------------------------------------------------
section "Result"
if [[ $FAILURES -eq 0 ]]; then
  echo "  PASS: ALL CHECKS PASSED"
else
  echo "  FAIL: $FAILURES CHECK(S) FAILED"
fi

exit $((FAILURES > 0 ? 1 : 0))
