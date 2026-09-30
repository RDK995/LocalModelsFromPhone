#!/bin/bash
# Verification script for ops tooling installation scripts
# Validates that scripts exist, have correct permissions, and pass basic syntax checks

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPS_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Verifying ops installation scripts..."

# Check that all required scripts exist
required_scripts=(
  "install-server-agent.sh"
  "install-bundle-host-agent.sh"
  "install-search-agent.sh"
  "uninstall-search-agent.sh"
  "search-service-proof.sh"
  "configure-tailscale-serve.sh"
  "install-pf-anchor.sh"
  "uninstall-pf-anchor.sh"
  "pf-bundle-host-load.sh"
  "check-pf-rules.sh"
  "boot-readiness-check.sh"
)

for script in "${required_scripts[@]}"; do
  if [[ ! -f "$SCRIPT_DIR/$script" ]]; then
    echo "FAIL: Missing required script: $script"
    exit 1
  fi

  # Check shellcheck syntax (if available)
  if command -v shellcheck &> /dev/null; then
    if ! shellcheck "$SCRIPT_DIR/$script"; then
      echo "FAIL: Shellcheck validation failed for $script"
      exit 1
    fi
  fi

  # Check that script is executable
  if [[ ! -x "$SCRIPT_DIR/$script" ]]; then
    echo "FAIL: Script is not executable: $script"
    exit 1
  fi
done

echo "Verifying LaunchAgent plist files..."

# Check that required plist files exist
required_plists=(
  "com.harness.server.plist"
  "com.harness.bundle-host.plist"
  "com.harness.search.plist"
)

for plist in "${required_plists[@]}"; do
  if [[ ! -f "$SCRIPT_DIR/$plist" ]]; then
    echo "FAIL: Missing required plist: $plist"
    exit 1
  fi

  # Validate plist format (if plutil is available)
  if command -v plutil &> /dev/null; then
    if ! plutil -lint "$SCRIPT_DIR/$plist" > /dev/null; then
      echo "FAIL: Invalid plist format: $plist"
      exit 1
    fi
  fi
done

echo "Verifying LaunchAgent plist contents..."

REPO_ROOT="$(dirname "$OPS_ROOT")"
BUN_PATH="/opt/homebrew/bin/bun"

# plist_has <plist> <literal string>  (checks a <string> value is present)
plist_has() {
  grep -qF "<string>$2</string>" "$SCRIPT_DIR/$1"
}

for plist in "${required_plists[@]}"; do
  if ! plist_has "$plist" "$BUN_PATH"; then
    echo "FAIL: $plist does not run bun at $BUN_PATH"
    exit 1
  fi
  if grep -q "/usr/local/bin/bun" "$SCRIPT_DIR/$plist"; then
    echo "FAIL: $plist references /usr/local/bin/bun"
    exit 1
  fi
  if grep -q "<string>/var/log/" "$SCRIPT_DIR/$plist"; then
    echo "FAIL: $plist logs to /var/log (not writable by a per-user LaunchAgent)"
    exit 1
  fi
  if grep -q "~" "$SCRIPT_DIR/$plist"; then
    echo "FAIL: $plist contains '~' (launchd does not expand it)"
    exit 1
  fi
done

# Server (C4): bun src/index.ts in server/, no test-only overrides.
if ! plist_has com.harness.server.plist "$REPO_ROOT/server" || \
   ! plist_has com.harness.server.plist "src/index.ts"; then
  echo "FAIL: com.harness.server.plist must run src/index.ts in $REPO_ROOT/server"
  exit 1
fi
if [[ ! -f "$REPO_ROOT/server/src/index.ts" ]]; then
  echo "FAIL: server entry point missing: $REPO_ROOT/server/src/index.ts"
  exit 1
fi
if grep -qE "PHONE_MODELS_PORT|PHONE_MODELS_TOKEN_FILE" "$SCRIPT_DIR/com.harness.server.plist"; then
  echo "FAIL: com.harness.server.plist sets a test-only override"
  exit 1
fi

