#!/bin/bash
# End-to-end tailnet proof for M1 (AC1..AC4), run on the Mac against the LIVE
# server (LaunchAgent com.harness.server), LIVE Ollama and the LIVE bundle host.
# No mocks. Never runs sudo, never changes pf, never changes Tailscale Serve.
#
# The bearer token is read from ~/.phone-models/token into a private temp header
# file and is never printed.
#
# Exit status: 0 only if every automated check passed, including that the bundle
# host on 8081 is NOT reachable on the LAN IP (needs the pf anchor, installed once
# by the human with: sudo bash ops/scripts/install-pf-anchor.sh). Checks that need
# the phone are printed at the end and do not affect the status.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BUN="${BUN:-/opt/homebrew/bin/bun}"
TAILSCALE="${TAILSCALE:-tailscale}"
TAILNET_NAME="ryans-mac-studio.tailc3648a.ts.net"
TAILNET_URL="https://$TAILNET_NAME:8443"
BUNDLE_URL="http://$TAILNET_NAME:8081"
OLLAMA="http://127.0.0.1:11434"
TOKEN_FILE="$HOME/.phone-models/token"

FAILURES=0
WORK="$(mktemp -d)"
chmod 700 "$WORK"
BG_PIDS=()
cleanup() {
  for p in "${BG_PIDS[@]:-}"; do [[ -n "$p" ]] && kill "$p" 2>/dev/null; done
  rm -rf "$WORK"
}
trap cleanup EXIT

section() { printf '\n==== %s ====\n' "$1"; }
pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
info() { printf '        %s\n' "$1"; }
check() { # check <description> <command...>
  local desc="$1"; shift
  if "$@"; then pass "$desc"; else fail "$desc"; fi
}
json() { # json <js expression over `j`> < json
  "$BUN" -e "const j = JSON.parse(await Bun.stdin.text()); const r = ($1); console.log(typeof r === 'string' ? r : JSON.stringify(r));"
}
# Prefix each line with seconds elapsed since the stream started (ms resolution).
stamp() { perl -MTime::HiRes=time -ne 'BEGIN { $| = 1; $t0 = time } printf "%8.3f %s", time - $t0, $_'; }
cputime() { # cumulative CPU seconds of a pid
  ps -o time= -p "$1" 2>/dev/null | awk -F: '{ s = 0; for (i = 1; i <= NF; i++) s = s * 60 + $i; printf "%.2f\n", s }'
}

echo "M1 end-to-end tailnet proof  ($(date '+%Y-%m-%d %H:%M:%S %Z'))"
echo "repo commit: $(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo NON-GIT)"
echo "tailnet server URL: $TAILNET_URL"

# ---------------------------------------------------------------------------
section "Preconditions: token file, LaunchAgents, Tailscale Serve"

if [[ ! -f "$TOKEN_FILE" ]]; then
  fail "token file exists at $TOKEN_FILE"
  echo "Cannot continue without the token file."; exit 1
fi
MODE="$(stat -f '%Lp' "$TOKEN_FILE")"
check "token file mode is 600 (got $MODE)" test "$MODE" = "600"
AUTH="$WORK/auth-header"
( umask 077; printf 'Authorization: Bearer %s\n' "$(tr -d '[:space:]' < "$TOKEN_FILE")" > "$AUTH" )
BAD_AUTH="$WORK/bad-auth-header"
( umask 077; printf 'Authorization: Bearer %s\n' "wrong-$(date +%s)" > "$BAD_AUTH" )

for label in com.harness.server com.harness.bundle-host; do
  state="$(launchctl print "gui/$(id -u)/$label" 2>/dev/null | awk -F'= ' '/^\tstate = /{print $2; exit}')"
  check "LaunchAgent $label loaded and running (state: ${state:-not loaded})" test "$state" = "running"
done

SERVE_JSON="$("$TAILSCALE" serve status --json)"
echo "  tailscale serve status:"
"$TAILSCALE" serve status | sed 's/^/        /'
SERVE_CHECK="$(printf '%s' "$SERVE_JSON" | json "
  (() => {
    const w = j.Web ?? {}, h443 = w['$TAILNET_NAME:443']?.Handlers ?? {}, h8443 = w['$TAILNET_NAME:8443']?.Handlers ?? {};
    const funnel = Object.values(j.AllowFunnel ?? {}).some(Boolean);
    return [
      h443['/']?.Proxy === 'http://127.0.0.1:7787' && Object.keys(h443).length === 2 ? 'ok' : 'bad',
      h443['/app']?.Proxy === 'http://127.0.0.1:7788' ? 'ok' : 'bad',
      h8443['/']?.Proxy === 'http://127.0.0.1:7789' && Object.keys(h8443).length === 1 && j.TCP?.['8443']?.HTTPS === true ? 'ok' : 'bad',
      funnel ? 'bad' : 'ok',
    ].join(' ');
  })()")"
