/**
 * Plain-language error mapping (FR16): the single place that turns a typed
 * client error or a server-reported `operation.error_code` into one of the
 * six fixed, user-facing sentences. Both screens that show a failure to the
 * user (Models -- src/app/models.tsx, src/ui/modelList.ts -- and Chat --
 * src/app/chat.tsx) go through this module instead of showing a raw error
 * message, so every failure mode reads the same way everywhere it appears.
 */

import { ServerError, UnauthorizedError, UnreachableError } from "./client";
import type { Operation } from "@shared/api";
import { DEEP_RESEARCH_NEEDS_WEB_MESSAGE } from "@/ui/deepResearch";

export const UNREACHABLE_MESSAGE =
  "Can't reach the Mac. Check that it's on and that this phone is connected to Tailscale.";

export const OLLAMA_DOWN_MESSAGE =
  "The Mac is reachable, but Ollama isn't running on it.";

/**
 * Also re-exported (unchanged) from mobile/src/chat/chatController.ts, which
 * defined this constant first (M3/M4 work) -- that export keeps working, and
 * this is now the single source of its text.
 */
export const UNAUTHORIZED_MESSAGE = "Password wrong or changed";

export const REPLY_IN_PROGRESS_MESSAGE =
  "A reply is already being written. Wait for it to finish, or stop it first.";

/** `model` unknown (e.g. the operation carried no name) falls back to "the model". */
export function loadFailedMessage(model?: string): string {
  return `Couldn't load ${model ?? "the model"}. Ollama failed to start it.`;
}

/** `model` unknown falls back to "That model". */
export function notInstalledMessage(model?: string): string {
  return `${model ?? "That model"} is no longer installed on the Mac. Pull down to refresh the list.`;
}

/**
 * Map any error a client call can throw or deliver to the plain-language
 * sentence the user should see. `model` is the model a load/chat targeted,
 * used by the two messages that name it; omit it when there is none (e.g. an
 * unload, or a chat send with no model resolved yet).
 *
 * Anything not covered by a specific typed error or server error code falls
 * back to the error's own message, unchanged from the app's behaviour before
 * this mapping existed.
 */
export function describeError(error: unknown, model?: string): string {
  if (error instanceof UnauthorizedError) {
    return UNAUTHORIZED_MESSAGE;
  }
  if (error instanceof UnreachableError) {
    return UNREACHABLE_MESSAGE;
  }
  if (error instanceof ServerError) {
    switch (error.code) {
      case "ollama_down":
        return OLLAMA_DOWN_MESSAGE;
      case "unknown_model":
        return notInstalledMessage(model);
      case "generation_in_flight":
        return REPLY_IN_PROGRESS_MESSAGE;
      case "load_failed":
        return loadFailedMessage(model);
      case "deep_research_needs_web":
        return DEEP_RESEARCH_NEEDS_WEB_MESSAGE;
      case "deep_research_model_not_loaded":
        // A ServerError with no body message carries its code as the message.
        return error.message && error.message !== error.code
          ? error.message
          : "Load the deep research model to use deep research";
      default:
        return error.message;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Map a finished operation's failure (`GET /v1/state`'s `operation.error`) to
 * the plain-language sentence the Models screen shows, by `error_code` when
 * the server sent one (M5b servers), falling back to the raw `error` string
 * unchanged for unload failures and older servers that never set a code.
 * Returns null when the operation carries no error at all.
 */
export function describeOperationFailure(operation: Operation): string | null {
  if (!operation.error) {
    return null;
  }
  switch (operation.error_code) {
    case "ollama_down":
      return OLLAMA_DOWN_MESSAGE;
    case "unknown_model":
      return notInstalledMessage(operation.model);
    case "load_failed":
      return loadFailedMessage(operation.model);
    default:
      return operation.error;
  }
}
