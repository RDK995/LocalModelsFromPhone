#!/bin/bash
# Live proof for M5-AC4 (FR17): after ops/scripts/retire-pwa.sh has run,
# /app no longer resolves, the PWA's LaunchAgent is gone, the harness's own
# / handler on :443 still works, the :8443 phone-models mapping is
# untouched, and the phoneToLocalModel repository is unchanged.
#
# Prints "PASS <check>" / "FAIL <check>" for each assertion and exits 0 only
# if every check passed. Read-only against Tailscale Serve, launchd and
# phoneToLocalModel; makes no changes anywhere.

set -uo pipefail

TAILSCALE="${TAILSCALE:-tailscale}"
BUN="${BUN:-/opt/homebrew/bin/bun}"
UIDN="$(id -u)"
LABEL="com.ryankenny.phone-pwa"
PLIST_SRC="$HOME/Library/LaunchAgents/$LABEL.plist"
BACKUP_DIR="$HOME/.phone-models/retired-pwa"
TAILNET_NAME="ryans-mac-studio.tailc3648a.ts.net"
PHONE_TO_LOCAL_MODEL="/Users/ryankenny/Projects/phoneToLocalModel"
EXPECT_HEAD="5c866080fbf58da3b5cf38a736536db29760cc7c"
# Distinguishing markers of the old PWA's served HTML (captured live from the
# PWA on 127.0.0.1:7788 before retirement): its <title> and manifest link.
PWA_MARKER_REGEX='Phone Reasoning Surface|app\.webmanifest'

FAILURES=0
WORK="$(mktemp -d)"
chmod 700 "$WORK"
responder_pid=""

cleanup() {
  if [[ -n "$responder_pid" ]]; then
    kill "$responder_pid" 2>/dev/null || true
    wait "$responder_pid" 2>/dev/null || true
  fi
  rm -rf "$WORK"
}

trap 'cleanup' EXIT

section() { printf '\n==== %s ====\n' "$1"; }
pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
info() { printf '      %s\n' "$1"; }
check() { # check <description> <command...>
  local desc="$1"; shift
  if "$@"; then pass "$desc"; else fail "$desc"; fi
}
now() { date '+%Y-%m-%d %H:%M:%S'; }

