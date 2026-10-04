import { describe, it, expect } from "bun:test";
import {
  classifyPage,
  isBotChallenge,
  BOT_CHALLENGE_MARKERS,
  UNREADABLE_MIN_WORDS,
  wordCount,
} from "@shared/readability";

describe("readability", () => {
  describe("wordCount", () => {
    it("counts words by splitting on whitespace", () => {
      expect(wordCount("hello world")).toBe(2);
      expect(wordCount("  hello   world  ")).toBe(2);
      expect(wordCount("one two three four five")).toBe(5);
    });

    it("handles empty and whitespace-only strings", () => {
      expect(wordCount("")).toBe(0);
      expect(wordCount("   ")).toBe(0);
    });
  });

  describe("isBotChallenge", () => {
    it("detects 'client challenge' marker", () => {
      const text = "This is a client challenge page";
      expect(isBotChallenge(text)).toBe(true);
    });

    it("detects 'verify you are human' marker", () => {
      const text = "Please verify you are human to continue";
      expect(isBotChallenge(text)).toBe(true);
    });

    it("returns false for long articles mentioning a marker", () => {
      const text = "A long article about security. " + "word ".repeat(400);
      // Should be > 400 words, so not classified as bot challenge
      expect(isBotChallenge(text)).toBe(false);
    });

    it("detects all bot challenge markers", () => {
      BOT_CHALLENGE_MARKERS.forEach((marker) => {
        expect(isBotChallenge(marker)).toBe(true);
      });
    });

    it("includes 'client challenge' in markers", () => {
      const markers = BOT_CHALLENGE_MARKERS.map((m) => m.toLowerCase());
      expect(markers).toContain("client challenge");
    });
  });

  describe("classifyPage", () => {
    it("classifies 'client challenge' page as blocked", () => {
      const page = { title: "Login", text: "Client Challenge screen" };
      const result = classifyPage(page);

      expect(result.readable).toBe(false);
      if (!result.readable) {
        expect(result.reason).toBe("blocked");
        expect(result.detail).toContain("bot challenge");
      }
    });

    it("classifies 'verify you are human' page as blocked", () => {
      const page = {
        title: "Verify",
        text: "Please verify you are human before continuing",
      };
      const result = classifyPage(page);

      expect(result.readable).toBe(false);
      if (!result.readable) {
        expect(result.reason).toBe("blocked");
      }
    });

    it("classifies a 39-word page as empty", () => {
      const words = Array(39).fill("word").join(" ");
      const page = { title: "Short", text: words };
      const result = classifyPage(page);

      expect(result.readable).toBe(false);
      if (!result.readable) {
        expect(result.reason).toBe("empty");
        expect(result.detail).toContain("39");
        expect(result.detail).toContain("40");
      }
    });

    it("classifies a 40-word page as readable", () => {
      const words = Array(40).fill("word").join(" ");
      const page = { title: "Long Enough", text: words };
      const result = classifyPage(page);

      expect(result.readable).toBe(true);
    });

    it("classifies a 500-word article mentioning 'captcha' as readable", () => {
      const text =
        "This is an article about security. " +
        "We discuss captcha systems. " +
        "word ".repeat(490);
      const page = { title: "Security", text };
      const result = classifyPage(page);

      expect(result.readable).toBe(true);
    });

    it("classifies empty text as empty", () => {
      const page = { title: "Title", text: "" };
      const result = classifyPage(page);

      expect(result.readable).toBe(false);
      if (!result.readable) {
        expect(result.reason).toBe("empty");
      }
    });

    it("detects marker in title only", () => {
      const page = { title: "Client Challenge", text: "This is normal content " + "word ".repeat(50) };
      const result = classifyPage(page);

      expect(result.readable).toBe(false);
      if (!result.readable) {
        expect(result.reason).toBe("blocked");
      }
    });

    it("respects custom minWords parameter", () => {
      const words = Array(30).fill("word").join(" ");
      const page = { title: "Short", text: words };

      const resultDefault = classifyPage(page); // 30 < 40
      expect(resultDefault.readable).toBe(false);

      const resultWith20MinWords = classifyPage(page, 20); // 30 >= 20
      expect(resultWith20MinWords.readable).toBe(true);
    });
  });
});
