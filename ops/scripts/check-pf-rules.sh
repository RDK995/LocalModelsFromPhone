#!/bin/bash
# No-sudo safety check for the bundle-host pf anchor (C9, FR14, review F5/F6).
#
# Renders the anchor rules with the real loader (pf-bundle-host-load.sh --render)
# and proves they are port-scoped: they can only ever touch inbound TCP 8081.
# Also checks the install/uninstall/loader scripts never disable pf, never flush
# the main ruleset and never edit the system pf.conf, and that the LaunchDaemon
# plist is valid and runs the root-owned installed copy of the loader.
#
# Never runs sudo and never changes pf: the only pfctl call is `pfctl -n`
# (parse only), which works without root on macOS.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOADER="$SCRIPT_DIR/pf-bundle-host-load.sh"
INSTALL="$SCRIPT_DIR/install-pf-anchor.sh"
UNINSTALL="$SCRIPT_DIR/uninstall-pf-anchor.sh"
DAEMON_PLIST="$SCRIPT_DIR/com.harness.pf-bundle-host.plist"
INSTALLED_LOADER="/Library/Application Support/com.harness.pf-bundle-host/pf-bundle-host-load.sh"

FAILURES=0
ok() { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
expect() { # expect <description> <command...>
  local desc="$1"; shift
  if "$@"; then ok "$desc"; else bad "$desc"; fi
}

echo "pf anchor safety check (no sudo)"

for f in "$LOADER" "$INSTALL" "$UNINSTALL" "$DAEMON_PLIST"; do
  if [[ ! -f "$f" ]]; then
    bad "exists: ${f#"$SCRIPT_DIR"/}"
  fi
done
if [[ $FAILURES -ne 0 ]]; then
  echo "pf anchor safety check: $FAILURES failure(s)"
  exit 1
fi

# --- Anchor name --------------------------------------------------------------
ANCHOR="$(bash "$LOADER" --anchor)"
expect "anchor name '$ANCHOR' is under com.apple/ (evaluated by the stock pf.conf 'anchor \"com.apple/*\"')" \
  bash -c '[[ "$1" == com.apple/?* && "$1" != *" "* ]]' _ "$ANCHOR"

# --- Rendered rules -------------------------------------------------------------
# rule_lines <text>: the non-blank, non-comment lines (what pf actually loads).
rule_lines() { grep -vE '^[[:space:]]*(#|$)' <<< "$1"; }

check_rules_for() {
  local utun="$1" text rules n i line lo_idx=-1 ut_idx=-1 blk_idx=-1
  text="$(bash "$LOADER" --render "$utun")"
  expect "[$utun] renderer exits 0" test $? -eq 0
  rules="$(rule_lines "$text")"
  n="$(printf '%s\n' "$rules" | grep -c .)"
  expect "[$utun] exactly 3 rule lines (got $n)" test "$n" -eq 3

  i=0
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    expect "[$utun] rule $i contains 'port 8081': $line" bash -c '[[ "$1" == *"port 8081"* ]]' _ "$line"
    expect "[$utun] rule $i is an inbound quick rule (no out, no bare pass/block)" \
      bash -c '[[ "$1" =~ ^(pass\ in\ quick\ on\ [a-z0-9]+|block\ drop\ in\ quick)\ proto\ tcp\ from\ any\ to\ any\ port\ 8081$ ]]' _ "$line"
    expect "[$utun] rule $i has no out/all/table/scrub/nat/rdr/anchor keywords" \
      bash -c '! grep -qwE "out|all|table|scrub|nat|rdr|binat|anchor|set|antispoof|<" <<< "$1"' _ "$line"
    case "$line" in
      "pass in quick on lo0 proto tcp from any to any port 8081") lo_idx=$i ;;
      "pass in quick on $utun proto tcp from any to any port 8081") ut_idx=$i ;;
      "block drop in quick proto tcp from any to any port 8081") blk_idx=$i ;;
    esac
    i=$((i + 1))
  done <<< "$rules"

  expect "[$utun] no 'block all' anywhere in the rendered text" bash -c '! grep -qiE "block[[:space:]]+(drop[[:space:]]+|return[[:space:]]+)?all" <<< "$1"' _ "$text"
  expect "[$utun] lo0 pass rule present" test "$lo_idx" -ge 0
  expect "[$utun] $utun pass rule present" test "$ut_idx" -ge 0
  expect "[$utun] 8081 block rule present" test "$blk_idx" -ge 0
  expect "[$utun] lo0 ($lo_idx) and $utun ($ut_idx) pass rules precede the block ($blk_idx)" \
    bash -c '(( $1 >= 0 && $2 >= 0 && $1 < $3 && $2 < $3 ))' _ "$lo_idx" "$ut_idx" "$blk_idx"

  # Parse check with pfctl -n (no root needed on macOS; nothing is loaded).
  if printf 'pass in quick on lo0 proto tcp from any to any port 8081\n' | pfctl -n -f - > /dev/null 2>&1; then
    local perr
    perr="$(printf '%s\n' "$text" | pfctl -n -a "$ANCHOR" -f - 2>&1 | grep -v -e 'Use of -f option' -e 'present in the main ruleset' -e 'See /etc/pf.conf' -e '^$')"
    expect "[$utun] pfctl -n parses the rendered rules${perr:+: $perr}" test -z "$perr"
  else
    echo "  SKIP  [$utun] pfctl -n -f does not work without root here; rules not parse-checked"
  fi
}

check_rules_for utun4
check_rules_for utun12

