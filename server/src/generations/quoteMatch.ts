/**
 * Quote matching for FR48: normalise page text and quotes, then check if a quote
 * appears on the page accounting for formatting variations.
 */

/**
 * Normalise a string for quote matching. Applies in order:
 * 1. Unicode NFKC
 * 2. Markdown to visible text (images, links, emphasis)
 * 3. Quote and apostrophe normalisation
 * 4. Dash normalisation
 * 5. Lowercase
 * 6. Whitespace collapse and trim
 */
export function normaliseForQuote(s: string): string {
  // 1. Unicode NFKC
  let result = s.normalize("NFKC");

  // 2. Markdown to visible text
  // Images: ![alt](target) → alt (before links so [![alt](img)](href) → alt)
  result = result.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");

  // Links: [text](target) → text
  result = result.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

  // Emphasis markers:
  // - Remove all * characters (for **bold** and *italic*)
  result = result.replace(/\*/g, "");

  // - Remove ~~ (for ~~strikethrough~~)
  result = result.replace(/~~/g, "");

  // - Remove underscore runs that open/close emphasis
  // An underscore run opens/closes emphasis if it touches:
  // - (whitespace, punctuation, or string edge) on ONE side AND
  // - (non-space character) on the OTHER side
  result = removeEmphasisUnderscores(result);

  // 3. Normalise quotes and apostrophes
  // ' ' ‚ ‛ ′ ` ´ ' ' → '
  result = result.replace(/['‚‛′`´‘’]/g, "'");
  // " " „ ‟ ″ « » " " → "
  result = result.replace(/["„‟″«»“”]/g, '"');

  // 4. Normalise dashes
  // U+2010 ‐, U+2011 ‑, U+2012 ‒, U+2013 –, U+2014 —, U+2015 ―, U+2212 −, U+FE58 ﹘, U+FE63 ﹣, U+FF0D － → -
  result = result.replace(/[‐‑‒–—―−﹘﹣－]/g, "-");

  // 5. Lowercase
  result = result.toLowerCase();

  // 6. Collapse whitespace and trim
  result = result.replace(/\s+/g, " ").trim();

  return result;
}

/**
 * Remove underscore runs that open or close emphasis.
 * A run of underscores opens/closes emphasis if:
 * - One side touches (whitespace, punctuation, or string edge)
 * - Other side touches a non-space character
 */
function removeEmphasisUnderscores(s: string): string {
  let result = "";
  let i = 0;

  while (i < s.length) {
    if (s[i] === "_") {
      // Collect the underscore run
      let runStart = i;
      while (i < s.length && s[i] === "_") {
        i++;
      }
      const runLength = i - runStart;

      // Get characters before and after the run
      const charBefore = runStart > 0 ? s[runStart - 1] : "";
      const charAfter = i < s.length ? s[i] : "";

      // Check if this is an opening or closing emphasis
      const isEdgeOrBoundary = (c: string) => !c || /\s|[^\w]/.test(c);
      const isNonSpace = (c: string) => c && c !== " " && !/\s/.test(c);

      const opensEmphasis =
        isEdgeOrBoundary(charBefore) && isNonSpace(charAfter);
      const closesEmphasis =
        isNonSpace(charBefore) && isEdgeOrBoundary(charAfter);

      // Keep the run only if it doesn't open or close emphasis
      if (!opensEmphasis && !closesEmphasis) {
        result += "_".repeat(runLength);
      }
      // Otherwise skip the underscores (remove them)
    } else {
      result += s[i];
      i++;
    }
  }

  return result;
}

/**
 * Check if a quote appears on a normalised page text.
 * The page text must already be normalised with normaliseForQuote.
 * The quote is normalised here.
 *
 * Matching rules:
 * - If the normalised quote contains no run of 3+ dots, match with simple includes
 * - If it contains 3+ dots, split on runs of 3+ dots, trim pieces, discard empty pieces,
 *   and match when all pieces are found in order
 * - Empty normalised quote does not match
 * - Quote whose pieces are all empty does not match
 */
export function quoteOnPage(
  quote: string,
  normalisedPageText: string
): boolean {
  // Normalise the quote
  const normalisedQuote = normaliseForQuote(quote);

  // Empty quote does not match
  if (normalisedQuote === "") {
    return false;
  }

  // Check if normalised quote contains 3+ dots
  const dotRunRegex = /\.{3,}/;
  if (!dotRunRegex.test(normalisedQuote)) {
    // No 3+ dot run: use simple includes check
    return normalisedPageText.includes(normalisedQuote);
  }

  // Has 3+ dot run: split on dot runs and check pieces in order
  const pieces = normalisedQuote.split(dotRunRegex);
  const trimmedPieces = pieces.map((p) => p.trim()).filter((p) => p !== "");

  // If all pieces are empty, don't match
  if (trimmedPieces.length === 0) {
    return false;
  }

  // Check if each piece is found in order
  let searchFrom = 0;
  for (const piece of trimmedPieces) {
    const index = normalisedPageText.indexOf(piece, searchFrom);
    if (index === -1) {
      return false;
    }
    searchFrom = index + piece.length;
  }

  return true;
}
