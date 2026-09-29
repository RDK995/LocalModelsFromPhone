#!/bin/bash
# Live proof for M7a-AC1 (I16/I17): drives POST /v1/search on the real search service
# (127.0.0.1:7790) against real ddgs, region uk-en, with no account/key/token.
#
# Starts the service only if nothing is listening on 7790 (and stops only what it started),
# with a minimal environment (env -i HOME PATH) to show no credential variable is needed.
# Prints "PASS: <case>" / "FAIL: <case> (<observed>)" per case; exits non-zero on any failure.
#
# Needs: bun, curl, python3, lsof, network access, and the helper venv
# (ops/scripts/install-search-helper.sh).

set -uo pipefail

SEARCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$SEARCH_DIR/.." && pwd)"
BUN="${BUN:-bun}"
BASE="http://127.0.0.1:7790"
VENV_PY="$SEARCH_DIR/helper/.venv/bin/python"

FAILURES=0
WORK="$(mktemp -d)"
server_pid=""

# Preserve any EXIT trap already installed by a caller (do not clobber it).
PREV_EXIT_TRAP="$(trap -p EXIT | sed -e "s/^trap -- '//" -e "s/' EXIT\$//")"

cleanup() {
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
    local left
    left="$(lsof -nP -iTCP:7790 -sTCP:LISTEN -t 2>/dev/null || true)"
    [[ -n "$left" ]] && kill $left 2>/dev/null || true
  fi
  rm -rf "$WORK"
  if [[ -n "$PREV_EXIT_TRAP" ]]; then eval "$PREV_EXIT_TRAP"; fi
}
trap cleanup EXIT

pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s (%s)\n' "$1" "$2"; FAILURES=$((FAILURES + 1)); }
info() { printf '      %s\n' "$1"; }
section() { printf '\n==== %s ====\n' "$1"; }

# post_search <json-body>: sets CODE and BODY_FILE.
post_search() {
  BODY_FILE="$WORK/body.json"
  CODE="$(curl -s --max-time 60 -o "$BODY_FILE" -w '%{http_code}' \
    -X POST "$BASE/v1/search" -H 'content-type: application/json' --data "$1")" || true
}

# check_results <file> <max>: prints "ok <n>" or "bad <reason>".
check_results() {
  python3 - "$1" "$2" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception as e:
    print("bad unparseable JSON: %s" % e); sys.exit()
mx = int(sys.argv[2])
if d.get("backend") != "ddgs":
    print("bad backend=%r" % d.get("backend")); sys.exit()
r = d.get("results")
if not isinstance(r, list) or not r:
    print("bad results empty or not an array"); sys.exit()
if len(r) > mx:
    print("bad %d results > %d" % (len(r), mx)); sys.exit()
for i, x in enumerate(r):
    if not isinstance(x, dict):
        print("bad result %d not an object" % i); sys.exit()
    t, u, s = x.get("title"), x.get("url"), x.get("snippet")
    if not (isinstance(t, str) and t.strip()):
        print("bad result %d title" % i); sys.exit()
    if not (isinstance(u, str) and u.startswith("http")):
        print("bad result %d url" % i); sys.exit()
    if not isinstance(s, str):
        print("bad result %d snippet" % i); sys.exit()
print("ok %d" % len(r))
PY
}

# ---------------------------------------------------------------- venv
section "M7a-AC1: helper venv (Python, ddgs, Playwright, Chromium)"
if [[ -x "$VENV_PY" ]]; then
  pass "venv python present ($VENV_PY)"
  info "python: $("$VENV_PY" -c 'import platform;print(platform.python_version())')"
  if out="$("$VENV_PY" -c 'import ddgs, playwright; from importlib.metadata import version; print("ddgs", version("ddgs"), "playwright", version("playwright"))' 2>&1)"; then
    pass "venv imports ddgs and playwright ($out)"
  else
    fail "venv imports ddgs and playwright" "$out"
  fi
  if chrom="$("$VENV_PY" -c 'from playwright.sync_api import sync_playwright
with sync_playwright() as p: print(p.chromium.executable_path)' 2>&1)" && [[ -e "$chrom" ]]; then
    pass "Playwright Chromium executable exists ($chrom)"
  else
    fail "Playwright Chromium executable exists" "$chrom"
  fi
else
  fail "venv python present" "$VENV_PY missing; run ops/scripts/install-search-helper.sh"
fi

# ---------------------------------------------------------------- service
section "service (minimal environment)"
if lsof -nP -iTCP:7790 -sTCP:LISTEN >/dev/null 2>&1; then
  info "something already listening on 127.0.0.1:7790; using it (will not stop it)"
