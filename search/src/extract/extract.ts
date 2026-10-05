/**
 * Main-content extraction (C13, interface I18; FR21): Defuddle over linkedom → markdown,
 * truncated to 40 000 characters with a visible marker. text/plain is returned as-is.
 */
import { parseHTML } from "linkedom";
import { Defuddle } from "defuddle/node";

export const MAX_MARKDOWN_CHARS = 40_000;

export interface ExtractInput {
  body: string;
  contentType: string;
  finalUrl: string;
  /** True if the fetcher cut the body at its byte cap. */
  bodyTruncated: boolean;
}

export interface ExtractedPage {
  title: string;
  markdown: string;
  truncated: boolean;
}

/** Extraction must add no network path beyond the guarded fetcher (I18): Defuddle's async extractors would use fetch. */
const noNetworkFetch = (() => Promise.reject(new Error("network access disabled during extraction"))) as unknown as typeof globalThis.fetch;

export async function extractPage(input: ExtractInput): Promise<ExtractedPage> {
  let title = "";
  let markdown: string;
  if (input.contentType === "text/plain") {
    markdown = input.body;
  } else {
    const { document } = parseHTML(input.body);
    const result = await Defuddle(document as unknown as Parameters<typeof Defuddle>[0], input.finalUrl, {
      markdown: true,
      useAsync: false,
      fetch: noNetworkFetch,
    });
    title = result.title ?? "";
    markdown = result.content ?? "";
  }

  let truncated = input.bodyTruncated;
  if (markdown.length > MAX_MARKDOWN_CHARS) {
    markdown = markdown.slice(0, MAX_MARKDOWN_CHARS);
    truncated = true;
  }
  if (truncated) markdown += `\n\n[… truncated: page exceeded ${MAX_MARKDOWN_CHARS} characters]`;
  return { title, markdown, truncated };
}
