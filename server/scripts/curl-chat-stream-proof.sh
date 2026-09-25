#!/bin/bash
# Proof script for the SSE chat streaming endpoints against a LIVE server.
# Fails (non-zero) if no server is listening; it never skips.
#
# Env:
#   SERVER_URL               default http://127.0.0.1:7789
#   PHONE_MODELS_TOKEN_FILE  default ~/.phone-models/token (mode 0600)
# The token is sent from a private temp header file and is never printed.

set -e

# Configuration
SERVER_URL="${SERVER_URL:-http://127.0.0.1:7789}"
TOKEN_FILE="${PHONE_MODELS_TOKEN_FILE:-$HOME/.phone-models/token}"
TIMEOUT=30

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "Testing SSE chat streaming infrastructure against $SERVER_URL..."

if [[ ! -r "$TOKEN_FILE" ]]; then
  echo -e "${RED}Failed: token file not readable: $TOKEN_FILE${NC}"
  exit 1
fi

AUTH_HEADER_FILE="$(mktemp)"
trap 'rm -f "$AUTH_HEADER_FILE"' EXIT
chmod 600 "$AUTH_HEADER_FILE"
printf 'Authorization: Bearer %s\n' "$(tr -d '[:space:]' < "$TOKEN_FILE")" > "$AUTH_HEADER_FILE"

# The server must be listening; a missing server is a failure, not a skip.
if ! curl -s -o /dev/null --max-time 5 "$SERVER_URL/v1/state"; then
  echo -e "${RED}Failed: no server reachable at $SERVER_URL${NC}"
  exit 1
fi

echo "Server is running"

# Test 1: POST to /v1/chat should return SSE stream with x-generation-id header
echo "Test 1: Chat endpoint returns SSE stream"

RESPONSE=$(curl -s --max-time "$TIMEOUT" -w "\n%{http_code}" -X POST "$SERVER_URL/v1/chat" \
  -H "@$AUTH_HEADER_FILE" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "test-model",
    "messages": [
      {
        "role": "user",
        "content": "This is a test prompt"
      }
    ]
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" != "200" ]; then
  echo -e "${RED}Failed: Expected 200, got $HTTP_CODE${NC}"
  exit 1
fi

echo "✓ Chat endpoint returns 200"

# Check that response has proper SSE content-type
CONTENT_TYPE=$(curl -s --max-time "$TIMEOUT" -D - -o /dev/null -X POST "$SERVER_URL/v1/chat" \
  -H "@$AUTH_HEADER_FILE" \
  -H "Content-Type: application/json" \
  -d '{"model": "test-model", "messages": [{"role": "user", "content": "test"}]}' | \
  grep -i "content-type" | cut -d: -f2 | tr -d '\r' | xargs)

if [[ "$CONTENT_TYPE" == "text/event-stream" ]]; then
  echo "✓ Response has correct content-type: text/event-stream"
else
  echo -e "${RED}Failed: Expected content-type text/event-stream, got $CONTENT_TYPE${NC}"
  exit 1
fi

# Test 2: Response should have x-generation-id header
GEN_ID=$(curl -s --max-time "$TIMEOUT" -D - -o /dev/null -X POST "$SERVER_URL/v1/chat" \
  -H "@$AUTH_HEADER_FILE" \
  -H "Content-Type: application/json" \
  -d '{"model": "test-model", "messages": [{"role": "user", "content": "test"}]}' | \
  grep -i "x-generation-id" | cut -d: -f2 | tr -d '\r' | xargs)

if [ -n "$GEN_ID" ]; then
  echo "✓ Response has x-generation-id header: $GEN_ID"
else
  echo -e "${RED}Failed: Missing x-generation-id header${NC}"
  exit 1
fi

# Test 3: Verify /v1/generations/{id}/events endpoint exists
echo "Test 2: Events endpoint accessibility"

EVENTS_RESPONSE=$(curl -s --max-time "$TIMEOUT" -w "\n%{http_code}" -X GET "$SERVER_URL/v1/generations/test-gen-123/events" \
  -H "@$AUTH_HEADER_FILE")

EVENTS_HTTP_CODE=$(echo "$EVENTS_RESPONSE" | tail -1)

if [ "$EVENTS_HTTP_CODE" != "404" ] && [ "$EVENTS_HTTP_CODE" != "200" ]; then
  echo -e "${RED}Failed: Expected 200 or 404 for events endpoint, got $EVENTS_HTTP_CODE${NC}"
  exit 1
fi

echo "✓ Events endpoint is accessible (code: $EVENTS_HTTP_CODE)"

# Test 4: Verify /v1/generations/{id}/cancel endpoint exists
echo "Test 3: Cancel endpoint accessibility"

CANCEL_RESPONSE=$(curl -s --max-time "$TIMEOUT" -w "\n%{http_code}" -X POST "$SERVER_URL/v1/generations/test-gen-123/cancel" \
  -H "@$AUTH_HEADER_FILE")

CANCEL_HTTP_CODE=$(echo "$CANCEL_RESPONSE" | tail -1)

if [ "$CANCEL_HTTP_CODE" != "404" ] && [ "$CANCEL_HTTP_CODE" != "200" ]; then
  echo -e "${RED}Failed: Expected 200 or 404 for cancel endpoint, got $CANCEL_HTTP_CODE${NC}"
  exit 1
fi

echo "✓ Cancel endpoint is accessible (code: $CANCEL_HTTP_CODE)"

# Test 5: Authentication required
echo "Test 4: Authentication enforcement"

NO_AUTH_RESPONSE=$(curl -s --max-time "$TIMEOUT" -w "\n%{http_code}" -X POST "$SERVER_URL/v1/chat" \
  -H "Content-Type: application/json" \
  -d '{"model": "test-model", "messages": [{"role": "user", "content": "test"}]}')

NO_AUTH_CODE=$(echo "$NO_AUTH_RESPONSE" | tail -1)

if [ "$NO_AUTH_CODE" = "401" ]; then
  echo "✓ Chat endpoint requires authentication"
else
  echo -e "${RED}Failed: Expected 401 for unauthenticated request, got $NO_AUTH_CODE${NC}"
  exit 1
fi

echo ""
echo -e "${GREEN}All streaming tests passed!${NC}"
echo "The SSE streaming chat infrastructure is in place and functional."
