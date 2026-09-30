#!/bin/bash
# Uninstall LaunchAgent for the location search service (C13)
# Removes the com.harness.search LaunchAgent from launchd and deletes its plist.

set -euo pipefail

LABEL="com.harness.search"
AGENT_DEST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true

if [[ -f "$AGENT_DEST" ]]; then
  rm "$AGENT_DEST"
fi

exit 0
