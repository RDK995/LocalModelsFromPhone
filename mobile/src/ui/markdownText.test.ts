/**
 * Static checks for MarkdownText (FR26, M10b-T2). bun cannot render React
 * Native, so the wiring is asserted on the source text.
 */

import { describe, it, expect } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const chat = readFileSync(join(import.meta.dir, "..", "app", "chat.tsx"), "utf-8");
const mdPath = join(import.meta.dir, "MarkdownText.tsx");
const md = existsSync(mdPath) ? readFileSync(mdPath, "utf-8") : "";

describe("chat.tsx uses MarkdownText for assistant replies", () => {
  it("imports MarkdownText", () => {
    expect(chat).toMatch(/import\s*\{\s*MarkdownText\s*\}\s*from\s*"@\/ui\/MarkdownText"/);
  });
  it("renders assistant content through it", () => {
    expect(chat).toContain(
      "<MarkdownText\n                          text={item.content}\n                          style={styles.messageText}\n                          sources={item.sources}\n                          iconCache={iconCacheRef.current}\n                          onOpenSource={handleOpenSource}\n                        />"
    );
    expect(chat).toContain("item.role === \"assistant\"");
  });
  it("keeps user content plain", () => {
    expect(chat).toContain("<Text style={styles.messageText}>{item.content}</Text>");
  });
  it("keeps thinking text plain", () => {
    expect(chat).toContain("<Text style={styles.thinkingText}>{item.thinking}</Text>");
  });
});

describe("MarkdownText.tsx", () => {
  it("exists and parses with parseMarkdown", () => {
    expect(md).toMatch(/import\s*\{[^}]*\bparseMarkdown\b[^}]*\}\s*from\s*"\.\/markdown"/);
    expect(md).toContain("export function MarkdownText");
    expect(md).toContain("useMemo");
  });
  for (const name of [
    "paragraph", "heading", "list", "codeBlock", "quote", "table", "rule",
    "text", "bold", "italic", "code", "link",
  ]) {
    it(`handles "${name}"`, () => {
      expect(md).toContain(`"${name}"`);
    });
  }
  it("links are not tappable", () => {
    expect(md).not.toContain("onPress");
    expect(md).not.toContain("Linking");
    expect(md).not.toContain("accessibilityRole");
  });
});

const logoPath = join(import.meta.dir, "SourceLogo.tsx");
const logo = existsSync(logoPath) ? readFileSync(logoPath, "utf-8") : "";

describe("source logos (FR27, M10c2-T3)", () => {
  it("chat.tsx passes sources, iconCache and onOpenSource", () => {
    expect(chat).toContain("sources={item.sources}");
    expect(chat).toContain("iconCache={iconCacheRef.current}");
    expect(chat).toContain("onOpenSource={handleOpenSource}");
    expect(chat).toContain("createIconCache(asyncStoragePort");
  });
  it("MarkdownText uses presentLink and SourceLogo", () => {
    expect(md).toMatch(/import\s*\{[^}]*\bpresentLink\b[^}]*\}\s*from\s*"\.\/inlineLink"/);
    expect(md).toMatch(/import\s*\{\s*SourceLogo\s*\}\s*from\s*"\.\/SourceLogo"/);
  });
  it("SourceLogo uses logoDisplay and the icon cache, and never fetches", () => {
    expect(logo).toContain("logoDisplay");
    expect(logo).toContain("iconCache.get(");
    expect(logo).toContain("iconCache.peek(");
    expect(logo).not.toContain("fetch(");
    expect(logo).not.toContain("http");
  });
  it("no ui or app file calls fetch( (baseline had none)", () => {
    const dirs = [join(import.meta.dir), join(import.meta.dir, "..", "app")];
    for (const dir of dirs) {
      for (const f of readdirSync(dir)) {
        if (!/\.tsx?$/.test(f) || f.endsWith(".test.ts")) continue;
        expect(readFileSync(join(dir, f), "utf-8")).not.toContain("fetch(");
      }
    }
  });
});
