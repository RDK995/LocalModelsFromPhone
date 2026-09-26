#!/bin/bash
# Live proof for M5b-T2 (FR16 / M5-AC3): each of the six failure modes,
# induced for real against the live Mac Studio server and the live Ollama,
# maps to its own distinct plain-language sentence through the app's own
# client (src/api/client.ts) and mapping (src/api/errorMessages.ts,
# src/ui/modelList.ts).
#
# How each failure mode is induced:
#   1. wrong password             -- client with a bogus token (no live
#      side effect; see model-swap-proof.ts etc. for the client-construction
#      pattern this reuses)
#   2. model no longer installed  -- `ollama cp` the smallest installed
#      model to a probe name, confirm it is listed, `ollama rm` it, then try
#      to load it
#   3. model failed to load       -- the mismatched-LoRA-adapter probe
#      technique proven in model-failed-load-proof.sh (see its header
#      comment): a GGUF LoRA adapter whose tensor shapes cannot match any
#      real model, attached via a Modelfile to the smallest installed model,
#      so the Ollama runner rejects the load
#   4. reply already in progress  -- a long chat while a second chat is sent
#   5. Ollama down                -- Ollama on this Mac runs as a plain
#      background process (`ollama serve`), not a LaunchAgent or brew
#      service (`launchctl list` and `brew services list` both show nothing
#      for it): stop it with `kill`, restart it the same way it was already
#      running (`ollama serve`, backgrounded, logging to the same file it
#      was already logging to)
#   6. Mac/server unreachable     -- `launchctl bootout` the server
#      LaunchAgent (it has KeepAlive, so a plain `kill` would just be
#      relaunched), then `launchctl bootstrap` it back
#
# All OS-level actions live in this script; scripts/error-messages-proof.ts
# (invoked once per scenario, selected by its first argument) only talks to
# the server over the tailnet and to Ollama's HTTP API directly, through the
# app's own client and plain-language mapping -- the same code paths the
# phone app itself uses.
#
# Restoration on ANY exit (trap): the server LaunchAgent loaded and
# answering 401, Ollama running and answering /api/tags, both probes removed
# with no Ollama blobs left behind, the scratch dir deleted, and the
# model(s) resident before this script ran restored with keep_alive -1.

set -u

SERVER_URL="${SERVER_URL:-https://ryans-mac-studio.tailc3648a.ts.net:8443}"
OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
BLOBS_DIR="${OLLAMA_BLOBS_DIR:-$HOME/.ollama/models/blobs}"
SERVER_PLIST="$HOME/Library/LaunchAgents/com.harness.server.plist"
OLLAMA_LOG="/private/tmp/ollama.log"
TIMEOUT=30
LOAD_TIMEOUT=300
NOT_INSTALLED_PROBE="m5b-gone-probe"
FAILED_LOAD_PROBE="m5b-failed-load-probe"
export SERVER_URL OLLAMA_URL

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

SCENARIO_RESULTS=()

echo "=== Plain-Language Error Mapping Live Proof (M5b-T2 / FR16) ==="
echo "date: $(date -u)"
echo ""

fail_now() {
  echo -e "${RED}FAIL: $1${NC}"
  exit 1
}

run_ts() {
  # Runs one scenario via the .ts script from the mobile/ directory,
  # streaming its output, capturing any "PASS <label>: ..." line it prints
  # into SCENARIO_RESULTS, and returning its exit status.
  local output status passline
  output=$(cd /Users/ryankenny/Projects/CodingHarnessv2/mobile && bun scripts/error-messages-proof.ts "$@" 2>&1)
  status=$?
  echo "$output"
  passline=$(echo "$output" | grep -m1 '^PASS ')
  if [ -n "$passline" ]; then
    SCENARIO_RESULTS+=("$passline")
  fi
  return $status
}

