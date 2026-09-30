/**
 * Pure decisions for source-matched links and their logos (FR27). No
 * react-native imports (bun loads this file).
 */

import { matchSource, siteHost } from "./sourceLinks";
import type { LinkSource } from "./sourceLinks";

export type LinkPresentation =
  | { kind: "plain" }
  | { kind: "source"; url: string; host: string };

/** "source" only when the link matches a saved source with a usable host. */
export function presentLink(
  url: string,
  sources: LinkSource[] | undefined,
): LinkPresentation {
  const source = matchSource(url, sources);
  if (!source) return { kind: "plain" };
  const host = siteHost(source.url);
  if (host === null) return { kind: "plain" };
  return { kind: "source", url: source.url, host };
}

export type LogoDisplay = { kind: "image"; uri: string } | { kind: "globe" };

/** Image only for a data:image/ URI; anything else falls back to the globe. */
export function logoDisplay(cached: string | null | undefined): LogoDisplay {
  if (typeof cached === "string" && cached.startsWith("data:image/")) {
    return { kind: "image", uri: cached };
  }
  return { kind: "globe" };
}
