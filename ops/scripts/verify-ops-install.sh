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
  "configure-tailscale-serve.sh"
  "create-pf-anchor.sh"
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

# Check that pf anchor files exist
if [[ ! -f "$SCRIPT_DIR/com.harness.pf.anchor" ]]; then
  echo "FAIL: Missing pf anchor file: com.harness.pf.anchor"
  exit 1
fi

echo "All verification checks passed!"
exit 0
