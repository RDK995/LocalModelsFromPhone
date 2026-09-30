/**
 * Pure utility for matching markdown links in an assistant answer against
 * the reply's saved sources (M10c2-T1).
 *
 * A link URL matches a source when their normalised hosts and paths align,
 * tolerating trivial differences: scheme (http/https), leading www.,
 * trailing slash, host case, and fragments.
 */

export type LinkSource = {
  title: string;
  url: string;
};

/**
 * Regex to parse an HTTP(S) URL into scheme, authority, and rest (path/query).
 * Pattern: ^(https?):\/\/([^/?#]+)(.*)$
 *   - (https?): captures scheme (http or https)
 *   - \/\/: literal ://
 *   - ([^/?#]+): captures authority (host:port, everything up to /, ?, or #)
 *   - (.*): captures rest (path, query, fragment)
 */
const URL_PATTERN = /^(https?):\/\/([^/?#]+)(.*)$/i;

/**
 * Normalises an HTTP(S) URL for source matching.
 *
 * - Accepts only http: or https: URLs (others return null).
 * - Drops scheme.
 * - Lower-cases host.
 * - Strips one leading www. from host.
 * - Keeps port, path, query.
 * - Drops fragment.
 * - Removes one trailing / from path (so root and root/ normalise equal).
 *
 * Returns null if the URL cannot be parsed, has no scheme, or is not http(s).
 */
export function normaliseLinkUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(URL_PATTERN);
  if (!match) {
    return null;
  }

  const [, , authority, rest] = match;

  // Normalise authority: lowercase, strip leading www.
  let host = authority.toLowerCase();
  if (host.startsWith("www.")) {
    host = host.slice(4); // Remove "www."
  }

  // If nothing left after removing www., reject
  if (!host) {
    return null;
  }

  // Parse rest (path + query + fragment)
  // Format: /path?query#fragment or ?query#fragment or #fragment or ""
  let pathAndQuery = rest;

  // Drop fragment: everything after # is removed
  const hashIndex = pathAndQuery.indexOf("#");
  if (hashIndex !== -1) {
    pathAndQuery = pathAndQuery.slice(0, hashIndex);
  }

  // Remove one trailing / from path (but not from entire result if it's in query)
  // Need to remove trailing / from the path part only, not from query
  // Path ends where ? begins
  const questionIndex = pathAndQuery.indexOf("?");
  if (questionIndex !== -1) {
    // Path is before ?, query is after
    const path = pathAndQuery.slice(0, questionIndex);
    const query = pathAndQuery.slice(questionIndex);
    const normalizedPath = path.endsWith("/") ? path.slice(0, -1) : path;
    pathAndQuery = normalizedPath + query;
  } else {
    // No query, just path (or empty)
    pathAndQuery = pathAndQuery.endsWith("/") ? pathAndQuery.slice(0, -1) : pathAndQuery;
  }

  return host + pathAndQuery;
}

/**
 * Extracts the normalised site host (lower-case, leading www. stripped, no port)
 * from an HTTP(S) URL.
 *
 * Returns null if the URL cannot be parsed or is not http(s).
 */
export function siteHost(url: string): string | null {
  const trimmed = url.trim();
  const match = trimmed.match(URL_PATTERN);
  if (!match) {
    return null;
  }

  const [, , authority] = match;

  // Normalise: lowercase, strip leading www., drop port
  let host = authority.toLowerCase();
  if (host.startsWith("www.")) {
    host = host.slice(4);
  }

  // Drop port (everything after :)
  const colonIndex = host.indexOf(":");
  if (colonIndex !== -1) {
    host = host.slice(0, colonIndex);
  }

  if (!host) {
    return null;
  }

  return host;
}

/**
 * Finds the first source whose normalised URL matches the given link URL.
 *
 * Returns null when:
 * - sources is undefined or empty
 * - the link URL does not normalise (invalid/non-http)
 * - no source's normalised URL matches the link's
 *
 * Matching requires the normalised URLs to be exactly equal, including
 * path and query string.
 */
export function matchSource(
  url: string,
  sources: LinkSource[] | undefined
): LinkSource | null {
  if (!sources || sources.length === 0) {
    return null;
  }

  const linkNormalized = normaliseLinkUrl(url);
  if (linkNormalized === null) {
    return null;
  }

  for (const source of sources) {
    const sourceNormalized = normaliseLinkUrl(source.url);
    if (sourceNormalized === null) {
      continue;
    }

    if (sourceNormalized === linkNormalized) {
      return source;
    }
  }

  return null;
}
