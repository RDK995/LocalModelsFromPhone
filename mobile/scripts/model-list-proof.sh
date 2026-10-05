#!/bin/bash
# Live proof wrapper: runs model-list-proof.ts with load/unload cycle and hardcoded name checks.
#
# Restarts both LaunchAgents, runs the proof script, and if no model is resident at start,
# loads the smallest model, re-runs the proof, unloads it, waits until empty, and re-runs
# again. Checks that no hardcoded model names exist in source. Leaves Ollama in its
# original state.

set -e

OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
TIMEOUT=30

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "=== Model List Proof ==="
echo ""

# Step 1: Restart LaunchAgents
echo "Restarting LaunchAgents..."
launchctl kickstart -k gui/$(id -u)/com.harness.server
launchctl kickstart -k gui/$(id -u)/com.harness.bundle-host

# Wait for the server to be up and enforcing auth (returns 401)
echo "Waiting for server to be ready..."
for i in {1..30}; do
  HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' https://ryans-mac-studio.tailc3648a.ts.net:8443/v1/state)
  if [ "$HTTP_CODE" = "401" ]; then
    echo "Server is up and enforcing auth"
    break
  fi
  if [ $i -eq 30 ]; then
    echo -e "${RED}Failed: server did not start in time${NC}"
    exit 1
  fi
  sleep 1
done

echo ""
echo "--- Initial state check ---"

# Get the initial resident state
INITIAL_PS=$(curl -s --max-time "$TIMEOUT" "$OLLAMA_URL/api/ps")
INITIAL_RESIDENT_COUNT=$(echo "$INITIAL_PS" | jq '.models | length')

if [ "$INITIAL_RESIDENT_COUNT" -eq 0 ]; then
  echo "No model is currently resident"

  # Get the smallest model to load
  TAGS=$(curl -s --max-time "$TIMEOUT" "$OLLAMA_URL/api/tags")
  SMALLEST_MODEL=$(echo "$TAGS" | jq -r '.models | sort_by(.size) | .[0].name')
  echo "Smallest model: $SMALLEST_MODEL"

  if [ -z "$SMALLEST_MODEL" ] || [ "$SMALLEST_MODEL" = "null" ]; then
    echo -e "${RED}Failed: no models available in Ollama${NC}"
    exit 1
  fi

  # Run the initial proof (should show "Nothing loaded")
  echo ""
  echo "--- Run 1: Nothing loaded (initial) ---"
  cd /Users/ryankenny/Projects/CodingHarnessv2/mobile
  if ! bun scripts/model-list-proof.ts; then
    echo -e "${RED}Failed: Run 1 failed${NC}"
    exit 1
  fi

  # Load the smallest model via Ollama
  echo ""
  echo "Loading model: $SMALLEST_MODEL"
  LOAD_RESPONSE=$(curl -s -X POST "$OLLAMA_URL/api/generate" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"$SMALLEST_MODEL\",\"keep_alive\":\"5m\"}" \
    -w "\n%{http_code}")

  HTTP_CODE=$(echo "$LOAD_RESPONSE" | tail -1)
  if [ "$HTTP_CODE" != "200" ]; then
    echo -e "${RED}Failed: could not load model, HTTP $HTTP_CODE${NC}"
    exit 1
  fi

  # Give Ollama a moment to fully register the model
  sleep 1

  # Run the proof again (should show "Loaded: $SMALLEST_MODEL")
  echo ""
  echo "--- Run 2: Model loaded ---"
  if ! bun scripts/model-list-proof.ts; then
    echo -e "${RED}Failed: Run 2 failed (model should be loaded)${NC}"
    # Try to unload before exiting
    curl -s -X POST "$OLLAMA_URL/api/generate" \
      -H "Content-Type: application/json" \
      -d "{\"model\":\"$SMALLEST_MODEL\",\"keep_alive\":0}" > /dev/null 2>&1
    exit 1
  fi

  # Unload the model
  echo ""
  echo "Unloading model: $SMALLEST_MODEL"
  UNLOAD_RESPONSE=$(curl -s -X POST "$OLLAMA_URL/api/generate" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"$SMALLEST_MODEL\",\"keep_alive\":0}" \
    -w "\n%{http_code}")

  # Wait until the model is fully unloaded
  echo "Waiting for model to unload..."
  for i in {1..30}; do
    PS_CHECK=$(curl -s --max-time "$TIMEOUT" "$OLLAMA_URL/api/ps")
    RESIDENT_COUNT=$(echo "$PS_CHECK" | jq '.models | length')
    if [ "$RESIDENT_COUNT" -eq 0 ]; then
      echo "Model is now unloaded"
      break
    fi
    if [ $i -eq 30 ]; then
      echo -e "${RED}Failed: model did not unload in time${NC}"
      exit 1
    fi
    sleep 1
  done

  # Run the proof once more (should show "Nothing loaded" again)
  echo ""
  echo "--- Run 3: Nothing loaded (after unload) ---"
  if ! bun scripts/model-list-proof.ts; then
    echo -e "${RED}Failed: Run 3 failed (nothing should be loaded)${NC}"
    exit 1
  fi
else
  echo "A model is already resident, skipping load/unload cycle"

  # Just run the proof once
  echo ""
  echo "--- Run 1: Current state ---"
  cd /Users/ryankenny/Projects/CodingHarnessv2/mobile
  if ! bun scripts/model-list-proof.ts; then
    echo -e "${RED}Failed: proof failed${NC}"
    exit 1
  fi
fi

echo ""
echo "--- Hardcoded name check ---"

# Get all current model names from Ollama
TAGS=$(curl -s --max-time "$TIMEOUT" "$OLLAMA_URL/api/tags")
MODEL_NAMES=$(echo "$TAGS" | jq -r '.models[].name')

# Check that none of these names appear in the source code
FOUND_NAMES=""
for MODEL_NAME in $MODEL_NAMES; do
  # Search for the model name in source files (not test files)
  # grep returns 0 if found, 1 if not found
  if grep -r "$MODEL_NAME" \
    /Users/ryankenny/Projects/CodingHarnessv2/mobile/src \
    /Users/ryankenny/Projects/CodingHarnessv2/server/src \
    --include="*.ts" --include="*.tsx" \
    2>/dev/null | grep -v ".test.ts" | grep -v ".test.tsx" >/dev/null 2>&1; then
    FOUND_NAMES="$FOUND_NAMES $MODEL_NAME"
  fi
done

if [ -n "$FOUND_NAMES" ]; then
  echo -e "${RED}FAIL: found hardcoded model names in source:$FOUND_NAMES${NC}"
  exit 1
fi

echo "PASS: no hardcoded model names found in source"

echo ""
echo -e "${GREEN}All proof checks passed!${NC}"
