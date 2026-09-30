#!/bin/bash
# Live proof for M8-AC1/AC2/AC3 (FR25, AC19): the always-on search service
# (LaunchAgent com.harness.search) answers on 127.0.0.1:7790, is restarted by
# launchd after SIGKILL, is not reachable on the tailnet or LAN address, has no
# Tailscale Serve mapping, needs no token, and answers as search/API.md says.
#
# Only ever kills the launchd-tracked pid of com.harness.search. No sudo.
# Does not touch com.harness.server, the bundle host, pf or Tailscale Serve.
# Leaves the agent installed and loaded. PROOF_SKIP_INSTALL=1 skips step 1
# (used for the red run against a booted-out agent).
#
# Exit status: 0 only if every check passed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LABEL="com.harness.search"
UIDN="$(id -u)"
PORT=7790
BASE="http://127.0.0.1:$PORT"
API_DOC="$REPO_ROOT/search/API.md"
TAILSCALE="$(command -v tailscale || echo /usr/local/bin/tailscale)"

FAILURES=0
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

section() { printf '\n==== %s ====\n' "$1"; }
pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
skip() { printf '  SKIP  %s\n' "$1"; }
info() { printf '        %s\n' "$1"; }
now() { date '+%Y-%m-%d %H:%M:%S'; }

get_state() { launchctl print "gui/$UIDN/$LABEL" 2>/dev/null | awk -F'= ' '/^\tstate = /{print $2; exit}' || true; }
get_pid()   { launchctl print "gui/$UIDN/$LABEL" 2>/dev/null | awk -F'= ' '/^\tpid = /{print $2; exit}' || true; }

# health_ok: GET /v1/health with no Authorization header, expect 200 {"ok": true}
health_ok() {
  local code
  code="$(curl -s --max-time 5 -o "$WORK/health.json" -w '%{http_code}' "$BASE/v1/health" 2>/dev/null || true)"
  [[ "$code" == "200" ]] && python3 -c '
import json,sys
j=json.load(open(sys.argv[1])); sys.exit(0 if j=={"ok": True} else 1)' "$WORK/health.json"
}

# req <method> <path> [body]: sets CODE and BODY_FILE; never sends Authorization.
req() {
  local method="$1" path="$2" body="${3-}"
  BODY_FILE="$WORK/resp.json"
  : > "$BODY_FILE"
  if [[ -n "$body" ]]; then
    CODE="$(curl -s --max-time 60 -X "$method" -H 'Content-Type: application/json' -d "$body" -o "$BODY_FILE" -w '%{http_code}' "$BASE$path" 2>/dev/null || true)"
  else
    CODE="$(curl -s --max-time 60 -X "$method" -o "$BODY_FILE" -w '%{http_code}' "$BASE$path" 2>/dev/null || true)"
  fi
}

# expect_error <desc> <status> <error-code>: check CODE and body {"error": code},
# and that both strings appear in API.md.
expect_error() {
  local desc="$1" status="$2" ecode="$3"
  if [[ "$CODE" == "$status" ]] && python3 -c '
import json,sys
j=json.load(open(sys.argv[1])); sys.exit(0 if j.get("error")==sys.argv[2] else 1)' "$BODY_FILE" "$ecode" \
     && grep -q "$status" "$API_DOC" && grep -q "\`$ecode\`" "$API_DOC"; then
    pass "$desc -> $status $ecode (documented in API.md)"
  else
    fail "$desc: expected $status $ecode, got $CODE $(head -c 200 "$BODY_FILE" 2>/dev/null)"
  fi
}

echo "M8 search service proof (M8-AC1/AC2/AC3)  ($(now))"
echo "repo commit: $(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo NON-GIT)"

# ---------------------------------------------------------------------------
section "1. Install + load"
if [[ "${PROOF_SKIP_INSTALL:-}" == "1" ]]; then
  skip "install skipped (PROOF_SKIP_INSTALL=1)"
else
  LISTENER="$(lsof -nP -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
  TRACKED="$(get_pid)"
  if [[ -n "$LISTENER" && "$LISTENER" != "$TRACKED" ]] \
     && [[ -z "$TRACKED" || "$(ps -o ppid= -p "$LISTENER" 2>/dev/null | tr -d ' ')" != "$TRACKED" ]]; then
    fail "something else (pid $LISTENER) already listens on 127.0.0.1:$PORT and is not the launchd job; not touching it"
    echo "search-service-proof: FAIL"
    exit 1
  fi
  if bash "$SCRIPT_DIR/install-search-agent.sh" --load; then
    pass "install-search-agent.sh --load"
  else
    fail "install-search-agent.sh --load"
  fi
