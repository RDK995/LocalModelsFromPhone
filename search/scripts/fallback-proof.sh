#!/bin/bash
# Live proof for M7b-AC1 (FR20, I16/I17): with ddgs forced to fail or to return nothing, the same
# POST /v1/search request returns results with backend "browser", and no headless Chromium process
# remains afterwards. Drives the real HTTP entry point on a dedicated port (default 7791,
# FALLBACK_PROOF_PORT); never touches 7790 and stops only the instances it starts.
#
# Needs: bun, curl, python3, lsof, pgrep, network access, and the helper venv.

set -uo pipefail

SEARCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUN="${BUN:-bun}"
PORT="${FALLBACK_PROOF_PORT:-7791}"
BASE="http://127.0.0.1:$PORT"

FAILURES=0
WORK="$(mktemp -d)"
server_pid=""

PREV_EXIT_TRAP="$(trap -p EXIT | sed -e "s/^trap -- '//" -e "s/' EXIT\$//")"

stop_server() {
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

# assert_no_new_chromium <label>: fails if a headless Chromium PID not in $PRE exists.
assert_no_new_chromium() {
  local now new
  now="$(headless_pids)"
  new="$(comm -13 <(printf '%s\n' "$PRE" | sort) <(printf '%s\n' "$now" | sort) | grep -v '^$' || true)"
  if [[ -z "$new" ]]; then
    pass "no new headless Chromium process $1"
  else
    fail "no new headless Chromium process $1" "leftover pids: $(printf '%s' "$new" | tr '\n' ' ')"
  fi
}

# check_results <file>: prints "ok <n>" or "bad <reason>".
check_results() {
  python3 - "$1" <<'PY'
import json, sys
from urllib.parse import urlparse
try:
    d = json.load(open(sys.argv[1]))
except Exception as e:
    print("bad unparseable JSON: %s" % e); sys.exit()
if d.get("backend") != "browser":
    print("bad backend=%r" % d.get("backend")); sys.exit()
r = d.get("results")
if not isinstance(r, list) or not r:
    print("bad results empty or not an array"); sys.exit()
engines = ("bing.com", "duckduckgo.com")
for i, x in enumerate(r):
    if not isinstance(x, dict):
        print("bad result %d not an object" % i); sys.exit()
    t, u = x.get("title"), x.get("url")
    if not (isinstance(t, str) and t.strip()):
        print("bad result %d title" % i); sys.exit()
    p = urlparse(u) if isinstance(u, str) else None
    if not (p and p.scheme in ("http", "https") and p.hostname):
        print("bad result %d url not absolute http(s): %r" % (i, u)); sys.exit()
    h = p.hostname.lower()
    if any(h == e or h.endswith("." + e) for e in engines):
        print("bad result %d url on search engine domain: %s" % (i, u)); sys.exit()
print("ok %d" % len(r))
PY
}

section "M7b-AC1: setup"
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "FAIL: port $PORT already in use; set FALLBACK_PROOF_PORT to a free port" >&2
  exit 1
fi
PRE="$(headless_pids)"
info "pre-existing headless Chromium pids (not ours): ${PRE:+$(printf '%s' "$PRE" | tr '\n' ' ')}${PRE:-<none>}"

for mode in fail empty; do
  section "M7b-AC1: SEARCH_HELPER_FORCE_DDGS=$mode"
  (cd "$SEARCH_DIR" && exec env -i HOME="$HOME" PATH="/usr/bin:/bin:/opt/homebrew/bin" \
    SEARCH_PORT="$PORT" SEARCH_HELPER_FORCE_DDGS="$mode" \
    "$(command -v "$BUN")" run src/index.ts >"$WORK/server-$mode.log" 2>&1) &
  server_pid=$!
  info "started own service on $BASE (pid $server_pid, mode $mode)"
  health="$(curl -s --max-time 5 --retry 60 --retry-delay 1 --retry-connrefused --retry-all-errors \
    -o /dev/null -w '%{http_code}' "$BASE/v1/health" 2>/dev/null || true)"
  if [[ "$health" != 200 ]]; then
    fail "[$mode] service health" "GET $BASE/v1/health returned '$health'"
    cat "$WORK/server-$mode.log"
    stop_server
    continue
  fi
  pass "[$mode] service health -> 200"

  BODY_FILE="$WORK/body-$mode.json"
  CODE="$(curl -s --max-time 90 -o "$BODY_FILE" -w '%{http_code}' \
    -X POST "$BASE/v1/search" -H 'content-type: application/json' \
    --data '{"query":"Ada Lovelace","max_results":5}')" || true
  verdict="$(check_results "$BODY_FILE")"
  info "status=$CODE verdict=$verdict"
  info "response (first 800 chars):"
  head -c 800 "$BODY_FILE" | sed 's/^/        | /'
  printf '\n'
  if [[ "$CODE" == 200 ]]; then pass "[$mode] HTTP 200"; else fail "[$mode] HTTP 200" "status=$CODE"; fi
  if [[ "$verdict" == ok* ]]; then
    pass "[$mode] backend browser, ${verdict#ok } results, each with title and external absolute http(s) url"
  else
    fail "[$mode] backend browser with valid results" "$verdict"
  fi
  assert_no_new_chromium "after the [$mode] request completed"

  stop_server
  assert_no_new_chromium "after the [$mode] service was stopped"
done

section "result"
if [[ "$FAILURES" -eq 0 ]]; then
  echo "ALL CASES PASSED"
  exit 0
fi
echo "$FAILURES CASE(S) FAILED"
exit 1