read -r S_ROOT S_APP S_8443 S_FUNNEL <<< "$SERVE_CHECK"
check "existing Serve mapping :443 / -> http://127.0.0.1:7787 unchanged" test "$S_ROOT" = ok
check "existing Serve mapping :443 /app -> http://127.0.0.1:7788 unchanged" test "$S_APP" = ok
check "Serve maps tailnet HTTPS :8443 -> http://127.0.0.1:7789 (only)" test "$S_8443" = ok
check "Tailscale Funnel is not enabled (tailnet only)" test "$S_FUNNEL" = ok

# ---------------------------------------------------------------------------
section "M1-AC1: live token streaming through the tailnet URL"

MODEL="$(curl -s --max-time 10 "$OLLAMA/api/ps" | json "j.models[0]?.name ?? ''")"
if [[ -n "$MODEL" ]]; then
  info "resident model (from Ollama /api/ps): $MODEL"
else
  MODEL="$(curl -s --max-time 10 "$OLLAMA/api/tags" | json "[...j.models].sort((a, b) => a.size - b.size)[0]?.name ?? ''")"
  info "no model resident in Ollama; loading the smallest installed model directly via Ollama: $MODEL"
  curl -s --max-time 600 -o /dev/null -X POST "$OLLAMA/api/generate" -d "{\"model\":\"$MODEL\"}"
  info "Ollama /api/ps now: $(curl -s --max-time 10 "$OLLAMA/api/ps" | json "j.models.map((m) => m.name).join(', ')")"
fi
if [[ -z "$MODEL" ]]; then
  fail "a model is resident in Ollama"
fi

STREAM1="$WORK/ac1.sse"
curl -sN --max-time 300 -X POST "$TAILNET_URL/v1/chat" -H "@$AUTH" -H "Content-Type: application/json" \
  -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"Count from 1 to 30, separated by spaces. Output only the numbers.\"}]}" \
  | stamp > "$STREAM1"
AC1_STATS="$(awk '
  /event: content/ { n++; t = $1 + 0; if (n == 1) first = t; last = t }
  /event: /        { term = $3 }
  /^ *[0-9.]+ data: / { lastdata = $0 }
  END { printf "%d %.3f %.3f %s\n", n, first, last, term }' "$STREAM1")"
read -r N_CONTENT T_FIRST T_LAST TERMINAL <<< "$AC1_STATS"
LAST_DATA="$(grep ' data: ' "$STREAM1" | tail -1 | sed 's/^ *[0-9.]* data: //')"
info "first 6 SSE events (elapsed seconds, as received over the tailnet):"
grep -E ' (event|data): ' "$STREAM1" | head -12 | sed 's/^/          /'
info "..."
info "last SSE events:"
grep -E ' (event|data): ' "$STREAM1" | tail -4 | sed 's/^/          /'
info "content events: $N_CONTENT, first at ${T_FIRST}s, last at ${T_LAST}s, terminal event: $TERMINAL $LAST_DATA"
check "multiple content (token) events arrived (got $N_CONTENT, need >= 5)" test "${N_CONTENT:-0}" -ge 5
check "tokens arrived over time, not in one burst (spread ${T_FIRST}s..${T_LAST}s)" \
  awk -v a="$T_FIRST" -v b="$T_LAST" 'BEGIN { exit !(b - a >= 0.1) }'
check "stream ended with a terminal done event, status complete" \
  bash -c '[[ "$1" == "done" && "$2" == *"\"status\":\"complete\""* ]]' _ "$TERMINAL" "$LAST_DATA"

# ---------------------------------------------------------------------------
section "M1-AC2: every route rejects missing and wrong tokens (via tailnet)"

