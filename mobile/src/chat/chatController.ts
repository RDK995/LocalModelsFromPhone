/**
 * Send/stop logic for the chat screen, extracted out of `chat.tsx` (a `.tsx`
 * module, which cannot be imported by a bun test) so it can be unit tested
 * against a fake fetch instead of only exercised manually on device.
 *
 * `sendMessage` reads `GET /v1/state` before every send and sends to the
 * currently resident model (FR8): if no model is resident, sending is
 * blocked -- `onBlocked` is called and no `POST /v1/chat` is made.
 *
 * `stopGeneration` only POSTs the cancel route; it does not touch the fetch
 * that is still streaming the reply, and does not clear anything itself.
 * The stream keeps being read (see `APIClient.chat`) until the server's
 * terminal `done {status:"cancelled"}` event closes it, which is what a
 * caller's `onComplete` should treat as the point at which the generation id
 * can finally be cleared.
 *
 * A `401` from either `GET /v1/state` or `POST /v1/chat` (however it
 * arrives -- thrown or delivered to `onError`) is reported via
 * `onUnauthorized` instead of `onError` (FR13).
 */

import { ModelNotResidentError, UnauthorizedError } from "@/api/client";
import type { APIClient, StreamEvent } from "@/api/client";
import type { ChatRequest } from "@shared/api";
import { UNAUTHORIZED_MESSAGE } from "@/api/errorMessages";
import {
  DEEP_RESEARCH_NEEDS_WEB_MESSAGE,
  DEEP_RESEARCH_UNKNOWN_MODEL_MESSAGE,
  loadDeepResearchModelMessage,
} from "@/ui/deepResearch";

export const NO_MODEL_LOADED_MESSAGE = "No model loaded";
/** Re-exported from errorMessages.ts (the single source of its text, M5b) so
 * existing importers of this module keep working unchanged. */
export { UNAUTHORIZED_MESSAGE };

export interface SendMessageCallbacks {
  /** The `x-generation-id` header value, as soon as it arrives. */
  onStart: (generationId: string) => void;
  onEvent: (event: StreamEvent) => void;
  /** Sending was blocked (no resident model); no request was made. */
  onBlocked: (message: string) => void;
  onError: (error: Error) => void;
  /** The token was rejected with a 401 (FR13); `onError` is not called. */
  onUnauthorized: () => void;
  onComplete: () => void;
  /**
   * The model this send is going to, as soon as `GET /v1/state` confirms one
   * is resident and before `POST /v1/chat` is made. The server's terminal
   * `done` event already carries the model that produced a reply; this lets
   * a caller (conversationSession.ts, M3-T2) fall back to the model a send
   * targeted if that field were ever missing.
   */
  onModelResolved?: (model: string) => void;
  /**
   * A request for web tools (FR18). Honoured only when it is `true` and the
   * resident model is listed with the `tools` capability in the state fetched
   * at send time; otherwise the body carries no `web` key.
   */
  web?: boolean;
  /**
   * Send this one message as a deep research run (M18, FR34). Honoured only
   * when `web` is true, the resident model has tools and is the
   * `deep_research_model` reported by `GET /v1/state`; otherwise sending is
   * blocked (`onBlocked` with the reason) and no request is made.
   */
  deepResearch?: boolean;
  signal?: AbortSignal;
}

type StateAndChatClient = Pick<APIClient, "getState" | "chat">;

/**
 * Look up the resident model and send `messages` to it. Resolves once the
 * send either completes normally, is blocked, or fails; errors are reported
 * via `callbacks.onError`/`onBlocked` rather than thrown, so a caller can
 * `await` this without a try/catch.
 */
export async function sendMessage(
  client: StateAndChatClient,
  messages: ChatRequest["messages"],
  callbacks: SendMessageCallbacks
): Promise<void> {
  let resident: ChatRequest["model"] | null;
  let residentHasTools = false;
  let deepResearchModel: string | undefined;
  try {
    const state = await client.getState();
    deepResearchModel = state.deep_research_model || undefined;
    resident = state.resident ? state.resident.name : null;
    residentHasTools =
      resident !== null &&
      state.models.some((m) => m.name === resident && m.tools === true);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      callbacks.onUnauthorized();
      return;
    }
    callbacks.onError(
      error instanceof Error ? error : new Error(String(error))
    );
    return;
  }

  if (callbacks.deepResearch === true) {
    if (callbacks.web !== true) {
      callbacks.onBlocked(DEEP_RESEARCH_NEEDS_WEB_MESSAGE);
      return;
    }
    if (!deepResearchModel) {
      callbacks.onBlocked(DEEP_RESEARCH_UNKNOWN_MODEL_MESSAGE);
      return;
    }
    if (resident !== deepResearchModel || !residentHasTools) {
      callbacks.onBlocked(loadDeepResearchModelMessage(deepResearchModel));
      return;
    }
  }

  if (!resident) {
    callbacks.onBlocked(NO_MODEL_LOADED_MESSAGE);
    return;
  }

  callbacks.onModelResolved?.(resident);

  try {
    await client.chat(
      callbacks.deepResearch === true
        ? { model: resident, messages, web: true, deep_research: true }
        : callbacks.web === true && residentHasTools
          ? { model: resident, messages, web: true }
          : { model: resident, messages },
      {
        onStart: callbacks.onStart,
        onEvent: callbacks.onEvent,
        onError: (error) => {
          // A 401 delivered via this callback (rather than thrown) is still
          // routed to onUnauthorized, not onError (FR13).
          if (error instanceof UnauthorizedError) {
            callbacks.onUnauthorized();
            return;
          }
          callbacks.onError(error);
        },
        onComplete: callbacks.onComplete,
        signal: callbacks.signal,
      }
    );
  } catch (error) {
    // The model resident at GET /v1/state time was unloaded before the
    // chat request landed; treat this the same as no resident model (F2)
    // rather than a generic error.
    if (error instanceof ModelNotResidentError) {
      callbacks.onBlocked(NO_MODEL_LOADED_MESSAGE);
      return;
    }
    if (error instanceof UnauthorizedError) {
      callbacks.onUnauthorized();
      return;
    }
    callbacks.onError(
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

/**
 * Cancel a generation on the server. Deliberately does not abort the fetch
 * that is still streaming the reply -- the caller keeps reading until the
 * terminal `done {status:"cancelled"}` event ends the stream naturally.
 */
export async function stopGeneration(
  client: Pick<APIClient, "cancelGeneration">,
  generationId: string
): Promise<void> {
  await client.cancelGeneration(generationId);
}
