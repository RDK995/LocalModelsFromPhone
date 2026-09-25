/**
 * Token management using Expo SecureStore.
 *
 * This module deliberately does not import "expo-secure-store" itself: like
 * "expo/fetch" (see ./client.ts), it pulls in react-native's Flow-typed
 * sources, which bun's test runner cannot parse. The default store is wired
 * in from `./secureStoreToken`, which the app uses; tests inject a fake
 * `SecureStoreLike` directly.
 */

const TOKEN_KEY = "api_bearer_token";

/**
 * Minimal shape of `expo-secure-store` that this module depends on, so a
 * fake implementation can be injected in tests.
 */
export interface SecureStoreLike {
  setItemAsync(key: string, value: string): Promise<void>;
  getItemAsync(key: string): Promise<string | null>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface TokenStore {
  saveToken(token: string): Promise<void>;
  getToken(): Promise<string | null>;
  clearToken(): Promise<void>;
  tokenExists(): Promise<boolean>;
}

export function createTokenStore(store: SecureStoreLike): TokenStore {
  async function saveToken(token: string): Promise<void> {
    await store.setItemAsync(TOKEN_KEY, token);
  }

  async function getToken(): Promise<string | null> {
    try {
      return await store.getItemAsync(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  async function clearToken(): Promise<void> {
    await store.deleteItemAsync(TOKEN_KEY);
  }

  async function tokenExists(): Promise<boolean> {
    const token = await getToken();
    return token !== null;
  }

  return { saveToken, getToken, clearToken, tokenExists };
}
