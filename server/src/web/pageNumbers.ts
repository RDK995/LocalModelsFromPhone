/**
 * Per-reply page numbering (FR31). A page's key follows the FR27 comparison:
 * http and https are the same, a leading `www.` on the host is ignored, and
 * a trailing slash is ignored.
 */
export function pageUrlKey(url: string): string {
  return url
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "");
}

/** Returns a function giving each distinct page 1, 2, 3 ... in first-read order. */
export function createPageNumberer(): (finalUrl: string) => number {
  const numbers = new Map<string, number>();
  return (finalUrl) => {
    const key = pageUrlKey(finalUrl);
    let n = numbers.get(key);
    if (n === undefined) {
      n = numbers.size + 1;
      numbers.set(key, n);
    }
    return n;
  };
}
