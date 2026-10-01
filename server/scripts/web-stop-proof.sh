#!/bin/bash
# Live proof for M12 (FR23, AC17, M12-AC1): Stop during an in-flight web search kills the
# search helper on the Mac and the reply stops, against the real server (LaunchAgent
# com.harness.server), the real search service and the real Ollama.
#
# In-flight signal: the server only emits step(started) AFTER the tool call returns
# (server/src/web/tools.ts returns the events as one batch), so that event cannot be
# used to catch a search in flight. Instead this polls the process table for the helper
# (argv contains "helper/search.py --query"), snapshots it and its process group, then
# POSTs /v1/generations/{id}/cancel. A run where no helper is seen alive is INCONCLUSIVE
# and retried (bounded); it is never counted as a pass.
#
# Same shape as mobile/scripts/web-resume-proof.sh: restart LaunchAgents, wait for 401,
# record the resident model and restore it however the script exits. The token is read
# from a file and never printed. Output also goes to .harness/evidence/M12-T3-proof.log.

set -u

SERVER_URL="${SERVER_URL:-https://ryans-mac-studio.tailc3648a.ts.net:8443}"
OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
TOKEN_FILE="${PHONE_MODELS_TOKEN_FILE:-$HOME/.phone-models/token}"
TIMEOUT=30
MAX_ATTEMPTS=5
HELPER_PATTERN='helper/search.py --query'
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_FILE="$REPO_ROOT/.harness/evidence/M12-T3-proof.log"
mkdir -p "$(dirname "$LOG_FILE")"
exec > >(tee "$LOG_FILE") 2>&1

RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'
FAILURES=0
pass() { echo -e "${GREEN}PASS${NC}: $1"; }
fail() { echo -e "${RED}FAIL${NC}: $1"; FAILURES=$((FAILURES + 1)); }
die() { echo -e "${RED}FAIL${NC}: $1"; exit 1; }

WORK_DIR="$(mktemp -d)"
BG_PIDS=()
CLEANUP_DONE=0
RESTORE_FAILED=0
ORIGINAL_MODEL=""

command -v jq >/dev/null || die "jq not available"
[[ -s "$TOKEN_FILE" ]] || die "token file $TOKEN_FILE missing or empty"
AUTH_HEADER_FILE="$WORK_DIR/auth"
( umask 077; printf 'Authorization: Bearer %s\n' "$(tr -d '[:space:]' < "$TOKEN_FILE")" > "$AUTH_HEADER_FILE" )

api() { curl -s --max-time "$TIMEOUT" -H "@$AUTH_HEADER_FILE" "$@"; }

