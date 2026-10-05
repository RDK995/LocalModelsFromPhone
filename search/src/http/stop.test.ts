import { describe, it, expect, afterEach } from "bun:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server";

// M12-T1: a caller that drops its request ends the work on the Mac (FR23, AC17).

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Resolves true as soon as `cond` holds, or false if it still does not after `ms`. */
async function eventually(cond: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await Bun.sleep(25);
  }
  return cond();
}

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

describe("stop ends work on the Mac", () => {
  it("POST /v1/search: client abort kills the helper and its child", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stop-search-"));
    const pidFile = join(dir, "pids");
    const script = join(dir, "slow-helper.sh");
    writeFileSync(
      script,
      `#!/bin/sh\nsleep 300 &\necho "$$ $!" > "${pidFile}.tmp"\nmv "${pidFile}.tmp" "${pidFile}"\nwait\n`,
    );
    let pids: number[] = [];
    cleanup.push(() => {
      for (const p of pids) {
        try {
          process.kill(p, "SIGKILL");
        } catch {}
      }
      rmSync(dir, { recursive: true, force: true });
    });
    // Helper time limit far above the assertion window, so only the abort can end it.
    const server = startServer(0, {}, { command: ["sh", script], timeoutMs: 120_000 });
    cleanup.push(() => server.stop(true));

    const ctl = new AbortController();
    const req = fetch(`http://127.0.0.1:${server.port}/v1/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "anything" }),
      signal: ctl.signal,
    }).catch(() => null);

    expect(await eventually(() => existsSync(pidFile), 5000)).toBe(true);
    pids = readFileSync(pidFile, "utf8").trim().split(/\s+/).map(Number);
    expect(pids.length).toBe(2);
    expect(pids.every(alive)).toBe(true);

    ctl.abort();
    await req;
    expect(await eventually(() => pids.every((p) => !alive(p)), 3000)).toBe(true);
  });

  it("POST /v1/read: client abort mid-body closes the upstream connection", async () => {
    let upstreamClosed = false;
    let started = false;
    const upstream = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.write("<html><body><p>partial</p>");
      started = true;
      res.on("close", () => {
        upstreamClosed = true;
      });
      // never ends the body
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", () => r()));
    const upPort = (upstream.address() as AddressInfo).port;
    cleanup.push(async () => {
      upstream.closeAllConnections();
      await new Promise<void>((r) => upstream.close(() => r()));
    });
    // Page-read time limit far above the assertion window.
    const server = startServer(0, {
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
      isAllowedAddress: () => true,
      timeoutMs: 60_000,
    });
    cleanup.push(() => server.stop(true));

    const ctl = new AbortController();
    const req = fetch(`http://127.0.0.1:${server.port}/v1/read`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: `http://127.0.0.1:${upPort}/slow` }),
      signal: ctl.signal,
    }).catch(() => null);

    expect(await eventually(() => started, 5000)).toBe(true);
    await Bun.sleep(200); // let the service be mid-body
    expect(upstreamClosed).toBe(false);

    ctl.abort();
    await req;
    expect(await eventually(() => upstreamClosed, 3000)).toBe(true);
  });
});