# Bundle host (C8): Expo dev server in mobile/, --no-dev --minify, port 8081,
# REACT_NATIVE_PACKAGER_HOSTNAME = the Mac's tailnet name.
for value in "$REPO_ROOT/mobile" "expo" "start" "--no-dev" "--minify" "8081" \
             "REACT_NATIVE_PACKAGER_HOSTNAME" "ryans-mac-studio.tailc3648a.ts.net"; do
  if ! grep -qF -- "$value" "$SCRIPT_DIR/com.harness.bundle-host.plist"; then
    echo "FAIL: com.harness.bundle-host.plist missing: $value"
    exit 1
  fi
done

# Search (C13): bun src/index.ts in search/, binds 127.0.0.1:7790 only, no token, no test-only overrides.
if ! plist_has com.harness.search.plist "$REPO_ROOT/search" || \
   ! plist_has com.harness.search.plist "src/index.ts"; then
  echo "FAIL: com.harness.search.plist must run src/index.ts in $REPO_ROOT/search"
  exit 1
fi
if [[ ! -f "$REPO_ROOT/search/src/index.ts" ]]; then
  echo "FAIL: search entry point missing: $REPO_ROOT/search/src/index.ts"
  exit 1
fi
if grep -qE "SEARCH_PORT|SEARCH_TIMEOUT_MS|SEARCH_HELPER_FORCE" "$SCRIPT_DIR/com.harness.search.plist"; then
  echo "FAIL: com.harness.search.plist sets a test-only override"
  exit 1
fi

echo "Verifying Tailscale Serve script..."

SERVE_SCRIPT="$SCRIPT_DIR/configure-tailscale-serve.sh"
if ! grep -q 'HTTPS_PORT=8443' "$SERVE_SCRIPT" || \
   ! grep -q 'TARGET="http://127.0.0.1:7789"' "$SERVE_SCRIPT" || \
   ! grep -q 'serve --bg --https="$HTTPS_PORT" "$TARGET"' "$SERVE_SCRIPT"; then
  echo "FAIL: configure-tailscale-serve.sh must map tailnet HTTPS 8443 -> http://127.0.0.1:7789 (--bg)"
  exit 1
fi
# Only comments may mention reset/funnel/remove; no command may use them.
if grep -vE '^[[:space:]]*#' "$SERVE_SCRIPT" | grep -qE 'serve reset|tailscale funnel|"\$TAILSCALE" funnel|--remove|--set-path'; then
  echo "FAIL: configure-tailscale-serve.sh must not reset, remove, set paths, or use Funnel"
  exit 1
fi

echo "Verifying token command integration..."

# Check that token command is properly integrated
if [[ ! -f "$OPS_ROOT/src/token.ts" ]]; then
  echo "FAIL: Missing token.ts"
  exit 1
fi

# Verify token.ts exports required functions
for func in generateToken isFileWorldOrGroupReadable writeTokenToFile ensureTokenFile; do
  if ! grep -q "export.*$func" "$OPS_ROOT/src/token.ts"; then
    echo "FAIL: Missing export: $func"
    exit 1
  fi
done

echo "Verifying pf anchor configuration..."

# LaunchDaemon (root, /Library/LaunchDaemons when installed) that loads the anchor at boot.
PF_DAEMON_PLIST="$SCRIPT_DIR/com.harness.pf-bundle-host.plist"
if [[ ! -f "$PF_DAEMON_PLIST" ]]; then
  echo "FAIL: Missing LaunchDaemon plist: com.harness.pf-bundle-host.plist"
  exit 1
fi
if ! plutil -lint "$PF_DAEMON_PLIST" > /dev/null; then
  echo "FAIL: Invalid plist format: com.harness.pf-bundle-host.plist"
  exit 1
fi

# No-sudo safety check: the rendered rules are port-scoped to inbound TCP 8081,
# the anchor is under com.apple/, and the scripts never disable pf, flush the main
# ruleset or edit the system pf.conf.
if ! bash "$SCRIPT_DIR/check-pf-rules.sh"; then
  echo "FAIL: pf anchor safety check failed"
  exit 1
fi

echo "All verification checks passed!"
exit 0
