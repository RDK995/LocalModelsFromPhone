#!/bin/bash
# Live proof wrapper: M10c2 source-link logos (FR27, AC21) against the real Mac server,
# using the phone app's own modules. Same shape as markdown-render-proof.sh: restart the
# LaunchAgents, wait for 401 on /v1/state, run source-logo-proof.ts (the actual assertions).
# This proof needs no model, so it never loads, unloads or swaps one; it only records
# Ollama's /api/ps before and after and FAILS if the resident model changed.
# Full output is also written to .harness/evidence/M10c2-T4-proof.log.

set -u

SERVER_URL="${SERVER_URL:-https://ryans-mac-studio.tailc3648a.ts.net:8443}"
export SERVER_URL
OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
TIMEOUT=30
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_FILE="$REPO_ROOT/.harness/evidence/M10c2-T4-proof.log"
mkdir -p "$(dirname "$LOG_FILE")"
exec > >(tee "$LOG_FILE") 2>&1

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

echo "=== Source Logo Live Proof ==="
echo ""

echo "Restarting LaunchAgents..."
launchctl kickstart -k gui/$(id -u)/com.harness.server
launchctl kickstart -k gui/$(id -u)/com.harness.bundle-host
# The Mac's icon fetch lives in the search service (com.harness.search); a copy started before
# M10c1 has no /icon route and answers 404 for every host, so restart it to serve current code.
launchctl kickstart -k gui/$(id -u)/com.harness.search

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

echo "Waiting for the search service (127.0.0.1:7790) to answer..."
SEARCH_READY=0
for i in $(seq 1 30); do
  SEARCH_CODE=$(curl -s -o /dev/null --max-time 5 -w '%{http_code}' "http://127.0.0.1:7790/v1/icon?host=")
  if [ "$SEARCH_CODE" != "000" ]; then
    echo "Search service is up (HTTP $SEARCH_CODE)"
    SEARCH_READY=1
    break
  fi
  sleep 1
done
if [ "$SEARCH_READY" -ne 1 ]; then
  echo -e "${RED}Failed: search service did not start in time${NC}"
  exit 1
fi

echo ""
echo "--- Recording Ollama state (before proof) ---"
BEFORE_PS=$(curl -s --max-time "$TIMEOUT" "$OLLAMA_URL/api/ps")
echo "Before: $BEFORE_PS"
BEFORE_MODEL=$(echo "$BEFORE_PS" | jq -r '.models[0].name // empty')
echo "Resident before: ${BEFORE_MODEL:-(none)}"

echo ""
echo "--- Running proof (mobile/scripts/source-logo-proof.ts) ---"
cd "$REPO_ROOT/mobile"
bun scripts/source-logo-proof.ts
CODE=$?

echo ""
echo "--- Recording Ollama state (after proof) ---"
AFTER_PS=$(curl -s --max-time "$TIMEOUT" "$OLLAMA_URL/api/ps")
echo "After: $AFTER_PS"
AFTER_MODEL=$(echo "$AFTER_PS" | jq -r '.models[0].name // empty')
if [ "$BEFORE_MODEL" = "$AFTER_MODEL" ]; then
  echo "PASS: resident model unchanged (${AFTER_MODEL:-none})"
else
  echo -e "${RED}FAIL: resident model changed from '${BEFORE_MODEL:-none}' to '${AFTER_MODEL:-none}'${NC}"
  [ "$CODE" -eq 0 ] && CODE=1
fi

if [ "$CODE" -ne 0 ]; then
  echo -e "${RED}=== Proof FAILED (exit $CODE) ===${NC}"
else
  echo -e "${GREEN}=== Proof PASSED ===${NC}"
fi
sleep 1  # let the tee process flush the log
exit $CODE
