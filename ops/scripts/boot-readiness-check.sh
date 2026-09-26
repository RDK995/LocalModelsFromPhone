#!/bin/bash
# Post-reboot readiness check for the always-on services (M5-AC1, FR15).
#
# Run this AFTER rebooting the Mac, logging in, and opening the project in Expo
# Go on the phone. It proves, from the Mac side and without touching anything,
# that everything the phone needed was started automatically by launchd since
# this boot -- nobody started anything by hand -- and that it is reachable over
# the tailnet. This is the Mac-side evidence for M5-AC1; the phone-side
# evidence is the human's Expo Go observation (recorded separately).
#
# Checks:
#   1. Boot time, and for com.harness.server / com.harness.bundle-host: the
#      LaunchAgent is loaded and running, its pid's parent is launchd (pid 1,
#      i.e. not started from a shell), and its process start time is after
#      this boot. For the bundle host, the pid listening on TCP 8081 is that
#      agent's pid or a descendant of it (bun x expo execs into node, so today
#      it is the same pid, but this does not assume that).
#   2. Server: unauthenticated GET /v1/models -> 401; authenticated GET
#      /v1/state over the tailnet HTTPS URL -> 200. (The server has no GET
#      /v1/models route, so /v1/state is used for the authenticated check;
#      GET /v1/models is still useful unauthenticated because auth runs
#      before routing, so it also returns 401 for an unknown route.)
#   3. Bundle host over the tailnet: /status reports packager-status:running;
#      the iOS manifest resolves and its bundle/launch-asset URL names the
#      tailnet host; that bundle URL itself returns 200 with a non-trivial
#      body.
#   4. pf: the LaunchDaemon com.harness.pf-bundle-host is loaded (skipped, not
#      failed, if it cannot be read without sudo), and the interface it last
#      loaded the anchor for matches the utun currently carrying the tailnet
#      IP -- a mismatch means the phone would be blocked on 8081 until the
#      LaunchDaemon's next run (every 60s) or the next reboot.
#
# Strictly read-only: never sudo, never launchctl load/unload/kickstart, never
# kills or restarts anything, never changes pf or Tailscale Serve. The only
# file it writes is a private temp bearer-token header file, deleted on exit.
#
# Exit status: 0 only if every check below passed (SKIPPED checks do not
# count as failures).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BUN="${BUN:-/opt/homebrew/bin/bun}"
TAILSCALE="${TAILSCALE:-tailscale}"
UIDN="$(id -u)"
TOKEN_FILE="$HOME/.phone-models/token"
TAILNET_NAME="ryans-mac-studio.tailc3648a.ts.net"
IFACE_FILE="/var/run/com.harness.pf-bundle-host.iface"

FAILURES=0
WORK="$(mktemp -d)"
chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT

ts() { date '+%Y-%m-%d %H:%M:%S'; }
section() { printf '\n==== %s ====\n' "$1"; }
pass() { printf '%s PASS  %s\n' "$(ts)" "$1"; }
fail() { printf '%s FAIL  %s\n' "$(ts)" "$1"; FAILURES=$((FAILURES + 1)); }
skip() { printf '%s SKIP  %s\n' "$(ts)" "$1"; }
info() { printf '        %s\n' "$1"; }
check() { # check <description> <command...>
  local desc="$1"; shift
  if "$@"; then pass "$desc"; else fail "$desc"; fi
}
json() { # json <js expression over `j`> < json
  "$BUN" -e "const j = JSON.parse(await Bun.stdin.text()); const r = ($1); console.log(typeof r === 'string' ? r : JSON.stringify(r));"
}

get_state() { launchctl print "gui/$UIDN/$1" 2>/dev/null | awk -F'= ' '/^\tstate = /{print $2; exit}'; }
get_pid()   { launchctl print "gui/$UIDN/$1" 2>/dev/null | awk -F'= ' '/^\tpid = /{print $2; exit}'; }