echo "--- Confirming the server is up before starting ---"
SERVER_READY=0
for i in $(seq 1 10); do
  HTTP_CODE=$(curl -s -o /dev/null --max-time "$TIMEOUT" -w '%{http_code}' "$SERVER_URL/v1/state")
  if [ "$HTTP_CODE" = "401" ]; then
    SERVER_READY=1
    break
  fi
  sleep 1
done
if [ "$SERVER_READY" -ne 1 ]; then
  fail_now "server is not answering 401 before starting (got $HTTP_CODE)"
fi
echo "Server answering 401"

echo ""
echo "--- Recording original state ---"
ORIGINAL_PS=$(curl -s --max-time "$TIMEOUT" "$OLLAMA_URL/api/ps")
echo "Before: $ORIGINAL_PS"
ORIGINAL_MODELS=$(echo "$ORIGINAL_PS" | jq -r '.models[].name')
if [ -n "$ORIGINAL_MODELS" ]; then
  echo "Originally resident: $(echo $ORIGINAL_MODELS)"
else
  echo "Originally resident: (none)"
fi
BLOBS_BEFORE=$(ls "$BLOBS_DIR" 2>/dev/null | sort)
SCRATCH_DIR=$(mktemp -d /private/tmp/m5b-t2-error-proof.XXXXXX)

CLEANUP_DONE=0
CLEANUP_FAILED=0

cleanup() {
  if [ "$CLEANUP_DONE" -eq 1 ]; then
    return
  fi
  CLEANUP_DONE=1

  echo ""
  echo "--- Cleanup: restoring the Mac to its original state ---"

  # Server LaunchAgent: make sure it's loaded, whatever state a scenario left it in.
  if ! launchctl print "gui/$(id -u)/com.harness.server" >/dev/null 2>&1; then
    echo "Server LaunchAgent not loaded; bootstrapping..."
    launchctl bootstrap "gui/$(id -u)" "$SERVER_PLIST" 2>&1
  fi
  SERVER_UP=0
  for i in $(seq 1 30); do
    HTTP_CODE=$(curl -s -o /dev/null --max-time "$TIMEOUT" -w '%{http_code}' "$SERVER_URL/v1/state")
    if [ "$HTTP_CODE" = "401" ]; then
      SERVER_UP=1
      break
    fi
    sleep 1
  done
  if [ "$SERVER_UP" -ne 1 ]; then
    echo -e "${RED}FAIL: server is not answering 401 after cleanup${NC}"
    CLEANUP_FAILED=1
  else
    echo "Server answering 401"
  fi

  # Ollama: make sure it's running.
  if ! curl -s -o /dev/null --max-time 5 "$OLLAMA_URL/api/tags"; then
    echo "Ollama not responding; starting it..."
    nohup ollama serve >>"$OLLAMA_LOG" 2>&1 &
    disown
  fi
  OLLAMA_UP=0
  for i in $(seq 1 30); do
    if curl -s -o /dev/null --max-time "$TIMEOUT" "$OLLAMA_URL/api/tags"; then
      OLLAMA_UP=1
      break
    fi
    sleep 1
  done
  if [ "$OLLAMA_UP" -ne 1 ]; then
    echo -e "${RED}FAIL: Ollama is not answering /api/tags after cleanup${NC}"
    CLEANUP_FAILED=1
  else
    echo "Ollama answering /api/tags"
  fi

  # Probes: remove if still present (e.g. the script failed partway through).
  for PROBE in "$NOT_INSTALLED_PROBE" "$FAILED_LOAD_PROBE"; do
    if ollama list 2>/dev/null | awk '{print $1}' | grep -q "^${PROBE}:"; then
      curl -s --max-time "$TIMEOUT" -X POST "$OLLAMA_URL/api/generate" \
        -H "Content-Type: application/json" \
        -d "{\"model\":\"$PROBE\",\"keep_alive\":0}" >/dev/null
      ollama rm "$PROBE" 2>&1 | tail -1
    fi
  done
  rm -rf "$SCRATCH_DIR"

  for MODEL in $ORIGINAL_MODELS; do
    echo "Restoring $MODEL (keep_alive -1)..."
    curl -s --max-time "$LOAD_TIMEOUT" -X POST "$OLLAMA_URL/api/generate" \
      -H "Content-Type: application/json" \
      -d "{\"model\":\"$MODEL\",\"keep_alive\":-1}" >/dev/null
  done
  if [ -z "$ORIGINAL_MODELS" ]; then
    for MODEL in $(curl -s --max-time "$TIMEOUT" "$OLLAMA_URL/api/ps" | jq -r '.models[].name'); do
      echo "Nothing was resident originally; unloading $MODEL..."
      curl -s --max-time "$TIMEOUT" -X POST "$OLLAMA_URL/api/generate" \
        -H "Content-Type: application/json" \
        -d "{\"model\":\"$MODEL\",\"keep_alive\":0}" >/dev/null
    done
  fi

  AFTER_PS=$(curl -s --max-time "$TIMEOUT" "$OLLAMA_URL/api/ps")
  echo "After cleanup: $AFTER_PS"
  AFTER_MODELS=$(echo "$AFTER_PS" | jq -r '.models[].name' | sort)
  if [ "$AFTER_MODELS" != "$(echo "$ORIGINAL_MODELS" | sort)" ]; then
    echo -e "${RED}FAIL: resident models after cleanup differ from before${NC}"
    CLEANUP_FAILED=1
  fi
  for PROBE in "$NOT_INSTALLED_PROBE" "$FAILED_LOAD_PROBE"; do
    if ollama list 2>/dev/null | awk '{print $1}' | grep -q "^${PROBE}:"; then
      echo -e "${RED}FAIL: probe $PROBE still installed${NC}"
      CLEANUP_FAILED=1
    fi
  done
  if [ "$(ls "$BLOBS_DIR" 2>/dev/null | sort)" != "$BLOBS_BEFORE" ]; then
    echo -e "${RED}FAIL: Ollama blob list changed (scratch blob left behind)${NC}"
    CLEANUP_FAILED=1
  fi
  if [ -e "$SCRATCH_DIR" ]; then
    echo -e "${RED}FAIL: scratch dir $SCRATCH_DIR left behind${NC}"
    CLEANUP_FAILED=1
  fi
}

