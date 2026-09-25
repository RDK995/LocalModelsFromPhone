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
import { createAPIClient as createClient, type FetchImpl } from "./client";
import type { APIClient } from "./client";
import { resolveServerUrl } from "./config";

export const SERVER_URL = resolveServerUrl(
  Constants.expoConfig?.extra as { serverUrl?: unknown } | undefined
);

export function createAPIClient(baseUrl: string = SERVER_URL): APIClient {
  return createClient(baseUrl, expoFetch as unknown as FetchImpl);
}
