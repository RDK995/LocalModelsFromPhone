/**
 * Pure markdown parser for assistant replies (FR26, M10b-T1). No React, no
 * dependencies: turns a reply into a small block/inline tree the phone renders
 * as styled text. It never throws, and tolerates a half-streamed prefix: an
 * unterminated construct at the very end of the input hides its markers (so a
 * reply mid-stream never shows a raw `**`), while an unmatched marker anywhere
 * else stays literal text because its closer can never arrive.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "bold"; children: Inline[] }
  | { type: "italic"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; url: string; children: Inline[] };
export interface ListItem { depth: number; children: Inline[] }
export type Block =
  | { type: "paragraph"; children: Inline[] }
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { type: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { type: "codeBlock"; language: string | null; text: string }
  | { type: "quote"; children: Inline[] }
  | { type: "table"; rows: Inline[][][] }
  | { type: "rule" };

// ---------------------------------------------------------------- inline

const ESCAPABLE = "\\`*_#[]()<>|~+-.!{}";
const MAX_DEPTH = 24;
const AUTOLINK = /<(https?:\/\/[^\s<>]+)>/y;

function isAlnum(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

function isSpace(ch: string | undefined): boolean {
  return ch === undefined || /\s/.test(ch);
}

function runLength(s: string, from: number, ch: string): number {
  let e = from;
  for (; s[e] === ch; e++);
  return e - from;
}

/** Index of the next backtick run of exactly `n` backticks at or after `from`, or -1. */
function findBacktickClose(s: string, from: number, n: number): number {
  let j = from;
  for (; j < s.length; ) {
    const k = s.indexOf("`", j);
    if (k < 0) return -1;
    const m = runLength(s, k, "`");
    if (m === n) return k;
    j = k + m;
  }
  return -1;
}

/** Index of a closing emphasis run of exactly `n` `c` characters, or -1. */
function findCloser(s: string, from: number, c: string, n: number): number {
  let j = from;
  for (; j < s.length; ) {
    const ch = s[j];
    if (ch === "\\") {
      j += 2;
    } else if (ch === "`") {
      const m = runLength(s, j, "`");
      const close = findBacktickClose(s, j + m, m);
      j = close >= 0 ? close + m : j + m;
    } else if (ch === c) {
      const m = runLength(s, j, c);
      if (m === n && j > from && !isSpace(s[j - 1]) && (c !== "_" || !isAlnum(s[j + m]))) return j;
      j += m;
    } else {
      j++;
    }
  }
  return -1;
}

/** Index of the `]` matching the `[` at `open`, or -1. */
function findBracketClose(s: string, open: number): number {
  let depth = 0;
  for (let j = open; j < s.length; j++) {
    const ch = s[j];
    if (ch === "\\") j++;
    else if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) return j;
  }
  return -1;
}

/** Index of the `)` matching a `(` whose content starts at `from`, or -1. */
function findParenClose(s: string, from: number): number {
  let depth = 1;
  for (let j = from; j < s.length; j++) {
    const ch = s[j];
    if (ch === "\\") j++;
    else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return j;
  }
  return -1;
}

function cleanUrl(raw: string): string {
  let u = raw.trim().split(/\s+/)[0] ?? "";
  if (u.startsWith("<") && u.endsWith(">")) u = u.slice(1, -1);
  return u;
}

function wrapEmphasis(run: number, inner: Inline[]): Inline[] {
  if (inner.length === 0) return [];
  if (run === 1) return [{ type: "italic", children: inner }];
  if (run === 2) return [{ type: "bold", children: inner }];
  return [{ type: "bold", children: [{ type: "italic", children: inner }] }];
}

