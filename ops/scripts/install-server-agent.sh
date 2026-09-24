#!/bin/bash
# Install LaunchAgent for the Coding Harness server
# This script copies the server LaunchAgent plist to ~/Library/LaunchAgents
# and optionally loads it into launchd

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_FILE="$SCRIPT_DIR/com.harness.server.plist"
AGENT_DEST="$HOME/Library/LaunchAgents/com.harness.server.plist"

if [[ ! -f "$PLIST_FILE" ]]; then
  echo "Error: LaunchAgent plist not found: $PLIST_FILE"
  exit 1
fi

# Create LaunchAgents directory if it doesn't exist
mkdir -p "$HOME/Library/LaunchAgents"

# Copy plist to LaunchAgents
cp "$PLIST_FILE" "$AGENT_DEST"
chmod 644 "$AGENT_DEST"

echo "Installed server LaunchAgent to: $AGENT_DEST"

# Optionally load the agent (only if this script is run with --load)
if [[ "${1:-}" == "--load" ]]; then
  launchctl load "$AGENT_DEST"
  echo "Loaded server LaunchAgent"
else
  echo "To load the agent, run: launchctl load $AGENT_DEST"
fi

exit 0
