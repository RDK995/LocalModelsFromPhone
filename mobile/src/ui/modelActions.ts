/**
 * Pure polling helper behind the Models screen's Load/Unload buttons
 * (src/app/models.tsx): starts a load or unload, then polls `GET /v1/state`
 * until the server reports the operation finished (`operation.kind ===
 * "idle"`), reporting each polled state to the caller so it can update the
 * busy label while waiting. Extracted out of `src/app/models.tsx` (a `.tsx`
 * module, which cannot be imported by a bun test) so it can be tested
 * directly, the same way `modelList.ts` and `streamReducer.ts` are.
 *
 * FR6 busy-warning confirmation: `start` is called unconfirmed first
 * (`confirm: false`). If the server answers `confirmation_required`
 * (`ConfirmationRequiredError`), the injected `confirm` callback is asked
 * with the server's reasons; a true reply retries `start` with `confirm:
 * true` and then polls as normal, a false reply makes no further call, does
 * not poll, and resolves to a distinct "cancelled" outcome rather than an
 * error. Any other error propagates unchanged.
 */

import type { StateResponse } from "@shared/api";
import { ConfirmationRequiredError } from "@/api/client";
import type { ConfirmationReason } from "@/api/client";

const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_MAX_WAIT_MS = 120_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RunModelActionOptions {
  /** Reads the current server state; only `getState` is needed. */
  getState: () => Promise<StateResponse>;
  /**
   * Starts the operation (`POST /v1/models/load` or `/unload`), called with
   * `confirm: false` first, then again with `confirm: true` if the user
   * confirms after a `confirmation_required` response. Errors other than
   * `ConfirmationRequiredError` propagate unchanged, before any polling
   * happens.
   */
  start: (confirm: boolean) => Promise<unknown>;
  /**
   * Asked with the server's reasons if the unconfirmed `start` throws
   * `ConfirmationRequiredError`; resolve true to retry with `confirm: true`,
   * false to cancel. If omitted, `ConfirmationRequiredError` propagates like
   * any other error.
   */
  confirm?: (reasons: ConfirmationReason[]) => Promise<boolean>;
  /** Called with each polled state, including the first, while waiting. */
  onPoll?: (state: StateResponse) => void;
  /** Injectable so tests can drive the poll loop without waiting in real time. */
  sleep?: (ms: number) => Promise<void>;
  /** Milliseconds between polls. */
  intervalMs?: number;
  /** Give up and reject if the operation has not gone idle within this long. */
  maxWaitMs?: number;
}

/** Resolved by `runModelAction` when the user declines to confirm. */
export interface RunModelActionCancelled {
  cancelled: true;
}

export type RunModelActionResult = StateResponse | RunModelActionCancelled;

/**
 * Start a load or unload, then poll `GET /v1/state` until the operation
 * finishes (`operation.kind === "idle"`), returning that final state. Errors
 * thrown by `start` propagate unchanged, except `ConfirmationRequiredError`
 * when a `confirm` callback is given: `confirm` is asked, and a false reply
 * resolves to `{cancelled: true}` without a further call or any polling. If
 * the operation is still not idle after `maxWaitMs`, rejects with a clear
 * timeout error instead of polling forever.
 */
export async function runModelAction(
  options: RunModelActionOptions
): Promise<RunModelActionResult> {
  const {
    getState,
    start,
    confirm,
    onPoll,
    sleep = defaultSleep,
    intervalMs = DEFAULT_INTERVAL_MS,
    maxWaitMs = DEFAULT_MAX_WAIT_MS,
  } = options;

  try {
    await start(false);
  } catch (error) {
    if (error instanceof ConfirmationRequiredError && confirm) {
      const confirmed = await confirm(error.reasons);
      if (!confirmed) {
        return { cancelled: true };
      }
      await start(true);
    } else {
      throw error;
    }
  }

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
