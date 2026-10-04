import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, writeFileSync, readFileSync, appendFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const dir = mkdtempSync(join(tmpdir(), "unreadable-cache-"));
const servers: ReturnType<typeof startServer>[] = [];
let page: http.Server;
let pagePort = 0;
let pageHits = 0;
let pageHandler: http.RequestListener;

// Client Challenge page - should be marked as unreadable
const CLIENT_CHALLENGE_PAGE = `<html><head><title>Client Challenge</title></head><body>
<p>Attention required! | Cloudflare</p>
<p>Please verify you are human.</p>
</body></html>`;

// 10-word page - should be marked as unreadable (below 40-word minimum)
const SHORT_PAGE = `<html><head><title>Short</title></head><body>
<p>This is a short page with only ten words total here.</p>
</body></html>`;

// Readable 200-word article - should be cached
const LONG_ARTICLE = `<html><head><title>Long Article</title></head><body><article><h1>Long Article</h1>
<p>This is a reasonably long paragraph of article text that should be extracted as the main content of the page. The paragraph contains multiple sentences and enough content to exceed the minimum word count requirement. Words like Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>
<p>Another paragraph follows here with more words so the content scoring keeps this article intact. This section provides additional detail and context to the overall article content being evaluated. The total word count is now definitely above the minimum threshold required for caching. Additional sentences continue to build out the length and substance of this test article data.</p>
</article></body></html>`;

const okPage: http.RequestListener = (req, res) => {
  if (req.url?.startsWith("/challenge")) {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(CLIENT_CHALLENGE_PAGE);
  } else if (req.url?.startsWith("/short")) {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(SHORT_PAGE);
  } else if (req.url?.startsWith("/long")) {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(LONG_ARTICLE);
  } else {
    res.writeHead(404);
    res.end();
  }
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
    read: (path: string) => postJson("/v1/read", { url: `http://example.test:${pagePort}${path}` }),
  };
}

describe("unreadable page cache behavior", () => {
  it("does not cache a Client Challenge page; repeat read fetches again", async () => {
    const t = setup();
    pageHandler = okPage;
    pageHits = 0;
    const a = await t.read("/challenge");
    expect(a.status).toBe(200);
    expect(a.headers.get("x-cache")).toBe("miss");
    await a.text();
    expect(pageHits).toBe(1);

    const b = await t.read("/challenge");
    expect(b.status).toBe(200);
    expect(b.headers.get("x-cache")).toBe("miss");
    await b.text();
    expect(pageHits).toBe(2);
  });

  it("does not cache a 10-word page; repeat read fetches again", async () => {
    const t = setup();
    pageHandler = okPage;
    pageHits = 0;
    const a = await t.read("/short");
    expect(a.status).toBe(200);
    expect(a.headers.get("x-cache")).toBe("miss");
    await a.text();
    expect(pageHits).toBe(1);

    const b = await t.read("/short");
    expect(b.status).toBe(200);
    expect(b.headers.get("x-cache")).toBe("miss");
    await b.text();
    expect(pageHits).toBe(2);
  });

  it("caches a readable 200-word article; repeat read is served from cache", async () => {
    const t = setup();
    pageHandler = okPage;
    pageHits = 0;
    const a = await t.read("/long");
    expect(a.status).toBe(200);
    expect(a.headers.get("x-cache")).toBe("miss");
    await a.text();
    expect(pageHits).toBe(1);

    const b = await t.read("/long");
    expect(b.status).toBe(200);
    expect(b.headers.get("x-cache")).toBe("hit");
    await b.text();
    expect(pageHits).toBe(1);
  });
});
