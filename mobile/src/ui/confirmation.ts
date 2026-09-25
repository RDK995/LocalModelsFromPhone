/**
 * Pure warning text for the Load/Unload busy-confirmation dialog (FR6,
 * src/app/models.tsx): turns the server's `confirmation_required` reasons
 * into a title and message in plain words. Extracted into its own module,
 * like `modelList.ts` and `modelActions.ts`, so it can be tested directly
 * without a `.tsx` import.
 */

import type { ConfirmationReason } from "@/api/client";

export interface ConfirmationWarning {
  title: string;
  message: string;
}

/**
 * Build the warning shown before a Load/Unload that the server refused with
 * `confirmation_required`. `residentModelName` is the name of the model
 * that is currently resident (and would be affected), when known; pass null
 * if it isn't known. Both reasons can be present together, in which case
 * both sentences are included.
 */
export function buildConfirmationWarning(
  reasons: ConfirmationReason[],
  residentModelName: string | null
): ConfirmationWarning {
  const sentences: string[] = [];

  if (reasons.includes("reply_in_progress")) {
    sentences.push(
      "A reply is still being written, and continuing will stop it."
    );
  }

  if (reasons.includes("not_loaded_by_server")) {
    const subject = residentModelName ?? "The loaded model";
    sentences.push(
      `${subject} was not loaded by this app, so another program on the Mac may be using it. This is a best guess: Ollama cannot tell whether it is actually in use.`
    );
  }

  return {
    title: "Continue anyway?",
    message: sentences.join(" "),
  };
}
