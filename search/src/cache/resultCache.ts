/**
 * In-memory result cache for the search service (C13): successful searches by normalised query and
 * successful page reads by final URL, valid for 24 hours. Bounded; the oldest entry goes when full.
 * Lost on restart (acceptable).
 */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_SEARCH_ENTRIES = 500;
export const MAX_PAGE_ENTRIES = 200;

/** A stored HTTP response: status plus the exact JSON body text. */
export interface CachedResponse {
  status: number;
  body: string;
}

export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; storedAt: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = CACHE_TTL_MS,
  ) {}

  /** The value while now < storedAt + ttl; an expired entry is dropped. */
  get(key: string): V | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (this.now() >= e.storedAt + this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return e.value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key); // re-inserting makes it the newest
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, storedAt: this.now() });
  }

  get size(): number {
    return this.entries.size;
  }
}

/** Trim, lower-case, Unicode NFKC, internal whitespace collapsed to one space. */
export function normaliseQuery(query: string): string {
  return query.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

export function searchKey(query: string, max: number): string {
  return `${normaliseQuery(query)}\u0000${max}`;
}