on_exit() {
  local code=$?
  cleanup
  if [ "$CLEANUP_FAILED" -eq 1 ] && [ "$code" -eq 0 ]; then
    code=1
  fi
  if [ "$code" -ne 0 ]; then
    echo -e "${RED}=== Proof FAILED (exit $code) ===${NC}"
  else
    echo -e "${GREEN}=== Proof PASSED, Mac restored to its original state ===${NC}"
  fi
  exit $code
}
trap on_exit EXIT

# --- Scenario 1: wrong password ---
echo ""
echo "--- Scenario 1: wrong password ---"
run_ts unauthorized || fail_now "scenario 1 (wrong password) failed"

# --- Scenario 2: model no longer installed ---
echo ""
echo "--- Scenario 2: model no longer installed ---"
SMALLEST=$(curl -s --max-time "$TIMEOUT" "$OLLAMA_URL/api/tags" | jq -r '.models | sort_by(.size) | .[0].name // empty')
if [ -z "$SMALLEST" ]; then
  fail_now "no models installed in Ollama"
fi
echo "Smallest installed model: $SMALLEST"
if ! ollama cp "$SMALLEST" "$NOT_INSTALLED_PROBE"; then
  fail_now "ollama cp $SMALLEST $NOT_INSTALLED_PROBE failed"
fi
run_ts not-installed-listed "$NOT_INSTALLED_PROBE" || fail_now "scenario 2 setup: probe not listed in /v1/state"
ollama rm "$NOT_INSTALLED_PROBE" 2>&1 | tail -1
run_ts not-installed-load "$NOT_INSTALLED_PROBE" || fail_now "scenario 2 (model no longer installed) failed"