fi

# ---------------------------------------------------------------------------
section "2. AC1: running under launchd, healthy, loopback-only listener"
OLD_PID=""
state=""; pid=""
start="$(date +%s)"
while :; do
  state="$(get_state)"; pid="$(get_pid)"
  if [[ "$state" == "running" && -n "$pid" ]] && health_ok; then OLD_PID="$pid"; break; fi
  if (( $(date +%s) - start >= 30 )); then break; fi
  sleep 1
done
if [[ -n "$OLD_PID" ]]; then
  pass "launchd shows $LABEL state=running pid=$OLD_PID and GET /v1/health -> 200 {\"ok\":true}"
else
  fail "$LABEL not running+healthy within 30s (state: ${state:-not loaded}, pid: ${pid:-none})"
  echo "search-service-proof: FAIL"
  exit 1
fi

listener_check() {
  local lpid names bad
  lpid="$(lsof -nP -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null | sort -u | tr '\n' ' ' | sed 's/ $//' || true)"
  names="$(lsof -nP -iTCP:$PORT -sTCP:LISTEN -Fn 2>/dev/null | grep '^n' | sort -u | tr '\n' ' ' || true)"
  info "listener pid(s): ${lpid:-none}; addresses: ${names:-none}"
  if [[ -z "$lpid" || "$lpid" == *" "* ]]; then return 1; fi
  if [[ "$lpid" != "$1" && "$(ps -o ppid= -p "$lpid" | tr -d ' ')" != "$1" ]]; then return 1; fi
  bad="$(printf '%s\n' "$names" | tr ' ' '\n' | grep '^n' | grep -v '^n127\.0\.0\.1:' || true)"
  [[ -z "$bad" ]]
}
if listener_check "$OLD_PID"; then
  pass "sole listener on $PORT is launchd pid $OLD_PID (or its child) and binds 127.0.0.1 only"
else
  fail "listener on $PORT is not the launchd pid, or is not loopback-only"
fi

# ---------------------------------------------------------------------------
section "3. AC1 restart: kill -9 the launchd pid, launchd restarts it"
info "$(now)  sending SIGKILL to pid $OLD_PID"
kill -9 "$OLD_PID" 2>/dev/null || true
NEW_PID=""
start="$(date +%s)"
while :; do
  state="$(get_state)"; pid="$(get_pid)"
  if [[ "$state" == "running" && -n "$pid" && "$pid" != "$OLD_PID" ]] && health_ok; then NEW_PID="$pid"; break; fi
  if (( $(date +%s) - start >= 45 )); then break; fi
  sleep 1
done
if [[ -n "$NEW_PID" ]]; then
  pass "launchd restarted $LABEL with a new pid ($OLD_PID -> $NEW_PID), health answers again (took $(( $(date +%s) - start ))s)"
else
  fail "no new running pid with healthy answer within 45s (last state: ${state:-none}, pid: ${pid:-none})"
fi

# ---------------------------------------------------------------------------
section "4. AC2: not reachable on tailnet or LAN addresses"
ADDRS=()
TS_IP=""
if [[ -x "$TAILSCALE" ]]; then
  TS_IP="$("$TAILSCALE" ip -4 2>/dev/null | head -1 || true)"
fi
if [[ -n "$TS_IP" ]]; then ADDRS+=("tailnet:$TS_IP"); else skip "tailnet address not discoverable (tailscale ip -4 gave nothing)"; fi
while read -r ip; do
  [[ -z "$ip" || "$ip" == "$TS_IP" ]] && continue
  ADDRS+=("lan:$ip")
done < <(ifconfig | awk '/^\tinet /{print $2}' | grep -v '^127\.' || true)
TESTED=0
for entry in "${ADDRS[@]+"${ADDRS[@]}"}"; do
  ip="${entry#*:}"
  rc=0
  code="$(curl -s --max-time 3 -o /dev/null -w '%{http_code}' "http://$ip:$PORT/v1/health" 2>/dev/null)" || rc=$?
  TESTED=$((TESTED + 1))
  if [[ "$rc" -ne 0 && ( "$code" == "000" || -z "$code" ) ]]; then
    pass "${entry%%:*} $ip:$PORT refused/unreachable (curl exit $rc)"
  else
    fail "${entry%%:*} $ip:$PORT answered (curl exit $rc, http $code)"
  fi
done
if (( TESTED == 0 )); then fail "no non-loopback address could be tested"; fi