function parseInlineImpl(s: string, streaming: boolean, depth: number): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  let i = 0;
  const flush = (): void => {
    if (buf) {
      out.push({ type: "text", text: buf });
      buf = "";
    }
  };
  const canNest = depth < MAX_DEPTH;

  for (; i < s.length; ) {
    const c = s[i] as string;

    if (c === "\\") {
      const n = s[i + 1];
      if (n !== undefined && ESCAPABLE.includes(n)) {
        buf += n;
        i += 2;
      } else {
        buf += c;
        i++;
      }
      continue;
    }

    if (c === "`") {
      const n = runLength(s, i, "`");
      const close = findBacktickClose(s, i + n, n);
      if (close >= 0) {
        let content = s.slice(i + n, close);
        if (content.length > 2 && content.startsWith(" ") && content.endsWith(" ")) {
          content = content.slice(1, -1);
        }
        flush();
        out.push({ type: "code", text: content });
        i = close + n;
      } else if (streaming) {
        const rest = s.slice(i + n);
        flush();
        if (rest) out.push({ type: "code", text: rest });
        i = s.length;
      } else {
        buf += s.slice(i, i + n);
        i += n;
      }
      continue;
    }

    if (c === "*" || c === "_") {
      const run = runLength(s, i, c);
      const e = i + run;
      const next = s[e];
      if (c === "_" && isAlnum(s[i - 1])) {
        buf += s.slice(i, e);
        i = e;
      } else if (next === undefined) {
        if (!streaming) buf += s.slice(i, e);
        i = e;
      } else if (run > 3 || isSpace(next)) {
        buf += s.slice(i, e);
        i = e;
      } else {
        const closer = findCloser(s, e, c, run);
        if (closer >= 0) {
          flush();
          out.push(...wrapEmphasis(run, parseInlineImpl(s.slice(e, closer), false, depth + 1)));
          i = closer + run;
        } else if (streaming && canNest) {
          flush();
          out.push(...wrapEmphasis(run, parseInlineImpl(s.slice(e), true, depth + 1)));
          i = s.length;
        } else {
          buf += s.slice(i, e);
          i = e;
        }
      }
      continue;
    }

    if (c === "[") {
      const close = findBracketClose(s, i);
      if (close < 0) {
        if (streaming && canNest) {
          flush();
          out.push(...parseInlineImpl(s.slice(i + 1), true, depth + 1));
          i = s.length;
        } else {
          buf += c;
          i++;
        }
        continue;
      }
      if (s[close + 1] === "(" && canNest) {
        const inner = s.slice(i + 1, close);
        const paren = findParenClose(s, close + 2);
        if (paren >= 0) {
          flush();
          out.push({
            type: "link",
            url: cleanUrl(s.slice(close + 2, paren)),
            children: parseInlineImpl(inner, false, depth + 1),
          });
          i = paren + 1;
          continue;
        }
        if (streaming) {
          flush();
          out.push({
            type: "link",
            url: cleanUrl(s.slice(close + 2)),
            children: parseInlineImpl(inner, false, depth + 1),
          });
          i = s.length;
          continue;
        }
      }
      buf += c;
      i++;
      continue;
    }

    if (c === "<") {
      AUTOLINK.lastIndex = i;
      const m = AUTOLINK.exec(s);
      if (m) {
        flush();
        out.push({ type: "link", url: m[1] as string, children: [{ type: "text", text: m[1] as string }] });
        i += m[0].length;
        continue;
      }
    }

    buf += c;
    i++;
  }
  flush();
  return out;
}

/** Parse inline markup, treating the end of `source` as the end of the reply. */
export function parseInline(source: string): Inline[] {
  return parseInlineImpl(source, true, 0);
}

// ---------------------------------------------------------------- blocks

type RawBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: "list"; ordered: boolean; start: number; items: { depth: number; text: string }[] }
  | { type: "codeBlock"; language: string | null; text: string }
  | { type: "quote"; text: string }
  | { type: "table"; rows: string[][] }
  | { type: "rule" };

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*)$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>[ ]?(.*)$/;
const LIST = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function isBlank(line: string): boolean {
  return line.trim() === "";
}

function fenceOpen(line: string): { char: string; len: number; language: string | null } | null {
  const m = FENCE.exec(line);
  if (!m) return null;
  const fence = m[1] as string;
  const info = (m[2] as string).trim();
  if (fence[0] === "`" && info.includes("`")) return null;
  return { char: fence[0] as string, len: fence.length, language: info.split(/\s+/)[0] || null };
}

function isTableStart(lines: string[], i: number): boolean {
  const next = lines[i + 1];
  return (
    next !== undefined &&
    (lines[i] as string).includes("|") &&
    next.includes("|") &&
    TABLE_SEP.test(next)
  );
}

function indentDepth(indent: string): number {
  let width = 0;
  for (const ch of indent) width += ch === "\t" ? 2 : 1;
  return Math.min(Math.floor(width / 2), 4);
}

function listStart(line: string): { ordered: boolean; num: number } | null {
  const m = LIST.exec(line);
  if (!m) return null;
  const marker = m[2] as string;
  const ordered = /\d/.test(marker[0] as string);
  return { ordered, num: ordered ? parseInt(marker, 10) : 1 };
}