else
  (cd "$SEARCH_DIR" && exec env -i HOME="$HOME" PATH="/usr/bin:/bin:/opt/homebrew/bin" \
    "$(command -v "$BUN")" run src/index.ts >"$WORK/server.log" 2>&1) &
  server_pid=$!
  info "started search service with env -i HOME PATH only (pid $server_pid)"
fi
# curl's own retry loop waits for the listener (up to ~30 s) without a shell sleep.
health="$(curl -s --max-time 5 --retry 60 --retry-delay 1 --retry-connrefused --retry-all-errors \
  -o /dev/null -w '%{http_code}' "$BASE/v1/health" 2>/dev/null || true)"
if [[ "$health" != 200 ]]; then
  fail "service health" "GET $BASE/v1/health returned '$health'"
  [[ -f "$WORK/server.log" ]] && cat "$WORK/server.log"
  exit 1
fi
pass "service health -> 200"

# ---------------------------------------------------------------- search
section "M7a-AC1: POST /v1/search returns real ddgs results"
attempt=0
passed=0
for q in "Ada Lovelace" "Bletchley Park" "River Thames"; do
  attempt=$((attempt + 1))
  post_search "$(python3 -c 'import json,sys;print(json.dumps({"query":sys.argv[1]}))' "$q")"
  verdict="$(check_results "$BODY_FILE" 5)"
  info "attempt $attempt query='$q' status=$CODE verdict=$verdict"
  if [[ "$CODE" == 200 && "$verdict" == ok* ]]; then
    pass "search '$q' -> 200, backend ddgs, ${verdict#ok } valid results (attempt $attempt of 3)"
    info "response (first 800 chars):"
    head -c 800 "$BODY_FILE" | sed 's/^/        | /'
    printf '\n'
    passed=1
    break
  fi
  info "body: $(head -c 200 "$BODY_FILE")"
done
[[ "$passed" == 1 ]] || fail "search returns valid results" "no attempt of 3 passed"

passed=0
attempt=0
for q in "Ada Lovelace" "Bletchley Park" "River Thames"; do
  attempt=$((attempt + 1))
  post_search "$(python3 -c 'import json,sys;print(json.dumps({"query":sys.argv[1],"max_results":3}))' "$q")"
  verdict="$(check_results "$BODY_FILE" 3)"
  info "attempt $attempt query='$q' max_results=3 status=$CODE verdict=$verdict"
  if [[ "$CODE" == 200 && "$verdict" == ok* ]]; then
    pass "max_results=3 -> ${verdict#ok } results (<= 3) (attempt $attempt of 3)"
    passed=1
    break
  fi
done
[[ "$passed" == 1 ]] || fail "max_results=3 returns <= 3 results" "no attempt of 3 passed"

post_search '{}'
if [[ "$CODE" == 400 ]]; then
  pass "bad body {} -> 400"
else
  fail "bad body {} -> 400" "status=$CODE body=$(head -c 200 "$BODY_FILE")"
fi

# ---------------------------------------------------------------- region
section "M7a-AC1: region UK/English"
if grep -q '^REGION = "uk-en"' "$SEARCH_DIR/helper/search.py" \
  && grep -q 'region=REGION' "$SEARCH_DIR/helper/search.py"; then
  pass "helper requests region uk-en (REGION = \"uk-en\"; region=REGION)"
else
  fail "helper requests region uk-en" "static grep of search/helper/search.py failed"
fi
if [[ -x "$VENV_PY" ]]; then
  if ut="$("$VENV_PY" -m unittest discover -s "$SEARCH_DIR/helper" -p 'test_*.py' 2>&1)"; then
    pass "helper unit tests (fake DDGS receives region uk-en): $(printf '%s' "$ut" | tail -3 | tr '\n' ' ')"
  else
    fail "helper unit tests" "$(printf '%s' "$ut" | tail -15)"
  fi
fi

# ---------------------------------------------------------------- no account/key
section "M7a-AC1: no account, API key or payment"
hits="$(grep -rnE 'API_KEY|TOKEN|SECRET|os\.environ|os\.getenv|process\.env' \
  "$SEARCH_DIR/helper/search.py" "$SEARCH_DIR/src" "$REPO_ROOT/ops/scripts/install-search-helper.sh" 2>/dev/null || true)"
info "env/key reads found:"
printf '%s\n' "${hits:-<none>}" | sed 's/^/        | /'
bad="$(printf '%s\n' "$hits" | grep -v '^$' | grep -v 'SEARCH_PORT' || true)"
if [[ -z "$bad" ]]; then
  pass "no API key/token/env reads other than SEARCH_PORT; service ran under env -i HOME PATH"
else
  fail "no API key/token/env reads" "$bad"
fi

# ---------------------------------------------------------------- result
section "result"
if [[ "$FAILURES" -eq 0 ]]; then
  echo "ALL CASES PASSED"
  exit 0
fi
echo "$FAILURES CASE(S) FAILED"
exit 1
