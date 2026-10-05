#!/bin/bash
# Install LaunchAgent for the location search service (C13)
# Copies com.harness.search.plist to ~/Library/LaunchAgents and, only with
# --load, (re)loads it into the user's launchd domain.
#
# The search service binds 127.0.0.1:7790 only and does not require a token.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LABEL="com.harness.search"
PLIST_FILE="$SCRIPT_DIR/$LABEL.plist"
AGENT_DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
BUN="/opt/homebrew/bin/bun"
ENTRY="$REPO_ROOT/search/src/index.ts"
HELPER_VENV="$REPO_ROOT/search/helper/.venv/bin/python"
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
  echo "Error: search entry point not found: $ENTRY"
  exit 1
fi

if ! grep -q "<string>$REPO_ROOT/search</string>" "$PLIST_FILE"; then
  echo "Error: $PLIST_FILE WorkingDirectory does not point at $REPO_ROOT/search"
  exit 1
fi

if [[ ! -f "$HELPER_VENV" ]]; then
  echo "Warning: search helper environment not found at $HELPER_VENV"
  echo "         Install it with: bash $SCRIPT_DIR/install-search-helper.sh"
fi

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$LOG_DIR"
chmod 700 "$LOG_DIR"

cp "$PLIST_FILE" "$AGENT_DEST"
chmod 644 "$AGENT_DEST"

echo "Installed search LaunchAgent to: $AGENT_DEST"

if [[ "${1:-}" == "--load" ]]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENT_DEST"
  echo "Loaded search LaunchAgent ($LABEL)"
else
  echo "To load the agent, run: $0 --load"
fi

exit 0
