/**
 * Static checks for MarkdownText (FR26, M10b-T2). bun cannot render React
 * Native, so the wiring is asserted on the source text.
 */

import { describe, it, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
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
      "<MarkdownText text={item.content} style={styles.messageText} />"
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
