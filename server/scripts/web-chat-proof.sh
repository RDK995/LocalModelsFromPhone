#!/bin/bash
# Live proof for M9 (AC1, AC2, AC3) against real Ollama and the real search service.
# Starts its OWN server from this working tree (never touches the server on 7789),
# with recording proxies in front of Ollama and the search service.
# Fails (non-zero) rather than skipping when a dependency is missing.
# The token is kept in a private 0600 temp file and is never printed or saved.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(dirname "$SCRIPT_DIR")"
EVIDENCE_DIR="$(dirname "$SERVER_DIR")/.harness/evidence"
BUN="${BUN:-$(command -v bun || echo /opt/homebrew/bin/bun)}"
OLLAMA_REAL="http://127.0.0.1:11434"
SEARCH_REAL="http://127.0.0.1:7790"

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
FAILURES=0
pass() { echo -e "${GREEN}PASS${NC}: $1"; }
fail() { echo -e "${RED}FAIL${NC}: $1"; FAILURES=$((FAILURES + 1)); }
die() { echo -e "${RED}FAIL${NC}: $1"; exit 1; }

WORK_DIR="$(mktemp -d)"
PIDS=()
cleanup() {
  for p in "${PIDS[@]:-}"; do
    [[ -n "$p" ]] && kill "$p" 2>/dev/null
  done
  mkdir -p "$EVIDENCE_DIR"
  [[ -f "$WORK_DIR/ollama.jsonl" ]] && cp "$WORK_DIR/ollama.jsonl" "$EVIDENCE_DIR/M9-T5-ollama-proxy.jsonl"
  [[ -f "$WORK_DIR/search.jsonl" ]] && cp "$WORK_DIR/search.jsonl" "$EVIDENCE_DIR/M9-T5-search-proxy.jsonl"
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT INT TERM

spare_port() {
  "$BUN" -e 'const s = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => new Response("")}); console.log(s.port); s.stop(true);'
}
nap() { "$BUN" -e 'await new Promise((r) => setTimeout(r, 200))'; }

# ---- Preflight -------------------------------------------------------------
[[ -x "$BUN" ]] || die "bun not available"
curl -s -o /dev/null --max-time 5 "$OLLAMA_REAL/api/tags" || die "Ollama not reachable at $OLLAMA_REAL"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$SEARCH_REAL/v1/health") || code=000
[[ "$code" == "200" ]] || die "search service GET /v1/health at $SEARCH_REAL returned $code (need 200)"
echo "Preflight ok: bun, Ollama, search service"

# ---- Resident model (never evict the user's model) --------------------------
MODEL=$(curl -s --max-time 10 "$OLLAMA_REAL/api/ps" | "$BUN" -e '
  const ps = JSON.parse(await Bun.stdin.text());
  for (const m of ps.models ?? []) {
    const r = await fetch("http://127.0.0.1:11434/api/show", {method:"POST", body: JSON.stringify({model: m.name})});
    const j = await r.json();
    if ((j.capabilities ?? []).includes("tools")) { console.log(m.name); break; }
  }') || MODEL=""
[[ -n "$MODEL" ]] || die "no tools-capable model is loaded in Ollama; load one first (this proof will not load or switch models)"
echo "Resident model with tools: $MODEL"

# ---- Start proxies and the proof server -------------------------------------
OLLAMA_PROXY_PORT=$(spare_port); SEARCH_PROXY_PORT=$(spare_port); SERVER_PORT=$(spare_port)
: > "$WORK_DIR/ollama.jsonl"; : > "$WORK_DIR/search.jsonl"
"$BUN" "$SCRIPT_DIR/record-proxy.ts" "$OLLAMA_PROXY_PORT" "$OLLAMA_REAL" "$WORK_DIR/ollama.jsonl" & PIDS+=($!)
"$BUN" "$SCRIPT_DIR/record-proxy.ts" "$SEARCH_PROXY_PORT" "$SEARCH_REAL" "$WORK_DIR/search.jsonl" & PIDS+=($!)

TOKEN_FILE="$WORK_DIR/token"
( umask 077; "$BUN" -e 'console.log(crypto.randomUUID() + crypto.randomUUID())' > "$TOKEN_FILE" )
chmod 600 "$TOKEN_FILE"
AUTH_HEADER_FILE="$WORK_DIR/auth"
( umask 077; printf 'Authorization: Bearer %s\n' "$(tr -d '[:space:]' < "$TOKEN_FILE")" > "$AUTH_HEADER_FILE" )

(cd "$SERVER_DIR" && PHONE_MODELS_PORT="$SERVER_PORT" PHONE_MODELS_TOKEN_FILE="$TOKEN_FILE" \
  PHONE_MODELS_OLLAMA_URL="http://127.0.0.1:$OLLAMA_PROXY_PORT" \
  PHONE_MODELS_SEARCH_URL="http://127.0.0.1:$SEARCH_PROXY_PORT" \
  exec "$BUN" src/index.ts > "$WORK_DIR/server.out" 2>&1) & PIDS+=($!)
SERVER_URL="http://127.0.0.1:$SERVER_PORT"

up=0
for _ in $(seq 1 50); do
  c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$SERVER_URL/v1/state" -H "@$AUTH_HEADER_FILE") || c=000
  [[ "$c" == "200" ]] && { up=1; break; }
  nap
done
[[ "$up" == 1 ]] || die "proof server did not come up on port $SERVER_PORT"
echo "Proof server on $SERVER_URL (proxies: ollama $OLLAMA_PROXY_PORT, search $SEARCH_PROXY_PORT)"

# ---- AC1 live ---------------------------------------------------------------
STATE_JSON=$(curl -s --max-time 60 "$SERVER_URL/v1/state" -H "@$AUTH_HEADER_FILE")
if printf '%s' "$STATE_JSON" | "$BUN" -e '
  const s = JSON.parse(await Bun.stdin.text());
  if (!s.models?.length) { console.error("no models listed"); process.exit(1); }
  for (const m of s.models) {
    if (typeof m.tools !== "boolean") { console.error(`${m.name}: tools not boolean`); process.exit(1); }
    const r = await fetch("http://127.0.0.1:11434/api/show", {method:"POST", body: JSON.stringify({model: m.name})});
    const j = await r.json();
    const want = (j.capabilities ?? []).includes("tools");
    if (m.tools !== want) { console.error(`${m.name}: state tools=${m.tools}, /api/show says ${want}`); process.exit(1); }
    console.log(`  ${m.name}: tools=${m.tools}`);
  }'; then
  pass "M9-AC1: GET /v1/state reports each model's tools capability matching /api/show"
else
  fail "M9-AC1: GET /v1/state tools capability mismatch"
fi
echo "NOTE: every installed model has tools, so the 409 tools_unsupported half of AC1 is proven by the unit tests in server/src/http/server.test.ts (M9-T3); it is not faked live."

# ---- helpers ---------------------------------------------------------------
# chat <prompt> <web-json-fragment or ""> <outfile>
chat() {
  local prompt="$1" webfrag="$2" out="$3"
  local body
  body=$("$BUN" -e 'const [m,p,w]=process.argv.slice(1); const o={model:m,messages:[{role:"user",content:p}]}; if(w!=="") o.web=JSON.parse(w); console.log(JSON.stringify(o));' "$MODEL" "$prompt" "$webfrag")
  curl -sN --max-time 600 -X POST "$SERVER_URL/v1/chat" -H "@$AUTH_HEADER_FILE" \
    -H "Content-Type: application/json" -d "$body" > "$out"
}
has_done() { grep -q '^event: done' "$1"; }

# ---- AC3 live ---------------------------------------------------------------
: > "$WORK_DIR/ollama.jsonl"; : > "$WORK_DIR/search.jsonl"
chat "Say hello in five words." "" "$WORK_DIR/ac3a.sse"
chat "Say hello in five words." "false" "$WORK_DIR/ac3b.sse"
if has_done "$WORK_DIR/ac3a.sse" && has_done "$WORK_DIR/ac3b.sse"; then
  if "$BUN" -e '
    import { readFileSync } from "fs";
    const rd = (f) => readFileSync(f, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const chats = rd(process.argv[1]).filter((r) => r.path === "/api/chat");
    if (chats.length < 2) { console.error(`expected >=2 /api/chat requests, saw ${chats.length}`); process.exit(1); }
    for (const c of chats) {
      const b = JSON.parse(c.body);
      if (Array.isArray(b.tools) ? b.tools.length > 0 : b.tools !== undefined) { console.error("chat request carries tools"); process.exit(1); }
      if ((b.messages ?? []).some((m) => m.role === "system" && /Today.s date is/.test(m.content))) { console.error("chat request carries date note"); process.exit(1); }
    }
    const s = rd(process.argv[2]);
    if (s.length !== 0) { console.error(`search service saw ${s.length} request(s)`); process.exit(1); }
  ' "$WORK_DIR/ollama.jsonl" "$WORK_DIR/search.jsonl"; then
    pass "M9-AC3: web absent/false sends no tools, no date note, and the search service gets no request"
  else
    fail "M9-AC3: web-off request carried tools/date note or hit the search service"
  fi
else
  fail "M9-AC3: a web-off chat stream did not reach event: done"
fi

# ---- AC2 live ---------------------------------------------------------------
SSE_LOG="$EVIDENCE_DIR/M9-T5-sse.log"
mkdir -p "$EVIDENCE_DIR"
PROMPTS=(
  "Search the web: what is the latest stable version of the Bun JavaScript runtime? Answer in one sentence and cite the source."
  "You MUST call the web_search tool now (do not answer from memory) to find the latest stable release of the Bun JavaScript runtime, then answer in one sentence and cite the source URL."
  "Call the web_search tool with the query 'Bun JavaScript runtime latest release', then call read_page on the best result, then answer in one sentence citing the URL. Do not answer without using the tools."
)
for attempt in 0 1 2; do
  : > "$WORK_DIR/ollama.jsonl"; : > "$WORK_DIR/search.jsonl"
  echo "AC2 attempt $((attempt + 1)) of 3 (large local model; may take minutes)..."
  chat "${PROMPTS[$attempt]}" "true" "$SSE_LOG"
  if [[ -s "$WORK_DIR/search.jsonl" ]]; then break; fi
  echo "  model did not call a web tool on this attempt"
done

if [[ ! -s "$WORK_DIR/search.jsonl" ]]; then
  fail "M9-AC2: the model never called a web tool in 3 attempts (R8: tool-calling quality varies by model)"
elif ! has_done "$SSE_LOG"; then
  fail "M9-AC2: web:true stream did not reach event: done"
else
  if "$BUN" -e '
    import { readFileSync } from "fs";
    const rd = (f) => readFileSync(f, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const fail = (m) => { console.error(m); process.exit(1); };
    const chats = rd(process.argv[1]).filter((r) => r.path === "/api/chat");
    if (!chats.length) fail("no /api/chat request recorded");
    const first = JSON.parse(chats[0].body);
    const names = (first.tools ?? []).map((t) => t.function?.name);
    if (!names.includes("web_search") || !names.includes("read_page")) fail(`tools offered: ${JSON.stringify(names)}`);
    const m0 = first.messages?.[0];
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const iso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    if (m0?.role !== "system") fail("first message is not a system message");
    if (!m0.content.includes(iso) || !m0.content.includes(String(now.getFullYear()))) fail(`system note lacks today (${iso})`);
    if (rd(process.argv[2]).length < 1) fail("search proxy saw no request");

    const events = [];
    for (const block of readFileSync(process.argv[3], "utf-8").split("\n\n")) {
      const ev = /^event: (.*)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (ev) events.push({ ev, data: data ? JSON.parse(data) : null });
    }
    const steps = events.filter((e) => e.ev === "step");
    if (!steps.length) fail("no step events");
    const byId = new Map();
    for (const s of steps) { if (!byId.has(s.data.step_id)) byId.set(s.data.step_id, []); byId.get(s.data.step_id).push(s.data.status); }
    let complete = false;
    for (const sts of byId.values()) if (sts[0] === "started" && sts.slice(1).some((x) => x !== "started")) complete = true;
    if (!complete) fail("no step went started -> final status");
    const srcIdx = events.map((e, i) => (e.ev === "sources" ? i : -1)).filter((i) => i >= 0);
    if (srcIdx.length !== 1) fail(`expected exactly one sources event, saw ${srcIdx.length}`);
    const doneIdx = events.findIndex((e) => e.ev === "done");
    const lastStep = events.map((e, i) => (e.ev === "step" ? i : -1)).filter((i) => i >= 0).pop();
    if (!(lastStep < srcIdx[0] && srcIdx[0] < doneIdx)) fail("sources not after every step and before done");
    const text = events.filter((e) => e.ev === "content").map((e) => e.data?.text ?? "").join("");
    if (!text.trim()) fail("final answer (content) is empty");
    if (events[doneIdx].data?.status !== "complete") fail(`done status ${events[doneIdx].data?.status}`);
    console.log(`  steps=${steps.length} sources=1 answer_chars=${text.length}`);
  ' "$WORK_DIR/ollama.jsonl" "$WORK_DIR/search.jsonl" "$SSE_LOG"; then
    pass "M9-AC2: web:true offered both tools with a dated system note; step, sources, content and done all live"
  else
    fail "M9-AC2: live web:true stream/request assertions failed"
  fi
fi

echo ""
if [[ "$FAILURES" -eq 0 ]]; then
  echo -e "${GREEN}All M9 live proofs passed${NC}"
  exit 0
fi
echo -e "${RED}$FAILURES M9 live proof(s) failed${NC}"
exit 1
