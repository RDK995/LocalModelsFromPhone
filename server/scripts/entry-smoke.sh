#!/bin/bash
# Smoke test for the server entry point (src/index.ts).
#
# Starts `bun src/index.ts` on a spare loopback port with a temporary 0600 token
# file and asserts:
#   - it listens on 127.0.0.1 only
#   - a route without a token -> 401
#   - a route with a wrong token -> 401
#   - a route with the correct token -> not 401
#   - starting with a 0644 token file exits non-zero
#   - starting with a missing token file exits non-zero
# The server is always killed on exit. The token is never printed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(dirname "$SCRIPT_DIR")"
BUN="${BUN:-$(command -v bun || echo /opt/homebrew/bin/bun)}"

WORK_DIR="$(mktemp -d)"
SERVER_PID=""
FAILURES=0

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    sleep 0.2
    kill -9 "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT INT TERM

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILURES=$((FAILURES + 1)); }

# Pick a spare loopback port (never the production port 7789).
spare_port() {
  "$BUN" -e 'const s = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => new Response("")}); console.log(s.port); s.stop(true);'
}

# Run a command in the background; return its exit status, or 124 if it is
# still running after $1 seconds (it is then killed).
run_with_deadline() {
  local deadline="$1"; shift
  "$@" >"$WORK_DIR/deadline.log" 2>&1 &
  local pid=$!
  local waited=0
  while kill -0 "$pid" 2>/dev/null; do
    if (( waited >= deadline * 10 )); then
      kill "$pid" 2>/dev/null || true
      sleep 0.2
      kill -9 "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      return 124
    fi
    sleep 0.1
    waited=$((waited + 1))
  done
  local status=0
  wait "$pid" || status=$?
  return "$status"
}

# Run `bun src/index.ts` from the server dir with the given VAR=value args.
run_entry() {
  (cd "$SERVER_DIR" && exec env "$@" "$BUN" src/index.ts)
}

http_code() {
  # $1 = URL, remaining args passed to curl
  local url="$1"; shift
  local code
  code="$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$@" "$url" 2>/dev/null)" || true
  echo "${code:-000}"
}

PORT="$(spare_port)"
if [[ -z "$PORT" || "$PORT" == "7789" ]]; then
  echo "FAIL: could not obtain a spare loopback port (got '$PORT')"
  exit 1
fi
BASE_URL="http://127.0.0.1:$PORT"

TOKEN_FILE="$WORK_DIR/token"
( umask 077; openssl rand -hex 32 > "$TOKEN_FILE" )
chmod 600 "$TOKEN_FILE"
WRONG_TOKEN="$(openssl rand -hex 32)"

echo "Entry smoke: starting server on 127.0.0.1:$PORT"

# --- Start the server with a valid 0600 token file ---------------------------
(
  cd "$SERVER_DIR"
  PHONE_MODELS_PORT="$PORT" PHONE_MODELS_TOKEN_FILE="$TOKEN_FILE" \
    exec "$BUN" src/index.ts
) >"$WORK_DIR/server.log" 2>&1 &
SERVER_PID=$!

started=0
for _ in $(seq 1 100); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    break
  fi
  code="$(http_code "$BASE_URL/v1/state")"
  if [[ "$code" != "000" ]]; then
    started=1
    break
  fi
  sleep 0.1
done

if [[ "$started" != "1" ]]; then
  echo "FAIL: server did not start listening on $BASE_URL"
  echo "--- server log ---"
  cat "$WORK_DIR/server.log"
  exit 1
fi
pass "server started and is listening on $BASE_URL"

# --- Listens on 127.0.0.1 only ----------------------------------------------
# All listening sockets on this port must be bound to 127.0.0.1.
LISTEN_ADDRS="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -Fn 2>/dev/null | sed -n 's/^n//p' | sort -u || true)"
if [[ -z "$LISTEN_ADDRS" ]]; then
  fail "no listening socket found on port $PORT"
else
  non_loopback="$(echo "$LISTEN_ADDRS" | grep -v "^127\.0\.0\.1:$PORT\$" || true)"
  if [[ -n "$non_loopback" ]]; then
    fail "server listens on non-loopback address(es): $non_loopback"
  else
    pass "listens on 127.0.0.1 only ($LISTEN_ADDRS)"
  fi
fi

# --- No token -> 401 ---------------------------------------------------------
code="$(http_code "$BASE_URL/v1/state")"
if [[ "$code" == "401" ]]; then
  pass "no token -> 401"
else
  fail "no token: expected 401, got $code"
fi

# --- Wrong token -> 401 ------------------------------------------------------
code="$(http_code "$BASE_URL/v1/state" -H "Authorization: Bearer $WRONG_TOKEN")"
if [[ "$code" == "401" ]]; then
  pass "wrong token -> 401"
else
  fail "wrong token: expected 401, got $code"
fi

# --- Correct token -> not 401 ------------------------------------------------
# Header is read from a file so the token never appears in argv or output.
printf 'Authorization: Bearer %s\n' "$(cat "$TOKEN_FILE")" > "$WORK_DIR/auth-header"
chmod 600 "$WORK_DIR/auth-header"
code="$(http_code "$BASE_URL/v1/state" -H "@$WORK_DIR/auth-header")"
if [[ "$code" != "401" && "$code" != "000" ]]; then
  pass "correct token -> $code (not 401)"
else
  fail "correct token: expected not 401, got $code"
fi

# Stop the running server before the refusal checks.
kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true
SERVER_PID=""

# --- 0644 token file -> exits non-zero ---------------------------------------
UNSAFE_TOKEN_FILE="$WORK_DIR/unsafe-token"
openssl rand -hex 32 > "$UNSAFE_TOKEN_FILE"
chmod 644 "$UNSAFE_TOKEN_FILE"
UNSAFE_PORT="$(spare_port)"
status=0
run_with_deadline 10 run_entry \
  PHONE_MODELS_PORT="$UNSAFE_PORT" PHONE_MODELS_TOKEN_FILE="$UNSAFE_TOKEN_FILE" \
  || status=$?
if [[ "$status" == "124" ]]; then
  fail "0644 token file: server kept running instead of refusing to start"
elif [[ "$status" != "0" ]]; then
  pass "0644 token file -> exits non-zero ($status)"
else
  fail "0644 token file: expected non-zero exit, got 0"
fi

# --- Missing token file -> exits non-zero ------------------------------------
status=0
run_with_deadline 10 run_entry \
  PHONE_MODELS_PORT="$UNSAFE_PORT" PHONE_MODELS_TOKEN_FILE="$WORK_DIR/does-not-exist" \
  || status=$?
if [[ "$status" == "124" ]]; then
  fail "missing token file: server kept running instead of refusing to start"
elif [[ "$status" != "0" ]]; then
  pass "missing token file -> exits non-zero ($status)"
else
  fail "missing token file: expected non-zero exit, got 0"
fi

if (( FAILURES > 0 )); then
  echo "Entry smoke: $FAILURES check(s) FAILED"
  exit 1
fi
echo "Entry smoke: all checks passed"
exit 0
