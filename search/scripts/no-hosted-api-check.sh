#!/bin/bash
# Check for AC18 / M13-AC3: no hosted search or fetch API or key is configured or called.
#
# Part A: code/config inspection. Scans tracked source and config (git ls-files, minus .harness/ and
#         node_modules, minus this script which necessarily lists the patterns), the installed
#         project LaunchAgent plists, and the process environment of the running server, search
#         service and Ollama, for hosted search/fetch API hostnames, SDK package names and key
#         variable names. Any hit FAILs with file:line (env hits print the variable name only, never a
#         value). A built-in self-test shows the scan is not vacuous (a planted api.tavily.com is caught).
# Part B: outbound check during a live web reply. Starts its OWN search service and server on
#         dedicated ports (default 7795/7796; never touches 7790/7789 or the LaunchAgents), sends
#         a real web-enabled chat that searches and reads a page, and samples TCP connections (lsof)
#         of the server, the search service and all its descendants (helper, Chromium), and Ollama.
#         Asserts: server talks to loopback only; Ollama never connects to ollama.com's addresses;
#         nothing connects to the resolved addresses of any hosted API hostname; and at least one
#         search-service-tree sample was non-loopback (else INCONCLUSIVE = FAIL).
#
# Needs: bun, curl, jq, python3, lsof, pgrep; Ollama with a tools-capable resident model; the search
# helper venv (see ops/scripts/install-search-helper.sh). Never sudo. Exit 0 only if all parts pass.

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SELF_REL="search/scripts/no-hosted-api-check.sh"
BUN="${BUN:-$(command -v bun || echo /opt/homebrew/bin/bun)}"
OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
SEARCH_PORT="${NO_HOSTED_SEARCH_PORT:-7795}"
SERVER_PORT="${NO_HOSTED_SERVER_PORT:-7796}"
MAX_ATTEMPTS=3
CHAT_TIMEOUT=420

FAILURES=0
pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
info() { printf '      %s\n' "$1"; }
section() { printf '\n==== %s ====\n' "$1"; }

