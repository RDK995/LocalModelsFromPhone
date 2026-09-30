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
