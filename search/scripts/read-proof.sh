#!/bin/bash
# Live proof for M6-AC1..AC4 (FR18/FR21, I18): drives POST /v1/read on the real search
# service (127.0.0.1:7790, default strict policy) with curl against the real public web.
#
# Starts the service only if nothing is listening on 7790 (and stops only what it started),
# waits for GET /v1/health, then prints one "PASS: <case>" / "FAIL: <case> (<observed>)" line per
# case and exits non-zero if any case failed.
#
# Needs: bun, curl, python3, lsof, network access to en.wikipedia.org and httpbin.org.

set -uo pipefail

SEARCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUN="${BUN:-bun}"
BASE="http://127.0.0.1:7790"
MARKER=$'\n\n[… truncated: page exceeded 40000 characters]'

FAILURES=0
WORK="$(mktemp -d)"
server_pid=""
sentinel_pid=""

# Preserve any EXIT trap already installed by a caller (do not clobber it).
PREV_EXIT_TRAP="$(trap -p EXIT | sed -e "s/^trap -- '//" -e "s/' EXIT\$//")"

cleanup() {
  if [[ -n "$sentinel_pid" ]]; then
    kill "$sentinel_pid" 2>/dev/null || true
    wait "$sentinel_pid" 2>/dev/null || true
  fi
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
    # Belt and braces: only reached when we started the service ourselves.
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

# jget <file> <key>: print a top-level JSON string/bool field ("" if absent).
jget() {
  python3 - "$1" "$2" <<'PY'
import json, sys
try:
    v = json.load(open(sys.argv[1])).get(sys.argv[2], "")
except Exception:
    v = ""
print(json.dumps(v) if isinstance(v, bool) else v)
PY
}

# read_url <url>: POST /v1/read; sets CODE, ELAPSED, BODY_FILE.
read_url() {
  BODY_FILE="$WORK/body.json"
  local out
  out="$(curl -s --max-time 30 -o "$BODY_FILE" -w '%{http_code} %{time_total}' \
    -X POST "$BASE/v1/read" -H 'content-type: application/json' \
    --data "$(python3 -c 'import json,sys;print(json.dumps({"url":sys.argv[1]}))' "$1")")" || true
  CODE="${out%% *}"
  ELAPSED="${out##* }"
}

# expect_error <case> <url> <status> <error-code>
expect_error() {
  local name="$1" url="$2" want_status="$3" want_err="$4"
  read_url "$url"
  local err
  err="$(jget "$BODY_FILE" error)"
  if [[ "$CODE" == "$want_status" && "$err" == "$want_err" ]]; then
    pass "$name -> $CODE $err"
  else
    fail "$name" "url=$url status=$CODE body=$(head -c 200 "$BODY_FILE") elapsed=${ELAPSED}s"
  fi
}

# ---------------------------------------------------------------- start service
section "service"
if lsof -nP -iTCP:7790 -sTCP:LISTEN >/dev/null 2>&1; then
  info "something already listening on 127.0.0.1:7790; using it (will not stop it)"
else
  (cd "$SEARCH_DIR" && exec "$BUN" run src/index.ts >"$WORK/server.log" 2>&1) &
  server_pid=$!
  info "started search service (pid $server_pid)"
fi
ready=0
for _ in $(seq 1 100); do
  if curl -s --max-time 1 -o /dev/null -w '%{http_code}' "$BASE/v1/health" 2>/dev/null | grep -q '^200$'; then
    ready=1
    break
  fi
  sleep 0.1
done
if [[ "$ready" != 1 ]]; then
  fail "service health" "GET $BASE/v1/health never returned 200"
  [[ -f "$WORK/server.log" ]] && cat "$WORK/server.log"
  exit 1
fi
pass "service health -> 200"

# ---------------------------------------------------------------- AC1
section "M6-AC1: read a real article; oversize is truncated"
ARTICLE="https://en.wikipedia.org/wiki/Ada_Lovelace_Day"
read_url "$ARTICLE"
md_file="$WORK/article.md"
python3 - "$BODY_FILE" "$md_file" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
open(sys.argv[2], "w").write(d.get("markdown", ""))
PY
truncated="$(jget "$BODY_FILE" truncated)"
md="$(cat "$md_file")"
info "url: $ARTICLE  status=$CODE  markdown_length=${#md}  truncated=$truncated  elapsed=${ELAPSED}s"
info "first 300 chars of markdown:"
printf '%s' "$md" | head -c 300 | sed 's/^/        | /'
printf '\n'
if [[ "$CODE" == 200 && "$truncated" == false ]]; then
  pass "AC1 normal article -> 200, truncated false"
else
  fail "AC1 normal article" "status=$CODE truncated=$truncated body=$(head -c 200 "$BODY_FILE")"
fi
if [[ "$md" == *"annual event held on the second Tuesday of October"* ]]; then
  pass "AC1 markdown contains article body sentence"
else
  fail "AC1 markdown contains article body sentence" "sentence missing"
fi
# Each of these is present in the raw page HTML (nav/footer/sidebar) and must be stripped.
raw="$(curl -s --max-time 20 "$ARTICLE")"
for boiler in "Privacy policy" "Toggle the table of contents" "Contact Wikipedia"; do
  if [[ "$raw" != *"$boiler"* ]]; then
    fail "AC1 boilerplate check '$boiler'" "not present in raw HTML; pick another marker"
  elif [[ "$md" == *"$boiler"* ]]; then
    fail "AC1 boilerplate removed: '$boiler'" "still present in markdown"
  else
    pass "AC1 boilerplate removed: '$boiler' (present in raw HTML, absent from markdown)"
  fi
done

LONG="https://en.wikipedia.org/wiki/World_War_II"
read_url "$LONG"
python3 - "$BODY_FILE" "$md_file" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
open(sys.argv[2], "w").write(d.get("markdown", ""))
PY
truncated="$(jget "$BODY_FILE" truncated)"
md="$(cat "$md_file")"
info "url: $LONG  status=$CODE  markdown_length=${#md}  truncated=$truncated"
if [[ "$CODE" == 200 && "$truncated" == true && "$md" == *"$MARKER" ]]; then
  pass "AC1 oversized page -> 200, truncated true, ends with truncation marker"
else
  fail "AC1 oversized page" "status=$CODE truncated=$truncated tail=$(printf '%s' "$md" | tail -c 80)"
fi

# ---------------------------------------------------------------- AC2
section "M6-AC2: blocked destinations -> 400 blocked_destination"
expect_error "AC2 loopback 127.0.0.1:7789" "http://127.0.0.1:7789" 400 blocked_destination
expect_error "AC2 localhost" "http://localhost" 400 blocked_destination
TS_IP="$(tailscale ip -4 2>/dev/null | head -1 || true)"
expect_error "AC2 tailnet 100.100.100.100" "http://100.100.100.100" 400 blocked_destination
if [[ -n "$TS_IP" ]]; then
  expect_error "AC2 this Mac's tailnet IP $TS_IP" "http://$TS_IP" 400 blocked_destination
fi
expect_error "AC2 private 192.168.1.1" "http://192.168.1.1" 400 blocked_destination
expect_error "AC2 IPv6 loopback [::1]" "http://[::1]" 400 blocked_destination

info "public loopback-DNS names, as seen by the system resolver vs public resolvers:"
for h in localtest.me 127.0.0.1.nip.io foo.localhost; do
  info "  $h: system=[$(python3 -c 'import socket,sys
try: print(" ".join(sorted({a[4][0] for a in socket.getaddrinfo(sys.argv[1],80)})))
except Exception as e: print("unresolved")' "$h")] @1.1.1.1=[$(dig +short +time=3 +tries=1 @1.1.1.1 "$h" 2>/dev/null | tr '\n' ' ')]"
done
# A hostname that resolves to 127.0.0.1 via the resolver the service actually uses.
# (foo.localhost: the OS resolver maps *.localhost to loopback. The public rebinding-test names
# localtest.me / nip.io resolve to 127.0.0.1 on public resolvers but are filtered by this
# machine's resolver, so they can only reach the service as unresolved names; see above.)
expect_error "AC2 hostname resolving to 127.0.0.1 (foo.localhost)" "http://foo.localhost:7789/" 400 blocked_destination

# Connect-time evidence: a sentinel listener must see zero requests.
SENT_PORT="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"
SENT_LOG="$WORK/sentinel.log"
: >"$SENT_LOG"
python3 - "$SENT_PORT" "$SENT_LOG" <<'PY' &
import socketserver, sys
port, log = int(sys.argv[1]), sys.argv[2]
class H(socketserver.BaseRequestHandler):
    def handle(self):
        data = self.request.recv(4096)
        if not data:
            return
        with open(log, "ab") as f:
            f.write(b"REQUEST: " + data.split(b"\r\n")[0] + b"\n")
        self.request.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 2\r\nConnection: close\r\n\r\nhi")
socketserver.TCPServer.allow_reuse_address = True
socketserver.TCPServer(("127.0.0.1", port), H).serve_forever()
PY
sentinel_pid=$!
for _ in $(seq 1 50); do
  (exec 3<>"/dev/tcp/127.0.0.1/$SENT_PORT") 2>/dev/null && break
  sleep 0.1
done
# The probe above connected once; reset the log so only the service's behaviour is counted.
: >"$SENT_LOG"
info "sentinel listener on 127.0.0.1:$SENT_PORT (would log any request that reaches it)"
expect_error "AC2 hostname->loopback with live listener (foo.localhost:$SENT_PORT)" \
  "http://foo.localhost:$SENT_PORT/" 400 blocked_destination
expect_error "AC2 literal loopback with live listener (127.0.0.1:$SENT_PORT)" \
  "http://127.0.0.1:$SENT_PORT/" 400 blocked_destination
reqs="$(grep -c '^REQUEST' "$SENT_LOG" || true)"
if [[ "$reqs" == 0 ]]; then
  pass "AC2 sentinel received zero requests (check made before connecting)"
else
  fail "AC2 sentinel received zero requests" "sentinel saw $reqs request(s): $(cat "$SENT_LOG")"
fi
# Control: prove the sentinel really records a request when one is made directly.
curl -s --max-time 5 -o /dev/null "http://127.0.0.1:$SENT_PORT/control" || true
if grep -q 'GET /control' "$SENT_LOG"; then
  pass "AC2 sentinel control (direct request is recorded, so zero above is meaningful)"
else
  fail "AC2 sentinel control" "direct request was not recorded"
fi
kill "$sentinel_pid" 2>/dev/null || true
wait "$sentinel_pid" 2>/dev/null || true
sentinel_pid=""

# ---------------------------------------------------------------- AC3
section "M6-AC3: redirects re-checked; non-http scheme -> bad_url"
for target in "http://127.0.0.1:7789/" "http://100.100.100.100/"; do
  redirector="https://httpbin.org/redirect-to?url=$target"
  first="$(curl -s --max-time 20 -o /dev/null -w '%{http_code} %{redirect_url}' "$redirector")"
  info "redirector first hop (direct curl, no follow): $first"
  if [[ "${first%% *}" != 302 ]]; then
    fail "AC3 redirector precondition ($redirector)" "expected 302 first, got: $first"
    continue
  fi
  expect_error "AC3 public redirect -> $target" "$redirector" 400 blocked_destination
done
expect_error "AC3 file:///etc/passwd" "file:///etc/passwd" 400 bad_url
expect_error "AC3 ftp://example.com/" "ftp://example.com/" 400 bad_url

# ---------------------------------------------------------------- AC4
section "M6-AC4: non-text -> 415; slow fetch -> 504 (not a hang)"
expect_error "AC4 non-text image/png" "https://httpbin.org/image/png" 415 unsupported_content
# httpbin /delay caps at 10 s (< the 15 s limit). /drip?delay=20 holds the response headers back
# for a full 20 s (verified with direct curl: 200 after ~20.4 s), which exceeds the service's
# 15 s overall deadline. (Without delay, /drip returns application/octet-stream, i.e. 415.)
SLOW="https://httpbin.org/drip?duration=1&delay=20&numbytes=1&code=200"
read_url "$SLOW"
err="$(jget "$BODY_FILE" error)"
info "url: $SLOW  status=$CODE  error=$err  service answered in ${ELAPSED}s (curl --max-time 30)"
if [[ "$CODE" == 504 && "$err" == timeout ]] && python3 -c "import sys;sys.exit(0 if float(sys.argv[1])<20 else 1)" "$ELAPSED"; then
  pass "AC4 slow fetch -> 504 timeout in ${ELAPSED}s (<20s)"
else
  fail "AC4 slow fetch -> 504 timeout in <20s" "status=$CODE error=$err elapsed=${ELAPSED}s"
fi

# ---------------------------------------------------------------- result
section "result"
if [[ "$FAILURES" -eq 0 ]]; then
  echo "ALL CASES PASSED"
  exit 0
fi
echo "$FAILURES CASE(S) FAILED"
exit 1
