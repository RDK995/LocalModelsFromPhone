/**
 * App-side wiring of the API client to `expo/fetch`.
 *
 * `expo/fetch` provides a `fetch` whose `Response.body` supports streaming
 * reads in the Expo Go runtime (the global `fetch` does not). This module is
 * the only place that imports it, so `./client` (and its tests) stay free of
 * react-native's Flow-typed sources, which bun's test runner cannot parse.
 * For the same reason, this is also the only module that imports
 * `expo-constants`, used to read the configured server URL out of
 * `app.json`'s `expo.extra.serverUrl` (see `./config` for the pure,
 * test-covered resolution logic).
 */

import Constants from "expo-constants";
import { fetch as expoFetch } from "expo/fetch";
import { AppState } from "react-native";
import { APIClient, type ClientLifecycle, type FetchImpl } from "./client";
import { resolveServerUrl } from "./config";

export const SERVER_URL = resolveServerUrl(
  Constants.expoConfig?.extra as { serverUrl?: unknown } | undefined
);

/**
 * `ClientLifecycle` backed by the real React Native `AppState` (FR11, AC
 * M4-AC3): `isForeground()` reflects the current state, and `onForeground`
 * fires only on a transition into `"active"` (not on every `AppState`
 * change, and not on the initial subscription), tracking the previous state
 * per subscription so concurrent chats each see their own transitions.
 */
export const appStateLifecycle: ClientLifecycle = {
  isForeground: () => AppState.currentState === "active",
  onForeground: (listener: () => void) => {
    let previous = AppState.currentState;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && previous !== "active") {
        listener();
      }
      previous = state;
    });
    return () => sub.remove();
  },
};

export function createAPIClient(baseUrl: string = SERVER_URL): APIClient {
  return new APIClient(baseUrl, expoFetch as unknown as FetchImpl, {
    lifecycle: appStateLifecycle,
  });
}
