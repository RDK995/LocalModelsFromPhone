/**
 * Send-in-conversation logic for the chat screen (FR7/FR8), extracted out of
 * `chat.tsx` (a `.tsx` module, which cannot be imported by a bun test) so it
 * can be unit tested directly, the same way `chatController.ts` is.
 *
 * `sendInConversation` builds the message history for a stored conversation
 * (every earlier turn, role and content only, plus the new prompt),
 * persists the prompt, sends that history through `chatController.sendMessage`,
 * and persists the assistant's reply once the send settles.
 *
 * Design decisions this file encodes:
 * - The user's prompt is persisted *before* `sendMessage` is called, and
 *   stays in the conversation even when the send turns out to be blocked
 *   (no resident model). The alternative -- holding it back and handing it
 *   to the caller to put back in the input box -- would need a way to
 *   remove a single message from a conversation, which the store does not
 *   offer, and would leave "was this prompt ever sent" ambiguous on
 *   reopening the conversation later. Kept in the conversation, the
 *   transcript reads exactly like what happened: a prompt with no reply.
 * - Renaming the conversation from the prompt (on its first message) also
 *   happens unconditionally, for the same reason: the prompt is real either
 *   way.
 * - A stream `error` SSE event is turned into a thrown `Error` inside the
 *   `onEvent` callback passed down to `sendMessage`/`client.chat`, the same
 *   trick `chat.tsx` uses today: `client.chat`'s read loop catches it and
 *   calls `onError` with whatever content had already been accumulated,
 *   which is what gets persisted with `status: "error"`.
 * - `client.chat`'s `onComplete`/`onError` are fire-and-forget calls (see
 *   src/api/client.ts's read loop): the persistence they kick off here is
 *   tracked in `pendingPersist` and awaited before `sendInConversation`
 *   returns, so a caller can rely on the store already being updated once it
 *   resolves.
 */

import { sendMessage } from "./chatController";
import type { SendMessageCallbacks } from "./chatController";
import type { APIClient, StreamEvent } from "@/api/client";
import type { ChatRequest } from "@shared/api";
import type { ConversationStore, Message, MessageStatus } from "@/store/conversationStore";
import { applyStreamEvent, initialStreamAccumulator } from "@/ui/streamReducer";

export const BLOCKED_MESSAGE =
  "No model loaded — load one on the Models screen to send.";

const TITLE_MAX_LENGTH = 40;

/** The conversation title set from a prompt: trimmed, and capped at 40 characters. */
export function titleFromPrompt(prompt: string): string {
  const trimmed = prompt.trim();
  return trimmed.length > TITLE_MAX_LENGTH
    ? trimmed.slice(0, TITLE_MAX_LENGTH)
    : trimmed;
}

/**
 * Mints a message id the same way `sendInConversation` does when the caller
 * does not supply one, so the chat screen can pre-mint the ids for the
 * prompt and the in-flight reply (see the `options` parameter below) and
 * reuse them once the send settles.
 */
export function newMessageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * The content sent in history for a stored message. An assistant message with
 * sources carries its source list (title + URL) after the answer, so a
 * follow-up sees what the answer was based on; page text is never stored, so
 * never re-sent (FR23). Messages without sources are sent as stored.
 */
export function historyContent(message: Message): string {
  const sources = message.sources;
  if (message.role !== "assistant" || !sources || sources.length === 0) {
    return message.content;
  }
  const lines = sources.map((s, i) => `[${s.n ?? i + 1}] ${s.title} — ${s.url}`);
  return `${message.content}\n\nSources:\n${lines.join("\n")}`;
}

type StateAndChatClient = Pick<APIClient, "getState" | "chat">;

export interface SendInConversationCallbacks {
  /** The `x-generation-id` header value, as soon as it arrives. */
  onStart?: (generationId: string) => void;
  onEvent: (event: StreamEvent) => void;
  /** Sending was blocked (no resident model); the prompt is still persisted. */
  onBlocked: (message: string) => void;
  onError: (error: Error) => void;
  onUnauthorized: () => void;
  /** The assistant's reply (or lack of one, on error) has been persisted. */
  onComplete: () => void;
  signal?: AbortSignal;
}