restore_original() {
  [[ "$CLEANUP_DONE" -eq 1 ]] && return
  CLEANUP_DONE=1
  for p in "${BG_PIDS[@]:-}"; do [[ -n "$p" ]] && kill "$p" 2>/dev/null; done
  echo ""
  echo "--- Cleanup: restoring original Ollama state ---"
  local ps_now cur
  ps_now=$(curl -s --max-time "$TIMEOUT" "$OLLAMA_URL/api/ps")
  echo "Before cleanup: $ps_now"
  cur=$(echo "$ps_now" | jq -r '.models[0].name // empty')
  if [[ -n "$ORIGINAL_MODEL" ]]; then
    if [[ "$cur" != "$ORIGINAL_MODEL" ]]; then
      echo "Restoring $ORIGINAL_MODEL (keep_alive -1)..."
      curl -s --max-time "$TIMEOUT" -X POST "$OLLAMA_URL/api/generate" -H "Content-Type: application/json" \
        -d "{\"model\":\"$ORIGINAL_MODEL\",\"keep_alive\":-1}" > /dev/null
      local ok=0
      for _ in $(seq 1 60); do
        [[ "$(curl -s --max-time "$TIMEOUT" "$OLLAMA_URL/api/ps" | jq -r '.models[0].name // empty')" == "$ORIGINAL_MODEL" ]] && { ok=1; break; }
        sleep 2
      done
      [[ "$ok" -eq 1 ]] || { echo -e "${RED}FAIL: could not restore $ORIGINAL_MODEL as resident${NC}"; RESTORE_FAILED=1; }
    else
      echo "$ORIGINAL_MODEL is already resident, nothing to restore"
    fi
  elif [[ -n "$cur" ]]; then
    echo "Nothing was resident originally; unloading $cur..."
    curl -s --max-time "$TIMEOUT" -X POST "$OLLAMA_URL/api/generate" -H "Content-Type: application/json" \
      -d "{\"model\":\"$cur\",\"keep_alive\":0}" > /dev/null
    for _ in $(seq 1 60); do
      [[ "$(curl -s --max-time "$TIMEOUT" "$OLLAMA_URL/api/ps" | jq '.models | length')" -eq 0 ]] && break
      sleep 2
    done
  fi
  echo "After cleanup: $(curl -s --max-time "$TIMEOUT" "$OLLAMA_URL/api/ps")"
  rm -rf "$WORK_DIR"
}
on_exit() {
  local code=$?
  restore_original
  [[ "$RESTORE_FAILED" -eq 1 && "$code" -eq 0 ]] && code=1
  if [[ "$code" -ne 0 ]]; then
    echo -e "${RED}=== Proof FAILED (exit $code) ===${NC}"
  else
    echo -e "${GREEN}=== Proof PASSED, Mac restored to its original state ===${NC}"
  fi
  sleep 1  # let tee flush
  exit $code
}
trap on_exit EXIT

echo "=== Web Stop Live Proof (M12-T3) ==="
echo "Restarting LaunchAgents..."
launchctl kickstart -k gui/$(id -u)/com.harness.server
launchctl kickstart -k gui/$(id -u)/com.harness.bundle-host
ready=0
for _ in $(seq 1 30); do
  [[ "$(curl -s -o /dev/null --max-time "$TIMEOUT" -w '%{http_code}' "$SERVER_URL/v1/state")" == "401" ]] && { ready=1; break; }
  sleep 1
done
[[ "$ready" -eq 1 ]] || die "server did not start in time"
echo "Server is up and enforcing auth"

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:7790/v1/health) || code=000
[[ "$code" == "200" ]] || die "search service health returned $code (need 200)"

ORIGINAL_PS=$(curl -s --max-time "$TIMEOUT" "$OLLAMA_URL/api/ps")
echo "Before: $ORIGINAL_PS"
ORIGINAL_MODEL=$(echo "$ORIGINAL_PS" | jq -r '.models[0].name // empty')
[[ -n "$ORIGINAL_MODEL" ]] || die "no model is resident in Ollama; load one first (this proof will not load or switch models)"
MODEL="$ORIGINAL_MODEL"
echo "Using resident model: $MODEL"

# ---- helpers ------------------------------------------------------------------
helper_pids() { pgrep -f "$HELPER_PATTERN" 2>/dev/null | sort -n | tr '\n' ' '; }
# the helpers plus every pid in their process groups (the helper leads its own group)
group_pids() {
  local pg
  pg=$(for p in $1; do ps -o pgid= -p "$p" 2>/dev/null | tr -d ' '; done | sort -u | tr '\n' ' ')
  { echo "$1" | tr ' ' '\n'; ps -axo pid=,pgid= | awk -v groups="$pg" 'BEGIN{n=split(groups,a," "); for(i=1;i<=n;i++) g[a[i]]=1} ($2 in g){print $1}'; } \
    | grep -E '^[0-9]+$' | sort -un | tr '\n' ' '
}
alive() { local p r=""; for p in $1; do kill -0 "$p" 2>/dev/null && r="$r$p "; done; echo "$r"; }
now_ms() { python3 -c 'import time; print(int(time.time()*1000))'; }

PROMPTS=(
  "You MUST call the web_search tool now (do not answer from memory) to find today's top news headlines, then answer in one sentence."
  "Call the web_search tool with the query 'latest stable release of the Bun JavaScript runtime', then answer in one sentence citing the URL. Do not answer without using the tool."
  "Search the web for today's weather news in London and summarise it in one sentence."
)

