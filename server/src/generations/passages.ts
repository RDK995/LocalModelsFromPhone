/**
 * Pure passage module: split a page into passages, rank by BM25, build note excerpts.
 * No I/O, no model calls, no external dependencies.
 */

export interface PassageSettings {
  passageMinWords: number; // default 150
  passageMaxWords: number; // default 400
  noteExcerptTokens: number; // default 2500 (excerpt size cap, tokens estimated as ceil(chars/4))
  noteMinWords: number; // default 40 (fewer words of page text -> "empty")
  noteMinRelevance: number; // default 0 (best passage BM25 score must be > this, else "empty")
}

export const DEFAULT_PASSAGE_SETTINGS: PassageSettings = {
  passageMinWords: 150,
  passageMaxWords: 400,
  noteExcerptTokens: 2500,
  noteMinWords: 40,
  noteMinRelevance: 0,
};

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
] as const;

/** Estimate tokens as ceil(characters / 4) */
export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

/** Tokenize: lowercase, split on non-letter/digit, drop stopwords */
export function tokenize(s: string): string[] {
  const stopwords = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "of",
    "to",
    "in",
    "on",
    "for",
    "is",
    "are",
    "was",
    "were",
    "be",
    "with",
    "by",
    "at",
    "as",
    "it",
    "this",
    "that",
    "what",
    "how",
    "why",
    "which",
    "who",
    "do",
    "does",
    "from",
  ]);

  const tokens = s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0 && !stopwords.has(token));

  return tokens;
}

/** Split text into passages by headings and paragraphs, merge until minWords, cut if > maxWords */
export function splitPassages(text: string, minWords: number, maxWords: number): string[] {
  // First, normalize whitespace
  const whitespaceNormalized = text.replace(/\s+/g, " ").trim();

  // Split into blocks on blank lines and headings
  // We need to process the original text to detect headings properly
  const blocks: Array<{ text: string; isHeading: boolean }> = [];

  const lines = text.split(/\n/);
  let currentBlock = "";
  let isCurrentHeading = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      if (currentBlock) {
        blocks.push({ text: currentBlock.replace(/\s+/g, " ").trim(), isHeading: isCurrentHeading });
        currentBlock = "";
      }
      continue;
    }

    // Check if this line is a heading
    const isMarkdownHeading = /^#{1,6} /.test(trimmed);
    const wordCount = trimmed.split(/\s+/).length;
    const isPlaintextHeading =
      wordCount <= 12 &&
      !trimmed.match(/[.!?]$/) &&
      i + 1 < lines.length &&
      (lines[i + 1].trim() === "" || lines[i + 1].trim().match(/^#{1,6} /));

    const isHeading = isMarkdownHeading || isPlaintextHeading;

    if (isHeading) {
      if (currentBlock) {
        blocks.push({ text: currentBlock.replace(/\s+/g, " ").trim(), isHeading: false });
      }
      blocks.push({ text: trimmed, isHeading: true });
      currentBlock = "";
    } else {
      if (currentBlock) currentBlock += " ";
      currentBlock += trimmed;
    }
  }

  if (currentBlock) {
    blocks.push({ text: currentBlock.replace(/\s+/g, " ").trim(), isHeading: false });
  }

  // Merge blocks into passages
  const passages: string[] = [];
  let currentPassage = "";
  let passageWordCount = 0;

  for (const block of blocks) {
    const blockWordCount = block.text.split(/\s+/).length;

    if (block.isHeading) {
      // Heading starts a new passage
      if (currentPassage) {
        passages.push(currentPassage.trim());
      }
      currentPassage = block.text;
      passageWordCount = blockWordCount;
    } else {
      // Regular text block
      if (currentPassage) {
        currentPassage += " ";
      }
      currentPassage += block.text;
      passageWordCount += blockWordCount;

      // If passage is now >= minWords, save it
      if (passageWordCount >= minWords) {
        passages.push(currentPassage.trim());
        currentPassage = "";
        passageWordCount = 0;
      }
    }
  }

  // Handle remaining passage
  if (currentPassage) {
    passages.push(currentPassage.trim());
  }

  // Split passages that exceed maxWords
  const finalPassages: string[] = [];

  for (const passage of passages) {
    if (passage.split(/\s+/).length <= maxWords) {
      finalPassages.push(passage);
    } else {
      // Cut into chunks at word boundaries, preferring sentence ends in last 25%
      const words = passage.split(/\s+/);
      let chunk = "";
      let chunkWords = 0;

      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        chunk += (chunkWords > 0 ? " " : "") + word;
        chunkWords++;

        if (chunkWords >= maxWords) {
          // Try to find sentence boundary in last 25% of chunk
          const last25Start = Math.floor(maxWords * 0.75);
          let cutPoint = chunk.length;

          for (let j = chunk.length - 1; j >= 0; j--) {
            if (chunk[j] === "." && j > 0 && chunk[j - 1] !== ".") {
              const wordsSoFar = chunk.substring(0, j + 1).split(/\s+/).length;
              if (wordsSoFar >= last25Start) {
                cutPoint = j + 1;
                break;
              }
            }
          }

          const cutChunk = chunk.substring(0, cutPoint).trim();
          if (cutChunk) finalPassages.push(cutChunk);

          chunk = chunk.substring(cutPoint).trim();
          chunkWords = chunk.split(/\s+/).filter(w => w).length;
        }
      }

      if (chunk.trim()) {
        finalPassages.push(chunk.trim());
      }
    }
  }

  return finalPassages;
}