check_root_routing() {
  # Prove that :443 "/" still routes to 127.0.0.1:7787
  local listener_exists
  listener_exists="$(lsof -nP -iTCP:7787 -sTCP:LISTEN -t 2>/dev/null | wc -l | tr -d ' ')"

  if [[ "$listener_exists" -gt 0 ]]; then
    # Something is already listening on 7787; just verify curl gets a response
    local root_http root_curl_exit
    root_http="$(curl -s -m 10 -o "$WORK/root-body" -w '%{http_code}' "https://$TAILNET_NAME/" 2>"$WORK/root-curl-err")"
    root_curl_exit=$?
    if [[ $root_curl_exit -eq 0 ]] && [[ "$root_http" != "502" ]] && [[ "$root_http" != "000" ]]; then
      pass "/ handler reaches the live harness on 7787 (got $root_http)"
      return 0
    else
      fail "/ handler reaches the live harness on 7787 (got $root_http, curl exit $root_curl_exit)"
      return 1
    fi
  else
    # No listener; start a sentinel responder
    local sentinel_suffix sentinel_body
    sentinel_suffix="$(openssl rand -hex 8)"
    if [[ -z "$sentinel_suffix" ]]; then
      fail "/ handler routes through Tailscale Serve to 127.0.0.1:7787 (failed to generate random suffix)"
      return 1
    fi
    sentinel_body="m5c-root-sentinel-$sentinel_suffix"

    # Start the responder in the background
    "$BUN" -e "Bun.serve({hostname:'127.0.0.1',port:7787,fetch:()=>new Response('$sentinel_body')})" &
    responder_pid=$!

    # Poll for the responder to be ready (up to ~50 tries with 1s timeout each)
    local tries=0
    while [[ $tries -lt 50 ]]; do
      if curl -s -m 1 "http://127.0.0.1:7787/" >/dev/null 2>&1; then
        break
      fi
      tries=$((tries + 1))
    done

    if [[ $tries -ge 50 ]]; then
      fail "/ handler routes through Tailscale Serve to 127.0.0.1:7787 (responder failed to start)"
      return 1
    fi

    # Now test the full routing: curl https://TAILNET_NAME/ should get the sentinel body
    local root_http root_body root_curl_exit
    root_http="$(curl -s -m 10 -o "$WORK/root-body" -w '%{http_code}' "https://$TAILNET_NAME/" 2>"$WORK/root-curl-err")"
    root_curl_exit=$?
    root_body="$(cat "$WORK/root-body" 2>/dev/null)"

    if [[ $root_curl_exit -ne 0 ]]; then
      fail "/ handler routes through Tailscale Serve to 127.0.0.1:7787 (curl failed with exit $root_curl_exit)"
      return 1
    elif [[ "$root_http" != "200" ]]; then
      fail "/ handler routes through Tailscale Serve to 127.0.0.1:7787 (got status $root_http)"
      return 1
    elif [[ "$root_body" != "$sentinel_body" ]]; then
      fail "/ handler routes through Tailscale Serve to 127.0.0.1:7787 (body mismatch: got '$root_body', expected '$sentinel_body')"
      return 1
    fi

    # Check /app while the sentinel is up
    local app_http app_body app_curl_exit
    app_http="$(curl -s -m 10 -o "$WORK/app-body-sentinel" -w '%{http_code}' "https://$TAILNET_NAME/app" 2>"$WORK/app-curl-err-sentinel")"
    app_curl_exit=$?
    app_body="$(cat "$WORK/app-body-sentinel" 2>/dev/null)"

    if [[ $app_curl_exit -eq 0 ]] && printf '%s' "$app_body" | grep -qE "$PWA_MARKER_REGEX"; then
      fail "/app does not return PWA while sentinel is up (found PWA marker: $(printf '%s' "$app_body" | head -c 100))"
      return 1
    fi
    info "/app while sentinel is up: status $app_http, body: $(printf '%s' "$app_body" | head -c 100)"

    pass "/ handler routes through Tailscale Serve to 127.0.0.1:7787 (sentinel round-trip)"

    # Kill the responder
    kill "$responder_pid" 2>/dev/null || true
    wait "$responder_pid" 2>/dev/null || true
    responder_pid=""

    # Verify nothing listens on 7787 after cleanup
    local listener_after
    listener_after="$(lsof -nP -iTCP:7787 -sTCP:LISTEN -t 2>/dev/null | wc -l | tr -d ' ')"
    if [[ "$listener_after" -ne 0 ]]; then
      fail "nothing listens on 127.0.0.1:7787 after check (found $listener_after listener(s))"
      return 1
    fi

    return 0
  fi
}

echo "M5c retire-pwa proof (M5-AC4 / FR17)  ($(now))"
echo "repo commit: $(git -C "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" rev-parse HEAD 2>/dev/null || echo NON-GIT)"

if ! command -v "$TAILSCALE" &> /dev/null; then
  echo "FAIL: tailscale CLI not found."
  exit 1
fi

app_handler_state() {
  "$BUN" -e '
    const raw = await Bun.stdin.text();
    const cfg = raw.trim() ? JSON.parse(raw) : {};
    const web = cfg.Web ?? {};
    const key = Object.keys(web).find((k) => k.endsWith(":443"));
    const present = !!(key && web[key].Handlers && web[key].Handlers["/app"]);
    console.log(present ? "present" : "absent");
  '
}

root_handler_target() {
  "$BUN" -e '
    const raw = await Bun.stdin.text();
    const cfg = raw.trim() ? JSON.parse(raw) : {};
    const web = cfg.Web ?? {};
    const key = Object.keys(web).find((k) => k.endsWith(":443"));
    const target = key && web[key].Handlers && web[key].Handlers["/"]
      ? web[key].Handlers["/"].Proxy ?? "" : "";
    console.log(target);
  '
}

# ---------------------------------------------------------------------------
section "a. /app no longer resolves"

CURRENT_STATUS_JSON="$("$TAILSCALE" serve status --json)"
APP_STATE="$(echo "$CURRENT_STATUS_JSON" | app_handler_state)"
check "tailscale serve status --json has no /app handler on :443 (got: $APP_STATE)" \
  test "$APP_STATE" = "absent"