# ---------------------------------------------------------------------------
section "5. AC2: no Tailscale Serve mapping to $PORT"
if [[ ! -x "$TAILSCALE" ]]; then
  fail "tailscale not installed at $TAILSCALE"
else
  serve_txt="$("$TAILSCALE" serve status 2>&1 || true)"
  serve_json="$("$TAILSCALE" serve status --json 2>&1 || true)"
  if printf '%s\n%s\n' "$serve_txt" "$serve_json" | grep -Eq "(^|[^0-9])$PORT([^0-9]|$)"; then
    fail "tailscale serve status references $PORT"
    printf '%s\n' "$serve_txt" | sed 's/^/        /'
  else
    pass "tailscale serve status (text and --json) has no reference to $PORT"
  fi
fi

# ---------------------------------------------------------------------------
section "6/7. AC2 no token + AC3: each documented route answers as documented (no Authorization header)"
if grep -q 'No token' "$API_DOC"; then pass "API.md documents that no token is required"; else fail "API.md does not state no token is required"; fi

if health_ok; then pass "GET /v1/health -> 200 {\"ok\": true}"; else fail "GET /v1/health did not answer 200 {\"ok\": true}"; fi
req POST /v1/health
expect_error "POST /v1/health" 405 method_not_allowed

req POST /v1/search '{"query":"example domain","max_results":3}'
if [[ "$CODE" == "200" ]] && python3 -c '
import json,sys
j=json.load(open(sys.argv[1]))
r=j["results"]
assert isinstance(r,list) and 0<len(r)<=3
assert isinstance(j["backend"],str) and j["backend"]
for x in r:
    for k in ("url","title","snippet"): assert isinstance(x[k],str)' "$BODY_FILE" 2>/dev/null; then
  pass "POST /v1/search -> 200 with results[{url,title,snippet}] and backend ($(python3 -c 'import json,sys;j=json.load(open(sys.argv[1]));print(len(j["results"]),"results, backend",j["backend"])' "$BODY_FILE"))"
else
  fail "POST /v1/search live query: got $CODE $(head -c 300 "$BODY_FILE") (documented 503/504 or drift; reviewer to rerun)"
fi
req POST /v1/search '{"query":"   "}'
expect_error "POST /v1/search empty query" 400 bad_request
req POST /v1/search 'not json'
expect_error "POST /v1/search invalid JSON" 400 bad_request
req POST /v1/search '{"query":"x","max_results":11}'
expect_error "POST /v1/search max_results 11" 400 bad_request
req GET /v1/search
expect_error "GET /v1/search" 405 method_not_allowed

req POST /v1/read '{"url":"https://example.com/"}'
if [[ "$CODE" == "200" ]] && python3 -c '
import json,sys
j=json.load(open(sys.argv[1]))
for k in ("url","final_url","title","markdown"): assert isinstance(j[k],str)
assert isinstance(j["truncated"],bool) and j["title"]=="Example Domain" and j["markdown"]' "$BODY_FILE" 2>/dev/null; then
  pass "POST /v1/read https://example.com/ -> 200 {url,final_url,title,markdown,truncated}"
else
  fail "POST /v1/read example.com: got $CODE $(head -c 300 "$BODY_FILE")"
fi
req POST /v1/read '{"url":"http://127.0.0.1:7789/"}'
expect_error "POST /v1/read loopback address" 400 blocked_destination
req POST /v1/read '{"url":"http://169.254.169.254/"}'
expect_error "POST /v1/read metadata address" 400 blocked_destination
req POST /v1/read '{"url":"ftp://example.com/"}'
expect_error "POST /v1/read non-http url" 400 bad_url
req POST /v1/read '{}'
expect_error "POST /v1/read missing url" 400 bad_url
req GET /v1/read
expect_error "GET /v1/read" 405 method_not_allowed

req GET /unknown
expect_error "GET /unknown" 404 not_found

# ---------------------------------------------------------------------------
section "8. Final: agent still installed, loaded, healthy"
if [[ -f "$HOME/Library/LaunchAgents/$LABEL.plist" ]]; then pass "plist installed"; else fail "plist not installed"; fi
if [[ "$(get_state)" == "running" ]]; then pass "$LABEL state running (pid $(get_pid))"; else fail "$LABEL not running"; fi
if health_ok; then pass "final health OK"; else fail "final health failed"; fi

section "Result"
if (( FAILURES == 0 )); then
  echo "search-service-proof: PASS"
  exit 0
fi
echo "  $FAILURES CHECK(S) FAILED"
echo "search-service-proof: FAIL"
exit 1
