#!/bin/bash
# Install LaunchAgent for the phone-models server (C4)
# Copies com.harness.server.plist to ~/Library/LaunchAgents and, only with
# --load, (re)loads it into the user's launchd domain.
#
# The server binds 127.0.0.1:7789 and reads its bearer token from
# ~/.phone-models/token (mode 0600). Create the token first with:
#   (cd ops && bun src/token.ts ~/.phone-models/token)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LABEL="com.harness.server"
PLIST_FILE="$SCRIPT_DIR/$LABEL.plist"
AGENT_DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
BUN="/opt/homebrew/bin/bun"
ENTRY="$REPO_ROOT/server/src/index.ts"
TOKEN_FILE="$HOME/.phone-models/token"
LOG_DIR="$HOME/Library/Logs/phone-models"

if [[ ! -f "$PLIST_FILE" ]]; then
  echo "Error: LaunchAgent plist not found: $PLIST_FILE"
  exit 1
fi

if [[ ! -x "$BUN" ]]; then
  echo "Error: bun not found at $BUN (the plist runs this path)"
  exit 1
fi

if [[ ! -f "$ENTRY" ]]; then
  echo "Error: server entry point not found: $ENTRY"
  exit 1
fi

if ! grep -q "<string>$REPO_ROOT/server</string>" "$PLIST_FILE"; then
  echo "Error: $PLIST_FILE WorkingDirectory does not point at $REPO_ROOT/server"
  exit 1
fi

if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "Warning: token file $TOKEN_FILE does not exist; the server will refuse to start."
  echo "         Create it with: (cd $REPO_ROOT/ops && bun src/token.ts $TOKEN_FILE)"
elif [[ -n "$(find "$TOKEN_FILE" -perm +044 2>/dev/null)" ]]; then
  echo "Error: token file $TOKEN_FILE is group/world-readable; run: chmod 600 $TOKEN_FILE"
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$LOG_DIR"
chmod 700 "$LOG_DIR"

cp "$PLIST_FILE" "$AGENT_DEST"
chmod 644 "$AGENT_DEST"

echo "Installed server LaunchAgent to: $AGENT_DEST"

if [[ "${1:-}" == "--load" ]]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENT_DEST"
  echo "Loaded server LaunchAgent ($LABEL)"
else
  echo "To load the agent, run: $0 --load"
fi

exit 0