CONCLUSIVE=0
for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  echo ""
  echo "--- Attempt $attempt of $MAX_ATTEMPTS ---"
  SSE="$WORK_DIR/a$attempt.sse"; HDR="$WORK_DIR/a$attempt.hdr"; : > "$SSE"; : > "$HDR"
  prompt="${PROMPTS[$(( (attempt - 1) % ${#PROMPTS[@]} ))]}"
  body=$(jq -n --arg m "$MODEL" --arg p "$prompt" '{model:$m,messages:[{role:"user",content:$p}],web:true}')

  pre=$(helper_pids)
  [[ -z "$pre" ]] || die "a search helper is already running before the chat started (pids: $pre); refusing to run"

  curl -sN --max-time 300 -D "$HDR" -X POST "$SERVER_URL/v1/chat" -H "@$AUTH_HEADER_FILE" \
    -H "Content-Type: application/json" -d "$body" > "$SSE" 2>/dev/null &
  CHAT_PID=$!; BG_PIDS+=("$CHAT_PID")

  # Wait for the helper to appear (the model must decide to call web_search first).
  HELPERS=""
  for _ in $(seq 1 1800); do   # up to 180 s at 0.1 s
    HELPERS=$(helper_pids)
    [[ -n "$HELPERS" ]] && break
    kill -0 "$CHAT_PID" 2>/dev/null || break
    sleep 0.1
  done
  if [[ -z "$HELPERS" ]]; then
    echo "INCONCLUSIVE: no live search helper observed (the model did not search, or the search finished before it was seen)"
    kill "$CHAT_PID" 2>/dev/null
    # make sure no reply is left running before the next attempt
    gid=$(api -X POST "$SERVER_URL/v1/chat" -H "Content-Type: application/json" -d '{"model":"'"$MODEL"'","messages":[{"role":"user","content":"hi"}]}' | jq -r '.error.generation_id // .generation_id // empty')
    [[ -n "$gid" ]] && api -X POST "$SERVER_URL/v1/generations/$gid/cancel" > /dev/null
    sleep 2
    continue
  fi
  SNAP=$(group_pids "$HELPERS")
  SSE_BYTES=$(wc -c < "$SSE" | tr -d ' ')

  # Generation id: response header when flushed, else from the 409 busy probe.
  GEN=$(grep -i '^x-generation-id:' "$HDR" | tr -d '\r' | awk '{print $2}')
  if [[ -z "$GEN" ]]; then
    GEN=$(api -X POST "$SERVER_URL/v1/chat" -H "Content-Type: application/json" \
      -d '{"model":"'"$MODEL"'","messages":[{"role":"user","content":"hi"}]}' | jq -r '.error.generation_id // .generation_id // empty')
  fi
  [[ -n "$GEN" ]] || { kill "$CHAT_PID" 2>/dev/null; die "could not determine the generation id"; }

  echo "Helper alive before cancel: pids [$HELPERS] ; helper + process-group members [$SNAP] ; generation $GEN"
  T0=$(now_ms)
  CANCEL_RESP=$(api -X POST "$SERVER_URL/v1/generations/$GEN/cancel")
  echo "Cancel response: $CANCEL_RESP"

  # (1) all snapshot pids gone within 5 s
  GONE_MS=-1
  for _ in $(seq 1 100); do
    [[ -z "$(alive "$SNAP")" ]] && { GONE_MS=$(( $(now_ms) - T0 )); break; }
    sleep 0.05
  done
  AFTER=$(alive "$SNAP")
  STRAY=$(helper_pids)
  if [[ -z "$AFTER" && -z "$STRAY" && "$GONE_MS" -ge 0 && "$GONE_MS" -le 5000 ]]; then
    pass "check 1: helper and its process group are gone ${GONE_MS} ms after cancel (pids before [$SNAP], still alive after [none], helper processes now [none])"
  else
    fail "check 1: processes still alive after cancel: [$AFTER] ; helpers now [$STRAY] ; pids before [$SNAP]"
  fi

  # (2) stream reaches the cancelled terminal, nothing content/sources after cancel
  for _ in $(seq 1 100); do kill -0 "$CHAT_PID" 2>/dev/null || break; sleep 0.05; done
  kill -0 "$CHAT_PID" 2>/dev/null && kill "$CHAT_PID" 2>/dev/null
  TERM_DATA=$(awk '/^event: /{ev=$2} /^data: /{ if (ev=="done") d=substr($0,7) } END{print d}' "$SSE")
  TERM_STATUS=$(echo "$TERM_DATA" | jq -r '.status // empty' 2>/dev/null)
  LAST_EV=$(grep '^event: ' "$SSE" | tail -1 | awk '{print $2}')
  AFTER_EVENTS=$(tail -c +"$((SSE_BYTES + 1))" "$SSE" | grep '^event: ' | awk '{print $2}' | sort | uniq -c | tr '\n' ';')
  LATE_BAD=$(tail -c +"$((SSE_BYTES + 1))" "$SSE" | grep -cE '^event: (content|sources)')
  echo "  terminal event: done $TERM_DATA ; last event: $LAST_EV ; events after cancel: ${AFTER_EVENTS:-none}"
  if [[ "$TERM_STATUS" == "cancelled" && "$LAST_EV" == "done" && "$LATE_BAD" -eq 0 ]]; then
    pass "check 2: stream ended with done status=cancelled and no content/sources events arrived after the cancel"
  else
    fail "check 2: terminal status '$TERM_STATUS', last event '$LAST_EV', content/sources after cancel: $LATE_BAD"
  fi

  # (3) no generation running, new chat admitted
  sleep 0.5
  ST_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" -H "@$AUTH_HEADER_FILE" "$SERVER_URL/v1/state")
  PROBE_HDR="$WORK_DIR/probe.hdr"; PROBE_OUT="$WORK_DIR/probe.out"; : > "$PROBE_HDR"
  curl -sN --max-time 60 -D "$PROBE_HDR" -X POST "$SERVER_URL/v1/chat" -H "@$AUTH_HEADER_FILE" -H "Content-Type: application/json" \
    -d '{"model":"'"$MODEL"'","messages":[{"role":"user","content":"Say hello in three words."}]}' > "$PROBE_OUT" 2>/dev/null &
  PROBE_PID=$!; BG_PIDS+=("$PROBE_PID")
  PROBE_STATUS=""
  for _ in $(seq 1 300); do
    PROBE_STATUS=$(head -1 "$PROBE_HDR" | awk '{print $2}')
    [[ -n "$PROBE_STATUS" ]] && break
    sleep 0.1
  done
  PGEN=$(grep -i '^x-generation-id:' "$PROBE_HDR" | tr -d '\r' | awk '{print $2}')
  [[ -n "$PGEN" ]] && api -X POST "$SERVER_URL/v1/generations/$PGEN/cancel" > /dev/null
  sleep 1; kill "$PROBE_PID" 2>/dev/null
  echo "  GET /v1/state -> $ST_CODE ; new chat admission -> HTTP ${PROBE_STATUS:-none} (generation ${PGEN:-none}); probe cancelled"
  if [[ "$ST_CODE" == "200" && "$PROBE_STATUS" == "200" ]]; then
    pass "check 3: state endpoint healthy and a new chat was admitted (no generation left running)"
  else
    fail "check 3: state $ST_CODE, new chat admission $PROBE_STATUS"
  fi
  CONCLUSIVE=1
  break
done

[[ "$CONCLUSIVE" -eq 1 ]] || die "no conclusive run in $MAX_ATTEMPTS attempts: a live search helper was never observed before a cancel"

echo ""
[[ "$FAILURES" -eq 0 ]] || die "$FAILURES check(s) failed"
echo -e "${GREEN}All M12 stop checks passed${NC}"
exit 0
