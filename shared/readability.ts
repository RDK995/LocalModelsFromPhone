/**
 * Shared readability check: determines if a page is readable based on bot-challenge markers and word count.
 * Used by both the search service and the server.
 * No I/O, no dependencies.
 */

export const BOT_CHALLENGE_MARKERS = [
  "captcha",
  "verify you are human",
  "are you a robot",
  "are you human",
  "checking your browser",
  "checking if the site connection is secure",
  "enable javascript and cookies to continue",
  "attention required! | cloudflare",
  "unusual traffic from your computer",
  "access denied",
  "cf-ray",
  "ddos protection by",
  "client challenge",
] as const;

export const UNREADABLE_MIN_WORDS = 40;

/** Count words in text after trimming and splitting on whitespace */
export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Check if text contains bot challenge markers */
export function isBotChallenge(text: string): boolean {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  const wordCountValue = normalized.split(/\s+/).length;

  // Only consider it a bot challenge if page is short (< 400 words)
  if (wordCountValue >= 400) {
    return false;
  }

  // Check for any marker
  for (const marker of BOT_CHALLENGE_MARKERS) {
    if (normalized.includes(marker)) {
      return true;
    }
  }

  return false;
}

export type Readability =
  | { readable: true }
  | { readable: false; reason: "blocked" | "empty"; detail: string };

/** Classify a page as readable or unreadable */
export function classifyPage(
  page: { title: string; text: string },
  minWords: number = UNREADABLE_MIN_WORDS
): Readability {
  // Check for bot challenge
  const fullText = page.title + "\n" + page.text;
  if (isBotChallenge(fullText)) {
    return {
      readable: false,
      reason: "blocked",
      detail: "Page appears to be a bot challenge or access verification",
    };
  }

  // Check word count
  const textWords = wordCount(page.text);
  if (textWords < minWords) {
    return {
      readable: false,
      reason: "empty",
      detail: `Page has only ${textWords} words (minimum ${minWords})`,
    };
  }

  return { readable: true };
}
