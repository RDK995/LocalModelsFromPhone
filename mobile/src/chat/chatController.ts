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
 */

import { ModelNotResidentError } from "@/api/client";
import type { APIClient, StreamEvent } from "@/api/client";
import type { ChatRequest } from "@shared/api";

export const NO_MODEL_LOADED_MESSAGE = "No model loaded";

export interface SendMessageCallbacks {
  /** The `x-generation-id` header value, as soon as it arrives. */
  onStart: (generationId: string) => void;
  onEvent: (event: StreamEvent) => void;
  /** Sending was blocked (no resident model); no request was made. */
  onBlocked: (message: string) => void;
  onError: (error: Error) => void;
  onComplete: () => void;
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
  try {
    const state = await client.getState();
    resident = state.resident ? state.resident.name : null;
  } catch (error) {
    callbacks.onError(
      error instanceof Error ? error : new Error(String(error))
    );
    return;
  }

  if (!resident) {
    callbacks.onBlocked(NO_MODEL_LOADED_MESSAGE);
    return;
  }

  try {
    await client.chat(
      { model: resident, messages },
      {
        onStart: callbacks.onStart,
        onEvent: callbacks.onEvent,
        onError: callbacks.onError,
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