# --- Renderer refuses anything that is not a utun interface ---------------------
for badif in "" "en0" "lo0" "utun" "utun4 " "utun4; block all" "utun4
block all" "any"; do
  out="$(bash "$LOADER" --render "$badif" 2>/dev/null)"; e=$?
  expect "renderer refuses interface '$(printf '%q' "$badif")' (exit $e, no output)" \
    bash -c '[[ $1 -ne 0 && -z "$2" ]]' _ "$e" "$out"
done

# --- Interface resolution (read-only: ifconfig) ---------------------------------
IFCONFIG_FIXTURE="$(printf '%s\n' \
  'lo0: flags=8049<UP,LOOPBACK,RUNNING,MULTICAST> mtu 16384' \
  '	inet 127.0.0.1 netmask 0xff000000' \
  'en1: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500' \
  '	inet 192.168.0.27 netmask 0xffffff00 broadcast 192.168.0.255' \
  'utun7: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1280' \
  '	inet 100.82.139.85 --> 100.82.139.85 netmask 0xffffffff' \
  'utun8: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1280' \
  '	inet 100.82.139.850 --> 100.82.139.850 netmask 0xffffffff')"
got="$(bash "$LOADER" --resolve 100.82.139.85 <<< "$IFCONFIG_FIXTURE")"
expect "resolver finds the utun carrying the tailnet IP (got '$got', want utun7)" test "$got" = utun7
bash "$LOADER" --resolve 192.168.0.27 <<< "$IFCONFIG_FIXTURE" > /dev/null 2>&1
expect "resolver refuses a non-utun interface (the LAN IP on en1)" test $? -ne 0
bash "$LOADER" --resolve 100.64.0.1 <<< "$IFCONFIG_FIXTURE" > /dev/null 2>&1
expect "resolver fails when no interface carries the IP" test $? -ne 0
bash "$LOADER" --resolve "" <<< "$IFCONFIG_FIXTURE" > /dev/null 2>&1
expect "resolver fails on an empty IP" test $? -ne 0

# --- Root-only entry points refuse to run without root --------------------------
if [[ $EUID -ne 0 ]]; then
  for s in "$LOADER" "$INSTALL" "$UNINSTALL"; do
    out="$(bash "$s" 2>&1 < /dev/null)"; e=$?
    expect "$(basename "$s") refuses to run without root (exit $e)" \
      bash -c '[[ $1 -ne 0 && "$2" == *"must be run as root"* ]]' _ "$e" "$out"
  done
fi

# --- Script-level safety: nothing can touch other traffic or the main ruleset ---
# Only command lines are inspected (comments stripped).
for s in "$LOADER" "$INSTALL" "$UNINSTALL"; do
  b="$(basename "$s")"
  expect "$b never disables pf (no 'pfctl -d')" bash -c '! grep -vE "^[[:space:]]*#" "$1" | grep -qE "pfctl[^|;&]*[[:space:]]-d([[:space:]]|$)"' _ "$s"
  expect "$b only flushes with an explicit anchor (-F only alongside -a \"\$ANCHOR\")" \
    bash -c '! grep -vE "^[[:space:]]*#" "$1" | grep -E "pfctl[^|;&]*[[:space:]]-F" | grep -vqF -- "-a \"\$ANCHOR\""' _ "$s"
  expect "$b loads rules only into the anchor (every 'pfctl ... -f' has -a \"\$ANCHOR\" or -n)" \
    bash -c '! grep -vE "^[[:space:]]*#" "$1" | grep -E "pfctl[^|;&]*[[:space:]]-f" | grep -vF -- "-a \"\$ANCHOR\"" | grep -qvE "pfctl[^|;&]*[[:space:]]-n"' _ "$s"
  expect "$b never writes the system pf.conf or pf.anchors" \
    bash -c '! grep -vE "^[[:space:]]*#" "$1" | grep -qE "/etc/pf\.(conf|anchors)"' _ "$s"
done

# No file in ops/scripts (other than this checker) carries 'block all' or tells
# anyone to edit the system pf.conf.
offenders="$(grep -rlE 'block[[:space:]]+(drop[[:space:]]+)?all|/etc/pf\.conf' "$SCRIPT_DIR" | grep -v "/check-pf-rules.sh$")"
expect "no file in ops/scripts carries 'block all' or refers to editing /etc/pf.conf${offenders:+: $offenders}" test -z "$offenders"
for old in com.harness.pf.anchor create-pf-anchor.sh; do
  expect "unsafe legacy file $old is gone" test ! -e "$SCRIPT_DIR/$old"
done

# --- LaunchDaemon plist ----------------------------------------------------------
expect "LaunchDaemon plist passes plutil -lint" plutil -lint "$DAEMON_PLIST"
pl() { plutil -extract "$1" raw -o - "$DAEMON_PLIST" 2>/dev/null; }
expect "plist Label is com.harness.pf-bundle-host" test "$(pl Label)" = com.harness.pf-bundle-host
expect "plist RunAtLoad is true" test "$(pl RunAtLoad)" = true
expect "plist runs /bin/bash" test "$(pl ProgramArguments.0)" = /bin/bash
expect "plist runs the root-owned installed loader ($INSTALLED_LOADER), not the repo copy" \
  test "$(pl ProgramArguments.1)" = "$INSTALLED_LOADER"
expect "install script installs the loader to the path the plist runs" \
  grep -qF 'SUPPORT_DIR="/Library/Application Support/com.harness.pf-bundle-host"' "$INSTALL"

if [[ $FAILURES -eq 0 ]]; then
  echo "pf anchor safety check: all passed"
  exit 0
fi
echo "pf anchor safety check: $FAILURES failure(s)"
exit 1