/** Rank passages by BM25 score */
export function rankPassages(
  passages: string[],
  terms: string[]
): Array<{ index: number; score: number }> {
  // Tokenize query terms, removing duplicates
  const queryTokens = Array.from(new Set(terms.flatMap((term) => tokenize(term))));

  if (queryTokens.length === 0) {
    // No query terms - all passages score 0, sorted by index
    return passages.map((_, index) => ({ index, score: 0 }));
  }

  const N = passages.length; // Total passages
  const k1 = 1.2;
  const b = 0.75;

  // Calculate average document length
  const passageLengths = passages.map((p) => tokenize(p).length);
  const avgLength = passageLengths.reduce((a, b) => a + b, 0) / N;

  // Score each passage
  const scores: Array<{ index: number; score: number }> = [];

  for (let i = 0; i < passages.length; i++) {
    const passage = passages[i];
    const passageTokens = tokenize(passage);
    const docLength = passageTokens.length;

    let score = 0;

    for (const term of queryTokens) {
      // Count occurrences of term in passage
      const termFreq = passageTokens.filter((t) => t === term).length;

      if (termFreq === 0) continue;

      // Count passages containing the term
      let docsWithTerm = 0;
      for (const p of passages) {
        if (tokenize(p).includes(term)) {
          docsWithTerm++;
        }
      }

      const n = docsWithTerm;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));

      const normalizedLength = docLength / avgLength;
      const denominator = termFreq + k1 * (1 - b + b * normalizedLength);

      score += idf * ((k1 + 1) * termFreq) / denominator;
    }

    scores.push({ index: i, score });
  }

  // Sort by score descending, then by index ascending
  scores.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.index - b.index;
  });

  return scores;
}

