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

// ---------------------------------------------------------------------------------------------
// GET /v1/icon (FR27, D-M10c-2). A loopback "website" answers per Host header + path, and records
// every request so tests can prove cache hits make no upstream contact. The icon handler is given
// a TEST-ONLY origin (http on the test port instead of https://<host>/), a resolver mapping every
// hostname to 127.0.0.1, and a TEST-ONLY policy that allows ONLY 127.0.0.1 — so 10.0.0.1 and
// 169.254.169.254 stay forbidden and the redirect / linked-icon block tests are real.
// ---------------------------------------------------------------------------------------------
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spyOn } from "bun:test";
import { createHandler } from "./server";

type Route = (req: http.IncomingMessage, res: http.ServerResponse) => void;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const ICO = Buffer.from([0, 0, 1, 0, 9, 9, 9]);

let site: http.Server;
let sitePort = 0;
let routes: Record<string, Route> = {};
let hits: string[] = [];
let cacheDir = "";
let iconSrv: ReturnType<typeof startServer>;
let strictIcon: ReturnType<typeof startServer>;

const html = (body: string): Route => (_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html><head><title>t</title>${body}</head><body>x</body></html>`);
};
const img = (type: string, bytes: Buffer): Route => (_req, res) => {
  res.writeHead(200, { "content-type": type });
  res.end(bytes);
};

beforeAll(async () => {
  cacheDir = mkdtempSync(join(tmpdir(), "icon-cache-"));
  site = http.createServer((req, res) => {
    const host = String(req.headers.host ?? "").replace(/:\d+$/, "");
    const key = `${host}${req.url}`;
    hits.push(key);
    const r = routes[key];
    if (r) return r(req, res);
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", () => r()));
  sitePort = (site.address() as AddressInfo).port;
  iconSrv = startServer(
    0,
    { resolve: async () => [{ address: "127.0.0.1", family: 4 }], isAllowedAddress: (ip) => ip === "127.0.0.1" },
    {},
    { cacheDir, origin: (h) => `http://${h}:${sitePort}` },
  );
  strictIcon = startServer(0, {}, {}, { cacheDir });
});

afterAll(async () => {
  iconSrv.stop(true);
  strictIcon.stop(true);
  site.closeAllConnections();
  await new Promise<void>((r) => site.close(() => r()));
  rmSync(cacheDir, { recursive: true, force: true });
});

const getIcon = (s: ReturnType<typeof startServer>, host: string, method = "GET") =>
  fetch(`http://127.0.0.1:${s.port}/v1/icon?host=${encodeURIComponent(host)}`, { method });
const hitsFor = (host: string) => hits.filter((h) => h.startsWith(`${host}/`));

