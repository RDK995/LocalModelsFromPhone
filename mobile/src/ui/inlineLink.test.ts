import { describe, it, expect } from "bun:test";
import { presentLink, presentCitation, logoDisplay } from "./inlineLink";

const sources = [
  { title: "BBC", url: "https://www.bbc.com/news/abc" },
  { title: "Odd", url: "not a url" },
];

describe("presentLink", () => {
  it("matches despite scheme, www. and trailing slash", () => {
    expect(presentLink("http://bbc.com/news/abc/", sources)).toEqual({
      kind: "source",
      url: "https://www.bbc.com/news/abc",
      host: "bbc.com",
    });
  });
  it("is plain when the URL is not in the sources", () => {
    expect(presentLink("https://www.msn.com/en-us/news/x", sources)).toEqual({ kind: "plain" });
  });
  it("is plain when there are no sources", () => {
    expect(presentLink("https://www.bbc.com/news/abc", undefined)).toEqual({ kind: "plain" });
    expect(presentLink("https://www.bbc.com/news/abc", [])).toEqual({ kind: "plain" });
  });
});

describe("logoDisplay", () => {
  it("shows an image for a data:image/ URI", () => {
    expect(logoDisplay("data:image/png;base64,AAA")).toEqual({
      kind: "image",
      uri: "data:image/png;base64,AAA",
    });
  });
  it("shows the globe for null, undefined and non-image strings", () => {
    expect(logoDisplay(null)).toEqual({ kind: "globe" });
    expect(logoDisplay(undefined)).toEqual({ kind: "globe" });
    expect(logoDisplay("https://x.com/i.png")).toEqual({ kind: "globe" });
    expect(logoDisplay("data:text/html;base64,AAA")).toEqual({ kind: "globe" });
  });
});

describe("presentCitation (FR31)", () => {
  const numbered = [
    { title: "BBC", url: "https://www.bbc.com/news/abc?x=1#f", n: 1 },
    { title: "Odd", url: "not a url", n: 2 },
    { title: "Saved only", url: "https://c.test/p" },
  ];
  it("resolves n to the exact saved url and host", () => {
    expect(presentCitation(1, numbered)).toEqual({
      kind: "source",
      url: "https://www.bbc.com/news/abc?x=1#f",
      host: "bbc.com",
    });
  });
  it("is plain for an unknown number, an unusable host, or sources without numbers", () => {
    expect(presentCitation(9, numbered)).toEqual({ kind: "plain" });
    expect(presentCitation(2, numbered)).toEqual({ kind: "plain" });
    expect(presentCitation(3, numbered)).toEqual({ kind: "plain" });
    expect(presentCitation(1, [{ title: "Old", url: "https://a.test" }])).toEqual({ kind: "plain" });
    expect(presentCitation(1, undefined)).toEqual({ kind: "plain" });
  });
});
