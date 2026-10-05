/**
 * Phone-side cache of site logos (FR27). A logo is a data URI fetched from
 * the Mac; the cache keeps it in memory and in storage so a render does not
 * re-ask the Mac. No react-native imports (bun loads this file).
 */

import type { StoragePort } from "./storagePort";

export interface IconCache {
  get(host: string): Promise<string | null>;
  /** Sync memory lookup: data URI, null ("none" marker), undefined if unknown. */
  peek(host: string): string | null | undefined;
}

const KEY_PREFIX = "iconCache:";

export function createIconCache(
  storage: StoragePort,
  fetchIcon: (host: string) => Promise<string | null>,
): IconCache {
  const memory = new Map<string, string | null>();
  const inFlight = new Map<string, Promise<string | null>>();

  async function load(host: string): Promise<string | null> {
    try {
      const stored = await storage.getItem(KEY_PREFIX + host);
      if (stored) {
        memory.set(host, stored);
        return stored;
      }
      const fetched = await fetchIcon(host);
      memory.set(host, fetched);
      if (fetched) {
        // Persist only real logos. A null ("none") result stays in memory for
        // this app session only, so a site whose logo failed because the Mac
        // was briefly unreachable is retried on a later launch.
        await storage.setItem(KEY_PREFIX + host, fetched);
      }
      return fetched;
    } catch {
      return null;
    }
  }

  return {
    peek(host) {
      return memory.get(host);
    },
    get(host) {
      if (memory.has(host)) return Promise.resolve(memory.get(host) ?? null);
      const pending = inFlight.get(host);
      if (pending) return pending;
      const p = load(host).finally(() => inFlight.delete(host));
      inFlight.set(host, p);
      return p;
    },
  };
}
