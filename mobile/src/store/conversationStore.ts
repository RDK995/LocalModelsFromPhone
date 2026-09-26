/**
 * Phone conversation store (C3, FR7/FR8): persists every conversation and
 * its messages on the phone so a brand-new store built over the same
 * `StoragePort` (the proxy for "the app was force-quit and reopened") sees
 * exactly the same data.
 *
 * Ported from `phoneToLocalModel/web/src/conversation-store.ts`, which is
 * synchronous over a single localStorage key. This version is async
 * (AsyncStorage in the app, see ./asyncStorage) and spreads conversations
 * across one storage key per conversation plus a small index key, instead
 * of one envelope holding every conversation. That keeps a single corrupt
 * conversation from taking the whole list down, and keeps rewriting one
 * conversation from having to rewrite every other one's JSON too. The
 * "validate what was loaded, never throw it into the UI" behaviour of the
 * original store is kept: an unparseable or invalid record is dropped, not
 * surfaced as a crash.
 *
 * Field names (`created_at`, `updated_at`, `generation_id`, `last_seq`)
 * match the shape agreed in architecture.md's Data table, not the
 * camelCase of the ported source.
 *
 * Title: new conversations default to "New chat" (`rename` can change it
 * later). This store does not special-case "set the title from the first
 * user message" -- it does not know which appended message is the first
 * user prompt versus a later one restored from disk, and a chat screen
 * calling `appendMessage` does. That decision is left to the caller via
 * `rename`.
 */

import type { StoragePort } from "./storagePort";

export type { StoragePort } from "./storagePort";

export type MessageRole = "user" | "assistant";
export type MessageStatus = "complete" | "stopped" | "error" | "streaming";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  thinking?: string;
  model?: string;
  status: MessageStatus;
  generation_id?: string;
  last_seq?: number;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages: Message[];
}

export interface ConversationStoreOptions {
  /** Injected clock, defaults to `() => new Date().toISOString()`. */
  now?: () => string;
  /** Injected id generator, defaults to a UUID (or a fallback if `crypto.randomUUID` is unavailable). */
  newId?: () => string;
}

export interface ConversationStore {
  list(): Promise<Conversation[]>;
  get(id: string): Promise<Conversation | null>;
  create(title?: string): Promise<Conversation>;
  delete(id: string): Promise<void>;
  appendMessage(conversationId: string, message: Message): Promise<Conversation>;
  updateMessage(
    conversationId: string,
    messageId: string,
    patch: Partial<Message>
  ): Promise<Conversation>;
  rename(conversationId: string, title: string): Promise<Conversation>;
}

const DEFAULT_TITLE = "New chat";
const KEY_PREFIX = "phone-models:v1:conversation:";
const INDEX_KEY = "phone-models:v1:conversations-index";

function conversationKey(id: string): string {
  return `${KEY_PREFIX}${id}`;
}

function defaultNow(): string {
  return new Date().toISOString();
}

function defaultNewId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const MESSAGE_STATUSES: MessageStatus[] = ["complete", "stopped", "error", "streaming"];

function isValidMessage(value: unknown): value is Message {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string") return false;
  if (v.role !== "user" && v.role !== "assistant") return false;
  if (typeof v.content !== "string") return false;
  if (!MESSAGE_STATUSES.includes(v.status as MessageStatus)) return false;
  if (v.thinking !== undefined && typeof v.thinking !== "string") return false;
  if (v.model !== undefined && typeof v.model !== "string") return false;
  if (v.generation_id !== undefined && typeof v.generation_id !== "string") return false;
  if (v.last_seq !== undefined && typeof v.last_seq !== "number") return false;
  return true;
}

function isValidConversation(value: unknown): value is Conversation {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string") return false;
  if (typeof v.title !== "string") return false;
  if (typeof v.created_at !== "string") return false;
  if (typeof v.updated_at !== "string") return false;
  if (!Array.isArray(v.messages)) return false;
  return v.messages.every(isValidMessage);
}

/** Parses `raw` into a valid `Conversation`, or `null` for anything unparseable or malformed. */
function parseConversation(raw: string | null): Conversation | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isValidConversation(parsed) ? parsed : null;
}

/** Parses the index into a list of conversation ids, treating anything unparseable or malformed as empty. */
function parseIndex(raw: string | null): string[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed) || !parsed.every(id => typeof id === "string")) {
    return [];
  }
  return parsed;
}

export function createConversationStore(
  storage: StoragePort,
  options: ConversationStoreOptions = {}
): ConversationStore {
  const now = options.now ?? defaultNow;
  const newId = options.newId ?? defaultNewId;

  async function readIndex(): Promise<string[]> {
    return parseIndex(await storage.getItem(INDEX_KEY));
  }

  async function writeIndex(ids: string[]): Promise<void> {
    await storage.setItem(INDEX_KEY, JSON.stringify(ids));
  }

  async function readConversation(id: string): Promise<Conversation | null> {
    return parseConversation(await storage.getItem(conversationKey(id)));
  }

  async function writeConversation(conversation: Conversation): Promise<void> {
    await storage.setItem(conversationKey(conversation.id), JSON.stringify(conversation));
  }

  async function requireConversation(id: string): Promise<Conversation> {
    const found = await readConversation(id);
    if (!found) throw new Error(`Conversation not found: ${id}`);
    return found;
  }

  return {
    async list(): Promise<Conversation[]> {
      const ids = await readIndex();
      const loaded = await Promise.all(ids.map(id => readConversation(id)));
      const conversations = loaded.filter((c): c is Conversation => c !== null);
      return conversations.sort(
        (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)
      );
    },

    async get(id: string): Promise<Conversation | null> {
      return readConversation(id);
    },

    async create(title?: string): Promise<Conversation> {
      const timestamp = now();
      const conversation: Conversation = {
        id: newId(),
        title: title ?? DEFAULT_TITLE,
        created_at: timestamp,
        updated_at: timestamp,
        messages: [],
      };

      await writeConversation(conversation);
      const ids = await readIndex();
      await writeIndex([...ids, conversation.id]);

      return conversation;
    },

    async delete(id: string): Promise<void> {
      await storage.removeItem(conversationKey(id));
      const ids = await readIndex();
      await writeIndex(ids.filter(existingId => existingId !== id));
    },

    async appendMessage(conversationId: string, message: Message): Promise<Conversation> {
      const conversation = await requireConversation(conversationId);
      conversation.messages.push(message);
      conversation.updated_at = now();
      await writeConversation(conversation);
      return conversation;
    },

    async updateMessage(
      conversationId: string,
      messageId: string,
      patch: Partial<Message>
    ): Promise<Conversation> {
      const conversation = await requireConversation(conversationId);
      const index = conversation.messages.findIndex(m => m.id === messageId);
      if (index === -1) {
        throw new Error(`Message not found: ${messageId} in conversation ${conversationId}`);
      }
      conversation.messages[index] = { ...conversation.messages[index], ...patch };
      conversation.updated_at = now();
      await writeConversation(conversation);
      return conversation;
    },

    async rename(conversationId: string, title: string): Promise<Conversation> {
      const conversation = await requireConversation(conversationId);
      conversation.title = title;
      conversation.updated_at = now();
      await writeConversation(conversation);
      return conversation;
    },
  };
}