WORK="$(mktemp -d)"
PIDS=()
cleanup() {
  local p port left
  for p in "${PIDS[@]:-}"; do [[ -n "$p" ]] && kill "$p" 2>/dev/null; done
  for p in "${PIDS[@]:-}"; do [[ -n "$p" ]] && wait "$p" 2>/dev/null; done
  for port in "$SEARCH_PORT" "$SERVER_PORT"; do
    left="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
    [[ -n "$left" ]] && kill $left 2>/dev/null
  done
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

# Hosted search/fetch API patterns (extended regex, case-insensitive).
PATTERN='tavily|exa\.ai|exa-js|exa_py|parallel\.ai|serpapi|search\.brave\.com|bing\.microsoft\.com|customsearch|jina\.ai|firecrawl|ollama\.com/api/web_(search|fetch)|OLLAMA_API_KEY|[A-Za-z0-9_]*_API_KEY|SEARCH_API'
# Hostnames to resolve for the Part B address check.
HOSTS=(api.tavily.com tavily.com api.exa.ai exa.ai api.parallel.ai serpapi.com api.search.brave.com
  api.bing.microsoft.com www.googleapis.com customsearch.googleapis.com r.jina.ai s.jina.ai api.firecrawl.dev
  ollama.com)

# scan_files <file>...: prints "file:line:match" for each hit; returns 0 if there were hits.
scan_files() {
  local out
  out="$(grep -nHoEi "$PATTERN" "$@" 2>/dev/null)"
  [[ -n "$out" ]] && { printf '%s\n' "$out"; return 0; }
  return 1
}
# scan_env <label> <pid>: prints matched names/hosts in the process environment (never values).
scan_env() {
  local out
  out="$(ps eww -p "$2" 2>/dev/null | tr ' ' '\n' | grep -Eio "$PATTERN" | sort -u)"
  [[ -n "$out" ]] && { printf '%s\n' "$out" | sed "s|^|$1 (pid $2) env: |"; return 0; }
  return 1
}

section "Part A: code and config inspection"
cd "$REPO_ROOT" || exit 1

# Self-test: the scan must catch a planted hit and stay quiet on a clean file.
printf 'const u = "https://api.tavily.com/search";\n' > "$WORK/planted.ts"
printf 'const u = "http://127.0.0.1:7790/v1/search";\n' > "$WORK/clean.ts"
planted="$(scan_files "$WORK/planted.ts")" && planted_hit=1 || planted_hit=0
scan_files "$WORK/clean.ts" >/dev/null && clean_hit=1 || clean_hit=0
echo "self-test: scan of a temp file containing api.tavily.com reports:"
printf '%s\n' "$planted" | sed 's|^|      |'
if [[ $planted_hit -eq 1 && $clean_hit -eq 0 ]]; then
  pass "self-test: scan flags the planted api.tavily.com hit with file:line (Part A would FAIL on it) and ignores a clean file"
else
  fail "self-test: scan is vacuous (planted hit=$planted_hit, clean file hit=$clean_hit)"
fi

# Tracked source and config.
FILES=()
while IFS= read -r f; do
  [[ -f "$f" ]] && FILES+=("$f")
done < <(git ls-files | grep -v -e '^\.harness/' -e '(^|/)node_modules/' -e "^$SELF_REL\$")
info "scanning ${#FILES[@]} tracked files (excluding .harness/, node_modules, $SELF_REL)"
[[ ${#FILES[@]} -gt 100 ]] || fail "file list suspiciously small (${#FILES[@]}); scan would be vacuous"
hits="$(scan_files "${FILES[@]}")" && { fail "tracked files contain hosted-API references:"; printf '%s\n' "$hits" | sed 's|^|      |'; } \
  || pass "tracked source and config: no hosted search/fetch API hostnames, SDK names or key variables"

# LaunchAgent plists (installed copies; the tracked sources are covered above).
PLISTS=()
for f in "$HOME"/Library/LaunchAgents/com.harness.*.plist; do [[ -f "$f" ]] && PLISTS+=("$f"); done
info "LaunchAgent plists scanned: ${PLISTS[*]:-none installed}"
if [[ ${#PLISTS[@]} -gt 0 ]]; then
  hits="$(scan_files "${PLISTS[@]}")" && { fail "LaunchAgent plists contain hosted-API references:"; printf '%s\n' "$hits" | sed 's|^|      |'; } \
    || pass "installed LaunchAgent plists: no hosted-API references"
fi

# Environment of running processes (LaunchAgent server/search listeners, Ollama).
ENV_PIDS=()
for port in 7789 7790; do
  p="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1)"
  [[ -n "$p" ]] && ENV_PIDS+=("port$port:$p")
done
for p in $(pgrep -x ollama 2>/dev/null); do ENV_PIDS+=("ollama:$p"); done
env_hits=""
for e in "${ENV_PIDS[@]:-}"; do
  [[ -z "$e" ]] && continue
  h="$(scan_env "${e%%:*}" "${e##*:}")" && env_hits="$env_hits$h"$'\n'
done
info "process environments inspected: ${ENV_PIDS[*]:-none running}"
if [[ -n "$env_hits" ]]; then fail "process environment has hosted-API references:"; printf '%s' "$env_hits" | sed 's|^|      |'
else pass "running server/search/ollama process environments: no hosted-API hostnames or key variables"; fi

[[ $FAILURES -eq 0 ]] && echo "PART A: PASS" || echo "PART A: FAIL"

# ---------------------------------------------------------------------------------------------
section "Part B: outbound connections during a live web reply"
for c in "$BUN" curl jq python3 lsof; do command -v "$c" >/dev/null || { fail "$c not available"; echo "PART B: FAIL"; exit 1; }; done
PB_FAILS_BEFORE=$FAILURES

# Resolve hosted API hostnames (hostnames that do not resolve are skipped and printed).
: > "$WORK/hosted_ips"; : > "$WORK/ollama_com_ips"
for h in "${HOSTS[@]}"; do
  ips="$(python3 -c '
import socket,sys
try:
    print(" ".join(sorted({a[4][0] for a in socket.getaddrinfo(sys.argv[1], 443, proto=socket.IPPROTO_TCP)})))
except Exception:
    pass' "$h")"
  if [[ -z "$ips" ]]; then info "SKIPPED (does not resolve): $h"; continue; fi
  info "resolved $h -> $ips"
  for ip in $ips; do printf '%s %s\n' "$ip" "$h" >> "$WORK/hosted_ips"; [[ "$h" == ollama.com ]] && echo "$ip" >> "$WORK/ollama_com_ips"; done
done
sort -u -o "$WORK/hosted_ips" "$WORK/hosted_ips"
info "hosted-API address set size: $(wc -l < "$WORK/hosted_ips" | tr -d ' ')"

curl -s -o /dev/null --max-time 5 "$OLLAMA_URL/api/tags" || { fail "Ollama not reachable at $OLLAMA_URL"; echo "PART B: FAIL"; exit 1; }
for port in "$SEARCH_PORT" "$SERVER_PORT"; do
  [[ -z "$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null)" ]] || { fail "port $port is already in use"; echo "PART B: FAIL"; exit 1; }
done

MODEL="$(curl -s --max-time 10 "$OLLAMA_URL/api/ps" | jq -r '.models[0].name // empty')"
[[ -n "$MODEL" ]] || { fail "no model is resident in Ollama; load one first (this check will not load or switch models)"; echo "PART B: FAIL"; exit 1; }
info "resident model: $MODEL"

# Dedicated search service.
(cd "$REPO_ROOT/search" && exec env -i HOME="$HOME" PATH="/usr/bin:/bin:/opt/homebrew/bin" SEARCH_PORT="$SEARCH_PORT" \
  "$BUN" run src/index.ts >"$WORK/search.log" 2>&1) &
SEARCH_PID=$!; PIDS+=("$SEARCH_PID")
h="$(curl -s --max-time 5 --retry 60 --retry-delay 1 --retry-connrefused --retry-all-errors -o /dev/null -w '%{http_code}' "http://127.0.0.1:$SEARCH_PORT/v1/health" 2>/dev/null)"
[[ "$h" == 200 ]] || { fail "own search service health returned '$h'"; cat "$WORK/search.log"; echo "PART B: FAIL"; exit 1; }
info "own search service pid $SEARCH_PID on 127.0.0.1:$SEARCH_PORT"

# Dedicated server with a throwaway token.
TOKEN_FILE="$WORK/token"
( umask 077; "$BUN" -e 'console.log(crypto.randomUUID() + crypto.randomUUID())' > "$TOKEN_FILE" )
AUTH_HEADER_FILE="$WORK/auth"
( umask 077; printf 'Authorization: Bearer %s\n' "$(tr -d '[:space:]' < "$TOKEN_FILE")" > "$AUTH_HEADER_FILE" )
(cd "$REPO_ROOT/server" && PHONE_MODELS_PORT="$SERVER_PORT" PHONE_MODELS_TOKEN_FILE="$TOKEN_FILE" \
  PHONE_MODELS_OLLAMA_URL="$OLLAMA_URL" PHONE_MODELS_SEARCH_URL="http://127.0.0.1:$SEARCH_PORT" \
  exec "$BUN" src/index.ts >"$WORK/server.log" 2>&1) &
SERVER_PID=$!; PIDS+=("$SERVER_PID")
SERVER_URL="http://127.0.0.1:$SERVER_PORT"
up=0
for _ in $(seq 1 60); do
  [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$SERVER_URL/v1/state" -H "@$AUTH_HEADER_FILE")" == 200 ]] && { up=1; break; }
  "$BUN" -e 'await new Promise((r) => setTimeout(r, 500))'
done
[[ "$up" == 1 ]] || { fail "own server did not come up on $SERVER_PORT"; cat "$WORK/server.log"; echo "PART B: FAIL"; exit 1; }
info "own server pid $SERVER_PID on $SERVER_URL"

# The processes we are about to exercise must be clean in their environment too.
for e in "own-search:$SEARCH_PID" "own-server:$SERVER_PID"; do
  scan_env "${e%%:*}" "${e##*:}" && fail "${e%%:*} environment has hosted-API references"
done

# --- sampler ---------------------------------------------------------------------------------
descendants() {  # all descendant pids of $1 (not including it)
  ps -axo pid=,ppid= | awk -v root="$1" '{p[$1]=$2; n[NR]=$1} END{ s[root]=1; ch=1; while(ch){ch=0; for(i=1;i<=NR;i++){k=n[i]; if(!(k in s) && (p[k] in s)){s[k]=1; ch=1; print k}}}}'
}
sampler() {  # appends "role pid comm remote" lines to $WORK/samples until $WORK/stop exists
  local role list pids
  while [[ ! -e "$WORK/stop" ]]; do
    for role in server search ollama; do
      case $role in
        server) pids="$SERVER_PID" ;;
        search) pids="$SEARCH_PID $(descendants "$SEARCH_PID" | tr '\n' ' ')" ;;
        ollama) pids="$(pgrep -x ollama; pgrep -x llama-server; pgrep -f 'ollama runner')"; pids="$(printf '%s\n' $pids | sort -u | tr '\n' ' ')" ;;
      esac
      list="$(printf '%s' "$pids" | tr -s ' \n' ',,' | sed -e 's/^,//' -e 's/,$//')"
      [[ -z "$list" ]] && continue
      lsof -nP -iTCP -a -p "$list" 2>/dev/null | awk -v role="$role" 'NR>1 && /->/ { n=$(NF-1); if ($NF !~ /^\(/) n=$NF; sub(/^.*->/, "", n); print role, $2, $1, n }' >> "$WORK/samples"
    done
    "$BUN" -e 'await new Promise((r) => setTimeout(r, 100))'
  done
}
: > "$WORK/samples"
sampler & SAMPLER_PID=$!; PIDS+=("$SAMPLER_PID")

# --- the live web reply ----------------------------------------------------------------------
PROMPTS=(
  "You MUST use the web_search tool to find the official Python documentation page for the 'argparse' module, then you MUST use the read_page tool on the top result's URL, then answer in one sentence citing the URL."
  "Use web_search for 'Bun JavaScript runtime latest release', then use read_page to open the first result and tell me in one sentence what it says. Do not answer from memory."
  "Search the web for 'Wikipedia Tailscale' and then read_page the Wikipedia article URL, then summarise it in one sentence."
)
CONCLUSIVE=0
for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  echo "--- reply attempt $attempt of $MAX_ATTEMPTS ---"
  SSE="$WORK/a$attempt.sse"
  body="$(jq -n --arg m "$MODEL" --arg p "${PROMPTS[$(( (attempt - 1) % ${#PROMPTS[@]} ))]}" '{model:$m,messages:[{role:"user",content:$p}],web:true}')"
  curl -sN --max-time "$CHAT_TIMEOUT" -X POST "$SERVER_URL/v1/chat" -H "@$AUTH_HEADER_FILE" -H "Content-Type: application/json" -d "$body" > "$SSE" 2>/dev/null
  n_search="$(grep -c '"kind":"search","status":"done"' "$SSE")"
  n_read="$(grep -c '"kind":"read","status":"done"' "$SSE")"
  status="$(awk '/^event: /{ev=$2} /^data: /{ if (ev=="done") d=substr($0,7) } END{print d}' "$SSE" | jq -r '.status // empty' 2>/dev/null)"
  info "done status: ${status:-none}; completed search steps: $n_search; completed read steps: $n_read"
  if [[ "$n_search" -ge 1 && "$n_read" -ge 1 && "$status" == "complete" ]]; then CONCLUSIVE=1; break; fi
  info "reply did not both search and read a page and complete; retrying"
done
touch "$WORK/stop"; wait "$SAMPLER_PID" 2>/dev/null

# --- evaluate --------------------------------------------------------------------------------
section "Part B: results"
info "reply with search + read_page completed: $([[ $CONCLUSIVE -eq 1 ]] && echo yes || echo NO)"
info "samples collected: $(wc -l < "$WORK/samples" | tr -d ' ') connection observations"
# Split remote into address (strip :port, brackets) and classify.
awk '{ r=$4; sub(/:[0-9]+$/, "", r); gsub(/[\[\]]/, "", r); lo = (r ~ /^127\./ || r == "::1" || r ~ /^::ffff:127\./) ? "loopback" : "remote"; print $1, $2, $3, r, lo }' "$WORK/samples" | sort -u > "$WORK/classified"
echo "observed remote addresses (count role comm address class), distinct pids collapsed:"
awk '{print $1, $3, $4, $5}' "$WORK/classified" | sort | uniq -c | sed 's|^|      |'
nonloop_set="$(awk '$5=="remote"{print $4}' "$WORK/classified" | sort -u | tr '\n' ' ')"
info "observed NON-loopback remote set: ${nonloop_set:-none}"

[[ $CONCLUSIVE -eq 1 ]] || fail "inconclusive: no completed reply that both searched and read a page"
srv_n="$(awk '$1=="server"' "$WORK/classified" | wc -l | tr -d ' ')"
srv_remote="$(awk '$1=="server" && $5=="remote"' "$WORK/classified")"
if [[ "$srv_n" -eq 0 ]]; then fail "(1) inconclusive: no server connection was ever sampled"
elif [[ -n "$srv_remote" ]]; then fail "(1) server process connected to non-loopback: $srv_remote"
else pass "(1) server process: $srv_n distinct sampled connections, all loopback"; fi

oll_hit="$(awk 'NR==FNR{o[$1]=1; next} $1=="ollama" && ($4 in o)' "$WORK/ollama_com_ips" "$WORK/classified")"
oll_n="$(awk '$1=="ollama"' "$WORK/classified" | wc -l | tr -d ' ')"
if [[ -n "$oll_hit" ]]; then fail "(2) Ollama connected to an ollama.com address: $oll_hit"
else pass "(2) Ollama process: $oll_n distinct sampled connections, none to ollama.com addresses ($(tr '\n' ' ' < "$WORK/ollama_com_ips"))"; fi

all_hit="$(awk 'NR==FNR{h[$1]=$2; next} ($4 in h){print $1, $3, $4, "=", h[$4]}' "$WORK/hosted_ips" "$WORK/classified")"
if [[ -n "$all_hit" ]]; then fail "(3) connection to a hosted API address: $all_hit"
else pass "(3) no sampled connection from server/search tree/Ollama to any resolved hosted-API address"; fi

search_remote="$(awk '$1=="search" && $5=="remote"' "$WORK/classified")"
if [[ -n "$search_remote" ]]; then pass "sampling observed search-service-tree outbound traffic (non-loopback): $(awk '{print $3"->"$4}' <<< "$search_remote" | sort -u | tr '\n' ' ')"
else fail "inconclusive: no sample showed the search service/helper/Chromium connecting to a non-loopback address"; fi

[[ $FAILURES -eq $PB_FAILS_BEFORE ]] && echo "PART B: PASS" || echo "PART B: FAIL"
echo
if [[ $FAILURES -eq 0 ]]; then echo "ALL PARTS PASS"; exit 0; fi
echo "FAILURES: $FAILURES"; exit 1
