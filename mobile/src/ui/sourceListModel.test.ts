/**
 * Collapsible source list (FR28, M10d-T1). Pure view-model checks plus static
 * checks over the component text (bun cannot render React Native).
 */

import { describe, it, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  initialSourcesExpanded,
  sourceListEntries,
  sourceListHeader,
  toggleSourcesExpanded,
} from "./sourceListModel";

const longUrl = `https://www.example.org/a/${"very-long-segment/".repeat(40)}?q=${"x".repeat(300)}`;

// Shaped like the 2026-09-30 phone screenshot: several sources that rendered glued together.
const fixture = [
  { title: "Markets slide on rate fears", url: "https://www.wsj.com/articles/markets-slide" },
  { title: "Fed holds steady", url: "https://wsj.com/economy/fed-holds" },
  { title: "", url: "https://www.reuters.com/markets/us/today/" },
  { title: "Line one\nline two   spaced\n\nend", url: "https://apnews.com/article/abc" },
  { title: "A ".repeat(200).trim(), url: longUrl },
  { title: "Duplicate page", url: "https://apnews.com/article/abc" },
];

describe("sourceListHeader / toggle", () => {
  it("shows the count", () => {
    expect(sourceListHeader(fixture.slice(0, 5))).toBe("Sources (5)");
    expect(sourceListHeader(fixture)).toBe("Sources (6)");
  });
  it("starts collapsed, expands then collapses", () => {
    expect(initialSourcesExpanded).toBe(false);
    const open = toggleSourcesExpanded(initialSourcesExpanded);
    expect(open).toBe(true);
    expect(toggleSourcesExpanded(open)).toBe(false);
  });
});

describe("sourceListEntries", () => {
  const entries = sourceListEntries(fixture);
  it("has exactly one entry per source, in order, with its own url", () => {
    expect(entries.length).toBe(fixture.length);
    entries.forEach((e, i) => expect(e.url).toBe(fixture[i].url));
  });
  it("keys are distinct, even for identical urls", () => {
    expect(new Set(entries.map((e) => e.key)).size).toBe(fixture.length);
    expect(entries[3].url).toBe(entries[5].url);
    expect(entries[3].key).not.toBe(entries[5].key);
  });
  it("same site gives same host for the shared-site pair", () => {
    expect(entries[0].host).toBe("wsj.com");
    expect(entries[1].host).toBe("wsj.com");
  });
  it("empty title falls back to the host label", () => {
    expect(entries[2].title).toBe("reuters.com");
  });
  it("titles are one line", () => {
    expect(entries[3].title).toBe("Line one line two spaced end");
    for (const e of entries) expect(e.title).not.toMatch(/\s{2}|[\r\n\t]/);
  });
  it("unusable host is null (globe)", () => {
    const [e] = sourceListEntries([{ title: "x", url: "not a url" }]);
    expect(e.host).toBeNull();
    expect(e.title).toBe("x");
  });
  it("empty or absent list gives nothing", () => {
    expect(sourceListEntries([])).toEqual([]);
    expect(sourceListEntries(undefined)).toEqual([]);
  });
});

const chat = readFileSync(join(import.meta.dir, "..", "app", "chat.tsx"), "utf-8");
const compPath = join(import.meta.dir, "SourceList.tsx");
const comp = existsSync(compPath) ? readFileSync(compPath, "utf-8") : "";

describe("SourceList.tsx", () => {
  it("exists and exports SourceList", () => {
    expect(comp).toContain("export function SourceList");
  });
  it("uses the view-model header and local non-persisted state", () => {
    expect(comp).toContain("sourceListHeader(");
    expect(comp).toContain("useState(initialSourcesExpanded)");
    expect(comp).toContain("toggleSourcesExpanded");
    expect(comp).not.toMatch(/AsyncStorage|asyncStorage|conversationStore|SecureStore/);
  });
  it("header is a button with expanded state", () => {
    expect(comp).toContain("accessibilityRole=\"button\"");
    expect(comp).toContain("accessibilityState={{ expanded");
  });
  it("each entry is its own touchable row opening its own url", () => {
    expect(comp).toContain("sourceListEntries(");
    expect(comp).toContain(".map((entry)");
    expect(comp).toContain("key={entry.key}");
    expect(comp).toContain("accessibilityRole=\"link\"");
    expect(comp).toContain("onOpenSource(entry.url)");
    expect(comp).toContain("<SourceLogo");
    expect(comp).toContain("flexDirection: \"row\"");
  });
  it("entries are not nested inline inside a shared Text", () => {
    expect(comp).toMatch(/\.map\(\(entry\) => \(\s*<TouchableOpacity\s+key=\{entry\.key\}/);
    expect(comp).not.toMatch(/<Text[^>]*>\s*\{[^}]*map\(/);
  });
});

describe("chat.tsx renders SourceList", () => {
  it("imports and renders it", () => {
    expect(chat).toMatch(/import\s*\{\s*SourceList\s*\}\s*from\s*"@\/ui\/SourceList"/);
    expect(chat).toContain(
      "<SourceList\n                        sources={item.sources}\n                        iconCache={iconCacheRef.current}\n                        onOpenSource={handleOpenSource}\n                      />"
    );
  });
  it("no longer maps sources itself", () => {
    expect(chat).not.toContain("item.sources.map");
    expect(chat).not.toContain("sourceLabel");
  });
});
