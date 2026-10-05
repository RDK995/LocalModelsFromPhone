import { describe, it, expect } from "bun:test";
import { mkdtempSync, rmSync, statSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findIconHref, normaliseHost, validateHost } from "./icon";
import { defaultIconCacheDir, readCachedIcon, writeCachedIcon, NEGATIVE_TTL_MS, POSITIVE_TTL_MS } from "./cache";

describe("validateHost / normaliseHost", () => {
  it("accepts DNS hostnames, lower-cased", () => {
    expect(validateHost("Example.COM")).toBe("example.com");
    expect(validateHost("localhost")).toBe("localhost");
    expect(validateHost("a-b.x1.co.uk")).toBe("a-b.x1.co.uk");
  });
  it("refuses schemes, paths, ports, IP literals, spaces, bad labels and > 253 chars", () => {
    for (const h of ["", "http://a.b", "a.b/", "a.b:1", "10.0.0.1", "::1", "[::1]", "a b", "a..b", "a.", "-a.b", "a-.b", "é.fr", "a.123", "0x7f.1", "x".repeat(254)]) {
      expect({ h, v: validateHost(h) }).toEqual({ h, v: null });
    }
  });
  it("normalises for the cache key: lower-case, leading www. stripped", () => {
    expect(normaliseHost("WWW.Example.com")).toBe("example.com");
    expect(normaliseHost("www2.example.com")).toBe("www2.example.com");
    expect(normaliseHost("example.com")).toBe("example.com");
  });
});

describe("findIconHref", () => {
  const base = "https://ex.test/dir/page";
  it("takes the first link whose rel tokens include icon or apple-touch-icon, resolved against the base", () => {
    expect(findIconHref(`<link rel="stylesheet" href="a.css"><link rel="icon" href="i.png"><link rel="apple-touch-icon" href="/t.png">`, base)).toBe("https://ex.test/dir/i.png");
    expect(findIconHref(`<link href="/t.png" rel="apple-touch-icon">`, base)).toBe("https://ex.test/t.png");
    expect(findIconHref(`<link rel=\"SHORTCUT ICON\" href=//cdn.test/f.ico>`, base)).toBe("https://cdn.test/f.ico");
  });
  it("does not match rel values that merely contain the word", () => {
    expect(findIconHref(`<link rel="icons" href="/x.png"><link rel="mask-icon" href="/m.svg"><link rel="apple-touch-icon-precomposed" href="/p.png">`, base)).toBeNull();
  });
  it("skips icon links without href and returns null when none", () => {
    expect(findIconHref(`<link rel="icon"><p>no links</p>`, base)).toBeNull();
  });
});

describe("icon cache", () => {
  it("creates the directory 0700, stores per-host files, honours TTLs, and a missing dir is a miss", async () => {
    const root = mkdtempSync(join(tmpdir(), "icon-cache-unit-"));
    const dir = join(root, "nested", "icons");
    try {
      expect(await readCachedIcon(dir, "a.test", 0)).toBeNull();
      const t = 1_000_000;
      await writeCachedIcon(dir, "a.test", { kind: "ok", contentType: "image/png", bytes: Buffer.from([1, 2]) }, t);
      await writeCachedIcon(dir, "b.test", { kind: "none" }, t);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      const files = readdirSync(dir);
      expect(files).toHaveLength(2);
      for (const f of files) expect(f).toMatch(/^[0-9a-f]{64}\.json$/);
      const stored = files.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
      expect(stored.every((e) => e.fetchedAt === t)).toBe(true);

      const hit = await readCachedIcon(dir, "a.test", t + POSITIVE_TTL_MS - 1);
      expect(hit?.kind).toBe("ok");
      if (hit?.kind === "ok") {
        expect(hit.contentType).toBe("image/png");
        expect([...hit.bytes]).toEqual([1, 2]);
      }
      expect(await readCachedIcon(dir, "a.test", t + POSITIVE_TTL_MS)).toBeNull();
      expect(await readCachedIcon(dir, "b.test", t + NEGATIVE_TTL_MS - 1)).toEqual({ kind: "none" });
      expect(await readCachedIcon(dir, "b.test", t + NEGATIVE_TTL_MS)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("default dir: SEARCH_ICON_CACHE_DIR, else ~/Library/Caches/harness-search/icons", () => {
    expect(defaultIconCacheDir({ SEARCH_ICON_CACHE_DIR: "/tmp/x" })).toBe("/tmp/x");
    expect(defaultIconCacheDir({})).toMatch(/\/Library\/Caches\/harness-search\/icons$/);
  });
});
