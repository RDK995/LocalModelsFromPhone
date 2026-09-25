/**
 * Behavioural tests for token storage: save/read round-trip, deletion, and
 * existence checks, against a fake `SecureStoreLike` in-memory store (no
 * "expo-secure-store" import, so bun can parse this test).
 */

import { describe, it, expect } from "bun:test";
import { createTokenStore } from "./token";
import type { SecureStoreLike } from "./token";

function fakeSecureStore(): SecureStoreLike {
  const backing = new Map<string, string>();
  return {
    async setItemAsync(key, value) {
      backing.set(key, value);
    },
    async getItemAsync(key) {
      return backing.has(key) ? backing.get(key)! : null;
    },
    async deleteItemAsync(key) {
      backing.delete(key);
    },
  };
}

describe("token store", () => {
  it("returns null for getToken before any token is saved", async () => {
    const store = createTokenStore(fakeSecureStore());

    expect(await store.getToken()).toBeNull();
    expect(await store.tokenExists()).toBe(false);
  });

  it("reads back the token that was saved", async () => {
    const store = createTokenStore(fakeSecureStore());

    await store.saveToken("secret-token");

    expect(await store.getToken()).toBe("secret-token");
    expect(await store.tokenExists()).toBe(true);
  });

  it("reads back the newest token after saving a new one over an old one", async () => {
    const store = createTokenStore(fakeSecureStore());

    await store.saveToken("old-token");
    await store.saveToken("new-token");

    expect(await store.getToken()).toBe("new-token");
  });

  it("returns null after the token is cleared", async () => {
    const store = createTokenStore(fakeSecureStore());

    await store.saveToken("secret-token");
    await store.clearToken();

    expect(await store.getToken()).toBeNull();
    expect(await store.tokenExists()).toBe(false);
  });

  it("maps a read error from the underlying store to null, not a throw", async () => {
    const backend = fakeSecureStore();
    const store = createTokenStore({
      ...backend,
      async getItemAsync() {
        throw new Error("keychain unavailable");
      },
    });

    await expect(store.getToken()).resolves.toBeNull();
  });
});
