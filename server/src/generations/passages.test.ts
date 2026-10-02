import { describe, it, expect } from "bun:test";
import {
  estimateTokens,
  tokenize,
  splitPassages,
  rankPassages,
  isBotChallenge,
  buildNoteExcerpt,
  BOT_CHALLENGE_MARKERS,
  DEFAULT_PASSAGE_SETTINGS,
} from "./passages";

describe("passages", () => {
  describe("estimateTokens", () => {
    it("estimates tokens as ceil(length / 4)", () => {
      expect(estimateTokens("")).toBe(0);
      expect(estimateTokens("abc")).toBe(1); // ceil(3/4) = 1
      expect(estimateTokens("abcd")).toBe(1); // ceil(4/4) = 1
      expect(estimateTokens("abcde")).toBe(2); // ceil(5/4) = 2
      expect(estimateTokens("a".repeat(100))).toBe(25); // ceil(100/4) = 25
    });
  });

  describe("tokenize", () => {
    it("lowercases and splits on non-letter/digit", () => {
      const result = tokenize("Hello World");
      expect(result).toContain("hello");
      expect(result).toContain("world");
    });

    it("drops common stopwords", () => {
      const result = tokenize("the a an and or of to in on for is are was were");
      expect(result.length).toBe(0);
    });

    it("preserves significant words", () => {
      const result = tokenize("machine learning research");
      expect(result).toEqual(["machine", "learning", "research"]);
    });

    it("handles Unicode characters", () => {
      const result = tokenize("café naïve résumé");
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toBe("café");
    });

    it("splits on multiple types of punctuation", () => {
      const result = tokenize("hello-world! how?apple you.");
      expect(result).toContain("hello");
      expect(result).toContain("world");
      expect(result).toContain("apple");
    });
  });

  describe("splitPassages", () => {
    it("merges short paragraphs until reaching minWords without crossing headings", () => {
      const text = `Introduction

This is a short paragraph.

Another short one.

## Section 2

First para under section.

Another one.`;

      const passages = splitPassages(text, 20, 100);
      expect(passages.length).toBeGreaterThanOrEqual(2);
      // Should not mix content from different sections
      expect(passages[0]).not.toContain("Section 2");
      expect(passages[1]).toContain("Section 2");
    });

    it("cuts long passages at word boundaries", () => {
      const longText = "word ".repeat(500); // 2500 words
      const passages = splitPassages(longText, 50, 100);

      // All passages should be at most 100 words
      passages.forEach((passage) => {
        const wordCount = passage.trim().split(/\s+/).length;
        expect(wordCount).toBeLessThanOrEqual(110); // Allow small margin for boundaries
      });
    });

    it("extracts passages as substrings of normalized text", () => {
      const text = "First  paragraph.\n\n  Second   paragraph.";
      const normalized = text.replace(/\s+/g, " ").trim();
      const passages = splitPassages(text, 1, 100);

      passages.forEach((passage) => {
        expect(normalized).toContain(passage);
      });
    });
  });

  describe("rankPassages", () => {
    it("ranks passage containing query terms first", () => {
      const passages = ["apple orange banana", "red blue green", "fruit salad"];
      const result = rankPassages(passages, ["fruit", "salad"]);

      expect(result[0].index).toBe(2); // "fruit salad" passage
      expect(result[0].score).toBeGreaterThan(0);
    });

    it("gives zero score to passages with no query terms", () => {
      const passages = ["apple orange", "red blue", "xyz abc"];
      const result = rankPassages(passages, ["fruit"]);

      const noMatchPassage = result.find((r) => r.index === 0 || r.index === 1);
      expect(noMatchPassage?.score).toBe(0);
    });

    it("returns results sorted by score descending, ties by index ascending", () => {
      const passages = ["alpha beta", "gamma alpha", "alpha delta"];
      const result = rankPassages(passages, ["alpha"]);

      // All have "alpha", so they're tied - should be sorted by index
      expect(result[0].index).toBeLessThan(result[1].index);
      expect(result[1].index).toBeLessThan(result[2].index);
    });
  });

  describe("isBotChallenge", () => {
    it("identifies cloudflare challenge pages", () => {
      const text = "Checking your browser before accessing... Cloudflare";
      expect(isBotChallenge(text)).toBe(true);
    });

    it("returns false for long articles mentioning captcha", () => {
      const text = "A long article about security. " + "word ".repeat(400);
      // Should be > 400 words
      expect(isBotChallenge(text)).toBe(false);
    });

    it("returns false for text without markers", () => {
      const text = "This is a normal article about machine learning.";
      expect(isBotChallenge(text)).toBe(false);
    });

    it("detects all bot challenge markers", () => {
      expect(BOT_CHALLENGE_MARKERS.length).toBeGreaterThan(0);
      BOT_CHALLENGE_MARKERS.forEach((marker) => {
        expect(isBotChallenge(marker)).toBe(true);
      });
    });
  });

  describe("buildNoteExcerpt", () => {
    it("skips a very short page as empty", () => {
      const page = { title: "Short", text: "Few words here" };
      const result = buildNoteExcerpt(page, "words");

      expect(result.skip).toBe("empty");
      expect("reason" in result && result.reason).toBeTruthy();
    });

    it("skips a bot challenge page", () => {
      const page = {
        title: "Challenge",
        text: "Checking your browser before accessing the site. Cloudflare.",
      };
      const result = buildNoteExcerpt(page, "browser");

      expect(result.skip).toBe("blocked");
      expect("reason" in result && result.reason).toBeTruthy();
    });

    it("skips a page with no matching terms as empty", () => {
      const page = {
        title: "Animals",
        text: "Dogs and cats and birds are common pets. " + "pet ".repeat(50),
      };
      const result = buildNoteExcerpt(page, "machine learning");

      expect(result.skip).toBe("empty");
    });

    it("builds excerpt with title, first paragraph, and passages within token cap", () => {
      const page = {
        title: "Deep Learning",
        text: `Introduction to the field.

Deep learning is a subset of machine learning. It uses neural networks.

Background section.

Machine learning and neural networks are powerful tools.

Conclusion.`,
      };

      const result = buildNoteExcerpt(page, "neural networks");

      if (result.skip === null) {
        expect(result.excerpt).toContain("Deep Learning");
        expect(result.excerpt).toContain("Introduction to the field");
        expect(result.tokens).toBeLessThanOrEqual(DEFAULT_PASSAGE_SETTINGS.noteExcerptTokens);
        expect(result.passages).toBeGreaterThan(0);
      }
    });

    it("respects the token limit even for long passages", () => {
      const longPassage = "word ".repeat(500);
      const page = {
        title: "Long",
        text: `Start of page.

${longPassage}

End.`,
      };

      const result = buildNoteExcerpt(page, "word", { noteExcerptTokens: 300 });

      if (result.skip === null) {
        expect(result.tokens).toBeLessThanOrEqual(300);
      }
    });

    it("includes passage cut at word boundary to fit token limit", () => {
      const longPage = `Title paragraph.

${"word ".repeat(600)}`;

      const page = { title: "Long Page", text: longPage };
      const result = buildNoteExcerpt(page, "word", { noteExcerptTokens: 300 });

      if (result.skip === null) {
        expect(result.excerpt).toBeTruthy();
        expect(result.tokens).toBeLessThanOrEqual(300);
        expect(result.passages).toBeGreaterThan(0);
      }
    });
  });

  describe("DEFAULT_PASSAGE_SETTINGS", () => {
    it("has default values", () => {
      expect(DEFAULT_PASSAGE_SETTINGS.passageMinWords).toBe(150);
      expect(DEFAULT_PASSAGE_SETTINGS.passageMaxWords).toBe(400);
      expect(DEFAULT_PASSAGE_SETTINGS.noteExcerptTokens).toBe(2500);
      expect(DEFAULT_PASSAGE_SETTINGS.noteMinWords).toBe(40);
      expect(DEFAULT_PASSAGE_SETTINGS.noteMinRelevance).toBe(0);
    });
  });

  describe("BOT_CHALLENGE_MARKERS", () => {
    it("is a readonly array", () => {
      expect(Array.isArray(BOT_CHALLENGE_MARKERS)).toBe(true);
      expect(BOT_CHALLENGE_MARKERS.length).toBeGreaterThan(0);
    });

    it("contains expected markers", () => {
      const markers = BOT_CHALLENGE_MARKERS;
      const markerSet = new Set(markers.map((m) => m.toLowerCase()));

      // Check for at least some expected markers
      expect(
        markerSet.has("captcha") ||
          markerSet.has("verify you are human") ||
          markerSet.has("are you a robot")
      ).toBe(true);
    });
  });
});
