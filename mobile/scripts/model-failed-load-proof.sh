#!/bin/bash
# Live proof wrapper for M2-AC5: a load that genuinely fails in Ollama leaves
# nothing resident, and the app's view shows the failure reason.
#
# Failure method (found in M2b-T3b Step 1, attempt 4): Ollama 0.32 rejects a
# truncated or header-corrupted GGUF at `ollama create` time, and clamps
# num_ctx / oversubscribes memory rather than failing, so neither a corrupt
# weights file nor an oversized context produces a load error. What does fail
# at load time is a model whose Modelfile attaches a LoRA ADAPTER whose tensor
# shapes do not match the base model: `ollama create` accepts it, and the
# runner (llama-server) exits with status 1 while loading. Failure class:
# runner load failure (invalid adapter), not out-of-memory.
#
# This wrapper:
#   1. restarts com.harness.server and com.harness.bundle-host and waits for
#      401 on /v1/state;
#   2. records the resident model(s) and the Ollama blob list;
#   3. builds a tiny mismatched LoRA GGUF in a scratch dir under /private/tmp
#      and creates the probe `m2b-failed-load-probe` FROM the smallest model
#      in /api/tags (no hardcoded installed-model names);
#   4. runs model-failed-load-proof.ts (the assertions, through the app's
#      client and helpers);
#   5. on any exit (trap): `ollama rm` the probe, deletes the scratch dir,
#      restores the originally resident model(s) with keep_alive -1, and
#      fails if the probe or any new blob is left behind.

set -u

SERVER_URL="${SERVER_URL:-https://ryans-mac-studio.tailc3648a.ts.net:8443}"
OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
BLOBS_DIR="${OLLAMA_BLOBS_DIR:-$HOME/.ollama/models/blobs}"
TIMEOUT=30
LOAD_TIMEOUT=300
PROBE_NAME="m2b-failed-load-probe"
export PROBE_NAME

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

echo "=== Model Failed-Load Live Proof (M2-AC5) ==="
echo "date: $(date -u)"
echo ""

echo "Restarting LaunchAgents..."
launchctl kickstart -k gui/$(id -u)/com.harness.server
launchctl kickstart -k gui/$(id -u)/com.harness.bundle-host

echo "Waiting for server to be ready..."
SERVER_READY=0
for i in $(seq 1 30); do
  HTTP_CODE=$(curl -s -o /dev/null --max-time "$TIMEOUT" -w '%{http_code}' "$SERVER_URL/v1/state")
  if [ "$HTTP_CODE" = "401" ]; then
    echo "Server is up and enforcing auth"
    SERVER_READY=1
    break
  fi
  sleep 1
done
if [ "$SERVER_READY" -ne 1 ]; then
  echo -e "${RED}Failed: server did not start in time${NC}"
  exit 1
fi

echo ""
echo "--- Recording original Ollama state ---"
ORIGINAL_PS=$(curl -s --max-time "$TIMEOUT" "$OLLAMA_URL/api/ps")
echo "Before: $ORIGINAL_PS"
ORIGINAL_MODELS=$(echo "$ORIGINAL_PS" | jq -r '.models[].name')
if [ -n "$ORIGINAL_MODELS" ]; then
  echo "Originally resident: $(echo $ORIGINAL_MODELS)"
else
  echo "Originally resident: (none)"
fi
BLOBS_BEFORE=$(ls "$BLOBS_DIR" 2>/dev/null | sort)
SCRATCH_DIR=$(mktemp -d /private/tmp/m2b-failed-load-probe.XXXXXX)

CLEANUP_DONE=0
CLEANUP_FAILED=0

