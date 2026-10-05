#!/bin/bash
# Live proof for M7c-AC1: with both backends forced to fail, POST /v1/search returns 503
# search_unavailable; a search exceeding its time limit returns 504 timeout and its helper process
# (and the headless Chromium it launched) is killed. Drives the real HTTP entry point on a dedicated
# port (default 7792, FAILURE_PROOF_PORT); never touches 7790/7791 and stops only what it starts.
# No public-network dependency (both backends are forced by test hooks).
#
# Needs: bun, curl, python3, lsof, pgrep, and the helper venv with Playwright Chromium.

set -uo pipefail

SEARCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUN="${BUN:-bun}"
PORT="${FAILURE_PROOF_PORT:-7792}"
BASE="http://127.0.0.1:$PORT"

FAILURES=0
WORK="$(mktemp -d)"
server_pid=""
req_pid=""

PREV_EXIT_TRAP="$(trap -p EXIT | sed -e "s/^trap -- '//" -e "s/' EXIT\$//")"

stop_server() {
  if [[ -n "$req_pid" ]]; then
    kill "$req_pid" 2>/dev/null || true
    wait "$req_pid" 2>/dev/null || true
    req_pid=""
  fi
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
    local left
    left="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true)"
    [[ -n "$left" ]] && kill $left 2>/dev/null || true
    server_pid=""
  fi
}

cleanup() {
  stop_server
  rm -rf "$WORK"
  if [[ -n "$PREV_EXIT_TRAP" ]]; then eval "$PREV_EXIT_TRAP"; fi
}
trap cleanup EXIT

pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s (%s)\n' "$1" "$2"; FAILURES=$((FAILURES + 1)); }
info() { printf '      %s\n' "$1"; }
section() { printf '\n==== %s ====\n' "$1"; }

headless_pids() { pgrep -f 'chrom.*headless' 2>/dev/null | sort -n || true; }
helper_pids() { pgrep -f 'helper/search.py' 2>/dev/null | sort -n || true; }

# new_pids <before> <now>: lines in <now> that are not in <before>.
new_pids() {
  comm -13 <(printf '%s\n' "$1" | sort) <(printf '%s\n' "$2" | sort) | grep -v '^$' || true
}
flat() { printf '%s' "$1" | tr '\n' ' '; }

# start_service <label> [ENV=VAL ...]: starts own service, waits for health. Returns 1 on failure.
start_service() {
  local label="$1"; shift
  (cd "$SEARCH_DIR" && exec env -i HOME="$HOME" PATH="/usr/bin:/bin:/opt/homebrew/bin" \
    SEARCH_PORT="$PORT" "$@" \
    "$(command -v "$BUN")" run src/index.ts >"$WORK/server-$label.log" 2>&1) &
  server_pid=$!
  info "started own service on $BASE (pid $server_pid, case $label)"
  local health
  health="$(curl -s --max-time 5 --retry 60 --retry-delay 1 --retry-connrefused --retry-all-errors \
    -o /dev/null -w '%{http_code}' "$BASE/v1/health" 2>/dev/null || true)"
  if [[ "$health" != 200 ]]; then
    fail "[$label] service health" "GET $BASE/v1/health returned '$health'"
    cat "$WORK/server-$label.log"
    stop_server
    return 1
  fi
  pass "[$label] service health -> 200"
}

section "M7c-AC1: setup"
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "FAIL: port $PORT already in use; set FAILURE_PROOF_PORT to a free port" >&2
  exit 1
fi
PRE_CHROME="$(headless_pids)"
PRE_HELPER="$(helper_pids)"
info "pre-existing headless Chromium pids (not ours): ${PRE_CHROME:+$(flat "$PRE_CHROME")}${PRE_CHROME:-<none>}"
info "pre-existing search.py helper pids (not ours): ${PRE_HELPER:+$(flat "$PRE_HELPER")}${PRE_HELPER:-<none>}"

REQ='{"query":"Ada Lovelace","max_results":5}'

# ---------------------------------------------------------------- unavailable
section "M7c-AC1: both backends forced to fail -> 503 search_unavailable"
if start_service unavailable SEARCH_HELPER_FORCE_DDGS=fail SEARCH_HELPER_FORCE_BROWSER=fail; then
  BODY_FILE="$WORK/body-unavailable.json"
  CODE="$(curl -s --max-time 30 -o "$BODY_FILE" -w '%{http_code}' \
    -X POST "$BASE/v1/search" -H 'content-type: application/json' --data "$REQ")" || true
  info "status=$CODE"
  info "response:"
  head -c 800 "$BODY_FILE" | sed 's/^/        | /'
  printf '\n'
  if [[ "$CODE" == 503 ]]; then pass "[unavailable] HTTP 503"; else fail "[unavailable] HTTP 503" "status=$CODE"; fi
  verdict="$(python3 - "$BODY_FILE" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception as e:
    print("bad unparseable JSON: %s" % e); sys.exit()
if d.get("error") != "search_unavailable":
    print("bad error=%r" % d.get("error")); sys.exit()
det = d.get("detail")
if not (isinstance(det, str) and det.strip()):
    print("bad detail not a non-empty string: %r" % det); sys.exit()
print("ok")
PY
)"
  if [[ "$verdict" == ok ]]; then
    pass "[unavailable] body error == search_unavailable with a non-empty string detail"
  else
    fail "[unavailable] body error search_unavailable with detail" "$verdict"
  fi
  stop_server
fi

