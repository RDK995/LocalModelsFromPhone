#!/bin/bash
# Install the bundle-host pf anchor (C9, FR14). Run ONCE by the human:
#
#   sudo bash ops/scripts/install-pf-anchor.sh
#
# What it does (it prints this, with the real values, before doing anything):
#   1. finds the Mac's tailnet IPv4 (`tailscale ip -4`, run as the invoking user)
#      and the utun interface that carries it (`ifconfig`); if either cannot be
#      found it stops WITHOUT changing anything;
#   2. copies pf-bundle-host-load.sh to a root-owned directory and records the
#      tailnet IP there;
#   3. installs the LaunchDaemon com.harness.pf-bundle-host, which runs the loader
#      at boot and every 60 s;
#   4. loads three port-scoped rules into the anchor com.apple/harness.bundle-host
#      (inbound TCP 8081 passes on lo0 and the utun, and is dropped everywhere
#      else) and enables pf with a reference (pfctl -E).
# The system pf.conf is not changed, pf is never disabled, and no rule matches
# anything other than inbound TCP 8081. Undo with uninstall-pf-anchor.sh.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "error: install-pf-anchor.sh must be run as root: sudo bash ops/scripts/install-pf-anchor.sh" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOADER_SRC="$SCRIPT_DIR/pf-bundle-host-load.sh"
LABEL="com.harness.pf-bundle-host"
PLIST_SRC="$SCRIPT_DIR/$LABEL.plist"
SUPPORT_DIR="/Library/Application Support/com.harness.pf-bundle-host"
LOADER_DEST="$SUPPORT_DIR/pf-bundle-host-load.sh"
IP_FILE="$SUPPORT_DIR/tailnet-ip"
DAEMON_DEST="/Library/LaunchDaemons/$LABEL.plist"
ANCHOR="$(bash "$LOADER_SRC" --anchor)"

for f in "$LOADER_SRC" "$PLIST_SRC"; do
  [[ -f "$f" ]] || { echo "error: missing $f" >&2; exit 1; }
done

# 1. Tailnet IP (as the invoking user, so root never runs the user's tailscale CLI).
TS_IP=""
for ts in "${TAILSCALE:-}" /usr/local/bin/tailscale /opt/homebrew/bin/tailscale \
          /Applications/Tailscale.app/Contents/MacOS/Tailscale; do
  [[ -n "$ts" && -x "$ts" ]] || continue
  if [[ -n "${SUDO_USER:-}" && "$SUDO_USER" != root ]]; then
    TS_IP="$(sudo -u "$SUDO_USER" "$ts" ip -4 2>/dev/null | head -1 | tr -d '[:space:]')" || TS_IP=""
  else
    TS_IP="$("$ts" ip -4 2>/dev/null | head -1 | tr -d '[:space:]')" || TS_IP=""
  fi
  [[ -n "$TS_IP" ]] && break
done
if [[ -z "$TS_IP" ]]; then
  echo "error: could not read the Mac's tailnet IPv4 with 'tailscale ip -4' (is Tailscale running and logged in?)." >&2
  echo "Nothing was changed." >&2
  exit 1
fi
if ! UTUN="$(/sbin/ifconfig | bash "$LOADER_SRC" --resolve "$TS_IP")"; then
  echo "error: no utun interface carries the tailnet IP $TS_IP. Nothing was changed." >&2
  exit 1
fi
RULES="$(bash "$LOADER_SRC" --render "$UTUN")"
if ! PARSE="$(printf '%s\n' "$RULES" | /sbin/pfctl -n -a "$ANCHOR" -f - 2>&1)"; then
  echo "error: the rendered rules failed pfctl's parse check. Nothing was changed." >&2
  echo "$PARSE" >&2
  exit 1
fi

cat <<EOF
install-pf-anchor.sh will:
  1. copy $LOADER_SRC
     to   $LOADER_DEST (root:wheel, 755)
     and record the tailnet IP $TS_IP in $IP_FILE
  2. install the LaunchDaemon $DAEMON_DEST
     (runs the loader at boot and every 60 s; it re-finds the Tailscale interface each time)
  3. load these rules into the pf anchor $ANCHOR
     (tailnet IP $TS_IP is on $UTUN):
$(printf '%s\n' "$RULES" | sed 's/^/       /')
  4. enable pf with a reference (pfctl -E), recording the token so uninstall can release it
The system pf.conf is not changed, pf is never disabled, and only inbound TCP 8081 is affected.

EOF

if [[ -t 0 && "${1:-}" != "--yes" ]]; then
  read -r -p "Proceed? [y/N] " answer
  [[ "$answer" == [yY] ]] || { echo "Cancelled. Nothing was changed."; exit 1; }
fi

install -d -o root -g wheel -m 755 "$SUPPORT_DIR"
install -o root -g wheel -m 755 "$LOADER_SRC" "$LOADER_DEST"
printf '%s\n' "$TS_IP" > "$IP_FILE"
chown root:wheel "$IP_FILE"
chmod 644 "$IP_FILE"
echo "Installed loader: $LOADER_DEST (tailnet IP $TS_IP recorded)"

install -o root -g wheel -m 644 "$PLIST_SRC" "$DAEMON_DEST"
plutil -lint "$DAEMON_DEST" > /dev/null
echo "Installed LaunchDaemon: $DAEMON_DEST"

# Load now, in the foreground, so any error is shown here.
bash "$LOADER_DEST"

launchctl bootout "system/$LABEL" 2>/dev/null || true
launchctl bootstrap system "$DAEMON_DEST"
echo "LaunchDaemon $LABEL loaded (runs at boot)."

echo
echo "Rules now in anchor $ANCHOR:"
/sbin/pfctl -a "$ANCHOR" -s rules 2>/dev/null | sed 's/^/  /'
echo "pf $(/sbin/pfctl -s info 2>/dev/null | head -1)"
echo
echo "Done. Re-run ops/scripts/e2e-tailnet-proof.sh: the LAN 8081 check should now pass."
