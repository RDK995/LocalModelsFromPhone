import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, writeFileSync, readFileSync, appendFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const dir = mkdtempSync(join(tmpdir(), "cache-"));
const servers: ReturnType<typeof startServer>[] = [];
let page: http.Server;
let pagePort = 0;
let pageHits = 0;
let pageHandler: http.RequestListener;

const HTML = `<html><head><title>Cached Page</title></head><body><article><h1>Cached Page</h1>
<p>This is a reasonably long paragraph of article text that should be extracted as the main content of the page.</p>
<p>Another paragraph follows here with more words so the content scoring keeps this article intact.</p></article></body></html>`;

const okPage: http.RequestListener = (req, res) => {
  if (req.url?.startsWith("/redir")) {
    res.writeHead(302, { location: "/final" });
    return res.end();
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(HTML);
};

beforeAll(async () => {
  page = http.createServer((req, res) => {
    pageHits++;
    pageHandler(req, res);
  });
  await new Promise<void>((r) => page.listen(0, "127.0.0.1", () => r()));
  pagePort = (page.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const s of servers) s.stop(true);
  page.closeAllConnections();
  await new Promise<void>((r) => page.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const id = Math.random().toString(36).slice(2);
  const log = join(dir, `${id}.log`);
  const replyFile = join(dir, `${id}.reply.json`);
  const script = join(dir, `${id}.ts`);
  writeFileSync(
    script,
    `import { appendFileSync, readFileSync } from "node:fs";
appendFileSync(${JSON.stringify(log)}, "x\\n");
const r = JSON.parse(readFileSync(${JSON.stringify(replyFile)}, "utf8"));
if (r.fail) { console.error("boom"); process.exit(1); }
console.log(JSON.stringify(r));`,
  );
  writeFileSync(
    replyFile,
    JSON.stringify({ results: [{ title: "T", url: "http://x/", snippet: "s" }], backend: "A", attempts: [{ backend: "A", outcome: "ok" }] }),
  );
  let clock = 1_000_000;
  const s = startServer(
    0,
    { resolve: async () => [{ address: "127.0.0.1", family: 4 }], isAllowedAddress: () => true, timeoutMs: 2000 },
    { command: ["bun", script], ddgsBackends: ["A"], now: () => clock },
  );
  servers.push(s);
  const base = `http://127.0.0.1:${s.port}`;
  const postJson = (path: string, body: unknown) =>
    fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return {
    advance: (ms: number) => (clock += ms),
    fail: () => writeFileSync(replyFile, JSON.stringify({ fail: true })),
    spawns: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).length : 0),
    search: (query: string, max?: number) => postJson("/v1/search", { query, max_results: max }),
    read: (path: string) => postJson("/v1/read", { url: `http://example.test:${pagePort}${path}` }),
  };
}

describe("search service result cache", () => {
  it("serves a repeated search (after normalisation) from the cache, and refetches after 24 h", async () => {
    const t = setup();
    const a = await t.search("Heat Pump  costs");
    expect(a.status).toBe(200);
    expect(a.headers.get("x-cache")).toBe("miss");
    const bodyA = await a.text();
    const b = await t.search(" heat pump costs");
    expect(b.status).toBe(200);
    expect(b.headers.get("x-cache")).toBe("hit");
    expect(await b.text()).toBe(bodyA);
    expect(t.spawns()).toBe(1);

    t.advance(DAY - 1);
    expect((await t.search("heat pump costs")).headers.get("x-cache")).toBe("hit");
    expect(t.spawns()).toBe(1);
    t.advance(1);
    const c = await t.search("heat pump costs");
    expect(c.headers.get("x-cache")).toBe("miss");
    expect(t.spawns()).toBe(2);
  });

  it("does not cache a failing search", async () => {
    const t = setup();
    t.fail();
    expect((await t.search("q")).status).toBe(503);
    expect((await t.search("q")).status).toBe(503);
    expect(t.spawns()).toBe(2);
  });

  it("serves a repeated page read from the cache, and refetches after 24 h", async () => {
    const t = setup();
    pageHandler = okPage;
    pageHits = 0;
    const a = await t.read("/redir");
    expect(a.status).toBe(200);
    expect(a.headers.get("x-cache")).toBe("miss");
    const bodyA = await a.text();
    expect(pageHits).toBe(2); // redirect + final
    const b = await t.read("/redir");
    expect(b.headers.get("x-cache")).toBe("hit");
    expect(await b.text()).toBe(bodyA);
    expect(pageHits).toBe(2);

    t.advance(DAY);
    const c = await t.read("/redir");
    expect(c.headers.get("x-cache")).toBe("miss");
    expect(pageHits).toBe(4);
  });

  it("serves a different URL redirecting to a cached final URL from the cached entry", async () => {
    const t = setup();
    pageHandler = okPage;
    const a = await t.read("/final");
    const bodyF = await a.text();
    pageHits = 0;
    const b = await t.read("/redir2");
    expect(b.status).toBe(200);
    expect(b.headers.get("x-cache")).toBe("hit");
    expect(await b.text()).toBe(bodyF);
    expect(pageHits).toBeLessThanOrEqual(2); // redirect discovery (plus the final hop)
  });

  it("does not cache a failing read", async () => {
    const t = setup();
    pageHandler = (_req, res) => {
      res.writeHead(500);
      res.end("no");
    };
    pageHits = 0;
    expect((await t.read("/bad")).status).toBe(502);
    expect((await t.read("/bad")).status).toBe(502);
    expect(pageHits).toBe(2);
  });
});
