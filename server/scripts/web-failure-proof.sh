#!/bin/bash
# Live proof for M13 (FR24, AC16, M13-AC1, M13-AC2): a real web reply still completes when
# (1) both search backends are forced to fail, and (2) a search exceeds its time limit.
# Uses the real server code (own instance), a real search service (own instance) and real Ollama.
#
# Check 1: search service started with SEARCH_HELPER_FORCE_DDGS=fail SEARCH_HELPER_FORCE_BROWSER=fail
#          -> expect step kind=search status=unavailable, non-empty content, done status=complete.
# Check 2: search service started with SEARCH_TIMEOUT_MS=8000 SEARCH_HELPER_FORCE_DDGS=fail
#          SEARCH_HELPER_FORCE_BROWSER=hang (hooks from search/scripts/failure-proof.sh) -> the search
#          service answers 504 {"error":"timeout"} after 8 s -> expect step status=failed detail=timeout,
#          non-empty content, done status=complete, bounded time, no new helper process left.
#
# Own ports are picked free at random (never 7790-7796); stops only what it starts; never touches the
# LaunchAgents. Uses the model already resident in Ollama (never loads or switches models).
# Output also goes to .harness/evidence/M13-T3-proof.log.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$SERVER_DIR")"
SEARCH_DIR="$REPO_ROOT/search"
EVIDENCE_DIR="$REPO_ROOT/.harness/evidence"
BUN="${BUN:-$(command -v bun || echo /opt/homebrew/bin/bun)}"
OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
MAX_ATTEMPTS=4
SEARCH_LIMIT_MS=8000
REPLY_BOUND_S=240

mkdir -p "$EVIDENCE_DIR"
exec > >(tee "$EVIDENCE_DIR/M13-T3-proof.log") 2>&1

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
FAILURES=0
pass() { echo -e "${GREEN}PASS${NC}: $1"; }
fail() { echo -e "${RED}FAIL${NC}: $1"; FAILURES=$((FAILURES + 1)); }
die() { echo -e "${RED}FAIL${NC}: $1"; exit 1; }

WORK_DIR="$(mktemp -d)"
SEARCH_PID=""; SERVER_PID=""
stop_pid() { [[ -n "$1" ]] && { kill "$1" 2>/dev/null; wait "$1" 2>/dev/null; }; }
stop_stack() { stop_pid "$SERVER_PID"; stop_pid "$SEARCH_PID"; SERVER_PID=""; SEARCH_PID=""; }
nap() { python3 -c 'import time,sys; time.sleep(float(sys.argv[1]))' "$1"; }
cleanup() { stop_stack; rm -rf "$WORK_DIR"; nap 1; }
trap cleanup EXIT INT TERM

spare_port() {
  "$BUN" -e 'const s = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => new Response("")}); console.log(s.port); s.stop(true);'
}
helper_pids() { pgrep -f 'helper/search.py' 2>/dev/null | sort -n | tr '\n' ' '; }
new_pids() { comm -13 <(printf '%s\n' $1 | sort) <(printf '%s\n' $2 | sort) | grep -v '^$' | tr '\n' ' '; }

