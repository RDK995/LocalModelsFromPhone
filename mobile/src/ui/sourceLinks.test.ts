/**
 * Tests for source link matching and URL normalization (M10c2-T1).
 *
 * A markdown link URL in an assistant answer matches one of the reply's saved
 * sources if their normalised hosts and paths align, tolerating trivial
 * differences (scheme http/https, leading www., trailing slash).
 */

import { describe, it, expect } from "bun:test";
import {
  type LinkSource,
  normaliseLinkUrl,
  matchSource,
  siteHost,
  sourceByNumber,
} from "./sourceLinks";

describe("normaliseLinkUrl", () => {
  it("returns null for non-http(s) URLs (mailto)", () => {
    expect(normaliseLinkUrl("mailto:user@example.com")).toBeNull();
  });

  it("returns null for non-http(s) URLs (javascript)", () => {
    expect(normaliseLinkUrl("javascript:alert('hi')")).toBeNull();
  });

  it("returns null for unparseable URLs", () => {
    expect(normaliseLinkUrl("not a url")).toBeNull();
  });

  it("returns null for input with only scheme", () => {
    expect(normaliseLinkUrl("https://")).toBeNull();
  });

  it("trims whitespace from input", () => {
    expect(normaliseLinkUrl("  https://example.com  ")).toBe("example.com");
  });

  it("accepts http scheme", () => {
    expect(normaliseLinkUrl("http://example.com")).toBe("example.com");
  });

  it("accepts https scheme", () => {
    expect(normaliseLinkUrl("https://example.com")).toBe("example.com");
  });

  it("drops scheme from result", () => {
    expect(normaliseLinkUrl("https://example.com")).toBe("example.com");
    expect(normaliseLinkUrl("http://example.com")).toBe("example.com");
  });

  it("lower-cases the host", () => {
    expect(normaliseLinkUrl("https://Example.COM")).toBe("example.com");
  });

  it("strips leading www. from host", () => {
    expect(normaliseLinkUrl("https://www.example.com")).toBe("example.com");
  });

  it("strips only one leading www.", () => {
    // This is an edge case; we expect one www. to be stripped
    expect(normaliseLinkUrl("https://www.www.example.com")).toBe("www.example.com");
  });

  it("preserves port in result", () => {
    expect(normaliseLinkUrl("https://example.com:8080")).toBe("example.com:8080");
  });

  it("preserves path in result", () => {
    expect(normaliseLinkUrl("https://example.com/path/to/page")).toBe(
      "example.com/path/to/page"
    );
  });

  it("preserves query string in result", () => {
    expect(normaliseLinkUrl("https://example.com/path?q=test&foo=bar")).toBe(
      "example.com/path?q=test&foo=bar"
    );
  });

  it("drops fragment from result", () => {
    expect(normaliseLinkUrl("https://example.com/path#section")).toBe(
      "example.com/path"
    );
  });

  it("removes one trailing slash from path (root case)", () => {
    expect(normaliseLinkUrl("https://example.com/")).toBe("example.com");
  });

  it("removes one trailing slash from path (nested case)", () => {
    expect(normaliseLinkUrl("https://example.com/a/b/")).toBe(
      "example.com/a/b"
    );
  });

  it("preserves multiple trailing slashes minus one", () => {
    // Remove one trailing slash, leaving others
    expect(normaliseLinkUrl("https://example.com/a//")).toBe("example.com/a/");
  });

  it("normalizes complex URL (www, scheme, trailing slash, case, query)", () => {
    expect(normaliseLinkUrl("https://www.Example.com/a/?q=test")).toBe(
      "example.com/a?q=test"
    );
  });

  it("treats http and https variants as equal after normalization", () => {
    const http = normaliseLinkUrl("http://example.com/a/");
    const https = normaliseLinkUrl("https://example.com/a/");
    expect(http).toBe(https);
  });

  it("treats www and non-www variants as equal after normalization", () => {
    const withWww = normaliseLinkUrl("https://www.example.com");
    const withoutWww = normaliseLinkUrl("https://example.com");
    expect(withWww).toBe(withoutWww);
  });

  it("treats trailing-slash variants as equal after normalization", () => {
    const withSlash = normaliseLinkUrl("https://example.com/a/");
    const withoutSlash = normaliseLinkUrl("https://example.com/a");
    expect(withSlash).toBe(withoutSlash);
  });

  it("normalizes case-variants as equal", () => {
    const upper = normaliseLinkUrl("https://EXAMPLE.COM");
    const lower = normaliseLinkUrl("https://example.com");
    expect(upper).toBe(lower);
  });
});

describe("siteHost", () => {
  it("returns null for non-http(s) URLs", () => {
    expect(siteHost("mailto:user@example.com")).toBeNull();
  });

  it("returns null for unparseable URLs", () => {
    expect(siteHost("not a url")).toBeNull();
  });

  it("returns normalized host for https URL", () => {
    expect(siteHost("https://example.com")).toBe("example.com");
  });

  it("returns normalized host for http URL", () => {
    expect(siteHost("http://example.com")).toBe("example.com");
  });

  it("lower-cases host", () => {
    expect(siteHost("https://Example.COM")).toBe("example.com");
  });

  it("strips leading www. from host", () => {
    expect(siteHost("https://www.example.com")).toBe("example.com");
  });

  it("drops port (does not include port in siteHost)", () => {
    expect(siteHost("https://example.com:8080")).toBe("example.com");
  });

  it("handles URL with path (ignores path for siteHost)", () => {
    expect(siteHost("https://example.com/path")).toBe("example.com");
  });

  it("handles URL with query (ignores query for siteHost)", () => {
    expect(siteHost("https://example.com?q=test")).toBe("example.com");
  });

  it("handles complex URL with all components", () => {
    expect(siteHost("https://www.Example.COM:8080/path?q=test#frag")).toBe(
      "example.com"
    );
  });
});

