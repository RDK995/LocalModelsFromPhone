import { describe, it, expect } from "bun:test";
import { TtlCache, normaliseQuery } from "./resultCache";

describe("TtlCache", () => {
  it("expires at exactly the TTL and evicts the oldest when full", () => {
    let t = 0;
    const c = new TtlCache<number>(2, () => t, 100);
    c.set("a", 1);
    t = 99;
    expect(c.get("a")).toBe(1);
    t = 100;
    expect(c.get("a")).toBeUndefined();
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe(2);
    expect(c.size).toBe(2);
  });

  it("normalises queries", () => {
    expect(normaliseQuery("  Heat   Pump\tcosts ")).toBe("heat pump costs");
    expect(normaliseQuery("ＡＢＣ")).toBe("abc");
  });
});