APP_HTTP="$(curl -s -m 10 -o "$WORK/app-body" -w '%{http_code}' "https://$TAILNET_NAME/app" 2>"$WORK/app-curl-err")"
APP_CURL_EXIT=$?
APP_BODY_HEAD="$(head -c 200 "$WORK/app-body" 2>/dev/null)"
info "curl https://$TAILNET_NAME/app -> status $APP_HTTP (curl exit $APP_CURL_EXIT)"
info "body head: $(printf '%s' "$APP_BODY_HEAD" | tr '\n' ' ' | head -c 160)"
if [[ $APP_CURL_EXIT -ne 0 ]]; then
  fail "curl https://$TAILNET_NAME/app succeeded (connection-level check)"
elif printf '%s' "$APP_BODY_HEAD" | grep -qE "$PWA_MARKER_REGEX"; then
  fail "https://$TAILNET_NAME/app does not return the PWA's content (found a PWA marker in the body)"
else
  pass "https://$TAILNET_NAME/app does not return the PWA's content"
fi

# ---------------------------------------------------------------------------
section "b. LaunchAgent gone"

if launchctl print "gui/$UIDN/$LABEL" &> /dev/null; then
  fail "launchctl print gui/$UIDN/$LABEL fails (LaunchAgent is still loaded)"
else
  pass "launchctl print gui/$UIDN/$LABEL fails (LaunchAgent gone)"
fi

check "plist absent from ~/Library/LaunchAgents ($PLIST_SRC)" test ! -f "$PLIST_SRC"

LISTEN_COUNT="$(lsof -nP -iTCP:7788 -sTCP:LISTEN -t 2>/dev/null | wc -l | tr -d ' ')"
check "nothing listens on 127.0.0.1:7788 (got $LISTEN_COUNT listener(s))" test "$LISTEN_COUNT" = "0"

# ---------------------------------------------------------------------------
section "c. Harness / handler still works"

STATUS_BACKUP_FILE="$(ls "$BACKUP_DIR"/tailscale-serve-status-*.json 2>/dev/null | sort | head -1)"
if [[ -z "$STATUS_BACKUP_FILE" ]]; then
  fail "a pre-retirement tailscale-serve-status-*.json backup exists in $BACKUP_DIR"
  ORIGINAL_ROOT_TARGET=""
else
  pass "a pre-retirement tailscale-serve-status-*.json backup exists in $BACKUP_DIR ($STATUS_BACKUP_FILE)"
  ORIGINAL_ROOT_TARGET="$(root_handler_target < "$STATUS_BACKUP_FILE")"
fi

CURRENT_ROOT_TARGET="$(echo "$CURRENT_STATUS_JSON" | root_handler_target)"
if [[ -z "$ORIGINAL_ROOT_TARGET" ]]; then
  fail ":443 / still targets its original proxy (no original recorded to compare against)"
else
  check ":443 / still targets its original proxy ($ORIGINAL_ROOT_TARGET)" \
    test "$CURRENT_ROOT_TARGET" = "$ORIGINAL_ROOT_TARGET"
fi

check_root_routing

# ---------------------------------------------------------------------------
section "d. :8443 mapping unchanged"

D_HTTP="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "https://$TAILNET_NAME:8443/v1/state" 2>"$WORK/8443-curl-err")"
check "https://$TAILNET_NAME:8443/v1/state returns 401 (got $D_HTTP)" test "$D_HTTP" = "401"

# ---------------------------------------------------------------------------
section "e. phoneToLocalModel untouched"

GOT_HEAD="$(git -C "$PHONE_TO_LOCAL_MODEL" rev-parse HEAD 2>/dev/null || echo "git-error")"
check "phoneToLocalModel HEAD is $EXPECT_HEAD (got $GOT_HEAD)" test "$GOT_HEAD" = "$EXPECT_HEAD"

PORCELAIN="$(git -C "$PHONE_TO_LOCAL_MODEL" status --porcelain 2>/dev/null)"
check "phoneToLocalModel git status --porcelain is empty" test -z "$PORCELAIN"

# ---------------------------------------------------------------------------
section "Result"
if [[ $FAILURES -eq 0 ]]; then
  echo "PASS: ALL CHECKS PASSED"
else
  echo "FAIL: $FAILURES CHECK(S) FAILED"
fi

exit $((FAILURES > 0 ? 1 : 0))
