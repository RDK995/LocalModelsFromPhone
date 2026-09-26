/**
 * Minimal async key-value storage contract the conversation store depends
 * on. Kept free of any native-module import (see ./asyncStorage) so bun's
 * test runner can load this file and every module that only imports it.
 */

export interface StoragePort {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * In-memory `StoragePort` for tests: a fresh `createConversationStore` over
 * the same instance sees whatever a previous store wrote to it, without
 * touching any real storage backend.
 */
export function createMemoryStorage(): StoragePort {
  const store = new Map<string, string>();

  return {
    async getItem(key: string): Promise<string | null> {
      return store.has(key) ? store.get(key)! : null;
    },
    async setItem(key: string, value: string): Promise<void> {
      store.set(key, value);
    },
    async removeItem(key: string): Promise<void> {
      store.delete(key);
    },
  };
}
