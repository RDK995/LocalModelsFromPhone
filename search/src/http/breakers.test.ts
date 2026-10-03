import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, appendFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server";

const dir = mkdtempSync(join(tmpdir(), "breakers-"));
const servers: ReturnType<typeof startServer>[] = [];
afterAll(() => {
  for (const s of servers) s.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

const MIN = 60_000;
const HOUR = 60 * MIN;
const ok = (backend: string, attempts: unknown[]) => ({ results: [{ title: "T", url: "http://x/", snippet: "s" }], backend, attempts });

/** A fake helper that logs each argv (one JSON line) and prints whatever `reply` currently holds. */
function setup(ddgsBackends = ["A", "B"]) {
  const id = Math.random().toString(36).slice(2);
  const log = join(dir, `${id}.log`);
  const replyFile = join(dir, `${id}.reply.json`);
  const script = join(dir, `${id}.ts`);
  writeFileSync(
    script,
    `import { appendFileSync, readFileSync } from "node:fs";
appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");
console.log(readFileSync(${JSON.stringify(replyFile)}, "utf8"));`,
  );
  let clock = 1_000_000;
  const s = startServer(0, {}, { command: ["bun", script], ddgsBackends, now: () => clock });
  servers.push(s);
  return {
    reply: (v: unknown) => writeFileSync(replyFile, JSON.stringify(v)),
    advance: (ms: number) => (clock += ms),
    calls: (): string[][] =>
      existsSync(log)
        ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
        : [],
    search: () =>
      fetch(`http://127.0.0.1:${s.port}/v1/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "q" }),
      }),
    last() {
      const c = this.calls();
      return c[c.length - 1]!;
    },
  };
}
const backendsArg = (argv: string[]) => argv[argv.indexOf("--backends") + 1];

describe("search backend breakers", () => {
  for (const [outcome, ms] of [
    ["rate_limited", HOUR],
    ["captcha", 24 * HOUR],
  ] as const) {
    it(`${outcome} rests the engine for exactly ${ms / HOUR} h`, async () => {
      const t = setup();
      t.reply(ok("B", [{ backend: "A", outcome }, { backend: "B", outcome: "ok" }]));
      expect((await t.search()).status).toBe(200);
      expect(backendsArg(t.last())).toBe("A,B");

      t.reply(ok("B", [{ backend: "B", outcome: "ok" }]));
      await t.search();
      expect(backendsArg(t.last())).toBe("B");
      t.advance(ms - MIN);
      await t.search();
      expect(backendsArg(t.last())).toBe("B");
      t.advance(MIN);
      await t.search();
      expect(backendsArg(t.last())).toBe("A,B");
    });
  }

  it("while A rests the remaining engine answers; with both resting the browser answers", async () => {
    const t = setup();
    t.reply(ok("B", [{ backend: "A", outcome: "rate_limited" }, { backend: "B", outcome: "ok" }]));
    await t.search();
    t.reply(ok("B", [{ backend: "B", outcome: "rate_limited" }]));
    let r = await t.search();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ results: [{ title: "T", url: "http://x/", snippet: "s" }], backend: "B" });
    expect(backendsArg(t.last())).toBe("B");
    t.reply(ok("browser", [{ backend: "browser", outcome: "ok" }]));
    r = await t.search();
    expect(r.status).toBe(200);
    expect(((await r.json()) as { backend: string }).backend).toBe("browser");
    expect(t.last()).toContain("--backends");
    expect(backendsArg(t.last())).toBe("");
    expect(t.last()).not.toContain("--no-browser");
  });

  it("a browser CAPTCHA passes --no-browser until +24 h", async () => {
    const t = setup();
    t.reply(ok("browser", [{ backend: "browser", outcome: "captcha" }]));
    await t.search();
    expect(t.last()).not.toContain("--no-browser");
    t.reply(ok("A", [{ backend: "A", outcome: "ok" }]));
    t.advance(24 * HOUR - MIN);
    await t.search();
    expect(t.last()).toContain("--no-browser");
    t.advance(MIN);
    await t.search();
    expect(t.last()).not.toContain("--no-browser");
  });

  it("every backend resting -> 503 search_unavailable without spawning the helper", async () => {
    const t = setup();
    t.reply({ error: "search_failed", detail: "x", attempts: [
      { backend: "A", outcome: "rate_limited" },
      { backend: "B", outcome: "captcha" },
      { backend: "browser", outcome: "captcha" },
    ] });
    expect((await t.search()).status).toBe(503);
    const spawned = t.calls().length;
    const r = await t.search();
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "search_unavailable", detail: "all search backends are resting" });
    expect(t.calls().length).toBe(spawned);
    t.advance(HOUR);
    await t.search();
    expect(t.calls().length).toBe(spawned + 1);
    expect(backendsArg(t.last())).toBe("A");
    expect(t.last()).toContain("--no-browser");
  });

  it("all trying and failing (helper error) -> 503 search_unavailable, nothing rests", async () => {
    const t = setup();
    t.reply({ error: "search_failed", detail: "boom", attempts: [
      { backend: "A", outcome: "error" },
      { backend: "B", outcome: "empty" },
      { backend: "browser", outcome: "error" },
    ] });
    for (let i = 0; i < 2; i++) {
      const r = await t.search();
      expect(r.status).toBe(503);
      expect(await r.json()).toEqual({ error: "search_unavailable", detail: "boom" });
    }
    expect(t.calls().length).toBe(2);
    expect(backendsArg(t.last())).toBe("A,B");
  });

  it("output without attempts records nothing", async () => {
    const t = setup();
    t.reply({ results: [], backend: "A" });
    await t.search();
    await t.search();
    expect(backendsArg(t.last())).toBe("A,B");
  });
});