/**
 * Send `prompt` in the conversation `conversationId`: persists it, sends the
 * full prior history plus `prompt` to the resident model, and persists the
 * assistant's reply (success, stopped, or error) once the send settles.
 * Resolves once the store is fully updated; outcomes are reported via
 * `callbacks`, not thrown.
 *
 * `options.userMessageId`/`options.assistantMessageId`, when given, are used
 * as the persisted ids for the prompt and the reply (whichever outcome it
 * settles to) instead of freshly minted ones -- so a caller that has already
 * shown the prompt/reply optimistically under those ids (via `newMessageId`)
 * sees the same ids land in the store, rather than a duplicate.
 */
export async function sendInConversation(
  client: StateAndChatClient,
  store: ConversationStore,
  conversationId: string,
  prompt: string,
  callbacks: SendInConversationCallbacks,
  options?: { userMessageId?: string; assistantMessageId?: string }
): Promise<void> {
  const conversation = await store.get(conversationId);
  if (!conversation) {
    callbacks.onError(new Error(`Conversation not found: ${conversationId}`));
    return;
  }

  // Read once, here: a switch change during the reply applies from the next prompt (FR18).
  const webSearch = conversation.web_search === true;

  const history: ChatRequest["messages"] = conversation.messages.map((m) => ({
    role: m.role,
    content: historyContent(m),
  }));
  history.push({ role: "user", content: prompt });

  const isFirstMessage = conversation.messages.length === 0;
  await store.appendMessage(conversationId, {
    id: options?.userMessageId ?? newMessageId(),
    role: "user",
    content: prompt,
    status: "complete",
  });
  if (isFirstMessage) {
    await store.rename(conversationId, titleFromPrompt(prompt));
  }

  let accumulator = initialStreamAccumulator;
  let doneModel: string | null = null;
  let doneStatus: "complete" | "cancelled" | null = null;
  let sentModel: string | null = null;
  let pendingPersist: Promise<void> = Promise.resolve();

  function persistReply(status: MessageStatus): void {
    const message: Message = {
      id: options?.assistantMessageId ?? newMessageId(),
      role: "assistant",
      content: accumulator.content,
      status,
      ...(accumulator.thinking ? { thinking: accumulator.thinking } : {}),
      ...(accumulator.steps.length > 0 ? { steps: accumulator.steps } : {}),
      ...(accumulator.sources.length > 0 ? { sources: accumulator.sources } : {}),
      ...(doneModel || sentModel ? { model: doneModel ?? sentModel ?? undefined } : {}),
    };
    pendingPersist = store.appendMessage(conversationId, message).then(() => undefined);
  }

  const innerCallbacks: SendMessageCallbacks = {
    onStart: (generationId) => callbacks.onStart?.(generationId),
    onModelResolved: (model) => {
      sentModel = model;
    },
    onEvent: (event: StreamEvent) => {
      if (event.type === "error") {
        callbacks.onEvent(event);
        // Turned into a thrown Error so client.chat's read loop routes it to
        // onError with whatever content was already accumulated (see the
        // module doc comment).
        throw new Error(`${event.data.code}: ${event.data.message}`);
      }
      if (event.type === "done") {
        doneStatus = event.data.status;
        doneModel = event.data.model || null;
        callbacks.onEvent(event);
        return;
      }
      accumulator = applyStreamEvent(accumulator, event);
      callbacks.onEvent(event);
    },
    onBlocked: () => callbacks.onBlocked(BLOCKED_MESSAGE),
    onError: (error) => {
      persistReply("error");
      pendingPersist = pendingPersist.then(() => callbacks.onError(error));
    },
    onUnauthorized: () => callbacks.onUnauthorized(),
    onComplete: () => {
      persistReply(doneStatus === "cancelled" ? "stopped" : "complete");
      pendingPersist = pendingPersist.then(() => callbacks.onComplete());
    },
    web: webSearch,
    signal: callbacks.signal,
  };

  await sendMessage(client, history, innerCallbacks);
  await pendingPersist;
}
