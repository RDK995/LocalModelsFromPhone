#!/bin/bash
# Live proof for M10c1-AC1 (GET /v1/icon through the server) against the real public web.
# Starts its OWN search service and its OWN server from this working tree on spare ports
# (never touches 7789/7790 or the LaunchAgents), each with a fresh temp cache/token.
# The token lives in a private 0600 temp file and is never printed or saved.
# Exit status is non-zero if any check FAILs. ICON_PROOF_SELFTEST_FAIL=1 forces one FAIL.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(dirname "$SERVER_DIR")"
SEARCH_DIR="$ROOT_DIR/search"
EVIDENCE_DIR="$ROOT_DIR/.harness/evidence"
BUN="${BUN:-$(command -v bun || echo /opt/homebrew/bin/bun)}"
mkdir -p "$EVIDENCE_DIR"

if [[ "${ICON_PROOF_SELFTEST_FAIL:-0}" == "1" ]]; then
  LOG="$EVIDENCE_DIR/M10c1-T3-red.log"
else
  LOG="$EVIDENCE_DIR/M10c1-T3-proof.log"
fi
if [[ -z "${ICON_PROOF_LOGGING:-}" ]]; then
  export ICON_PROOF_LOGGING=1
  "$0" "$@" 2>&1 | sed $'s/\033\\[[0-9;]*m//g' | tee "$LOG"
  exit "${PIPESTATUS[0]}"
fi

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
FAILURES=0
pass() { echo -e "${GREEN}PASS${NC}: $1"; }
fail() { echo -e "${RED}FAIL${NC}: $1"; FAILURES=$((FAILURES + 1)); }
skip() { echo "SKIP: $1"; }
die() { echo -e "${RED}FAIL${NC}: $1"; exit 1; }

WORK_DIR="$(mktemp -d)"
PIDS=()
cleanup() {
  for p in "${PIDS[@]:-}"; do
    [[ -n "$p" ]] && kill "$p" 2>/dev/null
  done
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT INT TERM

spare_port() {
  "$BUN" -e 'const s = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => new Response("")}); console.log(s.port); s.stop(true);'
}
nap() { "$BUN" -e 'await new Promise((r) => setTimeout(r, 200))'; }

[[ -x "$BUN" ]] || die "bun not available"
command -v curl >/dev/null || die "curl not available"

# ---- AC1: isolation --------------------------------------------------------
SEARCH_PORT_T=$(spare_port); SERVER_PORT=$(spare_port)
[[ "$SEARCH_PORT_T" != "7790" && "$SERVER_PORT" != "7789" && "$SERVER_PORT" != "7790" ]] || die "spare port collided with a production port"
CACHE_DIR="$WORK_DIR/icon-cache"
SEARCH_OUT="$WORK_DIR/search.out"
: > "$SEARCH_OUT"
(cd "$SEARCH_DIR" && SEARCH_PORT="$SEARCH_PORT_T" SEARCH_ICON_CACHE_DIR="$CACHE_DIR" \
  exec "$BUN" src/index.ts > "$SEARCH_OUT" 2>&1) & PIDS+=($!)

TOKEN_FILE="$WORK_DIR/token"
( umask 077; "$BUN" -e 'console.log(crypto.randomUUID() + crypto.randomUUID())' > "$TOKEN_FILE" )
chmod 600 "$TOKEN_FILE"
AUTH_HEADER_FILE="$WORK_DIR/auth"
( umask 077; printf 'Authorization: Bearer %s\n' "$(tr -d '[:space:]' < "$TOKEN_FILE")" > "$AUTH_HEADER_FILE" )
BAD_HEADER_FILE="$WORK_DIR/badauth"
( umask 077; printf 'Authorization: Bearer %s\n' "not-the-token-$(date +%s)" > "$BAD_HEADER_FILE" )

(cd "$SERVER_DIR" && PHONE_MODELS_PORT="$SERVER_PORT" PHONE_MODELS_TOKEN_FILE="$TOKEN_FILE" \
  PHONE_MODELS_SEARCH_URL="http://127.0.0.1:$SEARCH_PORT_T" \
  exec "$BUN" src/index.ts > "$WORK_DIR/server.out" 2>&1) & PIDS+=($!)
SERVER_URL="http://127.0.0.1:$SERVER_PORT"

up=0
for _ in $(seq 1 50); do
  c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$SEARCH_PORT_T/v1/health") || c=000
  s=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$SERVER_URL/v1/state" -H "@$AUTH_HEADER_FILE") || s=000
  # The server's /v1/state needs Ollama; any HTTP response (not 000) proves it is listening.
  [[ "$c" == "200" && "$s" != "000" ]] && { up=1; break; }
  nap
done
[[ "$up" == 1 ]] || die "test instances did not come up (search $SEARCH_PORT_T, server $SERVER_PORT)"
mkdir -p "$CACHE_DIR"
if [[ "$SEARCH_PORT_T" != "7790" && -d "$CACHE_DIR" && -s "$TOKEN_FILE" ]]; then
  pass "AC1 isolation: search on 127.0.0.1:$SEARCH_PORT_T (temp cache dir), server on $SERVER_URL (random 0600 token file, not printed); production 7789/7790 untouched"
else
  fail "AC1 isolation"
fi

# icon <host> <outfile> <headerfile> -> prints http code
icon() {
  curl -s --max-time 30 -o "$2" -D "$3" -w '%{http_code}' "$SERVER_URL/v1/icon?host=$1" -H "@$AUTH_HEADER_FILE"
}
fetch_lines() { grep -c "^icon fetch host=$1 result=" "$SEARCH_OUT"; }
result_lines() { grep -c "^icon fetch host=$1 result=$2\$" "$SEARCH_OUT"; }
ctype() { grep -i '^content-type:' "$1" | head -1 | tr -d '\r' | sed 's/^[^:]*: *//'; }
magic_ok() { # <file> <content-type>
  local hex; hex=$(head -c 12 "$1" | od -An -tx1 | tr -d ' \n')
  case "$hex" in
    89504e47*) return 0 ;;
    00000100*) return 0 ;;
    ffd8ff*) return 0 ;;
    47494638*) return 0 ;;
    52494646????????57454250*) return 0 ;;
    *) return 1 ;;
  esac
}
is_no_icon() { "$BUN" -e 'const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf-8")); process.exit(j.error === "no_icon" ? 0 : 1)' "$1" 2>/dev/null; }