# --- Scenario 3: model failed to load ---
echo ""
echo "--- Scenario 3: model failed to load ---"
BASE_MODEL=$(curl -s --max-time "$TIMEOUT" "$OLLAMA_URL/api/tags" | jq -r '.models | sort_by(.size) | .[0].name // empty')
if [ -z "$BASE_MODEL" ]; then
  fail_now "no models installed in Ollama"
fi
BASE_ARCH=$(curl -s --max-time "$TIMEOUT" -X POST "$OLLAMA_URL/api/show" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"$BASE_MODEL\"}" | jq -r '.model_info["general.architecture"] // empty')
if [ -z "$BASE_ARCH" ]; then
  fail_now "could not read general.architecture of $BASE_MODEL"
fi
echo "Base model for the failed-load probe: $BASE_MODEL (architecture $BASE_ARCH)"

# A minimal GGUF v3 LoRA adapter for the base architecture with one lora_a /
# lora_b pair on blk.0.attn_q.weight whose shapes (7x3, 3x7) cannot match any
# real model, so the runner rejects it while loading (same technique proven
# in model-failed-load-proof.sh -- see its header comment).
python3 - "$SCRATCH_DIR/adapter.gguf" "$BASE_ARCH" <<'PY'
import struct, sys
path, arch = sys.argv[1], sys.argv[2]
def s(x):
    b = x.encode()
    return struct.pack('<Q', len(b)) + b
kv = [
    ('general.architecture', 8, s(arch)),
    ('general.type', 8, s('adapter')),
    ('adapter.type', 8, s('lora')),
    ('adapter.lora.alpha', 6, struct.pack('<f', 16.0)),
]
tensors = [('blk.0.attn_q.weight.lora_a', [7, 3]), ('blk.0.attn_q.weight.lora_b', [3, 7])]
out = b'GGUF' + struct.pack('<IQQ', 3, len(tensors), len(kv))
for k, t, v in kv:
    out += s(k) + struct.pack('<I', t) + v
