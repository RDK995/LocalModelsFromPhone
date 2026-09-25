/**
 * App-side wiring of the API client to `expo/fetch`.
 *
 * `expo/fetch` provides a `fetch` whose `Response.body` supports streaming
 * reads in the Expo Go runtime (the global `fetch` does not). This module is
 * the only place that imports it, so `./client` (and its tests) stay free of
 * react-native's Flow-typed sources, which bun's test runner cannot parse.
 */

import { fetch as expoFetch } from "expo/fetch";
import { createAPIClient as createClient, type FetchImpl } from "./client";
import type { APIClient } from "./client";

export function createAPIClient(baseUrl: string): APIClient {
  return createClient(baseUrl, expoFetch as unknown as FetchImpl);
}
