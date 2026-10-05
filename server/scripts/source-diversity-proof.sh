#!/bin/bash
# Live proof for M10c4-AC2 (FR30 / AC24): broad web prompts yield replies whose saved
# sources span >= 3 distinct websites, and whose FR31 number marks / FR27 links resolve to >= 3 saved
# sources with no unresolved citation. Goes through the server's real POST /v1/chat with web on.
# Starts its OWN server from this working tree on a spare port (never touches 7789),
# uses the RESIDENT tools-capable Ollama model (never loads, switches or evicts one).
# The token is kept in a private 0600 temp file and is never printed or saved.
# Output is tee'd to .harness/evidence/M10c4-T2-proof.log; raw replies to M10c4-T2-replies.json.

set -u

IFS= read -r -d '' COUNTING_JS <<'COUNTING_EOF'
  // Mirrors mobile/src/ui/sourceLinks.ts normaliseLinkUrl / siteHost (FR27).
  const URL_PATTERN = /^(https?):\/\/([^/?#]+)(.*)$/i;
  const normalise = (url) => {
    const m = url.trim().match(URL_PATTERN);
    if (!m) return null;
    let host = m[2].toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    if (!host) return null;
    let rest = m[3];
    const h = rest.indexOf("#");
    if (h !== -1) rest = rest.slice(0, h);
    const q = rest.indexOf("?");
    if (q !== -1) {
      const path = rest.slice(0, q);
      rest = (path.endsWith("/") ? path.slice(0, -1) : path) + rest.slice(q);
    } else if (rest.endsWith("/")) rest = rest.slice(0, -1);
    return host + rest;
  };
  const siteHost = (url) => {
    const m = url.trim().match(URL_PATTERN);
    if (!m) return null;
    let host = m[2].toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    const c = host.indexOf(":");
    if (c !== -1) host = host.slice(0, c);
    return host || null;
  };
  // FR31 + FR27 citation counting. Returns resolved distinct saved sources and unresolved items.
  const countCitations = (text, sources) => {
    const clean = text.replace(/```[\s\S]*?(```|$)/g, " ").replace(/`[^`\n]*`/g, " ");
    const links = [];
    const noLinks = clean.replace(/\[[^\]]*\]\(([^)\s]*)\)/g, (_m, url) => {
      if (/^https?:\/\//i.test(url)) links.push(url);
      return " ";
    });
    const byN = new Map();
    for (const s of sources) if (typeof s.n === "number") byN.set(s.n, s);
    const savedNorm = new Map();
    for (const s of sources) { const k = normalise(s.url); if (k) savedNorm.set(k, s); }
    const resolved = new Set(), unresolved = [];
    let markCount = 0;
    const nums = [];
    for (const m of noLinks.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]|【(\d+)[^】]*】/g)) {
      const list = m[1] ? m[1].split(",").map((x) => Number(x.trim())) : [Number(m[2])];
      for (const n of list) nums.push({ n, at: m.index });
    }
    for (const { n } of nums) {
      markCount++;
      const src = byN.get(n);
      if (src) resolved.add(src.url); else unresolved.push("[" + n + "]");
    }
    for (const l of links) {
      const k = normalise(l);
      const src = k ? savedNorm.get(k) : undefined;
      if (src) resolved.add(src.url); else unresolved.push(l);
    }
    return { resolved: resolved.size, markCount, linkCount: links.length, unresolved };
  };
COUNTING_EOF
IFS= read -r -d '' SELFTEST_JS <<'SELFTEST_EOF'
  const sources = [
    { title: "A", url: "https://a.com/x", n: 1 },
    { title: "B", url: "https://www.b.com/y/", n: 2 },
    { title: "C", url: "https://c.com/z", n: 3 },
    { title: "D", url: "https://d.com/q" },
  ];
  let bad = 0;
  const check = (name, text, resolved, unresolved) => {
    const r = countCitations(text, sources);
    const ok = r.resolved === resolved && r.unresolved.length === unresolved;
    if (!ok) bad++;
    console.log((ok ? "ok   " : "FAIL ") + name + " -> resolved=" + r.resolved + " unresolved=" + JSON.stringify(r.unresolved));
  };
  check("adjacent [1][3]", "Claim [1][3].", 2, 0);
  check("list [1, 3]", "Claim [1, 3] and [1,3].", 2, 0);
  check("fullwidth 【2†L1-L4】", "Claim 【2†L1-L4】.", 1, 0);
  check("unknown [9]", "Claim [9].", 0, 1);
  check("[2](url) is a link", "See [B](https://b.com/y) and [2](https://b.com/y).", 1, 0);
  check("[2](url) unmatched link", "See [2](https://nope.com/).", 0, 1);
  check("mark in backticks ignored", "Use `[9]` and ```\n[8]\n``` ok [3].", 1, 0);
  check("FR27 link to unnumbered source", "[d](http://D.com/q/#f) [1]", 2, 0);
  console.log(bad ? "SELF-TEST FAIL" : "SELF-TEST PASS");
  process.exit(bad ? 1 : 0);
SELFTEST_EOF

if [[ "${1:-}" == "--self-test" ]]; then
  BUN="${BUN:-$(command -v bun || echo /opt/homebrew/bin/bun)}"
  exec "$BUN" -e "$COUNTING_JS
$SELFTEST_JS"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(dirname "$SCRIPT_DIR")"
EVIDENCE_DIR="$(dirname "$SERVER_DIR")/.harness/evidence"
BUN="${BUN:-$(command -v bun || echo /opt/homebrew/bin/bun)}"
OLLAMA="http://127.0.0.1:11434"
SEARCH="http://127.0.0.1:7790"
mkdir -p "$EVIDENCE_DIR"
PROOF_LOG="$EVIDENCE_DIR/M10c4-T2-proof.log"
REPLIES_JSON="$EVIDENCE_DIR/M10c4-T2-replies.json"

# Re-exec with output tee'd to the evidence log (keeps the exit status).
if [[ -z "${SDP_TEE:-}" ]]; then
  export SDP_TEE=1
  bash "${BASH_SOURCE[0]}" 2>&1 | tee "$PROOF_LOG"
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

spare_port() {
  "$BUN" -e 'const s = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => new Response("")}); console.log(s.port); s.stop(true);'
}
nap() { "$BUN" -e 'await new Promise((r) => setTimeout(r, 200))'; }

[[ -x "$BUN" ]] || die "bun not available"
curl -s -o /dev/null --max-time 5 "$OLLAMA/api/tags" || die "Ollama not reachable at $OLLAMA"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$SEARCH/v1/health") || code=000
[[ "$code" == "200" ]] || die "search service GET /v1/health returned $code (need 200)"
echo "Preflight ok: bun, Ollama, search service"

MODEL=$(curl -s --max-time 10 "$OLLAMA/api/ps" | "$BUN" -e '
  const ps = JSON.parse(await Bun.stdin.text());
  for (const m of ps.models ?? []) {
    const r = await fetch("http://127.0.0.1:11434/api/show", {method:"POST", body: JSON.stringify({model: m.name})});
    const j = await r.json();
    if ((j.capabilities ?? []).includes("tools")) { console.log(m.name); break; }
  }') || MODEL=""
[[ -n "$MODEL" ]] || die "no tools-capable model is loaded in Ollama; load one first (this proof will not load or switch models)"
echo "Resident model with tools: $MODEL"

SERVER_PORT=$(spare_port)
TOKEN_FILE="$WORK_DIR/token"
( umask 077; "$BUN" -e 'console.log(crypto.randomUUID() + crypto.randomUUID())' > "$TOKEN_FILE" )
chmod 600 "$TOKEN_FILE"
AUTH_HEADER_FILE="$WORK_DIR/auth"
( umask 077; printf 'Authorization: Bearer %s\n' "$(tr -d '[:space:]' < "$TOKEN_FILE")" > "$AUTH_HEADER_FILE" )

(cd "$SERVER_DIR" && PHONE_MODELS_PORT="$SERVER_PORT" PHONE_MODELS_TOKEN_FILE="$TOKEN_FILE" \
  exec "$BUN" src/index.ts > "$WORK_DIR/server.out" 2>&1) & PIDS+=($!)
SERVER_URL="http://127.0.0.1:$SERVER_PORT"

up=0
for _ in $(seq 1 50); do
  c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$SERVER_URL/v1/state" -H "@$AUTH_HEADER_FILE") || c=000
  [[ "$c" == "200" ]] && { up=1; break; }
  nap
done
[[ "$up" == 1 ]] || die "proof server did not come up on port $SERVER_PORT"
echo "Proof server on $SERVER_URL"

PROMPTS=(
  "What are today's news trends"
  "What are the latest developments in artificial intelligence?"
  "What is happening in the world economy right now?"
)
i=0
for p in "${PROMPTS[@]}"; do
  i=$((i + 1))
  echo "Prompt $i: $p (may take minutes)..."
  body=$("$BUN" -e 'const [m,p]=process.argv.slice(1); console.log(JSON.stringify({model:m,messages:[{role:"user",content:p}],web:true}));' "$MODEL" "$p")
  curl -sN --max-time 900 -X POST "$SERVER_URL/v1/chat" -H "@$AUTH_HEADER_FILE" \
    -H "Content-Type: application/json" -d "$body" > "$WORK_DIR/reply$i.sse"
done

"$BUN" -e "$COUNTING_JS"'
  import { readFileSync, writeFileSync } from "fs";
  const [model, outJson, ...rest] = process.argv.slice(1);
  const prompts = JSON.parse(rest.shift());
  const files = rest;
  const records = [];
  let divPass = 0, linkPass = 0;
  files.forEach((f, idx) => {
    const events = [];
    for (const block of readFileSync(f, "utf-8").split("\n\n")) {
      const ev = /^event: (.*)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (ev) { try { events.push({ ev, data: data ? JSON.parse(data) : null }); } catch {} }
    }
    const done = events.find((e) => e.ev === "done");
    const text = events.filter((e) => e.ev === "content").map((e) => e.data?.text ?? "").join("");
    const sources = events.filter((e) => e.ev === "sources").flatMap((e) => e.data?.items ?? []);
    const hosts = [...new Set(sources.map((s) => siteHost(s.url)).filter(Boolean))];
    const cc = countCitations(text, sources);
    const withN = sources.filter((x) => typeof x.n === "number").length;
    const dPass = hosts.length >= 3;
    const lPass = cc.resolved >= 3 && cc.unresolved.length === 0;
    if (dPass) divPass++;
    if (lPass) linkPass++;
    records.push({ prompt: prompts[idx], done: done?.data?.status ?? null, sources, reply: text,
      distinctHosts: hosts, savedWithN: withN, resolvedDistinct: cc.resolved, resolvedMarks: cc.markCount,
      linkCount: cc.linkCount, unresolvedCount: cc.unresolved.length, unresolved: cc.unresolved, diversityPass: dPass, linkPass: lPass });
  });
  writeFileSync(outJson, JSON.stringify({ model, records }, null, 2));
  console.log("");
  console.log(`Model: ${model}`);
  for (const r of records) {
    console.log(`- Prompt: ${r.prompt}`);
    console.log(`    status=${r.done} sources=${r.sources.length} distinct hosts=${r.distinctHosts.length} [${r.distinctHosts.join(", ")}]`);
    console.log(`    saved sources=${r.sources.length} with n=${r.savedWithN}; resolved distinct sources=${r.resolvedDistinct} (number marks=${r.resolvedMarks}, links=${r.linkCount}); unresolved=${r.unresolvedCount}${r.unresolvedCount ? " " + JSON.stringify(r.unresolved) : ""}`);
    console.log(`    diversity=${r.diversityPass ? "PASS" : "fail"} links=${r.linkPass ? "PASS" : "fail"}`);
  }
  console.log(`Diversity passes: ${divPass}/3 (need >=2)`);
  console.log(`Link passes: ${linkPass}/3 (need >=2)`);
  const ok = divPass >= 2 && linkPass >= 2;
  console.log(ok ? "RESULT: PASS" : "RESULT: FAIL");
  process.exit(ok ? 0 : 1);
' "$MODEL" "$REPLIES_JSON" "$("$BUN" -e 'console.log(JSON.stringify(process.argv.slice(1)))' "${PROMPTS[@]}")" \
  "$WORK_DIR/reply1.sse" "$WORK_DIR/reply2.sse" "$WORK_DIR/reply3.sse"