/** Would this line start a block that interrupts a paragraph? */
function interruptsParagraph(lines: string[], i: number): boolean {
  const line = lines[i] as string;
  if (fenceOpen(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line)) return true;
  if (isTableStart(lines, i)) return true;
  const ls = listStart(line);
  return ls !== null && (!ls.ordered || ls.num === 1);
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let j = 0; j < s.length; j++) {
    const ch = s[j] as string;
    if (ch === "\\" && j + 1 < s.length) {
      cur += ch + s[j + 1];
      j++;
    } else if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

function scanBlocks(source: string): RawBlock[] {
  const lines = source.split(/\r?\n/);
  const blocks: RawBlock[] = [];
  let i = 0;

  for (; i < lines.length; ) {
    const line = lines[i] as string;
    if (isBlank(line)) {
      i++;
      continue;
    }

    const fence = fenceOpen(line);
    if (fence) {
      const body: string[] = [];
      let closed = false;
      i++;
      const closeRe = new RegExp(`^ {0,3}\\${fence.char}{${fence.len},}[ \\t]*$`);
      for (; i < lines.length; ) {
        if (closeRe.test(lines[i] as string)) {
          closed = true;
          i++;
          break;
        }
        body.push(lines[i] as string);
        i++;
      }
      if (!closed && body.length > 0) {
        // A partly-streamed closing fence ("``") is not code.
        const last = (body[body.length - 1] as string).trim();
        if (last !== "" && last.length < fence.len && [...last].every((ch) => ch === fence.char)) body.pop();
      }
      blocks.push({ type: "codeBlock", language: fence.language, text: body.join("\n") });
      continue;
    }

    const h = HEADING.exec(line);
    if (h) {
      const text = (h[2] as string).replace(/(^|[ \t]+)#+[ \t]*$/, "").trim();
      blocks.push({ type: "heading", level: (h[1] as string).length as 1 | 2 | 3 | 4 | 5 | 6, text });
      i++;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: "rule" });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const parts: string[] = [];
      for (; i < lines.length; ) {
        const q = QUOTE.exec(lines[i] as string);
        if (!q) break;
        parts.push(q[1] as string);
        i++;
      }
      blocks.push({ type: "quote", text: parts.join("\n") });
      continue;
    }

    if (isTableStart(lines, i)) {
      const rows = [splitRow(line)];
      i += 2;
      for (; i < lines.length && !isBlank(lines[i] as string) && (lines[i] as string).includes("|"); i++) {
        rows.push(splitRow(lines[i] as string));
      }
      blocks.push({ type: "table", rows });
      continue;
    }

    const ls = listStart(line);
    if (ls) {
      const items: { depth: number; text: string }[] = [];
      let start = ls.num;
      let first = true;
      for (; i < lines.length; ) {
        const cur = lines[i] as string;
        if (isBlank(cur)) {
          let j = i;
          for (; j < lines.length && isBlank(lines[j] as string); j++);
          const nl = j < lines.length ? listStart(lines[j] as string) : null;
          if (nl && nl.ordered === ls.ordered && !RULE.test(lines[j] as string)) {
            i = j;
            continue;
          }
          break;
        }
        const m = LIST.exec(cur);
        if (m && !RULE.test(cur)) {
          const item = listStart(cur) as { ordered: boolean; num: number };
          if (item.ordered !== ls.ordered) break;
          if (first) {
            start = item.num;
            first = false;
          }
          items.push({ depth: indentDepth(m[1] as string), text: m[3] as string });
          i++;
        } else if (!interruptsParagraph(lines, i) && items.length > 0) {
          (items[items.length - 1] as { text: string }).text += " " + cur.trim();
          i++;
        } else {
          break;
        }
      }
      blocks.push({ type: "list", ordered: ls.ordered, start, items });
      continue;
    }

    const parts = [line];
    i++;
    for (; i < lines.length && !isBlank(lines[i] as string) && !interruptsParagraph(lines, i); i++) {
      parts.push(lines[i] as string);
    }
    blocks.push({ type: "paragraph", text: parts.join("\n") });
  }
  return blocks;
}

function finalizeBlock(raw: RawBlock, streaming: boolean): Block {
  const inl = (text: string): Inline[] => parseInlineImpl(text, streaming, 0);
  switch (raw.type) {
    case "paragraph":
      return { type: "paragraph", children: inl(raw.text) };
    case "heading":
      return { type: "heading", level: raw.level, children: inl(raw.text) };
    case "quote":
      return { type: "quote", children: inl(raw.text) };
    case "list":
      return {
        type: "list",
        ordered: raw.ordered,
        start: raw.start,
        items: raw.items.map((it) => ({ depth: it.depth, children: inl(it.text) })),
      };
    case "table":
      return { type: "table", rows: raw.rows.map((row) => row.map((cell) => inl(cell))) };
    case "codeBlock":
      return raw;
    case "rule":
      return raw;
  }
}

/** Parse a whole reply. Never throws; the last block is treated as still streaming. */
export function parseMarkdown(source: string): Block[] {
  try {
    const raw = scanBlocks(source);
    return raw.map((b, idx) => finalizeBlock(b, idx === raw.length - 1));
  } catch {
    return source === "" ? [] : [{ type: "paragraph", children: [{ type: "text", text: source }] }];
  }
}

// ---------------------------------------------------------------- visible text

function inlineText(nodes: Inline[]): string {
  let s = "";
  for (const n of nodes) {
    s += n.type === "text" || n.type === "code" ? n.text : inlineText(n.children);
  }
  return s;
}

function blockText(b: Block): string {
  switch (b.type) {
    case "paragraph":
    case "heading":
    case "quote":
      return inlineText(b.children);
    case "list":
      return b.items
        .map((it, idx) => {
          const marker = b.ordered ? `${b.start + idx}. ` : "• ";
          return "  ".repeat(it.depth) + marker + inlineText(it.children);
        })
        .join("\n");
    case "codeBlock":
      return b.text;
    case "table":
      return b.rows.map((row) => row.map(inlineText).join("  ")).join("\n");
    case "rule":
      return "";
  }
}

/** The text a reader sees: no markup characters, links show only their label. */
export function visibleText(blocks: Block[]): string {
  return blocks.map(blockText).join("\n");
}
