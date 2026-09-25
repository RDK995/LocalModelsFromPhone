#!/bin/bash
# Install LaunchAgent for the app bundle host (C8)
# The bundle host is the Expo dev server in mobile/, run in production mode
# (--no-dev --minify) on port 8081 with REACT_NATIVE_PACKAGER_HOSTNAME set to the
# Mac's tailnet name. Copies com.harness.bundle-host.plist to
# ~/Library/LaunchAgents and, only with --load, (re)loads it.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LABEL="com.harness.bundle-host"
PLIST_FILE="$SCRIPT_DIR/$LABEL.plist"
AGENT_DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
BUN="/opt/homebrew/bin/bun"
MOBILE_DIR="$REPO_ROOT/mobile"
LOG_DIR="$HOME/Library/Logs/phone-models"

if [[ ! -f "$PLIST_FILE" ]]; then
  echo "Error: LaunchAgent plist not found: $PLIST_FILE"
  exit 1
fi

if [[ ! -x "$BUN" ]]; then
  echo "Error: bun not found at $BUN (the plist runs this path)"
  exit 1
fi

if [[ ! -f "$MOBILE_DIR/package.json" ]]; then
  echo "Error: Expo app not found: $MOBILE_DIR/package.json"
  exit 1
fi

if [[ ! -e "$MOBILE_DIR/node_modules/.bin/expo" ]]; then
  echo "Error: Expo CLI not installed in $MOBILE_DIR; run: (cd $MOBILE_DIR && bun install)"
  exit 1
fi

if ! grep -q "<string>$MOBILE_DIR</string>" "$PLIST_FILE"; then
  echo "Error: $PLIST_FILE WorkingDirectory does not point at $MOBILE_DIR"
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$LOG_DIR"
chmod 700 "$LOG_DIR"

cp "$PLIST_FILE" "$AGENT_DEST"
chmod 644 "$AGENT_DEST"

echo "Installed bundle host LaunchAgent to: $AGENT_DEST"

if [[ "${1:-}" == "--load" ]]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENT_DEST"
  echo "Loaded bundle host LaunchAgent ($LABEL)"
else
  echo "To load the agent, run: $0 --load"
fi

exit 0
