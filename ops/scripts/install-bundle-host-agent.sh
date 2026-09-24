#!/bin/bash
# Install LaunchAgent for the Coding Harness bundle host
# This script copies the bundle host LaunchAgent plist to ~/Library/LaunchAgents
# and optionally loads it into launchd

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_FILE="$SCRIPT_DIR/com.harness.bundle-host.plist"
AGENT_DEST="$HOME/Library/LaunchAgents/com.harness.bundle-host.plist"

if [[ ! -f "$PLIST_FILE" ]]; then
  echo "Error: LaunchAgent plist not found: $PLIST_FILE"
  exit 1
fi

# Create LaunchAgents directory if it doesn't exist
mkdir -p "$HOME/Library/LaunchAgents"

# Copy plist to LaunchAgents
cp "$PLIST_FILE" "$AGENT_DEST"
chmod 644 "$AGENT_DEST"

echo "Installed bundle host LaunchAgent to: $AGENT_DEST"

# Optionally load the agent (only if this script is run with --load)
if [[ "${1:-}" == "--load" ]]; then
  launchctl load "$AGENT_DEST"
  echo "Loaded bundle host LaunchAgent"
else
  echo "To load the agent, run: launchctl load $AGENT_DEST"
fi

exit 0