# ---- Preflight --------------------------------------------------------------
echo "=== Web Failure Live Proof (M13-T3) ==="
[[ -x "$BUN" ]] || die "bun not available"
command -v python3 >/dev/null || die "python3 not available"
command -v jq >/dev/null || die "jq not available"
curl -s -o /dev/null --max-time 5 "$OLLAMA_URL/api/tags" || die "Ollama not reachable at $OLLAMA_URL"
MODEL=$(curl -s --max-time 10 "$OLLAMA_URL/api/ps" | "$BUN" -e '
  const ps = JSON.parse(await Bun.stdin.text());
  for (const m of ps.models ?? []) {
    const r = await fetch("http://127.0.0.1:11434/api/show", {method:"POST", body: JSON.stringify({model: m.name})});
    const j = await r.json();
    if ((j.capabilities ?? []).includes("tools")) { console.log(m.name); break; }
  }') || MODEL=""
[[ -n "$MODEL" ]] || die "no tools-capable model is loaded in Ollama; load one first (this proof will not load or switch models)"
echo "Resident model with tools: $MODEL"

TOKEN_FILE="$WORK_DIR/token"
( umask 077; "$BUN" -e 'console.log(crypto.randomUUID() + crypto.randomUUID())' > "$TOKEN_FILE" )
AUTH_HEADER_FILE="$WORK_DIR/auth"
( umask 077; printf 'Authorization: Bearer %s\n' "$(tr -d '[:space:]' < "$TOKEN_FILE")" > "$AUTH_HEADER_FILE" )

# start_stack <label> [ENV=VAL ...]: own search service (with the env) + own server pointed at it.
start_stack() {
  local label="$1"; shift
  local sport; sport=$(spare_port)
  SERVER_PORT=$(spare_port)
  (cd "$SEARCH_DIR" && exec env -i HOME="$HOME" PATH="/usr/bin:/bin:/opt/homebrew/bin" SEARCH_PORT="$sport" "$@" \
    "$BUN" run src/index.ts > "$WORK_DIR/search-$label.log" 2>&1) & SEARCH_PID=$!
  local h
  h=$(curl -s --max-time 5 --retry 60 --retry-delay 1 --retry-connrefused --retry-all-errors -o /dev/null -w '%{http_code}' "http://127.0.0.1:$sport/v1/health" 2>/dev/null || true)
  [[ "$h" == 200 ]] || { cat "$WORK_DIR/search-$label.log"; die "[$label] own search service on $sport not healthy ($h)"; }
  (cd "$SERVER_DIR" && PHONE_MODELS_PORT="$SERVER_PORT" PHONE_MODELS_TOKEN_FILE="$TOKEN_FILE" \
    PHONE_MODELS_OLLAMA_URL="$OLLAMA_URL" PHONE_MODELS_SEARCH_URL="http://127.0.0.1:$sport" \
    exec "$BUN" src/index.ts > "$WORK_DIR/server-$label.log" 2>&1) & SERVER_PID=$!
  local up=0 c
  for _ in $(seq 1 60); do
    c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$SERVER_PORT/v1/state" -H "@$AUTH_HEADER_FILE") || c=000
    [[ "$c" == 200 ]] && { up=1; break; }
    nap 1
  done
  [[ "$up" == 1 ]] || { cat "$WORK_DIR/server-$label.log"; die "[$label] own server did not come up on $SERVER_PORT"; }
  echo "[$label] own search service on port $sport, own server on port $SERVER_PORT"
}

# run_chat <prompt> <outfile>: streams /v1/chat, writes a JSON summary of the events to <outfile>.
run_chat() {
  python3 - "http://127.0.0.1:$SERVER_PORT/v1/chat" "$AUTH_HEADER_FILE" "$MODEL" "$1" "$REPLY_BOUND_S" > "$2" <<'PY'
import sys, json, time, urllib.request
url, hdrfile, model, prompt, bound = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], float(sys.argv[5])
auth = open(hdrfile).read().split(":", 1)[1].strip()
body = json.dumps({"model": model, "messages": [{"role": "user", "content": prompt}], "web": True}).encode()
req = urllib.request.Request(url, data=body, headers={"Authorization": auth, "Content-Type": "application/json"})
t0 = time.time()
steps, content, done, errors = [], "", None, []
try:
    with urllib.request.urlopen(req, timeout=bound) as r:
        ev = None
        for raw in r:
            line = raw.decode().rstrip("\n")
            if line.startswith("event: "):
                ev = line[7:]
            elif line.startswith("data: "):
                d = json.loads(line[6:])
                t = round(time.time() - t0, 1)
                if ev == "step": steps.append(dict(d, t=t))
                elif ev == "content": content += d.get("text", "")
                elif ev == "done": done = dict(d, t=t)
                elif ev == "error": errors.append(d)
            if time.time() - t0 > bound: break
except Exception as e:
    errors.append({"client": str(e)})
print(json.dumps({"steps": steps, "content": content, "done": done, "errors": errors,
                  "elapsed": round(time.time() - t0, 1)}))
PY
}

PROMPTS=(
  "You MUST call the web_search tool now (do not answer from memory) to find today's top news headlines. If the tool says search failed or was unavailable, say so in your answer. Then answer in one or two sentences."
  "Call the web_search tool with the query 'latest stable release of the Bun JavaScript runtime', then answer in one or two sentences. Do not answer without using the tool; if it fails, tell me it failed."
  "Search the web for today's weather news in London and summarise it in a sentence. If the search fails, say that it failed."
  "Use the web_search tool for 'current time in Tokyo' and then reply with one sentence. If the search fails, say so."
)

