/**
 * App-side wiring of the conversation store's `StoragePort` to
 * `@react-native-async-storage/async-storage`.
 *
 * This is the only place in `src/store/` that imports the native module, so
 * `./storagePort` and `./conversationStore` (and their tests) stay free of
 * react-native's Flow-typed sources, which bun's test runner cannot parse.
 * See `src/api/secureStoreToken.ts` for the same pattern applied to the
 * bearer token store.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { StoragePort } from "./storagePort";

export const asyncStoragePort: StoragePort = {
  getItem(key: string): Promise<string | null> {
    return AsyncStorage.getItem(key);
  },
  setItem(key: string, value: string): Promise<void> {
    return AsyncStorage.setItem(key, value);
  },
  removeItem(key: string): Promise<void> {
    return AsyncStorage.removeItem(key);
  },
};
