import { describe, it, expect } from "bun:test";
import { normaliseForQuote, quoteOnPage } from "./quoteMatch";

describe("quoteMatch", () => {
  describe("normaliseForQuote", () => {
    it("applies Unicode NFKC normalization", () => {
      // U+FB01 ligature should become "fi"
      expect(normaliseForQuote("ﬁnancial")).toBe("financial");
      // non-breaking space should become regular space
      expect(normaliseForQuote("28 June 1919")).toContain("28");
    });

    it("converts ellipsis … to ...", () => {
      expect(normaliseForQuote("hello … world")).toContain("...");
    });

    it("converts markdown image to alt text", () => {
      const result = normaliseForQuote("![Map of Europe in 1923](map.png) shows the borders");
      expect(result).toContain("map of europe in 1923");
      expect(result).not.toContain("map.png");
    });

    it("converts markdown link to link text", () => {
      const result = normaliseForQuote("the [Treaty of Versailles](https://en.wikipedia.org/wiki/Treaty_of_Versailles) was signed");
      expect(result).toContain("treaty of versailles");
      expect(result).not.toContain("https://");
    });

    it("removes emphasis markers like **bold**", () => {
      expect(normaliseForQuote("the **Great Depression** hit")).toBe("the great depression hit");
    });

    it("removes emphasis markers like _italic_", () => {
      expect(normaliseForQuote("hit _Germany_ hard")).toBe("hit germany hard");
    });

    it("removes strikethrough ~~text~~", () => {
      expect(normaliseForQuote("this ~~word~~ text")).toBe("this word text");
    });

    it("keeps underscores in snake_case", () => {
      expect(normaliseForQuote("uses max_tokens here")).toBe("uses max_tokens here");
    });

    it("normalizes curly quotes to straight quotes", () => {
      // ' ' ‚ ‛ ′ ` ´ become '
      expect(normaliseForQuote("the treaty's")).toBe("the treaty's");
      expect(normaliseForQuote("the treaty's")).toBe("the treaty's"); // curly
    });

    it("normalizes curly double quotes to straight double quotes", () => {
      // " " „ ‟ ″ « » become "
      expect(normaliseForQuote('"hello"')).toContain('"hello"');
      expect(normaliseForQuote('"hello"')).toContain('"hello"'); // curly
    });

    it("normalizes curly apostrophes (U+2018 and U+2019) to straight apostrophes", () => {
      expect(normaliseForQuote("it’s")).toBe(normaliseForQuote("it's"));
    });

    it("normalizes curly single quotes to straight single quotes", () => {
      expect(normaliseForQuote("‘a’")).toBe(normaliseForQuote("'a'"));
    });

    it("normalizes curly double quotes (U+201C and U+201D) to straight double quotes", () => {
      expect(normaliseForQuote("“b”")).toBe(normaliseForQuote("\"b\""));
    });

    it("normalizes various dash variants to -", () => {
      // U+2010, U+2011, U+2012, U+2013, U+2014, U+2015, U+2212, U+FE58, U+FE63, U+FF0D
      expect(normaliseForQuote("1919–1939")).toBe("1919-1939"); // U+2013 en dash
      expect(normaliseForQuote("a — b")).toBe("a - b"); // U+2014 em dash
    });

    it("lowercases text", () => {
      expect(normaliseForQuote("The Treaty of Versailles")).toBe("the treaty of versailles");
    });

    it("collapses whitespace and trims", () => {
      expect(normaliseForQuote("signed\n\n  at   Versailles")).toBe("signed at versailles");
    });

    it("handles combined markdown", () => {
      // [![alt](img)](href) should become just alt
      const result = normaliseForQuote("[![alt](img)](href)");
      expect(result).toBe("alt");
    });
  });

  describe("quoteOnPage", () => {
    it("matches with curly vs straight quotes", () => {
      const page = `the treaty's "war guilt" clause`;
      const normalisedPage = normaliseForQuote(page);
      const quote = `the treaty's "war guilt" clause`;
      expect(quoteOnPage(quote, normalisedPage)).toBe(true);
    });

    it("matches with dash variants", () => {
      const page = `1919–1939`;
      const normalisedPage = normaliseForQuote(page);
      const quote = `1919-1939`;
      expect(quoteOnPage(quote, normalisedPage)).toBe(true);
    });

    it("matches with various dash types", () => {
      const page = `a — b`;
      const normalisedPage = normaliseForQuote(page);
      const quote = `a - b`;
      expect(quoteOnPage(quote, normalisedPage)).toBe(true);
    });

    it("matches with different whitespace", () => {
      const page = `signed\n\n  at   Versailles`;
      const normalisedPage = normaliseForQuote(page);
      const quote = `signed at Versailles`;
      expect(quoteOnPage(quote, normalisedPage)).toBe(true);
    });

    it("matches with different case", () => {
      const page = `The Treaty of Versailles`;
      const normalisedPage = normaliseForQuote(page);
      const quote = `the treaty of versailles`;
      expect(quoteOnPage(quote, normalisedPage)).toBe(true);
    });

    it("matches with Unicode compatibility forms", () => {
      const page = `ﬁnancial reparations`; // U+FB01 ligature
      const normalisedPage = normaliseForQuote(page);
      const quote = `financial reparations`;
      expect(quoteOnPage(quote, normalisedPage)).toBe(true);
    });

    it("matches with non-breaking spaces", () => {
      const page = `28 June 1919`; // with non-breaking space
      const normalisedPage = normaliseForQuote(page);
      const quote = `28 June 1919`; // with regular space
      expect(quoteOnPage(quote, normalisedPage)).toBe(true);
    });

    it("matches with markdown link", () => {
      const page = `the [Treaty of Versailles](https://en.wikipedia.org/wiki/Treaty_of_Versailles) was signed`;
      const normalisedPage = normaliseForQuote(page);
      const quote = `the Treaty of Versailles was signed`;
      expect(quoteOnPage(quote, normalisedPage)).toBe(true);
    });

    it("matches with markdown image", () => {
      const page = `![Map of Europe in 1923](map.png) shows the borders`;
      const normalisedPage = normaliseForQuote(page);
      const quote = `Map of Europe in 1923 shows the borders`;
      expect(quoteOnPage(quote, normalisedPage)).toBe(true);
    });

    it("matches with emphasis markers", () => {
      const page = `the **Great Depression** hit _Germany_ hard`;
      const normalisedPage = normaliseForQuote(page);
      const quote = `the Great Depression hit Germany hard`;
      expect(quoteOnPage(quote, normalisedPage)).toBe(true);
    });

    it("keeps underscores in snake_case", () => {
      const page = `uses max_tokens here`;
      const normalisedPage = normaliseForQuote(page);
      const quote = `uses max_tokens here`;
      expect(quoteOnPage(quote, normalisedPage)).toBe(true);
    });

    it("matches ellipsis (…) in order", () => {
      const page = `Germany lost territory. Many other paragraphs. It also lost its colonies.`;
      const normalisedPage = normaliseForQuote(page);
      const quote = `Germany lost territory … It also lost its colonies`;
      expect(quoteOnPage(quote, normalisedPage)).toBe(true);
    });

    it("matches ellipsis (...) in order", () => {
      const page = `Germany lost territory. Many other paragraphs. It also lost its colonies.`;
      const normalisedPage = normaliseForQuote(page);
      const quote = `Germany lost territory ... It also lost its colonies`;
      expect(quoteOnPage(quote, normalisedPage)).toBe(true);
    });

    it("rejects ellipsis pieces out of order", () => {
      const page = `Germany lost territory. Many other paragraphs. It also lost its colonies.`;
      const normalisedPage = normaliseForQuote(page);
      const quote = `It also lost its colonies … Germany lost territory`;
      expect(quoteOnPage(quote, normalisedPage)).toBe(false);
    });

    it("rejects words not on page", () => {
      const page = `The treaty was signed in 1919.`;
      const normalisedPage = normaliseForQuote(page);
      const quote = `The treaty was signed in 1920.`;
      expect(quoteOnPage(quote, normalisedPage)).toBe(false);
    });

    it("rejects empty quote", () => {
      const page = `some text here`;
      const normalisedPage = normaliseForQuote(page);
      expect(quoteOnPage("", normalisedPage)).toBe(false);
    });

    it("rejects only-ellipsis quote", () => {
      const page = `some text here`;
      const normalisedPage = normaliseForQuote(page);
      expect(quoteOnPage("...", normalisedPage)).toBe(false);
    });

    it("rejects only-ellipsis quote with …", () => {
      const page = `some text here`;
      const normalisedPage = normaliseForQuote(page);
      expect(quoteOnPage("…", normalisedPage)).toBe(false);
    });

    it("rejects quote with only ellipses", () => {
      const page = `some text here`;
      const normalisedPage = normaliseForQuote(page);
      expect(quoteOnPage("... ... ...", normalisedPage)).toBe(false);
    });

    it("matches with curly apostrophe (U+2019)", () => {
      expect(quoteOnPage("the herd's size", normaliseForQuote("The herd’s size grew"))).toBe(true);
    });

    it("matches with curly double quotes (U+201C and U+201D)", () => {
      expect(quoteOnPage("he said \"no\"", normaliseForQuote("He said “no” twice"))).toBe(true);
    });
  });
});
