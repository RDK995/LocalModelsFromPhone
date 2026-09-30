import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../http/server";
import type { HelperOptions } from "./runHelper";

const dir = mkdtempSync(join(tmpdir(), "fake-helper-timeout-"));
const servers: ReturnType<typeof startServer>[] = [];
const startedPids: number[] = [];

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

afterAll(() => {
  // Clean up anything a failed assertion left behind.
  for (const pid of startedPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  for (const s of servers) s.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

function fake(name: string, script: string): string[] {
  const p = join(dir, name);
  writeFileSync(p, script);
  return ["bun", p];
}

function serverWith(options: HelperOptions) {
  const s = startServer(0, {}, options);
  servers.push(s);
  return s;
}

/** A helper that records its pid, starts a long-lived grandchild that records its pid, then hangs. */
function treeHelper(tag: string) {
  const helperPidFile = join(dir, `${tag}-helper.pid`);
  const childPidFile = join(dir, `${tag}-child.pid`);
  const command = fake(
    `${tag}-tree.ts`,
    `const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(helperPidFile)}, String(process.pid));
const child = Bun.spawn(["sleep", "60"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
fs.writeFileSync(${JSON.stringify(childPidFile)}, String(child.pid));
setTimeout(() => {}, 60000);`,
  );
  return { command, helperPidFile, childPidFile };
}

async function readPids(helperPidFile: string, childPidFile: string): Promise<[number, number]> {
  for (let i = 0; i < 100 && !(existsSync(helperPidFile) && existsSync(childPidFile)); i++) await Bun.sleep(50);
  expect(existsSync(helperPidFile)).toBe(true);
  expect(existsSync(childPidFile)).toBe(true);
  const pids: [number, number] = [
    Number(readFileSync(helperPidFile, "utf8")),
    Number(readFileSync(childPidFile, "utf8")),
  ];
  startedPids.push(...pids);
  return pids;
}

async function expectAllGone(pids: number[]) {
  for (let i = 0; i < 40 && pids.some(alive); i++) await Bun.sleep(50);
  for (const pid of pids) expect(alive(pid)).toBe(false);
}

const post = (s: ReturnType<typeof startServer>, signal?: AbortSignal) =>
  fetch(`http://127.0.0.1:${s.port}/v1/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "q" }),
    signal,
  });

describe("POST /v1/search time limit", () => {
  it("helper over the limit -> 504 timeout promptly, helper and its descendants killed", async () => {
    const { command, helperPidFile, childPidFile } = treeHelper("timeout");
    const s = serverWith({ command, timeoutMs: 500 });
    const started = Date.now();
    const pending = post(s, AbortSignal.timeout(5000)).catch((e: unknown) => e);
    const pids = await readPids(helperPidFile, childPidFile);
    const r = await pending;
    expect(r).toBeInstanceOf(Response);
    const res = r as Response;
    expect(Date.now() - started).toBeLessThan(3000);
    expect(res.status).toBe(504);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ error: "timeout" });
    await expectAllGone(pids);
  });

  it("client abort kills the helper and its descendants", async () => {
    const { command, helperPidFile, childPidFile } = treeHelper("abort");
    const s = serverWith({ command, timeoutMs: 10000 });
    const ac = new AbortController();
    const pending = post(s, ac.signal).catch(() => {});
    const pids = await readPids(helperPidFile, childPidFile);
    for (const pid of pids) expect(alive(pid)).toBe(true);
    ac.abort();
    await pending;
    await expectAllGone(pids);
  });

  it("a helper that finishes within the limit still succeeds", async () => {
    const command = fake(
      "slow-ok.ts",
      `await Bun.sleep(200);
console.log(JSON.stringify({results:[{title:"A",url:"http://a/",snippet:"s"}], backend:"ddgs"}));`,
    );
    const s = serverWith({ command, timeoutMs: 2000 });
    const r = await post(s);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ results: [{ title: "A", url: "http://a/", snippet: "s" }], backend: "ddgs" });
  });

  it("a helper that exits normally but leaves a descendant behind: the descendant is killed", async () => {
    const childPidFile = join(dir, "leftover-child.pid");
    const command = fake(
      "leftover.ts",
      `const child = Bun.spawn(["sleep", "60"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
child.unref();
require("node:fs").writeFileSync(${JSON.stringify(childPidFile)}, String(child.pid));
console.log(JSON.stringify({results:[], backend:"ddgs"}));
process.exit(0);`,
    );
    const s = serverWith({ command, timeoutMs: 5000 });
    const r = await post(s);
    expect(r.status).toBe(200);
    expect(existsSync(childPidFile)).toBe(true);
    const pid = Number(readFileSync(childPidFile, "utf8"));
    startedPids.push(pid);
    await expectAllGone([pid]);
  });
});