describe("GET /v1/icon", () => {
  it("returns the <link rel=icon> image with its content-type and a 7-day cache-control", async () => {
    routes["a1.test/"] = html(`<link rel="stylesheet" href="/s.css"><link rel="icon" href="/img/i.png">`);
    routes["a1.test/img/i.png"] = img("image/png", PNG);
    const r = await getIcon(iconSrv, "a1.test");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("cache-control")).toBe("public, max-age=604800");
    expect(Buffer.from(await r.arrayBuffer()).equals(PNG)).toBe(true);
    expect(hitsFor("a1.test")).toEqual(["a1.test/", "a1.test/img/i.png"]);
  });

  it("matches rel case-insensitively as a token list (apple-touch-icon, 'Shortcut Icon'), first in document order", async () => {
    routes["a2.test/"] = html(
      `<link rel="preload" href="/p.png"><LINK REL="Apple-Touch-Icon" HREF="touch.png"><link rel="icon" href="/i.png">`,
    );
    routes["a2.test/touch.png"] = img("image/png", PNG);
    const r = await getIcon(iconSrv, "a2.test");
    expect(r.status).toBe(200);
    expect(hitsFor("a2.test")).toEqual(["a2.test/", "a2.test/touch.png"]);

    routes["a3.test/"] = html(`<link rel='Shortcut Icon' href='/s.ico?v=1&amp;x=2'>`);
    routes["a3.test/s.ico?v=1&x=2"] = img("image/vnd.microsoft.icon", ICO);
    const r3 = await getIcon(iconSrv, "a3.test");
    expect(r3.status).toBe(200);
    expect(r3.headers.get("content-type")).toBe("image/vnd.microsoft.icon");
    expect(Buffer.from(await r3.arrayBuffer()).equals(ICO)).toBe(true);
  });

  it("falls back to /favicon.ico when the page links no icon", async () => {
    routes["b1.test/"] = html(`<link rel="stylesheet" href="/s.css">`);
    routes["b1.test/favicon.ico"] = img("image/x-icon", ICO);
    const r = await getIcon(iconSrv, "b1.test");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/x-icon");
    expect(Buffer.from(await r.arrayBuffer()).equals(ICO)).toBe(true);
  });

  it("falls back to /favicon.ico when the page itself fails (404)", async () => {
    routes["b2.test/favicon.ico"] = img("image/x-icon", ICO);
    const r = await getIcon(iconSrv, "b2.test");
    expect(r.status).toBe(200);
  });

  it("no icon anywhere -> 404 no_icon", async () => {
    routes["c1.test/"] = html("");
    const r = await getIcon(iconSrv, "c1.test");
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "no_icon" });
  });

  it("SVG-only -> 404 no_icon", async () => {
    routes["c2.test/"] = html(`<link rel="icon" type="image/svg+xml" href="/i.svg">`);
    routes["c2.test/i.svg"] = img("image/svg+xml", Buffer.from("<svg/>"));
    routes["c2.test/favicon.ico"] = img("image/svg+xml", Buffer.from("<svg/>"));
    const r = await getIcon(iconSrv, "c2.test");
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "no_icon" });
  });

  it("oversize icon (> 256 KiB) -> 404 no_icon, never truncated bytes", async () => {
    routes["c3.test/"] = html(`<link rel="icon" href="/big.png">`);
    routes["c3.test/big.png"] = img("image/png", Buffer.alloc(256 * 1024 + 1, 7));
    routes["c3.test/favicon.ico"] = img("image/x-icon", Buffer.alloc(300 * 1024, 7));
    const r = await getIcon(iconSrv, "c3.test");
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "no_icon" });
  });

  it("an icon exactly 256 KiB is accepted", async () => {
    const exact = Buffer.alloc(256 * 1024, 5);
    routes["c4.test/favicon.ico"] = img("image/png", exact);
    const r = await getIcon(iconSrv, "c4.test");
    expect(r.status).toBe(200);
    expect((await r.arrayBuffer()).byteLength).toBe(exact.length);
  });

  it("non-image content-type -> 404 no_icon", async () => {
    routes["c5.test/"] = html(`<link rel="icon" href="/i.png">`);
    routes["c5.test/i.png"] = img("text/html", Buffer.from("<html>soft 404</html>"));
    routes["c5.test/favicon.ico"] = img("application/octet-stream", ICO);
    const r = await getIcon(iconSrv, "c5.test");
    expect(r.status).toBe(404);
  });

  it("second request (also via www. and upper case) is served from the disk cache with zero upstream hits; one log line per upstream lookup only", async () => {
    routes["d1.test/"] = html(`<link rel="icon" href="/i.png">`);
    routes["d1.test/i.png"] = img("image/png", PNG);
    const log = spyOn(console, "log");
    try {
      const first = await getIcon(iconSrv, "d1.test");
      expect(first.status).toBe(200);
      const before = hitsFor("d1.test").length;
      expect(before).toBe(2);
      for (const h of ["d1.test", "WWW.D1.test"]) {
        const again = await getIcon(iconSrv, h);
        expect(again.status).toBe(200);
        expect(again.headers.get("content-type")).toBe("image/png");
        expect(Buffer.from(await again.arrayBuffer()).equals(PNG)).toBe(true);
      }
      expect(hitsFor("d1.test").length).toBe(before);
      const lines = log.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("icon fetch host=d1.test"));
      expect(lines).toEqual(["icon fetch host=d1.test result=ok"]);
    } finally {
      log.mockRestore();
    }
  });

  it("a negative result is cached too", async () => {
    routes["d2.test/"] = html("");
    expect((await getIcon(iconSrv, "d2.test")).status).toBe(404);
    const n = hitsFor("d2.test").length;
    expect(n).toBe(2); // page + /favicon.ico
    expect((await getIcon(iconSrv, "d2.test")).status).toBe(404);
    expect(hitsFor("d2.test").length).toBe(n);
  });

  it("an expired entry is refetched (positive after 7 days, negative after 1 day)", async () => {
    routes["d3.test/favicon.ico"] = img("image/x-icon", ICO);
    routes["d4.test/"] = html("");
    let now = Date.now();
    const handler = createHandler(
      { resolve: async () => [{ address: "127.0.0.1", family: 4 }], isAllowedAddress: (ip) => ip === "127.0.0.1" },
      {},
      { cacheDir, origin: (h) => `http://${h}:${sitePort}`, now: () => now },
    );
    const call = (host: string) => handler(new Request(`http://127.0.0.1/v1/icon?host=${host}`));
    expect((await call("d3.test")).status).toBe(200);
    expect((await call("d4.test")).status).toBe(404);
    const [p0, n0] = [hitsFor("d3.test").length, hitsFor("d4.test").length];

    now += 23 * 3600_000; // both still fresh
    await call("d3.test");
    await call("d4.test");
    expect([hitsFor("d3.test").length, hitsFor("d4.test").length]).toEqual([p0, n0]);

    now += 2 * 3600_000; // 25 h: negative expired, positive fresh
    await call("d3.test");
    await call("d4.test");
    expect([hitsFor("d3.test").length, hitsFor("d4.test").length]).toEqual([p0, n0 * 2]);

    now += 7 * 24 * 3600_000; // > 7 days: positive expired
    expect((await call("d3.test")).status).toBe(200);
    expect(hitsFor("d3.test").length).toBe(p0 * 2);
  });

  it("a corrupt cache entry is treated as a miss", async () => {
    routes["d5.test/favicon.ico"] = img("image/x-icon", ICO);
    expect((await getIcon(iconSrv, "d5.test")).status).toBe(200);
    const n = hitsFor("d5.test").length;
    for (const f of readdirSync(cacheDir)) writeFileSync(join(cacheDir, f), "{not json");
    const r = await getIcon(iconSrv, "d5.test");
    expect(r.status).toBe(200);
    expect(Buffer.from(await r.arrayBuffer()).equals(ICO)).toBe(true);
    expect(hitsFor("d5.test").length).toBe(n * 2);
  });

  it("blocked host under the default strict policy (localhost) -> 400 blocked_destination, not cached", async () => {
    const before = readdirSync(cacheDir).length;
    const r = await getIcon(strictIcon, "localhost");
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "blocked_destination" });
    expect(readdirSync(cacheDir).length).toBe(before);
  });

  it("a page redirecting to a forbidden address -> 400 blocked_destination (redirect re-checked), not cached", async () => {
    routes["e1.test/"] = (_req, res) => {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
      res.end();
    };
    routes["e1.test/favicon.ico"] = img("image/x-icon", ICO);
    const r = await getIcon(iconSrv, "e1.test");
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "blocked_destination" });
    expect(hitsFor("e1.test")).toEqual(["e1.test/"]); // no favicon fallback after a block
    await getIcon(iconSrv, "e1.test");
    expect(hitsFor("e1.test")).toEqual(["e1.test/", "e1.test/"]); // not cached
  });

  it("an icon <link> pointing at a forbidden address is not fetched -> 400 blocked_destination (no fallback)", async () => {
    routes["e2.test/"] = html(`<link rel="icon" href="http://10.0.0.1/i.png">`);
    routes["e2.test/favicon.ico"] = img("image/x-icon", ICO);
    const r = await getIcon(iconSrv, "e2.test");
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "blocked_destination" });
    expect(hitsFor("e2.test")).toEqual(["e2.test/"]);
  });

  it("an icon that redirects to a forbidden address -> 400 blocked_destination", async () => {
    routes["e3.test/"] = html(`<link rel="icon" href="/i.png">`);
    routes["e3.test/i.png"] = (_req, res) => {
      res.writeHead(301, { location: "http://10.0.0.1/i.png" });
      res.end();
    };
    const r = await getIcon(iconSrv, "e3.test");
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "blocked_destination" });
  });

  it("504 timeout when the site never answers within the deadline, not cached", async () => {
    routes["f1.test/"] = () => {
      /* never respond */
    };
    const handler = createHandler(
      { resolve: async () => [{ address: "127.0.0.1", family: 4 }], isAllowedAddress: (ip) => ip === "127.0.0.1" },
      {},
      { cacheDir, origin: (h) => `http://${h}:${sitePort}`, timeoutMs: 300 },
    );
    const r = await handler(new Request("http://127.0.0.1/v1/icon?host=f1.test"));
    expect(r.status).toBe(504);
    expect(await r.json()).toEqual({ error: "timeout" });
    routes["f1.test/"] = html("");
    routes["f1.test/favicon.ico"] = img("image/x-icon", ICO);
    expect((await handler(new Request("http://127.0.0.1/v1/icon?host=f1.test"))).status).toBe(200);
  });

  it("bad host -> 400 bad_url, no upstream contact", async () => {
    const bad = [
      "",
      "https://a.test",
      "a.test/path",
      "a.test:8080",
      "127.0.0.1",
      "::1",
      "[::1]",
      "a b.test",
      "a..test",
      "-a.test",
      "a_b.test",
      "x".repeat(64) + ".test",
      ("a".repeat(60) + ".").repeat(5) + "test", // > 253 chars
      "1.2.3.999",
      "0x7f.1",
      "user@a.test",
    ];
    const n = hits.length;
    for (const h of bad) {
      const r = await getIcon(iconSrv, h);
      expect({ h, status: r.status }).toEqual({ h, status: 400 });
      expect(await r.json()).toEqual({ error: "bad_url" });
    }
    const missing = await fetch(`http://127.0.0.1:${iconSrv.port}/v1/icon`);
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "bad_url" });
    expect(hits.length).toBe(n);
  });

  it("non-GET -> 405", async () => {
    const r = await getIcon(iconSrv, "a1.test", "POST");
    expect(r.status).toBe(405);
    expect(await r.json()).toEqual({ error: "method_not_allowed" });
  });
});