cleanup() {
  if [ "$CLEANUP_DONE" -eq 1 ]; then
    return
  fi
  CLEANUP_DONE=1

  echo ""
  echo "--- Cleanup: removing probe and restoring original Ollama state ---"
  if ollama list 2>/dev/null | awk '{print $1}' | grep -q "^$PROBE_NAME:"; then
    curl -s --max-time "$TIMEOUT" -X POST "$OLLAMA_URL/api/generate" \
      -H "Content-Type: application/json" \
      -d "{\"model\":\"$PROBE_NAME\",\"keep_alive\":0}" > /dev/null
    ollama rm "$PROBE_NAME" 2>&1 | tail -1
  fi
  rm -rf "$SCRATCH_DIR"

  for MODEL in $ORIGINAL_MODELS; do
    echo "Restoring $MODEL (keep_alive -1)..."
    curl -s --max-time "$LOAD_TIMEOUT" -X POST "$OLLAMA_URL/api/generate" \
      -H "Content-Type: application/json" \
      -d "{\"model\":\"$MODEL\",\"keep_alive\":-1}" > /dev/null
  done
  if [ -z "$ORIGINAL_MODELS" ]; then
    for MODEL in $(curl -s --max-time "$TIMEOUT" "$OLLAMA_URL/api/ps" | jq -r '.models[].name'); do
      echo "Nothing was resident originally; unloading $MODEL..."
      curl -s --max-time "$TIMEOUT" -X POST "$OLLAMA_URL/api/generate" \
        -H "Content-Type: application/json" \
        -d "{\"model\":\"$MODEL\",\"keep_alive\":0}" > /dev/null
    done
  fi

  AFTER_PS=$(curl -s --max-time "$TIMEOUT" "$OLLAMA_URL/api/ps")
  echo "After cleanup: $AFTER_PS"
  AFTER_MODELS=$(echo "$AFTER_PS" | jq -r '.models[].name' | sort)
  if [ "$AFTER_MODELS" != "$(echo "$ORIGINAL_MODELS" | sort)" ]; then
    echo -e "${RED}FAIL: resident models after cleanup differ from before${NC}"
    CLEANUP_FAILED=1
  fi
  if ollama list 2>/dev/null | awk '{print $1}' | grep -q "^$PROBE_NAME:"; then
    echo -e "${RED}FAIL: probe $PROBE_NAME still installed${NC}"
    CLEANUP_FAILED=1
  fi
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

echo ""
echo "--- Creating probe $PROBE_NAME ---"
BASE_MODEL=$(curl -s --max-time "$TIMEOUT" "$OLLAMA_URL/api/tags" | jq -r '.models | sort_by(.size) | .[0].name // empty')
if [ -z "$BASE_MODEL" ]; then
  echo -e "${RED}Failed: no models installed in Ollama${NC}"
  exit 1
fi
BASE_ARCH=$(curl -s --max-time "$TIMEOUT" -X POST "$OLLAMA_URL/api/show" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"$BASE_MODEL\"}" | jq -r '.model_info["general.architecture"] // empty')
if [ -z "$BASE_ARCH" ]; then
  echo -e "${RED}Failed: could not read general.architecture of $BASE_MODEL${NC}"
  exit 1
fi
echo "Base model (smallest in /api/tags): $BASE_MODEL (architecture $BASE_ARCH)"

# A minimal GGUF v3 LoRA adapter for the base architecture with one lora_a /
# lora_b pair on blk.0.attn_q.weight whose shapes (7x3, 3x7) cannot match any
# real model, so the runner rejects it while loading.
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
printf 'FROM %s\nADAPTER %s\n' "$BASE_MODEL" "$SCRATCH_DIR/adapter.gguf" > "$SCRATCH_DIR/Modelfile"
echo "Modelfile:"
cat "$SCRATCH_DIR/Modelfile"
if ! ollama create "$PROBE_NAME" -f "$SCRATCH_DIR/Modelfile" > "$SCRATCH_DIR/create.log" 2>&1; then
  echo -e "${RED}Failed: ollama create $PROBE_NAME failed${NC}"
  tail -3 "$SCRATCH_DIR/create.log"
  exit 1
fi
echo "Probe created"

echo ""
echo "--- Running proof (mobile/scripts/model-failed-load-proof.ts) ---"
cd /Users/ryankenny/Projects/CodingHarnessv2/mobile
bun scripts/model-failed-load-proof.ts