describe("matchSource", () => {
  const sources: LinkSource[] = [
    { title: "Example Article", url: "https://example.com/article" },
    { title: "GitHub", url: "https://github.com" },
  ];

  it("returns null when sources is undefined", () => {
    expect(matchSource("https://example.com/article", undefined)).toBeNull();
  });

  it("returns null when sources is empty array", () => {
    expect(matchSource("https://example.com/article", [])).toBeNull();
  });

  it("returns null when URL does not normalize", () => {
    expect(matchSource("not a url", sources)).toBeNull();
  });

  it("returns matching source when URL matches first source", () => {
    const result = matchSource("https://example.com/article", sources);
    expect(result).toEqual({ title: "Example Article", url: "https://example.com/article" });
  });

  it("returns matching source when URL matches second source", () => {
    const result = matchSource("https://github.com", sources);
    expect(result).toEqual({ title: "GitHub", url: "https://github.com" });
  });

  it("returns first matching source when multiple could match", () => {
    const multipleSources: LinkSource[] = [
      { title: "First", url: "https://example.com/article" },
      { title: "Second", url: "https://example.com/article" },
    ];
    const result = matchSource("https://example.com/article", multipleSources);
    expect(result?.title).toBe("First");
  });

  it("matches despite scheme difference (http vs https)", () => {
    const result = matchSource(
      "http://example.com/article",
      sources
    );
    expect(result).toEqual({ title: "Example Article", url: "https://example.com/article" });
  });

  it("matches despite www. difference", () => {
    const result = matchSource(
      "https://www.example.com/article",
      sources
    );
    expect(result).toEqual({ title: "Example Article", url: "https://example.com/article" });
  });

  it("matches despite trailing slash difference", () => {
    const result = matchSource("https://github.com/", sources);
    expect(result).toEqual({ title: "GitHub", url: "https://github.com" });
  });

  it("matches despite host case difference", () => {
    const result = matchSource("https://EXAMPLE.COM/article", sources);
    expect(result).toEqual({ title: "Example Article", url: "https://example.com/article" });
  });

  it("returns null when URL does not match (different path)", () => {
    expect(matchSource("https://example.com/different", sources)).toBeNull();
  });

  it("returns null when URL does not match (different host)", () => {
    expect(matchSource("https://other.com/article", sources)).toBeNull();
  });

  it("returns null for truncated URL like MSN (path mismatch)", () => {
    // e.g., https://www.msn.com/... should not match a source without exact path
    const msnSources: LinkSource[] = [
      { title: "MSN", url: "https://www.msn.com/news" },
    ];
    expect(matchSource("https://www.msn.com/en-us/news", msnSources)).toBeNull();
  });

  it("returns null when query string differs", () => {
    const querySource: LinkSource[] = [
      { title: "Search", url: "https://example.com?q=foo" },
    ];
    expect(matchSource("https://example.com?q=bar", querySource)).toBeNull();
  });

  it("requires exact query match (query is part of normalised URL)", () => {
    const querySource: LinkSource[] = [
      { title: "Search", url: "https://example.com/path?q=test" },
    ];
    const resultWithQuery = matchSource("https://example.com/path?q=test", querySource);
    expect(resultWithQuery).toEqual(querySource[0]);

    const resultWithoutQuery = matchSource("https://example.com/path", querySource);
    expect(resultWithoutQuery).toBeNull();
  });

  it("drops fragment from both URL and source for comparison", () => {
    const fragmentSource: LinkSource[] = [
      { title: "Article", url: "https://example.com/article" },
    ];
    // URL has fragment, source doesn't
    const result = matchSource("https://example.com/article#section", fragmentSource);
    expect(result).toEqual(fragmentSource[0]);
  });

  it("returns null for non-http(s) link", () => {
    expect(matchSource("mailto:user@example.com", sources)).toBeNull();
  });

  it("handles sources with fragments (dropped for comparison)", () => {
    const fragmentSources: LinkSource[] = [
      { title: "Article", url: "https://example.com/article#intro" },
    ];
    const result = matchSource("https://example.com/article", fragmentSources);
    expect(result).toEqual(fragmentSources[0]);
  });
});

describe("sourceByNumber (FR31)", () => {
  const list = [
    { title: "A", url: "https://a.test", n: 1 },
    { title: "B", url: "https://b.test" },
    { title: "C", url: "https://c.test", n: 3 },
  ];
  it("returns the source with that number", () => {
    expect(sourceByNumber(3, list)?.url).toBe("https://c.test");
  });
  it("is null for an unknown number, no numbers at all, or no sources", () => {
    expect(sourceByNumber(2, list)).toBeNull();
    expect(sourceByNumber(1, [{ title: "B", url: "https://b.test" }])).toBeNull();
    expect(sourceByNumber(1, undefined)).toBeNull();
  });
});