ROUTES=(
  "GET /v1/state"
  "POST /v1/models/load"
  "POST /v1/models/unload"
  "POST /v1/chat"
  "GET /v1/generations/00000000-0000-0000-0000-000000000000/events"
  "POST /v1/generations/00000000-0000-0000-0000-000000000000/cancel"
  "GET /v1/no-such-route"
)
for r in "${ROUTES[@]}"; do
  read -r method path <<< "$r"
  none="$(curl -s --max-time 15 -o /dev/null -w '%{http_code}' -X "$method" "$TAILNET_URL$path" -H 'Content-Type: application/json' -d '{}')"
  wrong="$(curl -s --max-time 15 -o /dev/null -w '%{http_code}' -X "$method" "$TAILNET_URL$path" -H "@$BAD_AUTH" -H 'Content-Type: application/json' -d '{}')"
  check "$method $path: no token -> $none, wrong token -> $wrong (expect 401/401)" \
    test "$none:$wrong" = "401:401"
done
ok_state="$(curl -s --max-time 15 -o /dev/null -w '%{http_code}' "$TAILNET_URL/v1/state" -H "@$AUTH")"
check "control: GET /v1/state with the real token -> $ok_state (expect 200)" test "$ok_state" = "200"

info "token command (ops/src/token.ts), run in a private temp dir:"
( cd "$REPO_ROOT/ops" && "$BUN" src/token.ts "$WORK/new-token" > /dev/null 2> "$WORK/tok.err" )
tok_exit=$?
tok_mode="$(stat -f '%Lp' "$WORK/new-token" 2>/dev/null)"
tok_len="$(tr -d '[:space:]' < "$WORK/new-token" 2>/dev/null | wc -c | tr -d ' ')"
check "token command creates a token (exit $tok_exit, mode ${tok_mode:-none}, ${tok_len:-0} chars; value not shown)" \
  test "$tok_exit:$tok_mode:$tok_len" = "0:600:64"
for bad_mode in 644 640 604; do
  f="$WORK/unsafe-$bad_mode"
  printf 'placeholder' > "$f"; chmod "$bad_mode" "$f"
  ( cd "$REPO_ROOT/ops" && "$BUN" src/token.ts "$f" > "$WORK/unsafe.out" 2> "$WORK/unsafe.err" )
  e=$?
  info "mode $bad_mode -> exit $e: $(head -1 "$WORK/unsafe.err")"
  check "token command refuses a mode-$bad_mode token file and leaves it untouched" \
    bash -c '[[ $1 -ne 0 && ! -s $2 && "$(cat "$3")" == placeholder ]]' _ "$e" "$WORK/unsafe.out" "$f"
done

# ---------------------------------------------------------------------------
section "M1-AC3: cancel stops generation in Ollama"

OLLAMA_PID="$(lsof -nP -tiTCP:11434 -sTCP:LISTEN 2>/dev/null | head -1)"
RUNNER_PID="$(pgrep -P "${OLLAMA_PID:-0}" 2>/dev/null | head -1)"
OLLAMA_LOG="$(lsof -a -p "${OLLAMA_PID:-0}" -d 1 -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
[[ -f "$OLLAMA_LOG" ]] || OLLAMA_LOG="$HOME/.ollama/logs/server.log"
LOG_OFFSET="$(stat -f '%z' "$OLLAMA_LOG" 2>/dev/null || echo 0)"
info "Ollama serve pid ${OLLAMA_PID:-?}, runner pid ${RUNNER_PID:-?}, Ollama log $OLLAMA_LOG"

STREAM3="$WORK/ac3.sse"; HDR3="$WORK/ac3.hdr"
curl -sN --max-time 600 -D "$HDR3" -X POST "$TAILNET_URL/v1/chat" -H "@$AUTH" -H "Content-Type: application/json" \
  -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"Write a very long, detailed essay of at least 3000 words on the history of computing, from the abacus to modern GPUs.\"}]}" \
  | stamp > "$STREAM3" &
CURL3=$!
BG_PIDS+=("$CURL3")
for _ in $(seq 1 240); do
  [[ "$(grep -c 'event: content' "$STREAM3")" -ge 20 ]] && break
  sleep 0.5
done
GEN_ID="$(awk 'tolower($1) == "x-generation-id:" { print $2 }' "$HDR3" | tr -d '\r')"
info "long generation started: id $GEN_ID, $(grep -c 'event: content' "$STREAM3") tokens so far"

