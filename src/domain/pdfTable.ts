import { detectColumns } from './statement';

/** One piece of text from a PDF page, with its position (PDF units: y grows upwards). */
export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
}

interface Cell {
  text: string;
  x0: number;
  x1: number;
}

const LINE_TOLERANCE = 3; // items whose heights differ by less than this are on the same line
const CELL_GAP = 7; // a gap wider than this starts a new column

function groupLines(items: PdfTextItem[]): PdfTextItem[][] {
  const sorted = items.filter((i) => i.str.trim() !== '').sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PdfTextItem[][] = [];
  let lineY = Number.NaN;
  for (const it of sorted) {
    if (lines.length === 0 || Math.abs(it.y - lineY) > LINE_TOLERANCE) {
      lines.push([it]);
      lineY = it.y;
    } else {
      lines[lines.length - 1].push(it);
    }
  }
  return lines.map((line) => line.sort((a, b) => a.x - b.x));
}

/** Joins neighbouring pieces of a line into cells wherever the gap between them is small. */
function mergeCells(line: PdfTextItem[]): Cell[] {
  const cells: Cell[] = [];
  for (const it of line) {
    const last = cells[cells.length - 1];
    const text = it.str.trim();
    if (last && it.x - last.x1 < CELL_GAP) {
      last.text += (it.x - last.x1 > 0.5 ? ' ' : '') + text;
      last.x1 = Math.max(last.x1, it.x + it.width);
    } else {
      cells.push({ text, x0: it.x, x1: it.x + it.width });
    }
  }
  return cells;
}

/** The column whose span (widened a little) overlaps the cell most, or else the nearest one. */
function columnFor(cell: Cell, anchors: Cell[]): number {
  let best = -1;
  let bestOverlap = 0;
  anchors.forEach((a, i) => {
    const overlap = Math.min(cell.x1, a.x1 + 6) - Math.max(cell.x0, a.x0 - 6);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = i;
    }
  });
  if (best >= 0) return best;
  const centre = (cell.x0 + cell.x1) / 2;
  let nearest = 0;
  let dist = Infinity;
  anchors.forEach((a, i) => {
    const d = Math.abs((a.x0 + a.x1) / 2 - centre);
    if (d < dist) {
      dist = d;
      nearest = i;
    }
  });
  return nearest;
}

/**
 * Turns the text of a PDF statement into a table like the one read from a CSV or Excel file:
 * the header row first, then one row per transaction with every value in its own column.
 * Returns null when no table header (Date, Description, Debit/Credit/Amount...) can be found.
 *
 * Handled: columns found from the header's position, headers repeated on every page, descriptions that wrap
 * onto several lines, and lines before the table (account details) or after it (totals).
 */
export function pdfItemsToGrid(pages: PdfTextItem[][]): string[][] | null {
  const lines = pages.flatMap((p) => groupLines(p));
  const mergedLines = lines.map(mergeCells);

  // First line that looks like the table header.
  let headerIdx = -1;
  let columns: ReturnType<typeof detectColumns> = null;
  for (let i = 0; i < lines.length; i++) {
    const m = detectColumns([mergedLines[i].map((c) => c.text)]);
    if (m && m.columns.date !== undefined && Object.keys(m.columns).length >= 3) {
      headerIdx = i;
      columns = m;
      break;
    }
  }
  if (headerIdx < 0 || !columns) return null;

  const anchors = mergedLines[headerIdx];
  const header = anchors.map((a) => a.text);
  const headerText = header.join('|').toLowerCase();
  const dateCol = columns.columns.date as number;
  const descCol = columns.columns.description;
  const moneyCols = [columns.columns.debit, columns.columns.credit, columns.columns.amount, columns.columns.balance].filter(
    (c): c is number => c !== undefined,
  );

  const rows: string[][] = [header];
  for (let li = headerIdx + 1; li < lines.length; li++) {
    if (mergedLines[li].map((c) => c.text).join('|').toLowerCase() === headerText) continue; // header repeated on a new page
    // Each piece of text goes to the column it sits under; pieces in the same column are then joined.
    const row = anchors.map(() => '');
    for (const it of lines[li]) {
      const col = columnFor({ text: it.str.trim(), x0: it.x, x1: it.x + it.width }, anchors);
      const text = it.str.trim();
      row[col] = row[col] ? `${row[col]} ${text}` : text;
    }
    const prev = rows.length > 1 ? rows[rows.length - 1] : null;
    const isContinuation = !row[dateCol] && moneyCols.every((c) => !row[c]);
    if (isContinuation && prev && descCol !== undefined && row[descCol]) {
      prev[descCol] = `${prev[descCol]} ${row[descCol]}`.trim(); // a wrapped description
    } else {
      rows.push(row);
    }
  }
  return rows;
}
