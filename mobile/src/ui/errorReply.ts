/**
 * The plain line shown for a reply saved with error status and no answer text
 * (FR45, M19f-AC3): never an empty bubble.
 */

import { UnreachableError } from "@/api/client";
import { describeError } from "@/api/errorMessages";

export const LOST_CONNECTION_LINE = "Lost connection to the Mac before the reply arrived";

/** The client's resume-exhausted error text (src/api/client.ts resumeStream). */
export const RESUME_EXHAUSTED_MESSAGE =
  "The connection to the Mac was lost and could not be restored.";

/** True for an error that means the connection to the Mac was lost or unrestorable. */
export function isLostConnectionError(error: unknown): boolean {
  if (error instanceof UnreachableError) return true;
  if (error instanceof TypeError) return true; // fetch network failure
  return error instanceof Error && error.message === RESUME_EXHAUSTED_MESSAGE;
}

/** The plain line persisted as `error_message` when a reply ends in error. */
export function errorLineFor(error: unknown): string {
  return isLostConnectionError(error) ? LOST_CONNECTION_LINE : describeError(error);
}
