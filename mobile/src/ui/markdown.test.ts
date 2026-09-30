import { describe, expect, test } from "bun:test";
import { parseInline, parseMarkdown, visibleText } from "@/ui/markdown";
import type { Block, Inline } from "@/ui/markdown";

const t = (text: string): Inline => ({ type: "text", text });
const bold = (...children: Inline[]): Inline => ({ type: "bold", children });
const italic = (...children: Inline[]): Inline => ({ type: "italic", children });
const code = (text: string): Inline => ({ type: "code", text });
const link = (url: string, ...children: Inline[]): Inline => ({ type: "link", url, children });
const para = (...children: Inline[]): Block => ({ type: "paragraph", children });

describe("blocks", () => {
  test("headings levels 1-6, trailing hashes stripped", () => {
    expect(parseMarkdown("# One")).toEqual([{ type: "heading", level: 1, children: [t("One")] }]);
    expect(parseMarkdown("###### Six")).toEqual([{ type: "heading", level: 6, children: [t("Six")] }]);
    expect(parseMarkdown("## Two ##")).toEqual([{ type: "heading", level: 2, children: [t("Two")] }]);
  });

  test("paragraphs join consecutive lines and split on blank lines", () => {
    expect(parseMarkdown("a\nb\n\nc")).toEqual([para(t("a\nb")), para(t("c"))]);
  });

  test("unordered list with -, * and +", () => {
    for (const m of ["-", "*", "+"]) {
      expect(parseMarkdown(`${m} a\n${m} b`)).toEqual([
        {
          type: "list",
          ordered: false,
          start: 1,
          items: [
            { depth: 0, children: [t("a")] },
            { depth: 0, children: [t("b")] },
          ],
        },
      ]);
    }
  });

  test("ordered list with . and ) and a start number", () => {
    expect(parseMarkdown("3. a\n4. b")).toEqual([
      {
        type: "list",
        ordered: true,
        start: 3,
        items: [
          { depth: 0, children: [t("a")] },
          { depth: 0, children: [t("b")] },
        ],
      },
    ]);
    const b = parseMarkdown("1) a");
    expect(b[0]).toMatchObject({ type: "list", ordered: true, start: 1 });
  });

  test("list depth from indentation and separate lists per ordered-ness", () => {
    const b = parseMarkdown("- a\n  - b\n\t- c\n1. d");
    expect(b).toEqual([
      {
        type: "list",
        ordered: false,
        start: 1,
        items: [
          { depth: 0, children: [t("a")] },
          { depth: 1, children: [t("b")] },
          { depth: 1, children: [t("c")] },
        ],
      },
      { type: "list", ordered: true, start: 1, items: [{ depth: 0, children: [t("d")] }] },
    ]);
  });

  test("fenced code block with language, verbatim content, ~~~ fence", () => {
    expect(parseMarkdown("```ts\nconst **a** = 1;\n\nx\n```")).toEqual([
      { type: "codeBlock", language: "ts", text: "const **a** = 1;\n\nx" },
    ]);
    expect(parseMarkdown("~~~\nq\n~~~")).toEqual([{ type: "codeBlock", language: null, text: "q" }]);
  });

  test("unclosed fence swallows the rest", () => {
    expect(parseMarkdown("```ts\nconst a = 1")).toEqual([
      { type: "codeBlock", language: "ts", text: "const a = 1" },
    ]);
    expect(parseMarkdown("```\na\n\n# b")).toEqual([
      { type: "codeBlock", language: null, text: "a\n\n# b" },
    ]);
  });

  test("quote strips the marker", () => {
    expect(parseMarkdown("> hi\n> there")).toEqual([{ type: "quote", children: [t("hi\nthere")] }]);
  });

  test("rules", () => {
    for (const r of ["---", "***", "___"]) expect(parseMarkdown(r)).toEqual([{ type: "rule" }]);
    expect(parseMarkdown("para\n---")).toEqual([para(t("para")), { type: "rule" }]);
  });

  test("pipe table drops the separator and trims cells", () => {
    expect(parseMarkdown("| A | B |\n|---|---|\n| **x** | y |")).toEqual([
      { type: "table", rows: [[[t("A")], [t("B")]], [[bold(t("x"))], [t("y")]]] },
    ]);
    expect(parseMarkdown("A | B\n--|--\n1 | 2")).toEqual([
      { type: "table", rows: [[[t("A")], [t("B")]], [[t("1")], [t("2")]]] },
    ]);
  });

  test("table header without a separator yet is a paragraph", () => {
    expect(parseMarkdown("| A | B |")[0]?.type).toBe("paragraph");
  });
});