off = 0
for name, dims in tensors:
    out += s(name) + struct.pack('<I', len(dims)) + b''.join(struct.pack('<Q', d) for d in dims)
    out += struct.pack('<IQ', 0, off)  # type F32, data offset
    off += ((dims[0] * dims[1] * 4 + 31) // 32) * 32
out += b'\0' * ((32 - len(out) % 32) % 32) + b'\0' * off
open(path, 'wb').write(out)
PY
printf 'FROM %s\nADAPTER %s\n' "$BASE_MODEL" "$SCRATCH_DIR/adapter.gguf" >"$SCRATCH_DIR/Modelfile"
echo "Modelfile:"
cat "$SCRATCH_DIR/Modelfile"
if ! ollama create "$FAILED_LOAD_PROBE" -f "$SCRATCH_DIR/Modelfile" >"$SCRATCH_DIR/create.log" 2>&1; then
  tail -3 "$SCRATCH_DIR/create.log"
  fail_now "ollama create $FAILED_LOAD_PROBE failed"
fi
echo "Probe created"
run_ts failed-load "$FAILED_LOAD_PROBE" || fail_now "scenario 3 (model failed to load) failed"

# --- Scenario 4: reply already in progress ---
echo ""
echo "--- Scenario 4: reply already in progress ---"
run_ts reply-in-progress || fail_now "scenario 4 (reply already in progress) failed"

# --- Scenario 5: Ollama down ---
echo ""
echo "--- Scenario 5: Ollama down ---"
echo "How Ollama runs on this Mac:"
launchctl list 2>/dev/null | grep -i ollama && echo "(a LaunchAgent -- unexpected)" || echo "not a LaunchAgent"
brew services list 2>/dev/null | grep -i ollama
ps aux | grep '[o]llama serve'
OLLAMA_PID=$(pgrep -x ollama)
if [ -z "$OLLAMA_PID" ]; then
  fail_now "could not find the ollama serve process"
fi
echo "Ollama runs as a plain background process (pid $OLLAMA_PID, not a LaunchAgent or brew service); stopping it with kill"
kill "$OLLAMA_PID"
OLLAMA_DOWN=0
for i in $(seq 1 30); do
  if ! curl -s -o /dev/null --max-time 3 "$OLLAMA_URL/api/tags" 2>/dev/null; then
    OLLAMA_DOWN=1
    break
  fi
  sleep 1
done
if [ "$OLLAMA_DOWN" -ne 1 ]; then
  fail_now "Ollama is still answering after being stopped"
fi
# Defensive: an orphaned runner subprocess would hold GPU memory and could
# make the restart below flaky; there should not be one, but clear it if so.
pkill -f "lib/ollama/llama-server" 2>/dev/null || true
echo "Ollama stopped"

run_ts ollama-down
SCENARIO5_STATUS=$?

echo "Restarting Ollama..."
nohup ollama serve >>"$OLLAMA_LOG" 2>&1 &
disown
OLLAMA_BACK=0
for i in $(seq 1 60); do
  if curl -s -o /dev/null --max-time "$TIMEOUT" "$OLLAMA_URL/api/tags"; then
    OLLAMA_BACK=1
    break
  fi
  sleep 1
done
if [ "$OLLAMA_BACK" -ne 1 ]; then
  fail_now "Ollama did not come back up after restart"
fi
echo "Ollama is back up"
if [ "$SCENARIO5_STATUS" -ne 0 ]; then
  fail_now "scenario 5 (Ollama down) failed"
fi

# --- Scenario 6: Mac/server unreachable ---
echo ""
echo "--- Scenario 6: Mac/server unreachable ---"
echo "Stopping the server LaunchAgent (it has KeepAlive, so a plain kill would relaunch it)..."
launchctl bootout "gui/$(id -u)/com.harness.server"
SERVER_DOWN=0
for i in $(seq 1 15); do
  CODE=$(curl -s -o /dev/null --max-time 3 -w '%{http_code}' "$SERVER_URL/v1/state" 2>/dev/null)
  if [ "$CODE" != "401" ]; then
    SERVER_DOWN=1
    break
  fi
  sleep 1
done
if [ "$SERVER_DOWN" -ne 1 ]; then
  fail_now "server is still answering 401 after bootout"
fi
echo "Server stopped"

run_ts mac-unreachable
SCENARIO6_STATUS=$?

echo "Restarting the server LaunchAgent..."
launchctl bootstrap "gui/$(id -u)" "$SERVER_PLIST"
SERVER_BACK=0
for i in $(seq 1 30); do
  CODE=$(curl -s -o /dev/null --max-time "$TIMEOUT" -w '%{http_code}' "$SERVER_URL/v1/state")
  if [ "$CODE" = "401" ]; then
    SERVER_BACK=1
    break
  fi
  sleep 1
done
if [ "$SERVER_BACK" -ne 1 ]; then
  fail_now "server did not come back up after bootstrap"
fi
echo "Server is back up"
if [ "$SCENARIO6_STATUS" -ne 0 ]; then
  fail_now "scenario 6 (Mac/server unreachable) failed"
fi

# --- Final: pairwise distinctness across all six observed sentences ---
echo ""
echo "--- Observed sentences ---"
for line in "${SCENARIO_RESULTS[@]}"; do
  echo "$line"
done
if [ "${#SCENARIO_RESULTS[@]}" -ne 6 ]; then
  fail_now "expected 6 observed sentences, got ${#SCENARIO_RESULTS[@]}"
fi
SENTENCES=$(printf '%s\n' "${SCENARIO_RESULTS[@]}" | sed 's/^PASS [^:]*: //')
UNIQUE_COUNT=$(printf '%s\n' "$SENTENCES" | sort -u | wc -l | tr -d ' ')
if [ "$UNIQUE_COUNT" -ne 6 ]; then
  fail_now "observed sentences are not pairwise distinct ($UNIQUE_COUNT unique of 6)"
fi
echo "All 6 observed sentences are pairwise distinct"

exit 0
