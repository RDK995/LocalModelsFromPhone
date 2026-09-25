/**
 * Behavioural tests for the configured server base URL (F1): `app.json` sets
 * the tailnet URL, `resolveServerUrl` returns it, and an `APIClient` built
 * from that URL actually sends its requests there.
 */

import { describe, it, expect, mock } from "bun:test";
import appConfig from "../../app.json";
import { DEFAULT_SERVER_URL, resolveServerUrl } from "./config";
import { APIClient } from "./client";

const TAILNET_URL = "https://ryans-mac-studio.tailc3648a.ts.net:8443";

describe("resolveServerUrl", () => {
  it("matches the URL configured in app.json's expo.extra.serverUrl", () => {
    expect(appConfig.expo.extra.serverUrl).toBe(TAILNET_URL);
    expect(DEFAULT_SERVER_URL).toBe(TAILNET_URL);
  });

  it("uses the configured serverUrl when present", () => {
    expect(resolveServerUrl({ serverUrl: "https://example.ts.net:8443" })).toBe(
      "https://example.ts.net:8443"
    );
  });

  it("falls back to the default when extra is missing or has no serverUrl", () => {
    expect(resolveServerUrl(undefined)).toBe(DEFAULT_SERVER_URL);
    expect(resolveServerUrl(null)).toBe(DEFAULT_SERVER_URL);
    expect(resolveServerUrl({})).toBe(DEFAULT_SERVER_URL);
  });
});

describe("APIClient uses the configured base URL", () => {
  it("sends requests to the URL resolved from app.json, not localhost", async () => {
    const baseUrl = resolveServerUrl(appConfig.expo.extra);
    const seenUrls: string[] = [];

    const fetchMock = mock(async (url: string) => {
      seenUrls.push(url);
      return new Response(
        JSON.stringify({
          models: [],
          resident: null,
          operation: { kind: "idle" },
          generation: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const client = new APIClient(baseUrl, fetchMock as unknown as typeof fetch);
    client.setToken("t");
    await client.getState();

    expect(seenUrls).toEqual([`${TAILNET_URL}/v1/state`]);
  });
});
