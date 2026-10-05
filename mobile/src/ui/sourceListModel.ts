/**
 * Pure view-model for the collapsible source list (FR28). No react-native
 * imports (bun loads this file). One entry per saved source, never merged.
 */

import { sourceLabel } from "./chatItems";
import { siteHost } from "./sourceLinks";

export type SourceListInput = { title: string; url: string };

export type SourceListEntry = {
  key: string;
  title: string;
  url: string;
  /** Site host for the FR27 logo; null means the globe. */
  host: string | null;
};

/** The list starts collapsed, and this is never saved. */
export const initialSourcesExpanded = false;

export function toggleSourcesExpanded(expanded: boolean): boolean {
  return !expanded;
}

export function sourceListHeader(sources: SourceListInput[]): string {
  return `Sources (${sources.length})`;
}

/** Exactly one entry per source, in order; titles collapsed to a single line. */
export function sourceListEntries(
  sources: SourceListInput[] | undefined,
): SourceListEntry[] {
  if (!sources) return [];
  return sources.map((source, index) => ({
    key: `${index}:${source.url}`,
    title: sourceLabel(source).replace(/\s+/g, " ").trim(),
    url: source.url,
    host: siteHost(source.url),
  }));
}
