#!/bin/bash
# Live proof wrapper: thinking proof demonstrating M4-AC1 (thinking events stored
# separately from content) against the real server and the real Ollama, using the
# app's own client, conversation store, and session module.
#
# Restarts both LaunchAgents so the server picks up current code, waits for 401 on
# /v1/state (the pattern in model-list-proof.sh), records what is resident on Ollama
# before the proof starts, runs thinking-proof.ts (the actual assertions), then
# restores the originally resident model -- or restores "nothing resident" -- no matter
# how the proof script exits, including a crash or Ctrl-C, via a trap.

set -u

SERVER_URL="${SERVER_URL:-https://ryans-mac-studio.tailc3648a.ts.net:8443}"
OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
TIMEOUT=30

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

echo "=== Thinking Live Proof ==="
echo ""

echo "Restarting LaunchAgents..."
launchctl kickstart -k gui/$(id -u)/com.harness.server
launchctl kickstart -k gui/$(id -u)/com.harness.bundle-host

echo "Waiting for server to be ready..."
SERVER_READY=0
for i in $(seq 1 30); do
  HTTP_CODE=$(curl -s -o /dev/null --max-time "$TIMEOUT" -w '%{http_code}' "$SERVER_URL/v1/state")
  if [ "$HTTP_CODE" = "401" ]; then
    echo "Server is up and enforcing auth"
    SERVER_READY=1
    break
  fi
  sleep 1
done
if [ "$SERVER_READY" -ne 1 ]; then
  echo -e "${RED}Failed: server did not start in time${NC}"
  exit 1
fi

echo ""
echo "--- Recording original Ollama state (before proof) ---"
ORIGINAL_PS=$(curl -s --max-time "$TIMEOUT" "$OLLAMA_URL/api/ps")
echo "Before: $ORIGINAL_PS"
ORIGINAL_MODEL=$(echo "$ORIGINAL_PS" | jq -r '.models[0].name // empty')
if [ -n "$ORIGINAL_MODEL" ]; then
  echo "Originally resident: $ORIGINAL_MODEL"
else
  echo "Originally resident: (none)"
fi

CLEANUP_DONE=0
RESTORE_FAILED=0

restore_original() {
  if [ "$CLEANUP_DONE" -eq 1 ]; then
    return
  fi
  CLEANUP_DONE=1

  echo ""
  echo "--- Cleanup: restoring original Ollama state ---"
  BEFORE_CLEANUP_PS=$(curl -s --max-time "$TIMEOUT" "$OLLAMA_URL/api/ps")
  echo "Before cleanup: $BEFORE_CLEANUP_PS"
  CURRENT_RESIDENT=$(echo "$BEFORE_CLEANUP_PS" | jq -r '.models[0].name // empty')

  if [ -n "$ORIGINAL_MODEL" ]; then
    if [ "$CURRENT_RESIDENT" != "$ORIGINAL_MODEL" ]; then
      echo "Restoring $ORIGINAL_MODEL (keep_alive -1)..."
      curl -s --max-time "$TIMEOUT" -X POST "$OLLAMA_URL/api/generate" \
        -H "Content-Type: application/json" \
        -d "{\"model\":\"$ORIGINAL_MODEL\",\"keep_alive\":-1}" > /dev/null

      RESTORED=0
      for i in $(seq 1 60); do
        CHECK=$(curl -s --max-time "$TIMEOUT" "$OLLAMA_URL/api/ps" | jq -r '.models[0].name // empty')
        if [ "$CHECK" = "$ORIGINAL_MODEL" ]; then
          RESTORED=1
          break
        fi
        sleep 2
      done
      if [ "$RESTORED" -ne 1 ]; then
        echo -e "${RED}FAIL: could not restore $ORIGINAL_MODEL as resident${NC}"
        RESTORE_FAILED=1
      fi
    else
      echo "$ORIGINAL_MODEL is already resident, nothing to restore"
    fi
  else
    if [ -n "$CURRENT_RESIDENT" ]; then
      echo "Nothing was resident originally; unloading $CURRENT_RESIDENT..."
      curl -s --max-time "$TIMEOUT" -X POST "$OLLAMA_URL/api/generate" \
        -H "Content-Type: application/json" \
        -d "{\"model\":\"$CURRENT_RESIDENT\",\"keep_alive\":0}" > /dev/null
      for i in $(seq 1 60); do
        COUNT=$(curl -s --max-time "$TIMEOUT" "$OLLAMA_URL/api/ps" | jq '.models | length')
        if [ "$COUNT" -eq 0 ]; then
          break
        fi
        sleep 2
      done
    else
      echo "Nothing was resident originally, and nothing is resident now"
    fi
  fi

  AFTER_CLEANUP_PS=$(curl -s --max-time "$TIMEOUT" "$OLLAMA_URL/api/ps")
  echo "After cleanup: $AFTER_CLEANUP_PS"
}

on_exit() {
  local code=$?
  restore_original
  if [ "$RESTORE_FAILED" -eq 1 ] && [ "$code" -eq 0 ]; then
    code=1
  fi
  if [ "$code" -ne 0 ]; then
    echo -e "${RED}=== Proof FAILED (exit $code) ===${NC}"
  else
    echo -e "${GREEN}=== Proof PASSED, Mac restored to its original state ===${NC}"
  fi
  exit $code
}
trap on_exit EXIT

echo ""
echo "--- Running proof (mobile/scripts/thinking-proof.ts) ---"
cd /Users/ryankenny/Projects/CodingHarnessv2/mobile
bun scripts/thinking-proof.ts
