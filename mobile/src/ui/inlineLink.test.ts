import { describe, it, expect } from "bun:test";
import { presentLink, logoDisplay } from "./inlineLink";

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