describe("inline", () => {
  test("bold and italic", () => {
    expect(parseInline("**x**")).toEqual([bold(t("x"))]);
    expect(parseInline("__x__")).toEqual([bold(t("x"))]);
    expect(parseInline("*x*")).toEqual([italic(t("x"))]);
    expect(parseInline("_x_")).toEqual([italic(t("x"))]);
    expect(parseInline("a **b** c")).toEqual([t("a "), bold(t("b")), t(" c")]);
  });

  test("triple emphasis nests bold and italic", () => {
    expect(parseInline("***x***")).toEqual([bold(italic(t("x")))]);
  });

  test("italic inside bold and bold inside italic", () => {
    expect(parseInline("**a *b* c**")).toEqual([bold(t("a "), italic(t("b")), t(" c"))]);
    expect(parseInline("*a **b** c*")).toEqual([italic(t("a "), bold(t("b")), t(" c"))]);
  });

  test("inline code, verbatim and double-backtick", () => {
    expect(parseInline("`a **b**`")).toEqual([code("a **b**")]);
    expect(parseInline("`` a`b ``")).toEqual([code("a`b")]);
  });

  test("links and autolinks", () => {
    expect(parseInline("[the **docs**](https://e.com/x)")).toEqual([
      link("https://e.com/x", t("the "), bold(t("docs"))),
    ]);
    expect(parseInline("<https://e.com>")).toEqual([link("https://e.com", t("https://e.com"))]);
  });

  test("backslash escapes", () => {
    expect(parseInline("\\*a\\* \\_ \\` \\# \\[ \\] \\\\")).toEqual([t("*a* _ ` # [ ] \\")]);
  });
});

describe("false-positive guards", () => {
  test("stay literal", () => {
    expect(parseInline("5 * 3 = 15")).toEqual([t("5 * 3 = 15")]);
    expect(parseInline("snake_case_name")).toEqual([t("snake_case_name")]);
    expect(parseInline("[1] note")).toEqual([t("[1] note")]);
    expect(parseMarkdown("#hashtag")).toEqual([para(t("#hashtag"))]);
    expect(parseInline("C:\\path")).toEqual([t("C:\\path")]);
  });

  test("an unmatched marker that is not at the end stays literal", () => {
    expect(parseMarkdown("a ** b\n\nnext")).toEqual([para(t("a ** b")), para(t("next"))]);
  });
});

describe("streaming", () => {
  test("open bold", () => {
    expect(parseMarkdown("Hello **wor")).toEqual([para(t("Hello "), bold(t("wor")))]);
  });
  test("open link", () => {
    expect(parseMarkdown("See [the docs](https://exa")).toEqual([
      para(t("See "), link("https://exa", t("the docs"))),
    ]);
    expect(parseInline("[text](")).toEqual([link("", t("text"))]);
    expect(parseInline("[text")).toEqual([t("text")]);
  });
  test("open code", () => {
    expect(parseMarkdown("Use `npm i")).toEqual([para(t("Use "), code("npm i"))]);
  });
  test("open fence", () => {
    expect(parseMarkdown("```ts\nconst a = 1")).toEqual([
      { type: "codeBlock", language: "ts", text: "const a = 1" },
    ]);
  });
  test("marker with nothing after it renders nothing", () => {
    expect(parseInline("a **")).toEqual([t("a ")]);
    expect(parseInline("a *")).toEqual([t("a ")]);
  });
  test("never throws on degenerate input", () => {
    for (const s of ["", "\n", "**", "*", "_", "`", "[", "](", "|", "---", "> ", "- ", "1.", "#", "```", "<", "\\"]) {
      expect(() => visibleText(parseMarkdown(s))).not.toThrow();
    }
    expect(() => parseMarkdown("*a ".repeat(3000))).not.toThrow();
  });
});

describe("visibleText", () => {
  test("shapes", () => {
    const src = "# H\n\np **b**\n\n- x\n  - y\n\n3. a\n4. b\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> q\n\n---\n\n[l](http://u)";
    expect(visibleText(parseMarkdown(src))).toBe(
      ["H", "p b", "• x\n  • y", "3. a\n4. b", "A  B\n1  2", "q", "", "l"].join("\n"),
    );
  });
});

const FIXTURE1 = [
  "# Heading",
  "",
  "Some **bold** and *italic* words with `code` and a [Example](https://example.com) link.",
  "",
  "- first item",
  "- second item",
  "",
  "1. one",
  "2. two",
  "",
  "```ts",
  "const total = 1 + 2;",
  "```",
  "",
  "Done.",
].join("\n");

const FIXTURE2 = [
  "## Summary",
  "",
  "| Name | Value |",
  "|------|-------|",
  "| **alpha** | one |",
  "| beta | [two](https://example.com/two) |",
  "",
  "> a *quoted* line",
  "",
  "Tail __text__ here.",
].join("\n");

describe("AC20 fixture", () => {
  test("no raw markdown visible", () => {
    const v = visibleText(parseMarkdown(FIXTURE1));
    for (const w of ["Heading", "bold", "italic", "first item", "1. one", "2. two", "code", "Example", "const total"]) {
      expect(v).toContain(w);
    }
    expect(v).not.toContain("**");
    expect(v).not.toContain("__");
    expect(v).not.toContain("](");
    expect(v).not.toContain("`");
    expect(v).not.toContain("[");
    expect(v).not.toContain("https://example.com");
    expect(v.split("\n").some((l) => l.startsWith("#"))).toBe(false);
  });
});

describe("prefix sweep", () => {
  for (const [name, fixture] of [["fixture 1", FIXTURE1], ["fixture 2", FIXTURE2]] as const) {
    test(name, () => {
      for (let n = 0; n <= fixture.length; n++) {
        const prefix = fixture.slice(0, n);
        let v = "";
        expect(() => {
          v = visibleText(parseMarkdown(prefix));
        }).not.toThrow();
        expect(v).not.toContain("**");
        expect(v).not.toContain("](");
        expect(v.split("\n").some((l) => l.startsWith("# ") || l.startsWith("## "))).toBe(false);
      }
    });
  }
});