# ---- AC2: public site with an icon ------------------------------------------
HOST=""
for cand in github.com en.wikipedia.org; do
  code=$(icon "$cand" "$WORK_DIR/icon1.bin" "$WORK_DIR/icon1.hdr") || code=000
  if [[ "$code" == "200" ]]; then HOST="$cand"; break; fi
  echo "  candidate $cand returned $code; trying next"
done
if [[ -z "$HOST" ]]; then
  fail "AC2: no candidate public site returned an icon"
  HOST="github.com"
else
  echo "Using $HOST as the public site with an icon"
  CT=$(ctype "$WORK_DIR/icon1.hdr"); SZ=$(wc -c < "$WORK_DIR/icon1.bin" | tr -d ' ')
  if [[ "$CT" == image/* && "$SZ" -gt 0 ]] && magic_ok "$WORK_DIR/icon1.bin" "$CT" \
     && [[ "$(result_lines "$HOST" ok)" == "1" && "$(fetch_lines "$HOST")" == "1" ]]; then
    pass "AC2: $HOST -> 200, content-type $CT, $SZ bytes with matching image magic, exactly one 'icon fetch host=$HOST result=ok' in the search log"
  else
    fail "AC2: $HOST content-type='$CT' size=$SZ magic=$(head -c 8 "$WORK_DIR/icon1.bin" | od -An -tx1) fetch-lines=$(fetch_lines "$HOST")"
  fi
fi

# ---- AC3: cache -------------------------------------------------------------
code=$(icon "$HOST" "$WORK_DIR/icon2.bin" "$WORK_DIR/icon2.hdr") || code=000
NFILES=$(find "$CACHE_DIR" -type f 2>/dev/null | wc -l | tr -d ' ')
if [[ "$code" == "200" ]] && cmp -s "$WORK_DIR/icon1.bin" "$WORK_DIR/icon2.bin" \
   && [[ "$(fetch_lines "$HOST")" == "1" && "$NFILES" -ge 1 ]]; then
  pass "AC3: second request -> 200, byte-identical body, still exactly one 'icon fetch' line for $HOST (served from cache); $NFILES cache file(s) in the temp cache dir"
else
  fail "AC3: second request code=$code identical=$(cmp -s "$WORK_DIR/icon1.bin" "$WORK_DIR/icon2.bin" && echo yes || echo no) fetch-lines=$(fetch_lines "$HOST") cache-files=$NFILES"
fi

# ---- AC4: refused hosts -----------------------------------------------------
refused() { # <label> <host> <required 1|0>
  local label="$1" h="$2" required="$3" code
  code=$(icon "$h" "$WORK_DIR/r.bin" "$WORK_DIR/r.hdr") || code=000
  if [[ "$code" == "404" ]] && is_no_icon "$WORK_DIR/r.bin" && [[ "$(result_lines "$h" blocked)" -ge 1 ]]; then
    pass "AC4: $label ($h) -> 404 no_icon, search log shows result=blocked"
    return 0
  fi
  if [[ "$required" == "0" ]] && ! getent_resolves "$h"; then
    skip "AC4: $label ($h) - wildcard-DNS name did not resolve here (got HTTP $code)"
    return 1
  fi
  fail "AC4: $label ($h) code=$code body=$(head -c 100 "$WORK_DIR/r.bin") blocked-lines=$(result_lines "$h" blocked)"
  return 1
}
getent_resolves() { "$BUN" -e 'import {lookup} from "dns/promises"; try { await lookup(process.argv[1]); } catch { process.exit(1); }' "$1" 2>/dev/null; }

refused "local name (bare)" localhost 1
refused "local name (dotted, resolves to 127.0.0.1)" app.localhost 1
DNS_RAN=0
refused "public DNS name resolving to loopback 127.0.0.1" localtest.me 0 && DNS_RAN=1
refused "LAN address 10.0.0.1 via wildcard DNS" 10.0.0.1.nip.io 0 && DNS_RAN=1
refused "tailnet CGNAT address 100.100.100.100 via wildcard DNS" 100.100.100.100.nip.io 0 && DNS_RAN=1
[[ "$DNS_RAN" == 1 ]] || fail "AC4: no DNS-resolved private address could be tested"
echo "NOTE: redirect-to-local is proven by the search unit tests, the redirect cases in search/src/http/server.test.ts (run: cd search && bun test src/http/server.test.ts); no public URL whose root redirects to a private address is known, so none is faked here."

# ---- AC5: site with no icon -------------------------------------------------
NOICON_HOST="example.com"
hp=$(curl -s --max-time 15 "https://$NOICON_HOST/" | grep -ci '<link[^>]*rel=[^>]*icon' || true)
fav=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$NOICON_HOST/favicon.ico") || fav=000
echo "Using $NOICON_HOST as the site with no icon: home page has $hp icon <link> tag(s); /favicon.ico returns HTTP $fav (example.com declares only an empty <link rel=icon href=data:,>, so there is no usable icon)"
code=$(icon "$NOICON_HOST" "$WORK_DIR/n.bin" "$WORK_DIR/n.hdr") || code=000
if [[ "$code" == "404" ]] && is_no_icon "$WORK_DIR/n.bin" && [[ "$(result_lines "$NOICON_HOST" none)" == "1" ]]; then
  pass "AC5: $NOICON_HOST -> 404 {\"error\":\"no_icon\"}, search log shows result=none"
else
  fail "AC5: $NOICON_HOST code=$code body=$(head -c 100 "$WORK_DIR/n.bin") none-lines=$(result_lines "$NOICON_HOST" none)"
fi

# ---- AC6: authentication ----------------------------------------------------
c1=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$SERVER_URL/v1/icon?host=github.com") || c1=000
c2=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$SERVER_URL/v1/icon?host=github.com" -H "@$BAD_HEADER_FILE") || c2=000
if [[ "$c1" == "401" && "$c2" == "401" ]]; then
  pass "AC6: no token -> 401, wrong token -> 401"
else
  fail "AC6: no token -> $c1, wrong token -> $c2 (want 401 both)"
fi

# ---- AC7: no third-party logo service --------------------------------------
HITS=$(grep -rniE 'google\.com/s2/favicons|icons\.duckduckgo\.com|besticon|clearbit|favicone|faviconkit' \
  "$SEARCH_DIR/src" "$SERVER_DIR/src" --include='*.ts' 2>/dev/null | grep -v '\.test\.ts:' || true)
if [[ -z "$HITS" ]]; then
  pass "AC7: no third-party favicon/logo service referenced in search/src or server/src (tests excluded)"
else
  fail "AC7: third-party logo service referenced:"; echo "$HITS"
fi

# ---- AC8: self-test ---------------------------------------------------------
if [[ "${ICON_PROOF_SELFTEST_FAIL:-0}" == "1" ]]; then
  fail "AC8 self-test: ICON_PROOF_SELFTEST_FAIL=1 forces this failure to show the script exits non-zero on FAIL"
fi

echo ""
if [[ "$FAILURES" -eq 0 ]]; then
  echo -e "${GREEN}All M10c1-T3 live proofs passed${NC}"
  exit 0
fi
echo -e "${RED}$FAILURES M10c1-T3 live proof(s) failed${NC}"
exit 1
