import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { startServer } from "./server";

let page: http.Server;
let pagePort = 0;
let pageHandler: http.RequestListener;
let strict: ReturnType<typeof startServer>;
let lax: ReturnType<typeof startServer>;

const HTML = `<html><head><title>Hello Page</title></head><body><nav>NAVJUNK</nav><article><h1>Hello Page</h1>
<p>This is a reasonably long paragraph of article text that should be extracted as the main content of the page.</p>
<p>Another paragraph follows here with more words so the content scoring keeps this article intact.</p></article></body></html>`;

beforeAll(async () => {
  pageHandler = (_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(HTML);
  };
  page = http.createServer((req, res) => pageHandler(req, res));
  await new Promise<void>((r) => page.listen(0, "127.0.0.1", () => r()));
  pagePort = (page.address() as AddressInfo).port;
  strict = startServer(0);
  lax = startServer(0, {
    resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    isAllowedAddress: () => true,
    timeoutMs: 300,
  });
});

afterAll(async () => {
  strict.stop(true);
  lax.stop(true);
  page.closeAllConnections();
  await new Promise<void>((r) => page.close(() => r()));
});

const post = (s: ReturnType<typeof startServer>, body: unknown, raw = false) =>
  fetch(`http://127.0.0.1:${s.port}/v1/read`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });

describe("search service", () => {
  it("binds to loopback", () => {
    expect(strict.hostname).toBe("127.0.0.1");
  });

  it("GET /v1/health -> 200 {ok:true}", async () => {
    const r = await fetch(`http://127.0.0.1:${strict.port}/v1/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });

  it("unknown route -> 404 JSON; wrong method -> 405 JSON", async () => {
    const a = await fetch(`http://127.0.0.1:${strict.port}/nope`);
    expect(a.status).toBe(404);
    expect(await a.json()).toEqual({ error: "not_found" });
    const b = await fetch(`http://127.0.0.1:${strict.port}/v1/read`);
    expect(b.status).toBe(405);
    const c = await fetch(`http://127.0.0.1:${strict.port}/v1/health`, { method: "POST" });
    expect(c.status).toBe(405);
  });

  it("400 bad_url for ftp scheme, missing url, and invalid JSON", async () => {
    for (const r of [await post(strict, { url: "ftp://example.com/" }), await post(strict, {}), await post(strict, "{nope", true)]) {
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: "bad_url" });
    }
  });

  it("400 blocked_destination for loopback IPv4 and IPv6 literals (strict default)", async () => {
    for (const url of ["http://127.0.0.1:7789/", "http://[::1]/"]) {
      const r = await post(strict, { url });
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: "blocked_destination" });
    }
  });

  it("200 success path returns extracted markdown", async () => {
    const r = await post(lax, { url: `http://example.test:${pagePort}/x` });
    expect(r.status).toBe(200);
    const j = (await r.json()) as Record<string, unknown>;
    expect(j.url).toBe(`http://example.test:${pagePort}/x`);
    expect(j.final_url).toBe(`http://example.test:${pagePort}/x`);
    expect(j.title).toBe("Hello Page");
    expect(String(j.markdown)).toContain("reasonably long paragraph");
    expect(String(j.markdown)).not.toContain("NAVJUNK");
    expect(j.truncated).toBe(false);
  });

  it("415 unsupported_content", async () => {
    pageHandler = (_req, res) => {
      res.writeHead(200, { "content-type": "image/png" });
      res.end("x");
    };
    const r = await post(lax, { url: `http://example.test:${pagePort}/img` });
    expect(r.status).toBe(415);
    expect(await r.json()).toEqual({ error: "unsupported_content" });
  });

  it("502 fetch_failed carries the upstream status", async () => {
    pageHandler = (_req, res) => {
      res.writeHead(404);
      res.end("no");
    };
    const r = await post(lax, { url: `http://example.test:${pagePort}/missing` });
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ error: "fetch_failed", status: 404 });
  });

  it("504 timeout", async () => {
    pageHandler = () => {
      /* never respond */
    };
    const r = await post(lax, { url: `http://example.test:${pagePort}/slow` });
    expect(r.status).toBe(504);
    expect(await r.json()).toEqual({ error: "timeout" });
  });
});
