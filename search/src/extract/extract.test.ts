import { describe, it, expect, afterEach } from "bun:test";
import { extractPage, MAX_MARKDOWN_CHARS } from "./extract";

const ARTICLE_HTML = `<!doctype html><html><head><title>Widget Guide</title></head><body>
<header><nav><a href="/">NAVBOILERPLATE Home</a></nav></header>
<aside class="sidebar">SIDEBARBOILERPLATE related links</aside>
<article><h1>Widget Guide</h1>
<p>Widgets are small reusable components that do useful work in many applications and systems.</p>
<p>To install a widget you run the installer and then restart your computer to finish the setup.</p>
<pre><code>npm install widget-lib</code></pre>
<p>After installation, configure the widget by editing the configuration file in your home directory.</p>
</article>
<footer>FOOTERBOILERPLATE copyright</footer></body></html>`;

describe("extractPage", () => {
  it("extracts article markdown without boilerplate and keeps the code block", async () => {
    const r = await extractPage({ body: ARTICLE_HTML, contentType: "text/html", finalUrl: "https://example.com/a", bodyTruncated: false });
    expect(r.title).toBe("Widget Guide");
    expect(r.markdown).toContain("Widgets are small reusable components");
    expect(r.markdown).toContain("npm install widget-lib");
    expect(r.markdown).not.toContain("NAVBOILERPLATE");
    expect(r.markdown).not.toContain("SIDEBARBOILERPLATE");
    expect(r.markdown).not.toContain("FOOTERBOILERPLATE");
    expect(r.truncated).toBe(false);
    expect(r.markdown).not.toContain("[… truncated");
  });

  it("truncates over-long content with a marker", async () => {
    const big = "<p>" + "word ".repeat(20_000) + "</p>";
    const html = `<html><head><title>Big</title></head><body><article><h1>Big</h1>${big}</article></body></html>`;
    const r = await extractPage({ body: html, contentType: "text/html", finalUrl: "https://example.com/b", bodyTruncated: false });
    expect(r.truncated).toBe(true);
    expect(r.markdown.endsWith(`[… truncated: page exceeded ${MAX_MARKDOWN_CHARS} characters]`)).toBe(true);
    expect(r.markdown.length).toBeLessThanOrEqual(MAX_MARKDOWN_CHARS + 100);
  });

  it("marks truncated with the marker when the fetcher cut the body", async () => {
    const r = await extractPage({ body: ARTICLE_HTML, contentType: "text/html", finalUrl: "https://example.com/a", bodyTruncated: true });
    expect(r.truncated).toBe(true);
    expect(r.markdown).toContain("[… truncated");
  });

  it("returns text/plain as-is, truncated when long", async () => {
    const r = await extractPage({ body: "hello <b>plain</b>", contentType: "text/plain", finalUrl: "https://example.com/t.txt", bodyTruncated: false });
    expect(r.markdown).toBe("hello <b>plain</b>");
    expect(r.truncated).toBe(false);
    const long = await extractPage({ body: "x".repeat(50_000), contentType: "text/plain", finalUrl: "https://example.com/t.txt", bodyTruncated: false });
    expect(long.truncated).toBe(true);
    expect(long.markdown.startsWith("x".repeat(MAX_MARKDOWN_CHARS))).toBe(true);
  });

  describe("offline extraction", () => {
    const realFetch = globalThis.fetch;
    afterEach(() => {
      globalThis.fetch = realFetch;
    });

    const urls = [
      "https://www.dropbox.com/s/abc/status/123",
      "https://x.com/someone/status/123",
      "https://www.reddit.com/r/x/comments/abc/title/",
    ];
    for (const finalUrl of urls) {
      it(`makes no network request of its own for ${finalUrl}`, async () => {
        const calls: unknown[] = [];
        globalThis.fetch = ((...args: unknown[]) => {
          calls.push(args);
          return Promise.reject(new Error("recorded, not forwarded"));
        }) as unknown as typeof globalThis.fetch;
        const r = await extractPage({ body: ARTICLE_HTML, contentType: "text/html", finalUrl, bodyTruncated: false });
        expect(calls.length).toBe(0);
        expect(r.markdown).toContain("Widgets are small reusable components");
      });
    }
  });
});
