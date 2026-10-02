/**
 * Backoff schedule and budget for `APIClient.chat()`'s dropped-connection
 * resume loop (FR11, architecture C2): a transport drop mid-reply retries
 * `GET /v1/generations/{id}/events` with `Last-Event-ID` instead of giving
 * up, so the caller keeps seeing the same reply.
 *
 * Ported from
 * /Users/ryankenny/Projects/phoneToLocalModel/web/src/recovery-policy.ts
 * (`recoveryDelayMs`/`RECOVERY_BUDGET_MS`).
 */

const RESUME_DELAY_SCHEDULE_MS: readonly number[] = [500, 1000, 2000, 4000, 8000];
const RESUME_DELAY_CAP_MS = 10_000;

/**
 * Backoff delay, in milliseconds, to wait before resume attempt `attempt`
 * (1-based): 500, 1000, 2000, 4000, 8000ms for attempts 1..5, then a flat
 * 10000ms for every attempt after that. No randomness/jitter, so recovery
 * timing is exactly reproducible in tests.
 */
export function resumeDelayMs(attempt: number): number {
  const index = attempt - 1;
  if (index >= 0 && index < RESUME_DELAY_SCHEDULE_MS.length) {
    return RESUME_DELAY_SCHEDULE_MS[index]!;
  }
  return RESUME_DELAY_CAP_MS;
}

/**
 * Wall-clock budget, in milliseconds, for one outage's resume loop,
 * measured from the transport drop that started that outage. It resets after
 * every successful resume, so several short outages in one reply each get
 * the full allowance. Once elapsed
 * time reaches this budget when the next attempt would start, the resume
 * loop stops and the caller sees an error instead of retrying further.
 */
export const RESUME_BUDGET_MS = 300_000;
