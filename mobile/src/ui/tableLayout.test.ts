import { describe, it, expect } from "bun:test";
import type { Inline } from "./markdown";
import { tableLayout } from "./tableLayout";

const t = (text: string): Inline[] => [{ type: "text", text }];
const bold = (text: string): Inline[] => [{ type: "bold", children: t(text) }];
const link: Inline[] = [{ type: "link", url: "https://a.com", children: t("A") }];
const code: Inline[] = [{ type: "code", text: "x" }];

describe("tableLayout", () => {
  it("two columns -> grid with header and body rows of exactly 2 cells", () => {
    const l = tableLayout([[t("K"), t("V")], [t("a"), bold("b")], [link, code]]);
    expect(l.kind).toBe("grid");
    if (l.kind !== "grid") return;
    expect(l.header).toEqual([t("K"), t("V")]);
    expect(l.rows).toEqual([[t("a"), bold("b")], [link, code]]);
    for (const r of l.rows) expect(r.length).toBe(2);
  });

  it("three or more columns -> one card per body row, pairs in column order", () => {
    const l = tableLayout([
      [t("Name"), t("Link"), t("Code")],
      [bold("n1"), link, code],
      [t("n2"), t("l2"), t("c2")],
    ]);
    expect(l.kind).toBe("cards");
    if (l.kind !== "cards") return;
    expect(l.cards.length).toBe(2);
    expect(l.cards[0]).toEqual([
      { heading: t("Name"), value: bold("n1") },
      { heading: t("Link"), value: link },
      { heading: t("Code"), value: code },
    ]);
    expect(l.cards[1]?.map((p) => p.heading)).toEqual([t("Name"), t("Link"), t("Code")]);
  });

  it("header-only tables do not throw", () => {
    const g = tableLayout([[t("A"), t("B")]]);
    expect(g).toEqual({ kind: "grid", header: [t("A"), t("B")], rows: [] });
    const c = tableLayout([[t("A"), t("B"), t("C")]]);
    expect(c).toEqual({ kind: "cards", cards: [] });
    expect(() => tableLayout([])).not.toThrow();
  });

  it("short rows get empty cells", () => {
    const g = tableLayout([[t("A"), t("B")], [t("x")]]);
    if (g.kind !== "grid") throw new Error("grid expected");
    expect(g.rows).toEqual([[t("x"), []]]);
    const c = tableLayout([[t("A"), t("B"), t("C")], [t("x")]]);
    if (c.kind !== "cards") throw new Error("cards expected");
    expect(c.cards[0]?.map((p) => p.value)).toEqual([t("x"), [], []]);
  });

  it("long rows keep surplus cells appended to the last column", () => {
    const g = tableLayout([[t("A"), t("B")], [t("x"), t("y"), t("z")]]);
    if (g.kind !== "grid") throw new Error("grid expected");
    expect(g.rows[0]?.length).toBe(2);
    expect(g.rows[0]?.[1]).toEqual([...t("y"), ...t(" | "), ...t("z")]);
    const c = tableLayout([[t("A"), t("B"), t("C")], [t("1"), t("2"), t("3"), link]]);
    if (c.kind !== "cards") throw new Error("cards expected");
    expect(c.cards[0]?.length).toBe(3);
    expect(c.cards[0]?.[2]?.value).toEqual([...t("3"), ...t(" | "), ...link]);
  });
});
