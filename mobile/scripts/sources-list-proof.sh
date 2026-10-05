#!/bin/bash
# Live proof wrapper: M10d Sources list (FR28 / FR27; AC22). Runs a real web-on chat through the
# server's POST /v1/chat on its OWN server (spare port, never 7789), using the RESIDENT tools-capable
# Ollama model (never loads, switches or evicts one), then sources-list-proof.ts checks the phone
# app's Sources list view-model over the saved sources. Logos come from the real Mac /v1/icon.
# The proof server's token lives in a private 0600 temp file and is never printed or saved.
# `--self-test` runs only the offline checks (no server, model or network).
# Output: .harness/evidence/M10d-T2-proof.log ; replies: .harness/evidence/M10d-T2-replies.json

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUN="${BUN:-$(command -v bun || echo /opt/homebrew/bin/bun)}"

if [[ "${1:-}" == "--self-test" ]]; then
  cd "$REPO_ROOT/mobile" && exec "$BUN" scripts/sources-list-proof.ts --self-test
fi

OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
SEARCH="http://127.0.0.1:7790"
SERVER_URL="${SERVER_URL:-https://ryans-mac-studio.tailc3648a.ts.net:8443}"
export SERVER_URL
EVIDENCE_DIR="$REPO_ROOT/.harness/evidence"
mkdir -p "$EVIDENCE_DIR"
PROOF_LOG="$EVIDENCE_DIR/M10d-T2-proof.log"
export REPLIES_JSON="$EVIDENCE_DIR/M10d-T2-replies.json"

# Re-exec with output tee'd to the evidence log (keeps the exit status).
if [[ -z "${SLP_TEE:-}" ]]; then
  export SLP_TEE=1
  bash "${BASH_SOURCE[0]}" "$@" 2>&1 | tee "$PROOF_LOG"
  exit "${PIPESTATUS[0]}"
fi

die() { echo "FAIL: $1"; exit 1; }

WORK_DIR="$(mktemp -d)"
PIDS=()
cleanup() {
  for p in "${PIDS[@]:-}"; do
    [[ -n "$p" ]] && kill "$p" 2>/dev/null
  done
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT INT TERM

nap() { "$BUN" -e 'await new Promise((r) => setTimeout(r, 200))'; }

echo "=== Sources List Live Proof ==="

echo ""
echo "--- Check 7: bundle freshness ---"
launchctl kickstart -k "gui/$(id -u)/com.harness.bundle-host" || die "could not restart com.harness.bundle-host"
echo "PASS: restarted com.harness.bundle-host at $(date '+%Y-%m-%d %H:%M:%S %Z') so the phone downloads the new code"

[[ -x "$BUN" ]] || die "bun not available"
curl -s -o /dev/null --max-time 5 "$OLLAMA_URL/api/tags" || die "Ollama not reachable at $OLLAMA_URL"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$SEARCH/v1/health") || code=000
[[ "$code" == "200" ]] || die "search service GET /v1/health returned $code (need 200)"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$SERVER_URL/v1/state") || code=000
[[ "$code" == "401" ]] || die "Mac server at $SERVER_URL did not answer 401 on /v1/state (got $code)"
echo "Preflight ok: bun, Ollama, search service, Mac server"

echo ""
echo "--- Recording Ollama state (before proof) ---"
BEFORE_PS=$(curl -s --max-time 30 "$OLLAMA_URL/api/ps")
echo "Before: $BEFORE_PS"
BEFORE_MODEL=$(echo "$BEFORE_PS" | jq -r '.models[0].name // empty')
echo "Resident before: ${BEFORE_MODEL:-(none)}"

MODEL=$(echo "$BEFORE_PS" | "$BUN" -e '
  const ps = JSON.parse(await Bun.stdin.text());
  for (const m of ps.models ?? []) {
    const r = await fetch("http://127.0.0.1:11434/api/show", {method:"POST", body: JSON.stringify({model: m.name})});
    const j = await r.json();
    if ((j.capabilities ?? []).includes("tools")) { console.log(m.name); break; }
  }') || MODEL=""
[[ -n "$MODEL" ]] || die "no tools-capable model is loaded in Ollama; load one first (this proof will not load or switch models)"
echo "Resident model with tools: $MODEL"

SERVER_PORT=$("$BUN" -e 'const s = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => new Response("")}); console.log(s.port); s.stop(true);')
TOKEN_FILE="$WORK_DIR/token"
( umask 077; "$BUN" -e 'console.log(crypto.randomUUID() + crypto.randomUUID())' > "$TOKEN_FILE" )
chmod 600 "$TOKEN_FILE"
AUTH_HEADER_FILE="$WORK_DIR/auth"
( umask 077; printf 'Authorization: Bearer %s\n' "$(tr -d '[:space:]' < "$TOKEN_FILE")" > "$AUTH_HEADER_FILE" )

(cd "$REPO_ROOT/server" && PHONE_MODELS_PORT="$SERVER_PORT" PHONE_MODELS_TOKEN_FILE="$TOKEN_FILE" \
  exec "$BUN" src/index.ts > "$WORK_DIR/server.out" 2>&1) & PIDS+=($!)
CHAT_URL="http://127.0.0.1:$SERVER_PORT"

up=0
for _ in $(seq 1 50); do
  c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$CHAT_URL/v1/state" -H "@$AUTH_HEADER_FILE") || c=000
  [[ "$c" == "200" ]] && { up=1; break; }
  nap
done
[[ "$up" == 1 ]] || die "proof server did not come up on port $SERVER_PORT"
echo "Proof server on $CHAT_URL"

echo ""
echo "--- Running proof (mobile/scripts/sources-list-proof.ts) ---"
cd "$REPO_ROOT/mobile"
CHAT_URL="$CHAT_URL" CHAT_TOKEN_FILE="$TOKEN_FILE" CHAT_MODEL="$MODEL" "$BUN" scripts/sources-list-proof.ts
CODE=$?

echo ""
echo "--- Check 1: resident model unchanged ---"
AFTER_PS=$(curl -s --max-time 30 "$OLLAMA_URL/api/ps")
echo "After: $AFTER_PS"
AFTER_MODEL=$(echo "$AFTER_PS" | jq -r '.models[0].name // empty')
if [ "$BEFORE_MODEL" = "$AFTER_MODEL" ]; then
  echo "PASS: resident model unchanged (${AFTER_MODEL:-none})"
else
  echo "FAIL: resident model changed from '${BEFORE_MODEL:-none}' to '${AFTER_MODEL:-none}'"
  [ "$CODE" -eq 0 ] && CODE=1
fi

if [ "$CODE" -ne 0 ]; then
  echo "=== Proof FAILED (exit $CODE) ==="
else
  echo "=== Proof PASSED ==="
fi
exit $CODE
