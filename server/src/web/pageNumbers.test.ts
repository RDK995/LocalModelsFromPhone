import { describe, it, expect } from "bun:test";
import { createPageNumberer, pageUrlKey } from "./pageNumbers";

describe("pageUrlKey", () => {
  it("ignores http/https, a leading www. and a trailing slash", () => {
    const k = pageUrlKey("https://example.com/a");
    expect(pageUrlKey("http://example.com/a")).toBe(k);
    expect(pageUrlKey("https://www.example.com/a")).toBe(k);
    expect(pageUrlKey("https://example.com/a/")).toBe(k);
    expect(pageUrlKey("http://www.example.com/a/")).toBe(k);
  });

  it("keeps different paths and hosts apart", () => {
    expect(pageUrlKey("https://example.com/a")).not.toBe(pageUrlKey("https://example.com/b"));
    expect(pageUrlKey("https://example.com/a")).not.toBe(pageUrlKey("https://news.example.com/a"));
  });
});

describe("createPageNumberer", () => {
  it("numbers pages from 1 in first-read order", () => {
    const n = createPageNumberer();
    expect(n("https://a.example/1")).toBe(1);
    expect(n("https://b.example/2")).toBe(2);
    expect(n("https://c.example/3")).toBe(3);
  });

  it("a re-read page keeps its number, including URL variants", () => {
    const n = createPageNumberer();
    expect(n("https://a.example/1")).toBe(1);
    expect(n("https://b.example/2")).toBe(2);
    expect(n("http://www.a.example/1/")).toBe(1);
    expect(n("https://b.example/2")).toBe(2);
    expect(n("https://a.example/other")).toBe(3);
  });
});
