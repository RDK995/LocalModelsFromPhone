/**
 * Pure polling helper behind the Models screen's Load/Unload buttons
 * (src/app/models.tsx): starts a load or unload, then polls `GET /v1/state`
 * until the server reports the operation finished (`operation.kind ===
 * "idle"`), reporting each polled state to the caller so it can update the
 * busy label while waiting. Extracted out of `src/app/models.tsx` (a `.tsx`
 * module, which cannot be imported by a bun test) so it can be tested
 * directly, the same way `modelList.ts` and `streamReducer.ts` are.
 */

import type { StateResponse } from "@shared/api";

const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_MAX_WAIT_MS = 120_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RunModelActionOptions {
  /** Reads the current server state; only `getState` is needed. */
  getState: () => Promise<StateResponse>;
  /**
   * Starts the operation (`POST /v1/models/load` or `/unload`). Its errors
   * propagate unchanged, before any polling happens.
   */
  start: () => Promise<unknown>;
  /** Called with each polled state, including the first, while waiting. */
  onPoll?: (state: StateResponse) => void;
  /** Injectable so tests can drive the poll loop without waiting in real time. */
  sleep?: (ms: number) => Promise<void>;
  /** Milliseconds between polls. */
  intervalMs?: number;
  /** Give up and reject if the operation has not gone idle within this long. */
  maxWaitMs?: number;
}

/**
 * Start a load or unload, then poll `GET /v1/state` until the operation
 * finishes (`operation.kind === "idle"`), returning that final state. Errors
 * thrown by `start` propagate unchanged. If the operation is still not idle
 * after `maxWaitMs`, rejects with a clear timeout error instead of polling
 * forever.
 */
export async function runModelAction(
  options: RunModelActionOptions
): Promise<StateResponse> {
  const {
    getState,
    start,
    onPoll,
    sleep = defaultSleep,
    intervalMs = DEFAULT_INTERVAL_MS,
    maxWaitMs = DEFAULT_MAX_WAIT_MS,
  } = options;

  await start();

  let elapsedMs = 0;
  for (;;) {
    const state = await getState();
    onPoll?.(state);

    if (state.operation.kind === "idle") {
      return state;
    }

    if (elapsedMs >= maxWaitMs) {
      throw new Error(
        `Timed out after ${maxWaitMs}ms waiting for the operation to finish`
      );
    }

    await sleep(intervalMs);
    elapsedMs += intervalMs;
  }
}
