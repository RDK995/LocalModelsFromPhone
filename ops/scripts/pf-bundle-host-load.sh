#!/bin/bash
# pf loader for the app bundle host (C9, FR14, I12-I14, risk R1).
#
# The Expo bundle host (C8) listens on *:8081. This loader limits inbound TCP 8081
# to loopback and the Tailscale utun interface with three port-scoped rules in the
# pf anchor com.apple/harness.bundle-host. The stock macOS pf.conf already
# evaluates every com.apple/* anchor, so the system pf.conf is not changed.
# The rules match only inbound TCP to port 8081; no other traffic is affected.
#
# Modes:
#   --anchor          print the anchor name (no root)
#   --render UTUN     print the rules for interface UTUN (no root, loads nothing)
#   --resolve IP      print the utun interface that carries IP; reads `ifconfig`
#                     output from stdin when stdin is not a terminal (no root)
#   (no arguments)    as root: resolve the utun from the recorded tailnet IP, load
#                     the rules into the anchor and hold a pf enable reference.
#                     Run at boot and every 60 s by the LaunchDaemon
#                     com.harness.pf-bundle-host (installed by install-pf-anchor.sh).
#                     If the utun cannot be resolved it exits non-zero WITHOUT
#                     loading anything.
#
# pf is only ever enabled with a reference (pfctl -E); this script never disables
# pf and never touches the main ruleset.

set -uo pipefail

ANCHOR="com.apple/harness.bundle-host"
SUPPORT_DIR="/Library/Application Support/com.harness.pf-bundle-host"
IP_FILE="$SUPPORT_DIR/tailnet-ip"
TOKEN_FILE="/var/run/com.harness.pf-bundle-host.token"
IFACE_FILE="/var/run/com.harness.pf-bundle-host.iface"

# render_rules <utun>: the complete anchor ruleset. Every rule is inbound, quick,
# TCP and port 8081. `quick` makes the first match final, so the two pass rules
# must come before the block.
render_rules() {
  local utun="$1"
  if [[ ! "$utun" =~ ^utun[0-9]+$ ]]; then
    echo "error: not a utun interface name: '$utun'" >&2
    return 1
  fi
  cat <<EOF
# com.harness.pf-bundle-host: inbound TCP 8081 only on lo0 and the Tailscale interface.
pass in quick on lo0 proto tcp from any to any port 8081
pass in quick on $utun proto tcp from any to any port 8081
block drop in quick proto tcp from any to any port 8081
EOF
}

# resolve_utun <ipv4>: reads `ifconfig` output on stdin, prints the single utun
# interface carrying <ipv4>. Fails for anything else.
resolve_utun() {
  local ip="$1" ifc
  if [[ ! "$ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
    echo "error: not an IPv4 address: '$ip'" >&2
    return 1
  fi
  ifc="$(awk -v ip="$ip" '
    /^[^[:space:]]/ { ifc = $1; sub(/:$/, "", ifc) }
    $1 == "inet" && $2 == ip { print ifc }' | sort -u)"
  if [[ ! "$ifc" =~ ^utun[0-9]+$ ]]; then
    echo "error: no single utun interface carries $ip (found: '${ifc//$'\n'/ }')" >&2
    return 1
  fi
  printf '%s\n' "$ifc"
}

log() { printf '%s pf-bundle-host: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

pf_enabled() { /sbin/pfctl -s info 2>/dev/null | grep -q '^Status: Enabled'; }

load() {
  if [[ $EUID -ne 0 ]]; then
    echo "error: pf-bundle-host-load.sh must be run as root (it loads pf rules)" >&2
    return 1
  fi
  local ip utun tmp out token old

  if [[ ! -r "$IP_FILE" ]]; then
    log "error: tailnet IP not recorded in $IP_FILE (run install-pf-anchor.sh); nothing loaded"
    return 1
  fi
  ip="$(tr -d '[:space:]' < "$IP_FILE")"
  if ! utun="$(/sbin/ifconfig | resolve_utun "$ip" 2>&1)"; then
    log "cannot resolve the Tailscale interface for $ip ($utun); nothing loaded"
    return 1
  fi

  tmp="$(mktemp /tmp/pf-bundle-host.XXXXXX)" || return 1
  RULES_TMP="$tmp"
  trap 'rm -f "$RULES_TMP"' EXIT
  render_rules "$utun" > "$tmp" || return 1
  if ! out="$(/sbin/pfctl -n -a "$ANCHOR" -f "$tmp" 2>&1)"; then
    log "error: rules for $utun failed to parse; nothing loaded: $out"
    return 1
  fi

  # Already loaded for this interface, with our reference held: nothing to do.
  if [[ "$(cat "$IFACE_FILE" 2>/dev/null)" == "$utun" && -s "$TOKEN_FILE" ]] && pf_enabled && \
     /sbin/pfctl -a "$ANCHOR" -s rules 2>/dev/null | grep -q 'port = 8081'; then
    return 0
  fi

  if ! out="$(/sbin/pfctl -a "$ANCHOR" -f "$tmp" 2>&1)"; then
    log "error: loading anchor $ANCHOR failed: $out"
    return 1
  fi
  printf '%s\n' "$utun" > "$IFACE_FILE"
  log "loaded anchor $ANCHOR for lo0 and $utun (tailnet IP $ip)"

  if ! pf_enabled || [[ ! -s "$TOKEN_FILE" ]]; then
    old="$(cat "$TOKEN_FILE" 2>/dev/null)"
    out="$(/sbin/pfctl -E 2>&1)"
    token="$(sed -n 's/^Token : \([0-9][0-9]*\).*/\1/p' <<< "$out" | head -1)"
    if [[ -z "$token" ]]; then
      log "error: pfctl -E did not return a reference token: $out"
      return 1
    fi
    [[ "$old" =~ ^[0-9]+$ ]] && /sbin/pfctl -X "$old" > /dev/null 2>&1
    printf '%s\n' "$token" > "$TOKEN_FILE"
    log "pf enabled with reference token $token"
  fi
  /sbin/pfctl -a "$ANCHOR" -s rules 2>/dev/null | sed 's/^/    /'
  return 0
}

case "${1:-}" in
  --anchor)
    printf '%s\n' "$ANCHOR" ;;
  --render)
    render_rules "${2-}" ;;
  --resolve)
    if [[ -t 0 ]]; then /sbin/ifconfig | resolve_utun "${2-}"; else resolve_utun "${2-}"; fi ;;
  "")
    load ;;
  *)
    echo "usage: $0 [--anchor | --render UTUN | --resolve IP]" >&2
    exit 2 ;;
esac
