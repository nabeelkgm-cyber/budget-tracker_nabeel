export type CsvCell = string | number | null | undefined;

const NEEDS_QUOTES = /[",\r\n]/;
/** Excel treats cells starting with these as formulas. */
const FORMULA_START = /^[=+\-@]/;

/**
 * Text that a spreadsheet could run as a formula (a bank note like "=1+1") gets a leading
 * apostrophe, which `unprotectCell` removes again on import.
 */
export function protectCell(text: string): string {
  return FORMULA_START.test(text) && !/^[+-]?\d+(\.\d+)?$/.test(text) ? `'${text}` : text;
}

export function unprotectCell(text: string): string {
  return /^'[=+\-@]/.test(text) ? text.slice(1) : text;
}

function cell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'number' ? String(value) : protectCell(value);
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows -> CSV text with Windows line endings (what Excel expects). */
export function toCsv(rows: CsvCell[][]): string {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Picks the separator used by the first line: comma, semicolon or tab (Excel in some regions uses ;). */
export function detectDelimiter(text: string): string {
  const first = text.replace(/^﻿/, '').split(/\r\n|\n|\r/, 1)[0] ?? '';
  let best = ',';
  let bestCount = 0;
  for (const d of [',', ';', '\t']) {
    // Ignore separators inside quotes.
    let inQuotes = false;
    let count = 0;
    for (const ch of first) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === d && !inQuotes) count++;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Reads CSV: quoted fields, doubled quotes, commas and line breaks inside quotes, any line
 * ending, a leading byte-order mark. Completely empty lines are skipped.
 */
export function parseCsv(text: string, delimiter: string = detectDelimiter(text)): string[][] {
  const src = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };

  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
      i++;
    } else if (ch === delimiter) {
      endField();
      i++;
    } else if (ch === '\r') {
      endRow();
      i += src[i + 1] === '\n' ? 2 : 1;
    } else if (ch === '\n') {
      endRow();
      i++;
    } else {
      field += ch;
      i++;
    }
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}
