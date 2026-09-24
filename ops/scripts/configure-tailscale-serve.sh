#!/bin/bash
# Configure Tailscale Serve for the Coding Harness server
# Maps the server port to be reachable via Tailscale on the device's tailnet hostname
# No Funnel (public exposure) is enabled; access is restricted to tailnet devices only

set -euo pipefail

# The server listens on localhost:7789
# We configure Tailscale Serve to make it available on the Tailscale IP
# at a port accessible only over the tailnet

TAILSCALE_PORT=${1:-7789}
LOCALHOST_PORT=7789

# Check if tailscale is installed
if ! command -v tailscale &> /dev/null; then
  echo "Error: tailscale CLI not found. Install Tailscale first."
  exit 1
fi

# Configure Tailscale Serve
# The --https=off flag ensures we serve over HTTP within the tailnet
# The mapping is: tailnet device -> localhost:7789
echo "Configuring Tailscale Serve for port $LOCALHOST_PORT..."

tailscale serve tcp/$TAILSCALE_PORT --set-path=/ http://localhost:$LOCALHOST_PORT

echo "Tailscale Serve configured successfully"
echo "The server is now accessible via Tailscale at: https://<device-name>.tailXXXX.ts.net:$TAILSCALE_PORT"
echo "Note: Access is restricted to your tailnet and requires Tailscale authentication"

exit 0
