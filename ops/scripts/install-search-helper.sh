#!/bin/bash
# Install the search helper's Python venv (C9/C14)
# Creates search/helper/.venv from Homebrew Python 3.14 (only if absent),
# installs the pinned requirements (ddgs, playwright) and downloads Chromium
# via playwright. Idempotent; needs network. No account, key or payment used.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PYTHON="/opt/homebrew/bin/python3.14"
HELPER_DIR="$REPO_ROOT/search/helper"
VENV="$HELPER_DIR/.venv"
VENV_PY="$VENV/bin/python"
REQUIREMENTS="$HELPER_DIR/requirements.txt"

if [[ ! -x "$PYTHON" ]]; then
  echo "Error: Python 3.14 not found at $PYTHON (install with: brew install python@3.14)"
  exit 1
fi

if [[ ! -f "$REQUIREMENTS" ]]; then
  echo "Error: requirements file not found: $REQUIREMENTS"
  exit 1
fi

if [[ ! -x "$VENV_PY" ]]; then
  echo "Creating venv at $VENV"
  "$PYTHON" -m venv "$VENV"
fi

"$VENV_PY" -m pip install --disable-pip-version-check --quiet -r "$REQUIREMENTS"
"$VENV_PY" -m playwright install chromium

PY_VER="$("$VENV_PY" -c 'import platform; print(platform.python_version())')"
DDGS_VER="$("$VENV_PY" -c 'from importlib.metadata import version; print(version("ddgs"))')"
PW_VER="$("$VENV_PY" -c 'from importlib.metadata import version; print(version("playwright"))')"

echo "search helper ready: python $PY_VER, ddgs $DDGS_VER, playwright $PW_VER"
exit 0
