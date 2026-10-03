/**
 * Per-backend circuit breakers for the search service (C13, FR39). In memory only: lost on restart.
 * A backend whose attempt came back `rate_limited` rests for 1 hour, `captcha` for 24 hours; it is usable
 * again at exactly rest-start + duration. `empty`, `error` and `ok` outcomes never rest a backend.
 */
export const BROWSER = "browser";
export const DEFAULT_DDGS_BACKENDS = ["duckduckgo", "bing", "brave", "mojeek"];

const REST_MS: Record<string, number> = { rate_limited: 3_600_000, captcha: 86_400_000 };

export interface Attempt {
  backend: string;
  outcome: string;
}

export class Breakers {
  private restingUntil = new Map<string, number>();

  constructor(private now: () => number = Date.now) {}

  isResting(backend: string): boolean {
    const until = this.restingUntil.get(backend);
    return until !== undefined && this.now() < until;
  }

  /** Records helper attempts; only rate_limited and captcha outcomes start a rest. */
  record(attempts: Attempt[] | undefined): void {
    for (const a of attempts ?? []) {
      const ms = REST_MS[a.outcome];
      if (ms !== undefined) this.restingUntil.set(a.backend, this.now() + ms);
    }
  }
}

/** Parses the helper's `attempts` array, dropping malformed entries. */
export function parseAttempts(value: unknown): Attempt[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: Attempt[] = [];
  for (const e of value) {
    if (typeof e !== "object" || e === null) continue;
    const { backend, outcome } = e as Record<string, unknown>;
    if (typeof backend === "string" && typeof outcome === "string") out.push({ backend, outcome });
  }
  return out;
}