C1="$(cputime "${RUNNER_PID:-0}")"; sleep 2; C2="$(cputime "${RUNNER_PID:-0}")"
CPU_DURING="$(awk -v a="${C1:-0}" -v b="${C2:-0}" 'BEGIN { printf "%.2f", b - a }')"
BEFORE_CANCEL="$(grep -c 'event: content' "$STREAM3")"
CANCEL_WALL="$(date '+%H:%M:%S')"
CANCEL_BODY="$(curl -s --max-time 15 -X POST "$TAILNET_URL/v1/generations/$GEN_ID/cancel" -H "@$AUTH")"
info "cancel sent at $CANCEL_WALL via tailnet after $BEFORE_CANCEL tokens; response: $CANCEL_BODY"
for _ in $(seq 1 60); do kill -0 "$CURL3" 2>/dev/null || break; sleep 0.5; done
STREAM_ENDED=no; kill -0 "$CURL3" 2>/dev/null || STREAM_ENDED=yes
TOTAL="$(grep -c 'event: content' "$STREAM3")"
TERM3="$(grep ' event: ' "$STREAM3" | tail -1 | awk '{ print $3 }')"
TERM3_DATA="$(grep ' data: ' "$STREAM3" | tail -1 | sed 's/^ *[0-9.]* data: //')"
SIZE1="$(stat -f '%z' "$STREAM3")"; sleep 3; SIZE2="$(stat -f '%z' "$STREAM3")"
C3="$(cputime "${RUNNER_PID:-0}")"; sleep 2; C4="$(cputime "${RUNNER_PID:-0}")"
CPU_AFTER="$(awk -v a="${C3:-0}" -v b="${C4:-0}" 'BEGIN { printf "%.2f", b - a }')"
STATE_GEN="$(curl -s --max-time 15 "$TAILNET_URL/v1/state" -H "@$AUTH" | json "j.generation === null ? 'null' : JSON.stringify(j.generation)")"
REPLAY_TERM="$(curl -s --max-time 15 "$TAILNET_URL/v1/generations/$GEN_ID/events" -H "@$AUTH" | grep '^data: ' | tail -1)"
OLLAMA_LINES="$(tail -c +"$((LOG_OFFSET + 1))" "$OLLAMA_LOG" 2>/dev/null | grep -aE '"/api/chat"|cancel|abort' | tail -5)"

info "stream: $TOTAL content events total ($((TOTAL - BEFORE_CANCEL)) in flight after cancel), terminal: $TERM3 $TERM3_DATA"
info "server event log replay, last event: $REPLAY_TERM"
info "Ollama runner CPU seconds per 2s window: while generating $CPU_DURING, after cancel $CPU_AFTER"
info "Ollama's own log since this test started:"
printf '%s\n' "${OLLAMA_LINES:-<none>}" | sed 's/^/          /'
check "cancel endpoint answered {\"status\":\"cancelled\"}" test "$CANCEL_BODY" = '{"status":"cancelled"}'
check "the SSE stream ended by itself after cancel" test "$STREAM_ENDED" = yes
check "terminal event is done with status cancelled" \
  bash -c '[[ "$1" == "done" && "$2" == *"\"status\":\"cancelled\""* ]]' _ "$TERM3" "$TERM3_DATA"
check "no further bytes arrived after the terminal event ($SIZE1 -> $SIZE2 bytes over 3s)" test "$SIZE1" = "$SIZE2"
check "server reports no active generation afterwards (generation: $STATE_GEN)" test "$STATE_GEN" = null
check "Ollama logged the /api/chat request as finished after the cancel (connection closed)" \
  bash -c 'grep -q "\"/api/chat\"" <<< "$1"' _ "$OLLAMA_LINES"
check "Ollama runner went idle: CPU after cancel ($CPU_AFTER s) < half of CPU while generating ($CPU_DURING s)" \
  awk -v d="$CPU_DURING" -v a="$CPU_AFTER" 'BEGIN { exit !(d > 0 && a < d / 2) }'

# ---------------------------------------------------------------------------
section "M1-AC4: network exposure"

LISTEN_7789="$(lsof -nP -iTCP:7789 -sTCP:LISTEN 2>/dev/null | awk 'NR > 1 { print $9 }' | sort -u | tr '\n' ' ')"
info "listeners on port 7789: ${LISTEN_7789:-none}"
check "server listens on 127.0.0.1:7789 only" test "$LISTEN_7789" = "127.0.0.1:7789 "
tail_state="$(curl -s --max-time 15 -o /dev/null -w '%{http_code} via %{remote_ip}' "$TAILNET_URL/v1/state" -H "@$AUTH")"
check "server reachable through the tailnet URL ($tail_state)" bash -c '[[ "$1" == 200* ]]' _ "$tail_state"