/** Check if text contains bot challenge markers */
export function isBotChallenge(text: string): boolean {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  const wordCount = normalized.split(/\s+/).length;

  // Only consider it a bot challenge if page is short (< 400 words)
  if (wordCount >= 400) {
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

export type NoteExcerpt =
  | { skip: "empty" | "blocked"; reason: string }
  | { skip: null; excerpt: string; passages: number; tokens: number };

/** Build note excerpt from page and search terms */
export function buildNoteExcerpt(
  page: { title: string; text: string },
  terms: string,
  settings?: Partial<PassageSettings>
): NoteExcerpt {
  const finalSettings = { ...DEFAULT_PASSAGE_SETTINGS, ...settings };

  // 1. Check for bot challenge
  const fullText = page.title + "\n" + page.text;
  if (isBotChallenge(fullText)) {
    return {
      skip: "blocked",
      reason: "Page appears to be a bot challenge or access verification",
    };
  }

  // 2. Check word count
  const textWords = page.text.split(/\s+/).length;
  if (textWords < finalSettings.noteMinWords) {
    return {
      skip: "empty",
      reason: `Page has only ${textWords} words (minimum ${finalSettings.noteMinWords})`,
    };
  }

  // 3. Split and rank passages
  const passages = splitPassages(
    page.text,
    finalSettings.passageMinWords,
    finalSettings.passageMaxWords
  );

  if (passages.length === 0) {
    return {
      skip: "empty",
      reason: "No passages could be extracted from page",
    };
  }

  const ranked = rankPassages(passages, [terms]);

  // Find best scoring passage
  const bestRanked = ranked.find((r) => r.score > finalSettings.noteMinRelevance);

  if (!bestRanked) {
    return {
      skip: "empty",
      reason: "No passage matches the search terms",
    };
  }

  // 4. Build excerpt
  // Get first paragraph (first block that's not a heading)
  // Split before collapsing whitespace: collapsing first would make the whole page one paragraph.
  const paragraphs = page.text.split(/\n\s*\n|\n(?=#{1,6} )/);
  let firstParagraph = "";

  for (const para of paragraphs) {
    const trimmed = para.replace(/\s+/g, " ").trim();
    if (trimmed && !trimmed.startsWith("#")) {
      firstParagraph = trimmed;
      break;
    }
  }

  // Check if first paragraph would exceed half the cap
  let useFirstParagraph = firstParagraph;
  if (estimateTokens(firstParagraph) > finalSettings.noteExcerptTokens / 2) {
    // Cut to half cap
    const words = firstParagraph.split(/\s+/);
    let truncated = "";
    for (const word of words) {
      const testStr = truncated + (truncated ? " " : "") + word;
      if (estimateTokens(testStr) > finalSettings.noteExcerptTokens / 2) {
        break;
      }
      truncated = testStr;
    }
    useFirstParagraph = truncated;
  }

  // Build header content
  const header = `Title: ${page.title}\n\nFirst paragraph:\n${useFirstParagraph}\n\nRelevant passages:`;
  const headerTokens = estimateTokens(header);

  // Track available space for passages
  let availableTokens = finalSettings.noteExcerptTokens - headerTokens;
  const selectedPassages: Array<{ index: number; text: string }> = [];

  for (const rankedItem of ranked) {
    if (rankedItem.score <= finalSettings.noteMinRelevance) {
      continue;
    }

    const passage = passages[rankedItem.index];
    const normalizedPassage = passage.replace(/\s+/g, " ").trim();

    // Skip if this is the first paragraph
    if (normalizedPassage === useFirstParagraph.replace(/\s+/g, " ").trim()) {
      continue;
    }

    const passageTokens = estimateTokens(passage);

    // Need at least newlines between passages
    const separatorTokens = estimateTokens("\n\n");

    if (passageTokens + separatorTokens <= availableTokens) {
      // Passage fits whole
      selectedPassages.push({ index: rankedItem.index, text: passage });
      availableTokens -= passageTokens + separatorTokens;
    } else if (selectedPassages.length === 0 && availableTokens > 0) {
      // Must include at least one passage - cut if needed
      const words = passage.split(/\s+/);
      let cutPassage = "";

      for (const word of words) {
        const testStr = cutPassage + (cutPassage ? " " : "") + word;
        if (estimateTokens(testStr) > availableTokens) {
          break;
        }
        cutPassage = testStr;
      }

      if (cutPassage) {
        selectedPassages.push({ index: rankedItem.index, text: cutPassage });
      }
      break; // Can't add more
    } else {
      break; // No more space
    }
  }

  // Sort by original index order
  selectedPassages.sort((a, b) => a.index - b.index);

  // Build final excerpt
  const excerptLines = [header];
  for (const selected of selectedPassages) {
    excerptLines.push(selected.text);
  }

  const excerptText = excerptLines.join("\n\n").trim();
  const finalTokens = estimateTokens(excerptText);

  return {
    skip: null,
    excerpt: excerptText,
    passages: selectedPassages.length,
    tokens: finalTokens,
  };
}