# ---------------------------------------------------------------- timeout
section "M7c-AC1: search exceeding its time limit -> 504 timeout, helper and browser killed"
if start_service timeout SEARCH_TIMEOUT_MS=8000 SEARCH_HELPER_FORCE_DDGS=fail SEARCH_HELPER_FORCE_BROWSER=hang; then
  BODY_FILE="$WORK/body-timeout.json"
  TIME_FILE="$WORK/time-timeout.txt"
  START="$(python3 -c 'import time; print(time.time())')"
  (curl -s --max-time 60 -o "$BODY_FILE" -w '%{http_code}' \
    -X POST "$BASE/v1/search" -H 'content-type: application/json' --data "$REQ" >"$WORK/code-timeout.txt" 2>/dev/null
   python3 -c 'import time; print(time.time())' >"$TIME_FILE") &
  req_pid=$!

  # While the request is in flight, catch the new helper and the new headless Chromium.
  HELPER_NEW=""; CHROME_NEW=""
  for _ in $(seq 1 60); do
    HELPER_NEW="$(new_pids "$PRE_HELPER" "$(helper_pids)")"
    CHROME_NEW="$(new_pids "$PRE_CHROME" "$(headless_pids)")"
    [[ -n "$HELPER_NEW" && -n "$CHROME_NEW" ]] && break
    python3 -c 'import time; time.sleep(0.1)'
  done
  HELPER_PID="$(printf '%s\n' "$HELPER_NEW" | head -1)"
  if [[ -n "$HELPER_PID" ]]; then
    pass "[timeout] new helper process seen in flight (pid $HELPER_PID)"
  else
    fail "[timeout] new helper process seen in flight" "no new helper/search.py pid appeared"
  fi
  if [[ -n "$CHROME_NEW" ]]; then
    pass "[timeout] new headless Chromium running when the limit hit (pids $(flat "$CHROME_NEW"))"
  else
    fail "[timeout] new headless Chromium running when the limit hit" "none appeared; proof would be vacuous"
  fi

  wait "$req_pid" 2>/dev/null || true
  req_pid=""
  CODE="$(cat "$WORK/code-timeout.txt" 2>/dev/null || true)"
  END="$(cat "$TIME_FILE" 2>/dev/null || true)"
  ELAPSED="$(python3 -c 'import sys; print("%.2f" % (float(sys.argv[2]) - float(sys.argv[1])))' "$START" "${END:-$START}")"
  info "status=$CODE elapsed=${ELAPSED}s"
  info "response:"
  head -c 800 "$BODY_FILE" | sed 's/^/        | /'
  printf '\n'
  if [[ "$CODE" == 504 ]]; then pass "[timeout] HTTP 504"; else fail "[timeout] HTTP 504" "status=$CODE"; fi
  if python3 - "$BODY_FILE" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(1)
sys.exit(0 if d == {"error": "timeout"} else 1)
PY
  then
    pass "[timeout] body is exactly {\"error\":\"timeout\"}"
  else
    fail "[timeout] body is exactly {\"error\":\"timeout\"}" "body: $(head -c 200 "$BODY_FILE")"
  fi
  if python3 -c 'import sys; e=float(sys.argv[1]); sys.exit(0 if 8 <= e < 15 else 1)' "$ELAPSED"; then
    pass "[timeout] elapsed ${ELAPSED}s is >= 8 s and < 15 s"
  else
    fail "[timeout] elapsed between 8 s and 15 s" "elapsed=${ELAPSED}s"
  fi

  # Poll up to ~3 s for the helper and browser to be gone.
  helper_gone=0; chrome_left="$CHROME_NEW"
  for _ in $(seq 1 30); do
    helper_gone=1
    [[ -n "$HELPER_PID" ]] && kill -0 "$HELPER_PID" 2>/dev/null && helper_gone=0
    chrome_left="$(new_pids "$PRE_CHROME" "$(headless_pids)")"
    [[ "$helper_gone" == 1 && -z "$chrome_left" ]] && break
    python3 -c 'import time; time.sleep(0.1)'
  done
  if [[ -n "$HELPER_PID" && "$helper_gone" == 1 ]]; then
    pass "[timeout] helper pid $HELPER_PID no longer exists after the 504"
  else
    fail "[timeout] helper pid no longer exists after the 504" "pid='$HELPER_PID' still alive or never seen"
  fi
  if [[ -z "$chrome_left" ]]; then
    pass "[timeout] no new headless Chromium process after the 504"
  else
    fail "[timeout] no new headless Chromium process after the 504" "leftover pids: $(flat "$chrome_left")"
  fi

  stop_server
  left_chrome="$(new_pids "$PRE_CHROME" "$(headless_pids)")"
  if [[ -z "$left_chrome" ]]; then
    pass "[timeout] no new headless Chromium process after the service was stopped"
  else
    fail "[timeout] no new headless Chromium process after the service was stopped" "leftover pids: $(flat "$left_chrome")"
  fi
  if [[ -n "$HELPER_PID" ]] && kill -0 "$HELPER_PID" 2>/dev/null; then
    fail "[timeout] helper pid gone after the service was stopped" "pid $HELPER_PID alive"
  else
    pass "[timeout] helper pid gone after the service was stopped"
  fi
fi

section "result"
if [[ "$FAILURES" -eq 0 ]]; then
  echo "ALL CASES PASSED"
  exit 0
fi
echo "$FAILURES CASE(S) FAILED"
exit 1