LAN_IF="$(route -n get default 2>/dev/null | awk '/interface:/ { print $2 }')"
LAN_IP="$(ipconfig getifaddr "${LAN_IF:-en0}" 2>/dev/null)"
TS_IP="$("$TAILSCALE" ip -4 2>/dev/null | head -1)"
TS_IF="$(ifconfig 2>/dev/null | awk -v ip="$TS_IP" '/^[a-z]/ { sub(":", "", $1); ifc = $1 } $1 == "inet" && $2 == ip { print ifc }')"
info "LAN interface ${LAN_IF:-?} address ${LAN_IP:-?}; tailnet interface ${TS_IF:-?} address ${TS_IP:-?}"
if [[ -z "$LAN_IP" ]]; then
  fail "found the Mac's LAN IP"
else
  for port in 7789 8443; do
    curl -s --max-time 5 -o /dev/null "http://$LAN_IP:$port/"; e=$?
    check "LAN $LAN_IP:$port refuses connections (curl exit $e; 7 = refused)" test "$e" = 7
  done
fi

MANIFEST="$WORK/manifest.json"
m_code="$(curl -s --max-time 120 -o "$MANIFEST" -w '%{http_code} %{content_type}' -H 'expo-platform: ios' \
  -H 'Accept: application/expo+json,application/json' "$BUNDLE_URL/")"
LAUNCH_URL="$(json "j.launchAsset?.url ?? ''" < "$MANIFEST" 2>/dev/null)"
info "bundle manifest: $m_code; launchAsset: $LAUNCH_URL"
check "bundle host on 8081 serves the Expo manifest via the tailnet name" bash -c '[[ "$1" == "200 application/expo+json"* ]]' _ "$m_code"
check "manifest points the phone at the tailnet name, production bundle (dev=false, minify=true)" \
  bash -c '[[ "$1" == "http://'"$TAILNET_NAME"':8081/"* && "$1" == *dev=false* && "$1" == *minify=true* ]]' _ "$LAUNCH_URL"

# Verify the pf anchor is working via LaunchDaemon and iface file checks
check "pf anchor LaunchDaemon is loaded and healthy (last exit code = 0)" \
  bash -c 'launchctl print system/com.harness.pf-bundle-host 2>/dev/null | grep -q "last exit code = 0"'

IFACE_FILE_CONTENT="$(cat /var/run/com.harness.pf-bundle-host.iface 2>/dev/null)"
check "pf anchor loaded for the current Tailscale interface ($IFACE_FILE_CONTENT == $TS_IF)" \
  test "$IFACE_FILE_CONTENT" = "$TS_IF"

if [[ -n "$LAN_IP" ]]; then
  LAN_ROUTE="$(route -n get "$LAN_IP" 2>/dev/null | awk '/interface:/ { print $2 }')"
  info "Mac-local probe of LAN IP $LAN_IP goes over interface $LAN_ROUTE (lo0 is passed by the pf anchor; cannot test the actual LAN path)"
fi

# ---------------------------------------------------------------------------
section "Result"
if [[ $FAILURES -eq 0 ]]; then
  echo "  ALL AUTOMATED CHECKS PASSED"
else
  echo "  $FAILURES AUTOMATED CHECK(S) FAILED"
fi

cat <<EOF

==== REMAINING FOR THE HUMAN (cannot be proven from the Mac) ====
1. On the iPhone (on the tailnet), open Expo Go and enter: exp://$TAILNET_NAME:8081
   - the app loads (production bundle, no dev menu);
   - in Settings, paste the bearer token (on the Mac: pbcopy < ~/.phone-models/token,
     or read it with: cat ~/.phone-models/token) and save;
   - send a prompt: the reply renders token by token, not all at once;
   - send a long prompt and tap Stop: output halts within a moment and does not resume.
2. From a device on the same Wi-Fi but NOT on the tailnet (or the phone with Tailscale off):
   - $TAILNET_URL/v1/state does not resolve/connect;
   - http://${LAN_IP:-<mac-lan-ip>}:7789 and :8443 refuse;
   - http://${LAN_IP:-<mac-lan-ip>}:8081 must not load.
EOF

exit $((FAILURES > 0 ? 1 : 0))
