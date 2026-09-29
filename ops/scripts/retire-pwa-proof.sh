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
trap 'rm -rf "$WORK"' EXIT

section() { printf '\n==== %s ====\n' "$1"; }
pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
info() { printf '      %s\n' "$1"; }
check() { # check <description> <command...>
  local desc="$1"; shift
  if "$@"; then pass "$desc"; else fail "$desc"; fi
}
now() { date '+%Y-%m-%d %H:%M:%S'; }

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

ROOT_HTTP="$(curl -s -m 10 -o "$WORK/root-body" -w '%{http_code}' "https://$TAILNET_NAME/" 2>"$WORK/root-curl-err")"
ROOT_CURL_EXIT=$?
info "curl https://$TAILNET_NAME/ -> status $ROOT_HTTP (curl exit $ROOT_CURL_EXIT); compare against the"
info "pre-retirement capture in the evidence log -- this script has no machine-readable record of it."

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