# check <label> <want_status> <want_detail or ""> <reply-bound-seconds>
check() {
  local label="$1" want_status="$2" want_detail="$3" bound="$4"
  local before; before=$(helper_pids)
  local ok=0 attempt out
  for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
    out="$WORK_DIR/$label-$attempt.json"
    echo "--- [$label] attempt $attempt of $MAX_ATTEMPTS ---"
    run_chat "${PROMPTS[$(( (attempt - 1) % ${#PROMPTS[@]} ))]}" "$out"
    if jq -e '[.steps[] | select(.kind=="search" and .status!="started")] | length > 0' "$out" >/dev/null 2>&1; then ok=1; break; fi
    echo "INCONCLUSIVE: the model did not search this attempt; summary: $(jq -c '{steps,done,errors,elapsed}' "$out" 2>/dev/null)"
  done
  [[ "$ok" == 1 ]] || { fail "[$label] the model never called web_search in $MAX_ATTEMPTS attempts (inconclusive)"; return; }
  echo "[$label] model searched on attempt $attempt; steps: $(jq -c '.steps' "$out")"
  echo "[$label] answer (first 200 chars): $(jq -r '.content' "$out" | head -c 200 | tr '\n' ' ')"
  echo "[$label] done: $(jq -c '.done' "$out") ; reply elapsed $(jq -r '.elapsed' "$out") s"

  if jq -e --arg s "$want_status" --arg d "$want_detail" \
      '[.steps[] | select(.kind=="search" and .status==$s and ($d=="" or .detail==$d))] | length > 0' "$out" >/dev/null; then
    pass "[$label] stream has a search step with status=$want_status${want_detail:+ detail=$want_detail}"
  else
    fail "[$label] expected a search step with status=$want_status${want_detail:+ detail=$want_detail}"
  fi
  if jq -e '(.content | gsub("\\s";"") | length) > 0' "$out" >/dev/null; then
    pass "[$label] the reply then streamed non-empty answer content"
  else
    fail "[$label] no answer content streamed"
  fi
  if jq -e '.done.status == "complete" and (.errors | length) == 0' "$out" >/dev/null; then
    pass "[$label] ended done status=complete (not error, not cancelled)"
  else
    fail "[$label] did not end done/complete: $(jq -c '{done,errors}' "$out")"
  fi
  local step_t; step_t=$(jq -r '[.steps[] | select(.kind=="search" and .status!="started")][0].t' "$out")
  if python3 -c 'import sys; sys.exit(0 if float(sys.argv[1]) < float(sys.argv[2]) else 1)' "$(jq -r '.elapsed' "$out")" "$bound"; then
    pass "[$label] reply completed in $(jq -r '.elapsed' "$out") s, under the ${bound} s bound (search step reported at ${step_t} s)"
  else
    fail "[$label] reply took $(jq -r '.elapsed' "$out") s, over the ${bound} s bound"
  fi
  nap 1
  local left; left=$(new_pids "$before" "$(helper_pids)")
  if [[ -z "${left// /}" ]]; then
    pass "[$label] no new search helper process left running afterwards"
  else
    fail "[$label] helper process(es) left running: $left"
  fi
}

echo ""
echo "==== Check 1: both search backends forced to fail ===="
start_stack unavailable SEARCH_HELPER_FORCE_DDGS=fail SEARCH_HELPER_FORCE_BROWSER=fail
check unavailable unavailable "" "$REPLY_BOUND_S"
stop_stack

echo ""
echo "==== Check 2: search exceeds its time limit (${SEARCH_LIMIT_MS} ms) ===="
start_stack timeout SEARCH_TIMEOUT_MS="$SEARCH_LIMIT_MS" SEARCH_HELPER_FORCE_DDGS=fail SEARCH_HELPER_FORCE_BROWSER=hang
check timeout failed timeout "$REPLY_BOUND_S"
stop_stack

echo ""
if [[ "$FAILURES" -eq 0 ]]; then
  echo -e "${GREEN}All M13 web failure checks passed${NC}"
  exit 0
fi
echo -e "${RED}$FAILURES check(s) failed${NC}"
exit 1
