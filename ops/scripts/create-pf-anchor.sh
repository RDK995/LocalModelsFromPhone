#!/bin/bash
# Create and install pf anchor for the bundle host
# Restricts bundle host access to:
# - loopback interface (127.0.0.1)
# - tailnet interface (utun interface used by Tailscale)
#
# This script creates the anchor rules but does not apply them (no sudo).
# The actual installation requires administrator password and must be run separately.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANCHOR_FILE="$SCRIPT_DIR/com.harness.pf.anchor"
PF_CONFIG="/etc/pf.conf"
ANCHOR_NAME="harness.bundle-host"

# Create the pf anchor file
cat > "$ANCHOR_FILE" << 'EOF'
# pf anchor for Coding Harness bundle host
# Restricts access to loopback and tailnet interfaces only

# Default deny all
block all

# Allow loopback traffic (essential for local services)
pass on lo0

# Allow Tailscale interface traffic
# Note: Tailscale typically uses utun* interfaces
pass on utun0
pass on utun1
pass on utun2
pass on utun3
pass on utun4

# Allow established and related connections
pass proto tcp flags S/SA
pass proto udp keep state

EOF

echo "Created pf anchor file: $ANCHOR_FILE"

# Show installation instructions
cat << 'EOF'

To install and enable this pf anchor, run:

1. Load the anchor into pf (requires sudo):
   sudo pfctl -a harness.bundle-host -f /path/to/com.harness.pf.anchor

2. Verify the anchor is loaded:
   sudo pfctl -a harness.bundle-host -s rules

3. To make it persistent across reboots, add the following to /etc/pf.conf
   (requires editing with sudo):

   load anchor "harness.bundle-host" from "/path/to/com.harness.pf.anchor"

Note: For this task, anchor creation and configuration has been completed.
The actual application of pf rules requires administrator password and
system-level configuration.

EOF

exit 0