# pid_tree <root pid>: the root pid plus every descendant, one per line.
pid_tree() {
  local queue=("$1") out=() cur child
  while [[ ${#queue[@]} -gt 0 ]]; do
    cur="${queue[0]}"; queue=("${queue[@]:1}")
    out+=("$cur")
    while IFS= read -r child; do
      [[ -n "$child" ]] && queue+=("$child")
    done < <(pgrep -P "$cur" 2>/dev/null)
  done
  printf '%s\n' "${out[@]}"
}

echo "Boot readiness check ($(ts))"
echo "repo commit: $(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo NON-GIT)"

if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "FAIL: token file $TOKEN_FILE does not exist; cannot run the authenticated checks."
  exit 1
fi
AUTH="$WORK/auth-header"
( umask 077; printf 'Authorization: Bearer %s\n' "$(tr -d '[:space:]' < "$TOKEN_FILE")" > "$AUTH" )

# ---------------------------------------------------------------------------
section "Boot time and LaunchAgents started by launchd since this boot"

BOOT_SEC="$(sysctl -n kern.boottime | sed -E 's/^\{ sec = ([0-9]+).*/\1/')"
echo "  system booted at: $(date -r "$BOOT_SEC") (epoch $BOOT_SEC)"

BUNDLE_AGENT_PID=""
for label in com.harness.server com.harness.bundle-host; do
  state="$(get_state "$label")"
  check "LaunchAgent $label loaded and running (state: ${state:-not loaded})" test "$state" = running

  pid="$(get_pid "$label")"
  info "$label launchd-tracked pid: ${pid:-<none>}"
  [[ "$label" == com.harness.bundle-host ]] && BUNDLE_AGENT_PID="$pid"
  if [[ -z "$pid" ]]; then
    fail "$label has a launchd-tracked pid"
    continue
  fi

  ppid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"
  check "$label pid $pid has parent pid 1 (launchd), i.e. not started from a shell (ppid: ${ppid:-<none>})" \
    test "$ppid" = "1"

  lstart_raw="$(LC_ALL=C ps -o lstart= -p "$pid" 2>/dev/null | sed -E 's/^ +| +$//g')"
  lstart_epoch="$(LC_ALL=C date -j -f '%a %b %d %H:%M:%S %Y' "$lstart_raw" +%s 2>/dev/null)"
  info "$label process start time: ${lstart_raw:-<none>} (epoch ${lstart_epoch:-<none>})"
  check "$label process started after this boot (start epoch ${lstart_epoch:-<none>} > boot epoch $BOOT_SEC)" \
    bash -c '[[ -n "$1" && "$1" -gt "$2" ]]' _ "${lstart_epoch:-}" "$BOOT_SEC"
done

if [[ -n "$BUNDLE_AGENT_PID" ]]; then
  LISTENER_PID="$(lsof -nP -iTCP:8081 -sTCP:LISTEN -t 2>/dev/null | head -1)"
  TREE="$(pid_tree "$BUNDLE_AGENT_PID")"
  info "com.harness.bundle-host process tree (agent pid + descendants): $(tr '\n' ' ' <<< "$TREE")"
  info "TCP 8081 listener pid: ${LISTENER_PID:-<none>}"
  check "TCP 8081 listener (pid ${LISTENER_PID:-<none>}) is com.harness.bundle-host's launchd pid ($BUNDLE_AGENT_PID) or a descendant of it" \
    bash -c '[[ -n "$1" ]] && grep -qx "$1" <<< "$2"' _ "$LISTENER_PID" "$TREE"
else
  fail "obtained com.harness.bundle-host's launchd-tracked pid, to check the TCP 8081 listener against"
fi

# ---------------------------------------------------------------------------
section "Server reachable (unauthenticated rejected, authenticated works over the tailnet)"

UNAUTH_CODE="$(curl -s --max-time 10 -o /dev/null -w '%{http_code}' http://127.0.0.1:7789/v1/models)"
check "unauthenticated GET http://127.0.0.1:7789/v1/models -> 401 (got $UNAUTH_CODE)" test "$UNAUTH_CODE" = "401"

AUTH_CODE="$(curl -s --max-time 10 -o /dev/null -w '%{http_code}' "https://$TAILNET_NAME:8443/v1/state" -H "@$AUTH")"
check "authenticated GET https://$TAILNET_NAME:8443/v1/state -> 200 (got $AUTH_CODE)" test "$AUTH_CODE" = "200"

# ---------------------------------------------------------------------------
section "Bundle host reachable over the tailnet (status, iOS manifest, bundle fetch)"

BUNDLE_URL="http://$TAILNET_NAME:8081"
STATUS="$(curl -s --max-time 10 "$BUNDLE_URL/status")"
check "GET $BUNDLE_URL/status -> packager-status:running (got '$STATUS')" test "$STATUS" = "packager-status:running"

MANIFEST="$WORK/manifest.json"
M_CODE="$(curl -s --max-time 30 -o "$MANIFEST" -w '%{http_code}' -H 'expo-platform: ios' \
  -H 'accept: application/expo+json,application/json' "$BUNDLE_URL/")"
LAUNCH_URL="$(json "j.launchAsset?.url ?? ''" < "$MANIFEST" 2>/dev/null)"
info "iOS manifest fetch: $M_CODE; launchAsset.url: $LAUNCH_URL"
check "iOS manifest fetch -> 200 JSON (got $M_CODE)" test "$M_CODE" = "200"
check "manifest's bundle/launch-asset URL names the tailnet host ($BUNDLE_URL/...)" \
  bash -c '[[ "$1" == "'"$BUNDLE_URL"'/"* ]]' _ "$LAUNCH_URL"

if [[ -n "$LAUNCH_URL" ]]; then
  BUNDLE_FILE="$WORK/bundle.js"
  B_CODE="$(curl -s --max-time 60 -o "$BUNDLE_FILE" -w '%{http_code}' "$LAUNCH_URL")"
  B_SIZE="$(stat -f '%z' "$BUNDLE_FILE" 2>/dev/null || echo 0)"
  info "bundle fetch: $B_CODE, $B_SIZE bytes"
  check "fetching the bundle URL -> 200 with a non-trivial body (got $B_CODE, $B_SIZE bytes)" \
    bash -c '[[ "$1" == "200" && "$2" -gt 10000 ]]' _ "$B_CODE" "$B_SIZE"
else
  fail "obtained a launchAsset.url from the manifest to fetch the bundle from"
fi

# ---------------------------------------------------------------------------
section "pf: LaunchDaemon loaded, anchor interface matches the current tailnet interface"

PF_PRINT="$(launchctl print system/com.harness.pf-bundle-host 2>&1)"
PF_PRINT_EXIT=$?
if [[ $PF_PRINT_EXIT -ne 0 ]]; then
  skip "pf LaunchDaemon com.harness.pf-bundle-host is loaded (not readable without sudo here: $PF_PRINT)"
else
  check "pf LaunchDaemon com.harness.pf-bundle-host is loaded (last exit code = 0)" \
    bash -c '[[ "$1" == *"last exit code = 0"* ]]' _ "$PF_PRINT"
fi

RECORDED_IFACE="$(cat "$IFACE_FILE" 2>/dev/null)"
TS_IP="$("$TAILSCALE" ip -4 2>/dev/null | head -1)"
CURRENT_IFACE="$(ifconfig 2>/dev/null | bash "$SCRIPT_DIR/pf-bundle-host-load.sh" --resolve "$TS_IP" 2>/dev/null)"
info "pf anchor recorded interface ($IFACE_FILE): ${RECORDED_IFACE:-<none>}"
info "current tailnet IP ($TS_IP) resolves to interface: ${CURRENT_IFACE:-<none>}"
if [[ -z "$RECORDED_IFACE" || -z "$CURRENT_IFACE" ]]; then
  fail "pf anchor interface file and current tailnet interface are both readable/resolvable (recorded: '${RECORDED_IFACE:-}', current: '${CURRENT_IFACE:-}')"
elif [[ "$RECORDED_IFACE" != "$CURRENT_IFACE" ]]; then
  fail "pf anchor interface ($RECORDED_IFACE) matches the current tailnet interface ($CURRENT_IFACE) -- MISMATCH: the phone would be blocked on port 8081 until pf-bundle-host-load.sh next runs (every 60s) or the next reboot"
else
  pass "pf anchor interface ($RECORDED_IFACE) matches the current tailnet interface for IP $TS_IP"
fi

# ---------------------------------------------------------------------------
section "Result"
if [[ $FAILURES -eq 0 ]]; then
  echo "  PASS: ALL CHECKS PASSED"
else
  echo "  FAIL: $FAILURES CHECK(S) FAILED"
fi

exit $((FAILURES > 0 ? 1 : 0))
