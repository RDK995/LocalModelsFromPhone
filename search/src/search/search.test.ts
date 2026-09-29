import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../http/server";

const dir = mkdtempSync(join(tmpdir(), "fake-helper-"));
const servers: ReturnType<typeof startServer>[] = [];

afterAll(() => {
  for (const s of servers) s.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

function fake(name: string, script: string): string[] {
  const p = join(dir, name);
  writeFileSync(p, script);
  return ["bun", p];
}

function serverWith(command: string[]) {
  const s = startServer(0, {}, { command });
  servers.push(s);
  return s;
}

const search = (s: ReturnType<typeof startServer>, body: unknown, raw = false) =>
  fetch(`http://127.0.0.1:${s.port}/v1/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });

const argvEcho = fake(
  "echo.ts",
  `const a = process.argv.slice(2);
console.log(JSON.stringify({results:[{title:"T",url:"http://x/",snippet:JSON.stringify(a)}], backend:"ddgs"}));`,
);

describe("POST /v1/search", () => {
  it("maps helper success, keeping valid fields and capping at max", async () => {
    const s = serverWith(
      fake(
        "ok.ts",
        `console.log(JSON.stringify({results:[
          {title:"A",url:"http://a/",snippet:"sa",extra:1},
          {title:"nourl",snippet:"x"},
          {title:5,url:"http://b/",snippet:"sb"},
          {title:"C",url:"http://c/",snippet:"sc"}], backend:"ddgs"}));`,
      ),
    );
    const r = await search(s, { query: "hi", max_results: 2 });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      results: [
        { title: "A", url: "http://a/", snippet: "sa" },
        { title: "", url: "http://b/", snippet: "sb" },
      ],
      backend: "ddgs",
    });
  });

  it("passes query literally and --max; default max is 5", async () => {
    const s = serverWith(argvEcho);
    for (const q of ["; rm -rf /", "$(whoami) `id` | x", "plain words"]) {
      const r = await search(s, { query: q });
      const body = (await r.json()) as { results: { snippet: string }[] };
      expect(JSON.parse(body.results[0]!.snippet)).toEqual(["--query", q, "--max", "5"]);
    }
    const r = await search(s, { query: "q", max_results: 7 });
    const body = (await r.json()) as { results: { snippet: string }[] };
    expect(JSON.parse(body.results[0]!.snippet)).toEqual(["--query", "q", "--max", "7"]);
  });

  it("helper {error} -> 503 search_unavailable with detail", async () => {
    const s = serverWith(fake("err.ts", `console.log(JSON.stringify({error:"rate_limited", detail:"slow down"}));`));
    const r = await search(s, { query: "q" });
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "search_unavailable", detail: "slow down" });
  });

  it("garbage stdout -> 503", async () => {
    const s = serverWith(fake("garbage.ts", `console.log("not json at all");`));
    const r = await search(s, { query: "q" });
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: string }).error).toBe("search_unavailable");
  });

  it("non-zero exit -> 503", async () => {
    const s = serverWith(fake("fail.ts", `process.exit(3);`));
    const r = await search(s, { query: "q" });
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: string }).error).toBe("search_unavailable");
  });

  it("missing helper binary -> 503", async () => {
    const s = serverWith([join(dir, "does-not-exist")]);
    const r = await search(s, { query: "q" });
    expect(r.status).toBe(503);
    const body = (await r.json()) as { error: string; detail: unknown };
    expect(body.error).toBe("search_unavailable");
    expect(typeof body.detail).toBe("string");
  });

  it("bad bodies -> 400 bad_request", async () => {
    const s = serverWith(argvEcho);
    const bads: [unknown, boolean?][] = [
      [{}],
      [{ query: "" }],
      [{ query: "   " }],
      [{ query: 5 }],
      [{ query: "x".repeat(501) }],
      [{ query: "q", max_results: 11 }],
      [{ query: "q", max_results: 0 }],
      [{ query: "q", max_results: 1.5 }],
      ["not json{", true],
    ];
    for (const [b, raw] of bads) {
      const r = await search(s, b, raw);
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: "bad_request" });
    }
  });

  it("GET /v1/search -> 405", async () => {
    const s = serverWith(argvEcho);
    const r = await fetch(`http://127.0.0.1:${s.port}/v1/search`);
    expect(r.status).toBe(405);
  });

  it("client abort kills the helper", async () => {
    const pidFile = join(dir, "pid.txt");
    const s = serverWith(
      fake(
        "sleep.ts",
        `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
setTimeout(() => {}, 60000);`,
      ),
    );
    const ac = new AbortController();
    const p2 = fetch(`http://127.0.0.1:${s.port}/v1/search`, {
      method: "POST",
      body: JSON.stringify({ query: "q" }),
      signal: ac.signal,
    }).catch(() => {});
    for (let i = 0; i < 100 && !existsSync(pidFile); i++) await Bun.sleep(50);
    expect(existsSync(pidFile)).toBe(true);
    const pid = Number(readFileSync(pidFile, "utf8"));
    expect(() => process.kill(pid, 0)).not.toThrow();
    ac.abort();
    await p2;
    let gone = false;
    for (let i = 0; i < 100 && !gone; i++) {
      try {
        process.kill(pid, 0);
        await Bun.sleep(50);
      } catch {
        gone = true;
      }
    }
    expect(gone).toBe(true);
  });
});
