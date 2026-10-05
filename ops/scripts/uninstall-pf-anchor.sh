#!/bin/bash
# Uninstall the bundle-host pf anchor (C9, FR14). Run by the human:
#
#   sudo bash ops/scripts/uninstall-pf-anchor.sh
#
# Removes the LaunchDaemon com.harness.pf-bundle-host, flushes ONLY the anchor
# com.apple/harness.bundle-host and releases the pf enable reference this
# install recorded. It never disables pf and never flushes the main ruleset, so
# anything else using pf is unaffected. After this, the bundle host on 8081 is
# reachable from the LAN again.

set -uo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "error: uninstall-pf-anchor.sh must be run as root: sudo bash ops/scripts/uninstall-pf-anchor.sh" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL="com.harness.pf-bundle-host"
ANCHOR="$(bash "$SCRIPT_DIR/pf-bundle-host-load.sh" --anchor)"
SUPPORT_DIR="/Library/Application Support/com.harness.pf-bundle-host"
DAEMON_DEST="/Library/LaunchDaemons/$LABEL.plist"
TOKEN_FILE="/var/run/com.harness.pf-bundle-host.token"
IFACE_FILE="/var/run/com.harness.pf-bundle-host.iface"
TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE" 2>/dev/null)"

if [[ "$ANCHOR" != com.apple/?* ]]; then
  echo "error: unexpected anchor name '$ANCHOR'; refusing to flush anything." >&2
  exit 1
fi

cat <<EOF
uninstall-pf-anchor.sh will:
  1. unload and remove the LaunchDaemon $DAEMON_DEST
  2. flush only the pf anchor $ANCHOR (pfctl -a "$ANCHOR" -F all)
  3. release this install's pf enable reference: ${TOKEN:-none recorded}
     (pf stays enabled if anything else holds a reference; pf is never disabled)
  4. remove $SUPPORT_DIR and the state files in /var/run
Afterwards the bundle host on 8081 is reachable from the LAN again.

EOF

if [[ -t 0 && "${1:-}" != "--yes" ]]; then
  read -r -p "Proceed? [y/N] " answer
  [[ "$answer" == [yY] ]] || { echo "Cancelled. Nothing was changed."; exit 1; }
fi

launchctl bootout "system/$LABEL" 2>/dev/null || true
rm -f "$DAEMON_DEST"
echo "Removed LaunchDaemon $LABEL"

/sbin/pfctl -a "$ANCHOR" -F all 2>&1 | grep -v -e '^$' | sed 's/^/  /'
echo "Flushed anchor $ANCHOR"

if [[ "$TOKEN" =~ ^[0-9]+$ ]]; then
  if /sbin/pfctl -X "$TOKEN" > /dev/null 2>&1; then
    echo "Released pf enable reference $TOKEN"
  else
    echo "pf enable reference $TOKEN was already released (e.g. by a reboot)"
  fi
fi

rm -f "$TOKEN_FILE" "$IFACE_FILE" "$SUPPORT_DIR/pf-bundle-host-load.sh" "$SUPPORT_DIR/tailnet-ip"
rmdir "$SUPPORT_DIR" 2>/dev/null || true
echo "Removed $SUPPORT_DIR"
echo "pf $(/sbin/pfctl -s info 2>/dev/null | head -1)"
