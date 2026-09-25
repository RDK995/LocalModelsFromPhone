#!/usr/bin/env bash
# Runtime smoke check for the phone app (see scripts/runtime-smoke.mjs for
# what it proves and what it cannot).
#
# Usage (from mobile/):
#   scripts/runtime-smoke.sh              export a fresh production iOS bundle
#                                         from the working tree and run it
#   scripts/runtime-smoke.sh <file|url>   run an existing bundle, e.g. the one
#                                         the bundle host serves (its
#                                         manifest's launchAsset.url)
#
# Runs the app twice: with a stored token (first screen must be Chat) and
# without one (first screen must be Setup). Exits non-zero if either fails.
set -euo pipefail

cd "$(dirname "$0")/.."
work="$(mktemp -d "${TMPDIR:-/tmp}/runtime-smoke.XXXXXX")"
trap 'rm -rf "$work"' EXIT

src="${1:-}"
if [[ -z "$src" ]]; then
  npx expo export --platform ios --no-bytecode --output-dir "$work/dist" >"$work/export.log" 2>&1 ||
    { cat "$work/export.log"; exit 1; }
  bundle="$(ls "$work"/dist/_expo/static/js/ios/*.js | head -n 1)"
elif [[ "$src" =~ ^https?:// ]]; then
  bundle="$work/served.js"
  curl -sfS --max-time 300 "$src" -o "$bundle"
else
  bundle="$src"
fi

status=0
for token in present absent; do
  echo "=== token $token ==="
  node scripts/runtime-smoke.mjs "$bundle" --token="$token" || status=1
done
exit "$status"
