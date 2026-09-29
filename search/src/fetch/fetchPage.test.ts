import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { fetchPage, FetchPageError, type FetchPageErrorCode, type ResolvedAddress, type FetchPageOptions } from "./fetchPage";

// All tests talk only to a loopback test server. Because the default policy (correctly) refuses
// loopback, tests that need a successful fetch inject a resolver and a TEST-ONLY address policy.

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

interface TestServer {
  port: number;
  connections: number;
  requests: { url: string; host: string | undefined; method: string | undefined }[];
  closedRequests: number;
  handler: Handler;
  close(): Promise<void>;
}

async function startServer(): Promise<TestServer> {
  const sockets = new Set<import("node:net").Socket>();
  const state: TestServer = {
    port: 0,
    connections: 0,
    requests: [],
    closedRequests: 0,
    handler: (_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<html><body>hello</body></html>");
    },
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
  const server = http.createServer((req, res) => {
    state.requests.push({ url: req.url ?? "", host: req.headers.host, method: req.method });
    req.on("close", () => {
      state.closedRequests++;
    });
    state.handler(req, res);
  });
  server.on("connection", (socket) => {
    state.connections++;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  state.port = (server.address() as AddressInfo).port;
  return state;
}

/** A resolver that maps every hostname to the given addresses and records each call. */
function fakeResolver(addresses: ResolvedAddress[]) {
  const calls: string[] = [];
  const resolve = async (hostname: string) => {
    calls.push(hostname);
    return addresses;
  };
  return { calls, resolve };
}

/** TEST-ONLY policy: allow loopback (so tests can reach their own server), refuse the rest. */
const allowLoopbackOnly = (ip: string) => ip === "127.0.0.1";

async function expectCode(p: Promise<unknown>, code: FetchPageErrorCode): Promise<FetchPageError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(FetchPageError);
    expect((err as FetchPageError).code).toBe(code);
    return err as FetchPageError;
  }
  throw new Error(`expected rejection with ${code}, but fetch resolved`);
}

const loopback: ResolvedAddress[] = [{ address: "127.0.0.1", family: 4 }];

let srv: TestServer;
beforeEach(async () => {
  srv = await startServer();
});
afterEach(async () => {
  await srv.close();
});

describe("fetchPage — URL validation", () => {
  for (const url of ["file:///etc/passwd", "ftp://x/", "javascript:alert(1)", "not a url", "", "data:text/html,hi"]) {
    it(`rejects ${JSON.stringify(url)} as bad_url`, async () => {
      await expectCode(fetchPage(url), "bad_url");
    });
  }
});

describe("fetchPage — R6: Bun honours the custom lookup", () => {
  it("connects via the injected resolver for a hostname that cannot resolve in real DNS", async () => {
    const r = fakeResolver(loopback);
    const page = await fetchPage(`http://r6-probe.invalid:${srv.port}/probe?x=1`, {
      resolve: r.resolve,
      isAllowedAddress: allowLoopbackOnly,
    });
    // The .invalid TLD never resolves (RFC 6761); this only succeeds if our lookup was used.
    expect(r.calls).toEqual(["r6-probe.invalid"]);
    expect(srv.connections).toBe(1);
    expect(srv.requests).toHaveLength(1);
    expect(srv.requests[0].url).toBe("/probe?x=1");
    expect(srv.requests[0].host).toBe(`r6-probe.invalid:${srv.port}`);
    expect(page.status).toBe(200);
    expect(page.body).toContain("hello");
  });

  it("refuses a hostname resolving to 127.0.0.1 under the default policy, with no connection made", async () => {
    const r = fakeResolver(loopback);
    await expectCode(fetchPage(`http://r6-probe.invalid:${srv.port}/`, { resolve: r.resolve }), "blocked_destination");
    expect(r.calls).toEqual(["r6-probe.invalid"]);
    await Bun.sleep(50);
    expect(srv.connections).toBe(0);
    expect(srv.requests).toHaveLength(0);
  });

  it("refuses when ANY resolved record is non-public, even if another is public", async () => {
    const r = fakeResolver([
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expectCode(fetchPage(`http://mixed.invalid:${srv.port}/`, { resolve: r.resolve }), "blocked_destination");
    await Bun.sleep(50);
    expect(srv.connections).toBe(0);
  });

  it("refuses an IPv4-mapped IPv6 loopback record", async () => {
    const r = fakeResolver([{ address: "::ffff:127.0.0.1", family: 6 }]);
    await expectCode(fetchPage(`http://mapped.invalid:${srv.port}/`, { resolve: r.resolve }), "blocked_destination");
    expect(srv.connections).toBe(0);
  });

  it("refuses 'localhost' with the real (default) resolver, no connection made", async () => {
    await expectCode(fetchPage(`http://localhost:${srv.port}/`), "blocked_destination");
    await Bun.sleep(50);
    expect(srv.connections).toBe(0);
  });

  it("reports a hostname that resolves to nothing as fetch_failed", async () => {
    const r = fakeResolver([]);
    await expectCode(fetchPage(`http://empty.invalid:${srv.port}/`, { resolve: r.resolve }), "fetch_failed");
  });
});

describe("fetchPage — IP literal hosts are checked before connecting", () => {
  const literals = [
    (p: number) => `http://127.0.0.1:${p}/`,
    (p: number) => `http://[::1]:${p}/`,
    (p: number) => `http://[::ffff:127.0.0.1]:${p}/`,
    (p: number) => `http://0x7f.0.0.1:${p}/`,
    (p: number) => `http://2130706433:${p}/`,
    (p: number) => `http://0.0.0.0:${p}/`,
    (p: number) => `https://169.254.169.254:${p}/latest/meta-data/`,
    (p: number) => `http://100.100.100.100:${p}/`,
  ];
  for (const make of literals) {
    it(`refuses ${make(0)}`, async () => {
      const r = fakeResolver(loopback);
      await expectCode(fetchPage(make(srv.port), { resolve: r.resolve }), "blocked_destination");
      expect(r.calls).toEqual([]);
      await Bun.sleep(20);
      expect(srv.connections).toBe(0);
    });
  }

  it("applies the injected policy to literals too (same policy object)", async () => {
    const page = await fetchPage(`http://127.0.0.1:${srv.port}/`, { isAllowedAddress: allowLoopbackOnly });
    expect(page.status).toBe(200);
  });
});

describe("fetchPage — successful fetch", () => {
  it("returns url, finalUrl, status, contentType and body", async () => {
    const r = fakeResolver(loopback);
    const url = `http://site.invalid:${srv.port}/a`;
    const page = await fetchPage(url, { resolve: r.resolve, isAllowedAddress: allowLoopbackOnly });
    expect(page).toEqual({
      url,
      finalUrl: url,
      status: 200,
      contentType: "text/html",
      body: "<html><body>hello</body></html>",
      bodyTruncated: false,
    });
  });

  it("accepts text/plain and application/xhtml+xml", async () => {
    const r = fakeResolver(loopback);
    for (const ct of ["text/plain", "application/xhtml+xml; charset=utf-8", "TEXT/HTML"]) {
      srv.handler = (_req, res) => {
        res.writeHead(200, { "content-type": ct });
        res.end("ok");
      };
      const page = await fetchPage(`http://site.invalid:${srv.port}/`, {
        resolve: r.resolve,
        isAllowedAddress: allowLoopbackOnly,
      });
      expect(page.body).toBe("ok");
    }
  });

  it("decodes a gzip body a server sends despite Accept-Encoding: identity", async () => {
    const r = fakeResolver(loopback);
    srv.handler = (req, res) => {
      expect(req.headers["accept-encoding"]).toBe("identity");
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
      res.end(gzipSync(Buffer.from("<p>zipped</p>")));
    };
    const page = await fetchPage(`http://site.invalid:${srv.port}/`, {
      resolve: r.resolve,
      isAllowedAddress: allowLoopbackOnly,
    });
    expect(page.body).toBe("<p>zipped</p>");
  });
});

describe("fetchPage — redirects", () => {
  const opts = (): FetchPageOptions => ({ resolve: fakeResolver(loopback).resolve, isAllowedAddress: allowLoopbackOnly });

  it("follows a relative redirect and reports finalUrl", async () => {
    srv.handler = (req, res) => {
      if (req.url === "/start") {
        res.writeHead(302, { location: "/end" });
        res.end();
      } else {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("arrived");
      }
    };
    const page = await fetchPage(`http://site.invalid:${srv.port}/start`, opts());
    expect(page.finalUrl).toBe(`http://site.invalid:${srv.port}/end`);
    expect(page.url).toBe(`http://site.invalid:${srv.port}/start`);
    expect(page.body).toBe("arrived");
  });

  it("re-checks every hop: redirect to a blocked host is refused", async () => {
    const resolve = async (host: string): Promise<ResolvedAddress[]> =>
      host === "internal.invalid" ? [{ address: "10.0.0.5", family: 4 }] : loopback;
    srv.handler = (_req, res) => {
      res.writeHead(301, { location: `http://internal.invalid:${srv.port}/admin` });
      res.end();
    };
    await expectCode(fetchPage(`http://site.invalid:${srv.port}/`, { resolve, isAllowedAddress: allowLoopbackOnly }), "blocked_destination");
    expect(srv.requests).toHaveLength(1);
  });

  it("re-checks every hop: redirect to an IP literal loopback is refused under the default policy", async () => {
    // The test policy allows only 127.0.0.1, so the ::1 literal hop must be refused.
    const resolve = async (): Promise<ResolvedAddress[]> => loopback;
    srv.handler = (_req, res) => {
      res.writeHead(307, { location: `http://[::1]:${srv.port}/` });
      res.end();
    };
    await expectCode(fetchPage(`http://site.invalid:${srv.port}/`, { resolve, isAllowedAddress: allowLoopbackOnly }), "blocked_destination");
    expect(srv.requests).toHaveLength(1);
  });

  it("refuses a redirect to a non-http(s) scheme", async () => {
    srv.handler = (_req, res) => {
      res.writeHead(302, { location: "file:///etc/passwd" });
      res.end();
    };
    await expectCode(fetchPage(`http://site.invalid:${srv.port}/`, opts()), "blocked_destination");
  });

  it("follows up to 5 redirects", async () => {
    srv.handler = (req, res) => {
      const n = Number(req.url!.slice(1));
      if (n < 5) {
        res.writeHead(302, { location: `/${n + 1}` });
        res.end();
      } else {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("five");
      }
    };
    const page = await fetchPage(`http://site.invalid:${srv.port}/0`, opts());
    expect(page.body).toBe("five");
    expect(srv.requests).toHaveLength(6);
  });

  it("more than 5 redirects → fetch_failed", async () => {
    srv.handler = (req, res) => {
      const n = Number(req.url!.slice(1));
      res.writeHead(302, { location: `/${n + 1}` });
      res.end();
    };
    await expectCode(fetchPage(`http://site.invalid:${srv.port}/0`, opts()), "fetch_failed");
    expect(srv.requests).toHaveLength(6);
  });

  it("non-2xx final response → fetch_failed with upstream status", async () => {
    srv.handler = (_req, res) => {
      res.writeHead(404, { "content-type": "text/html" });
      res.end("nope");
    };
    const err = await expectCode(fetchPage(`http://site.invalid:${srv.port}/`, opts()), "fetch_failed");
    expect(err.status).toBe(404);
  });
});

describe("fetchPage — limits", () => {
  const opts = (extra: FetchPageOptions = {}): FetchPageOptions => ({
    resolve: fakeResolver(loopback).resolve,
    isAllowedAddress: allowLoopbackOnly,
    ...extra,
  });

  it("truncates a body over the byte cap and flags it", async () => {
    srv.handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("a".repeat(600));
      res.write("b".repeat(600));
      res.end("c".repeat(600));
    };
    const page = await fetchPage(`http://site.invalid:${srv.port}/`, opts({ maxBytes: 1000 }));
    expect(page.bodyTruncated).toBe(true);
    expect(page.body).toBe("a".repeat(600) + "b".repeat(400));
  });

  it("does not flag a body exactly at the cap", async () => {
    srv.handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("x".repeat(1000));
    };
    const page = await fetchPage(`http://site.invalid:${srv.port}/`, opts({ maxBytes: 1000 }));
    expect(page.bodyTruncated).toBe(false);
    expect(page.body.length).toBe(1000);
  });

  for (const ct of ["image/png", "application/pdf", "application/octet-stream", "text/htmlx", ""]) {
    it(`refuses content type ${JSON.stringify(ct)} as unsupported_content`, async () => {
      srv.handler = (_req, res) => {
        res.writeHead(200, ct ? { "content-type": ct } : {});
        res.end("binary");
      };
      await expectCode(fetchPage(`http://site.invalid:${srv.port}/`, opts()), "unsupported_content");
    });
  }

  it("a server that never responds → timeout within the configured limit", async () => {
    srv.handler = () => {
      /* never respond */
    };
    const started = Date.now();
    await expectCode(fetchPage(`http://site.invalid:${srv.port}/`, opts({ timeoutMs: 300 })), "timeout");
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(2000);
  });

  it("a body that stalls mid-stream → timeout", async () => {
    srv.handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("partial");
    };
    await expectCode(fetchPage(`http://site.invalid:${srv.port}/`, opts({ timeoutMs: 300 })), "timeout");
  });

  it("aborts the request when the AbortSignal fires", async () => {
    srv.handler = () => {
      /* never respond */
    };
    const ac = new AbortController();
    const p = fetchPage(`http://site.invalid:${srv.port}/`, opts({ signal: ac.signal }));
    await Bun.sleep(100);
    expect(srv.requests).toHaveLength(1);
    ac.abort();
    let caught: unknown;
    try {
      await p;
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught).not.toBeInstanceOf(FetchPageError);
    expect((caught as Error).name).toBe("AbortError");
    await Bun.sleep(50);
    expect(srv.closedRequests).toBe(1);
  });

  it("rejects immediately with AbortError if the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    let caught: unknown;
    try {
      await fetchPage(`http://site.invalid:${srv.port}/`, opts({ signal: ac.signal }));
    } catch (err) {
      caught = err;
    }
    expect((caught as Error).name).toBe("AbortError");
    expect(srv.connections).toBe(0);
  });
});
