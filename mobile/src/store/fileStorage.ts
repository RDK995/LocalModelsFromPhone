/**
 * File-backed `StoragePort` for testing persistence without touching the app's
 * AsyncStorage. Stores data as JSON in a single file, with one key per line.
 * Used by the M3-T3 conversation-proof to verify that a fresh store built over
 * the same storage sees identical conversations.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import type { StoragePort } from "./storagePort";

export function createFileStorage(filePath: string): StoragePort {
  function readStore(): Map<string, string> {
    if (!existsSync(filePath)) {
      return new Map();
    }
    const store = new Map<string, string>();
    const lines = readFileSync(filePath, "utf-8").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const { key, value } = JSON.parse(line);
        store.set(key, value);
      } catch {
        // Skip malformed lines
      }
    }
    return store;
  }

  function writeStore(store: Map<string, string>): void {
    const lines: string[] = [];
    for (const [key, value] of store) {
      lines.push(JSON.stringify({ key, value }));
    }
    writeFileSync(filePath, lines.join("\n"), "utf-8");
  }

  return {
    async getItem(key: string): Promise<string | null> {
      const store = readStore();
      return store.get(key) ?? null;
    },
    async setItem(key: string, value: string): Promise<void> {
      const store = readStore();
      store.set(key, value);
      writeStore(store);
    },
    async removeItem(key: string): Promise<void> {
      const store = readStore();
      store.delete(key);
      writeStore(store);
    },
  };
}
