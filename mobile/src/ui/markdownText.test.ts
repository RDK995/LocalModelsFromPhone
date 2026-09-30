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

describe("MarkdownText renders tables through tableLayout (FR29)", () => {
  it("imports and calls the helper", () => {
    expect(md).toMatch(/import\s*\{\s*tableLayout\s*\}\s*from\s*"\.\/tableLayout"/);
    expect(md).toContain("tableLayout(block.rows)");
  });
  it("renders grid and card layouts with renderInline", () => {
    expect(md).toContain("layout.kind === \"grid\"");
    expect(md).toContain("layout.header.map");
    expect(md).toContain("layout.rows.map");
    expect(md).toContain("layout.cards.map");
    expect(md).toContain("renderInline(cell, ctx)");
    expect(md).toContain("renderInline(line.heading, ctx)");
    expect(md).toContain("renderInline(line.value, ctx)");
  });
});

describe("one table render path for streamed and saved replies (M10c3-C3)", () => {
  it("chat.tsx renders every assistant reply through a single MarkdownText", () => {
    expect(chat.match(/<MarkdownText\b/g)?.length).toBe(1);
    expect(chat).toContain("buildChatItems(messages, pending)");
  });
  it("the table branch never lays out block.rows directly (the pre-FR29 per-row grid)", () => {
    expect(md).not.toContain("block.rows.map");
    expect(md.match(/tableLayout\(/g)?.length).toBe(1);
  });
  it("no other app or ui source renders markdown tables or calls parseMarkdown/tableLayout", () => {
    const srcRoot = join(import.meta.dir, "..");
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
      );
    const users = walk(srcRoot)
      .filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"))
      .filter((f) => /\b(parseMarkdown|tableLayout|MarkdownText)\b|tableRow|tableCard/.test(readFileSync(f, "utf-8")))
      .map((f) => f.slice(srcRoot.length + 1))
      .sort();
    expect(users).toEqual(["app/chat.tsx", "ui/MarkdownText.tsx", "ui/markdown.ts", "ui/tableLayout.ts"]);
  });
});

describe("2-column grid has a definite width on the device (M10c3-C4)", () => {
  // The assistant bubble shrink-wraps (alignSelf flex-start, maxWidth 85%) and
  // each grid cell is flex: 1 (flexBasis 0), so a grid without its own width
  // measures ~0 wide and the bubble collapses to a strip. The grid must take a
  // width from the window, not from its content.
  const gridStart = md.indexOf("layout.kind === \"grid\"");
  const cardsStart = md.indexOf("layout.cards.map");
  const gridBranch = md.slice(gridStart, cardsStart);
  it("MarkdownText reads the window width and derives the grid width from it", () => {
    expect(md).toMatch(/import\s*\{[^}]*\buseWindowDimensions\b[^}]*\}\s*from\s*"react-native"/);
    expect(md).toMatch(/import\s*\{[^}]*\bgridWidth\b[^}]*\}\s*from\s*"\.\/tableLayout"/);
    expect(md).toContain("useWindowDimensions()");
    expect(md).toContain("gridWidth(");
  });
  it("the grid container gets that width, bounded by the bubble, with no horizontal scroll", () => {
    expect(gridStart).toBeGreaterThan(-1);
    expect(gridBranch).toMatch(/style=\{\[styles\.list, styles\.tableGrid, \{ width: [A-Za-z.]+ \}\]\}/);
    expect(md).toMatch(/tableGrid:\s*\{\s*maxWidth:\s*"100%"\s*\}/);
    expect(md).not.toContain("ScrollView");
    expect(md).not.toContain("horizontal");
  });
  it("cells still share the row equally (aligned columns) and wrap", () => {
    expect(gridBranch).toContain("styles.tableCell");
    expect(md).toMatch(/tableCell:\s*\{\s*flex:\s*1,\s*paddingRight:\s*8\s*\}/);
    expect(gridBranch).not.toContain("numberOfLines");
  });
  it("gridWidth's constants match the chat bubble styles they mirror", () => {
    expect(chat).toMatch(/messagesContent:\s*\{\s*padding:\s*16,\s*\}/);
    expect(chat).toMatch(/message:\s*\{\s*marginBottom:\s*8,\s*padding:\s*12,\s*borderRadius:\s*8,\s*maxWidth:\s*"85%",\s*\}/);
    expect(chat).toMatch(/assistantMessage:\s*\{\s*alignSelf:\s*"flex-start",/);
  });
});

describe("numbered citations render as source logos (FR31, M10c4-T5)", () => {
  const cite = md.slice(md.indexOf("case \"cite\""), md.indexOf("case \"link\""));
  it("imports presentCitation", () => {
    expect(md).toMatch(/import\s*\{[^}]*\bpresentCitation\b[^}]*\}\s*from\s*"\.\/inlineLink"/);
  });
  it("renders SourceLogo with the same props as a link and falls back to the raw mark", () => {
    expect(cite).toContain("presentCitation(n, ctx.sources)");
    expect(cite).toContain("<SourceLogo");
    expect(cite).toContain("host={p.host}");
    expect(cite).toContain("url={p.url}");
    expect(cite).toContain("iconCache={ctx.iconCache}");
    expect(cite).toContain("onOpen={ctx.onOpenSource}");
    expect(cite).toContain("return node.raw");
  });
});
