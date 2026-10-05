/**
 * Pure layout decision for markdown tables (FR29). Two columns or fewer read
 * fine as an aligned grid; three or more are too wide for a phone, so each
 * body row becomes a card of heading/value pairs. Cell content is passed
 * through as Inline[] so the renderer formats it (bold, links, code).
 */

import type { Inline } from "./markdown";

export type CardLine = { heading: Inline[]; value: Inline[] };

export type TableLayout =
  | { kind: "grid"; header: Inline[][]; rows: Inline[][][] }
  | { kind: "cards"; cards: CardLine[][] };

/**
 * Exactly `columns` cells: missing ones empty, surplus appended to the last.
 * parseMarkdown already yields header-width rows (fitRow in markdown.ts joins with " | "),
 * so this path is defensive and joins the same way.
 */
function normaliseRow(row: Inline[][], columns: number): Inline[][] {
  const cells: Inline[][] = [];
  for (let c = 0; c < columns; c++) cells.push(row[c] ?? []);
  if (columns > 0) {
    for (let c = columns; c < row.length; c++) {
      cells[columns - 1] = [
        ...(cells[columns - 1] ?? []),
        { type: "text", text: " | " },
        ...(row[c] ?? []),
      ];
    }
  }
  return cells;
}

export function tableLayout(rows: Inline[][][]): TableLayout {
  const headerRow = rows[0] ?? [];
  const columns = headerRow.length;
  const header = normaliseRow(headerRow, columns);
  const body = rows.slice(1).map((r) => normaliseRow(r, columns));
  if (columns <= 2) return { kind: "grid", header, rows: body };
  return {
    kind: "cards",
    cards: body.map((r) =>
      r.map((value, c) => ({ heading: header[c] ?? [], value })),
    ),
  };
}

/*
 * Width of a 2-column grid on the phone (M10c3-C4). The assistant bubble in
 * app/chat.tsx shrink-wraps its content (alignSelf "flex-start", maxWidth
 * "85%"), and grid cells are flex: 1 (flexBasis 0), so a grid with no width of
 * its own measures ~0 wide and the bubble collapses to a strip. Giving the grid
 * the bubble's inner width makes the bubble open to its max width and the two
 * cells split it equally. Mirrors chat.tsx: messagesContent padding 16,
 * message maxWidth 85% and padding 12 (markdownText.test.ts pins those).
 */
const SCREEN_PADDING = 16;
const BUBBLE_MAX_FRACTION = 0.85;
const BUBBLE_PADDING = 12;

export function gridWidth(windowWidth: number): number {
  const inner = (windowWidth - 2 * SCREEN_PADDING) * BUBBLE_MAX_FRACTION - 2 * BUBBLE_PADDING;
  return Math.max(0, Math.floor(inner));
}
