import { describe, it, expect, mock } from "bun:test";
import { createIconCache } from "./iconCache";
import { createMemoryStorage } from "./storagePort";
import type { StoragePort } from "./storagePort";

const URI = "data:image/png;base64,AAAA";

describe("createIconCache", () => {
  it("fetches once then serves from memory", async () => {
    const fetchIcon = mock(async () => URI);
    const cache = createIconCache(createMemoryStorage(), fetchIcon);
    expect(cache.peek("a.com")).toBeUndefined();
    expect(await cache.get("a.com")).toBe(URI);
    expect(await cache.get("a.com")).toBe(URI);
    expect(cache.peek("a.com")).toBe(URI);
    expect(fetchIcon).toHaveBeenCalledTimes(1);
  });

  it("serves a persisted value to a fresh cache without fetching", async () => {
    const storage = createMemoryStorage();
    await createIconCache(storage, async () => URI).get("a.com");
    const fetchIcon = mock(async () => null);
    const fresh = createIconCache(storage, fetchIcon);
    expect(await fresh.get("a.com")).toBe(URI);
    expect(fetchIcon).not.toHaveBeenCalled();
    expect(await storage.getItem("iconCache:a.com")).toBe(URI);
  });

  it("keeps null in memory only, not persisted", async () => {
    const storage = createMemoryStorage();
    const fetchIcon = mock(async () => null);
    const cache = createIconCache(storage, fetchIcon);
    expect(await cache.get("a.com")).toBeNull();
    expect(await cache.get("a.com")).toBeNull();
    expect(cache.peek("a.com")).toBeNull();
    expect(fetchIcon).toHaveBeenCalledTimes(1);
    expect(await storage.getItem("iconCache:a.com")).toBeNull();

    const retry = mock(async () => URI);
    expect(await createIconCache(storage, retry).get("a.com")).toBe(URI);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight fetch between concurrent gets", async () => {
    let release!: (v: string) => void;
    const fetchIcon = mock(
      () => new Promise<string | null>((r) => (release = r)),
    );
    const cache = createIconCache(createMemoryStorage(), fetchIcon);
    const p1 = cache.get("a.com");
    const p2 = cache.get("a.com");
    await Promise.resolve();
    await Promise.resolve();
    release(URI);
    expect(await p1).toBe(URI);
    expect(await p2).toBe(URI);
    expect(fetchIcon).toHaveBeenCalledTimes(1);
  });

  it("resolves null when storage throws", async () => {
    const broken: StoragePort = {
      getItem: async () => {
        throw new Error("boom");
      },
      setItem: async () => {
        throw new Error("boom");
      },
      removeItem: async () => {},
    };
    const cache = createIconCache(broken, async () => URI);
    expect(await cache.get("a.com")).toBeNull();
  });

  it("resolves null when fetch throws", async () => {
    const cache = createIconCache(createMemoryStorage(), async () => {
      throw new Error("x");
    });
    expect(await cache.get("a.com")).toBeNull();
  });
});
