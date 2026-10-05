/**
 * Server base URL configuration.
 *
 * The value is set once, in `app.json`'s `expo.extra.serverUrl`, and read at
 * runtime via `expo-constants` (see `expoFetchClient.ts`, the only module
 * that imports `expo-constants`: that import pulls in react-native's
 * Flow-typed sources, which bun's test runner cannot parse, the same reason
 * `expoFetchClient` isolates `expo/fetch`).
 *
 * `DEFAULT_SERVER_URL` is the compiled-in fallback `resolveServerUrl` returns
 * when `expo.extra.serverUrl` is missing, and is also the value this
 * module's test asserts `app.json` is configured with, so the two cannot
 * silently drift apart.
 */

export const DEFAULT_SERVER_URL = "https://ryans-mac-studio.tailc3648a.ts.net:8443";

export function resolveServerUrl(
  extra: { serverUrl?: unknown } | null | undefined
): string {
  const configured = extra?.serverUrl;
  return typeof configured === "string" && configured.length > 0
    ? configured
    : DEFAULT_SERVER_URL;
}
