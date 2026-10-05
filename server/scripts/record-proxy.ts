/**
 * Recording proxy for the M9 live proof.
 * Usage: bun record-proxy.ts <listen-port> <upstream-url> <log-file>
 *
 * Forwards every request unchanged to the upstream, streams the response back
 * without buffering, and appends one JSON line {method, path, body} per request.
 * Only bodies are logged, never headers.
 */
import { appendFileSync } from "fs";

const [portArg, upstreamArg, logFile] = process.argv.slice(2);
if (!portArg || !upstreamArg || !logFile) {
  console.error("usage: bun record-proxy.ts <listen-port> <upstream-url> <log-file>");
  process.exit(2);
}
const upstream = upstreamArg.replace(/\/+$/, "");

Bun.serve({
  hostname: "127.0.0.1",
  port: Number(portArg),
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const body = hasBody ? await req.text() : "";
    appendFileSync(
      logFile,
      JSON.stringify({ method: req.method, path: url.pathname + url.search, body }) + "\n"
    );
    const headers = new Headers(req.headers);
    headers.delete("host");
    headers.delete("content-length");
    const res = await fetch(upstream + url.pathname + url.search, {
      method: req.method,
      headers,
      body: hasBody ? body : undefined,
      signal: req.signal,
    });
    const out = new Headers(res.headers);
    out.delete("content-length");
    out.delete("content-encoding");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
  },
});
