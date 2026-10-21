/**
 * Reading bank statements: amounts and dates in the many formats banks use, finding the right
 * columns, and cleaning merchant names. Everything here is pure and tested.
 */

export interface ParsedAmount {
  /** Digits with a decimal point, never negative, e.g. "1234.56". */
  value: string;
  /** -1 debit-like (minus sign, brackets, Dr), +1 credit-like (Cr / plus), 0 unknown. */
  sign: -1 | 0 | 1;
}

const CURRENCY_NOISE = /(?:rs\.?|inr|qar|qr|sar|aed|omr|kwd|bhd|usd|₹|\$|\bcurrency\b)/gi;

/**
 * "1,23,456.78", "(1,200.00)", "-500", "500.00 Dr", "Rs. 1,000", "1 234,50" -> {value, sign}.
 * Indian grouping and comma decimals are understood. Null if there is no number.
 */
export function parseAmountText(input: string): ParsedAmount | null {
  let s = input.trim();
  if (!s) return null;
  let sign: -1 | 0 | 1 = 0;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  if (/\bdr\.?$/i.test(s) || /^dr\b/i.test(s)) sign = -1;
  if (/\bcr\.?$/i.test(s) || /^cr\b/i.test(s)) sign = 1;
  s = s.replace(/\b(dr|cr)\.?/gi, '').replace(CURRENCY_NOISE, '').trim();
  if (s.startsWith('-') || s.endsWith('-')) sign = -1;
  else if (s.startsWith('+')) sign = sign === 0 ? 1 : sign;
  s = s.replace(/[+\-\s]/g, '');
  if (!/^\d[\d.,]*$/.test(s) && !/^[.,]\d+$/.test(s)) return null;

  // Decide which of "," and "." is the decimal mark: the last one, if followed by 1-3 digits and
  // the other mark (if any) comes earlier. "1,234" with no other mark is thousands.
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let decimalAt = -1;
  if (lastDot >= 0 && lastComma >= 0) decimalAt = Math.max(lastDot, lastComma);
  else if (lastDot >= 0) decimalAt = s.length - lastDot - 1 <= 3 && s.split('.').length === 2 ? lastDot : -1;
  else if (lastComma >= 0) decimalAt = s.length - lastComma - 1 <= 2 && s.split(',').length === 2 ? lastComma : -1;
  const whole = (decimalAt >= 0 ? s.slice(0, decimalAt) : s).replace(/[.,]/g, '') || '0';
  const frac = decimalAt >= 0 ? s.slice(decimalAt + 1) : '';
  if (!/^\d*$/.test(frac)) return null;
  return { value: frac ? `${whole}.${frac}` : whole, sign };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const iso = (y: number, m: number, d: number): string | null => {
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};
const fullYear = (y: number): number => (y < 100 ? 2000 + y : y);

/**
 * Dates as banks print them, day first: 2026-10-21, 21/10/2026, 21-10-26, 21.10.2026,
 * 21 Oct 2026, 21-Oct-26, 21OCT26, "Oct 21, 2026". Any time of day is ignored. Null if not a date.
 */
export function parseStatementDate(input: string): string | null {
  const s = input.trim().replace(/\s+/g, ' ');
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2}|\d{4})(?:[ T,].*)?$/.exec(s);
  if (m) return iso(fullYear(Number(m[3])), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})[-/. ]?([A-Za-z]{3,9})[-/. ,]*(\d{2}|\d{4})(?:[ T,].*)?$/.exec(s);
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    return mi >= 0 ? iso(fullYear(Number(m[3])), mi + 1, Number(m[1])) : null;
  }
  m = /^([A-Za-z]{3,9})[ .]+(\d{1,2}),?[ ]+(\d{4})$/.exec(s);
  if (m) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    return mi >= 0 ? iso(Number(m[3]), mi + 1, Number(m[2])) : null;
  }
  return null;
}

// ───────────── Finding the columns ─────────────

export type StatementField = 'date' | 'description' | 'debit' | 'credit' | 'amount' | 'balance' | 'reference' | 'drcr';

export interface ColumnMapping {
  /** 0-based index of the header row in the file. */
  headerRow: number;
  columns: Partial<Record<StatementField, number>>;
}

const HEADER_HINTS: Record<StatementField, RegExp> = {
  date: /^(?:txn\.?|transaction|posting|post|value|trans\.?)?\s*date$|^date\b|\bdate\b/i,
  description: /description|narration|particulars|details|remarks|transaction detail|payee|merchant/i,
  debit: /\bdebit|withdraw|\bdr\b|paid out|money out/i,
  credit: /\bcredit|deposit|\bcr\b|paid in|money in/i,
  amount: /^amount|\bamount\b|\bamt\b/i,
  balance: /balance|\bbal\b/i,
  reference: /ref|chq|cheque|utr|rrn|transaction id|txn id/i,
  drcr: /^(?:dr\/?cr|cr\/?dr|type|debit\/credit)$/i,
};

function scoreHeader(row: string[]): { columns: Partial<Record<StatementField, number>>; score: number } {
  const columns: Partial<Record<StatementField, number>> = {};
  // Order matters: more specific fields first so "Debit Amount" is a debit, not an amount.
  for (const field of ['drcr', 'debit', 'credit', 'balance', 'reference', 'date', 'description', 'amount'] as StatementField[]) {
    const idx = row.findIndex((cell, i) => cell && HEADER_HINTS[field].test(cell.trim()) && !Object.values(columns).includes(i));
    if (idx >= 0) columns[field] = idx;
  }
  const hasMoney = columns.amount !== undefined || columns.debit !== undefined || columns.credit !== undefined;
  const score = columns.date !== undefined && hasMoney ? Object.keys(columns).length : 0;
  return { columns, score };
}

/** Bank files often start with account details; this finds the real header row. Null if none. */
export function detectColumns(rows: string[][]): ColumnMapping | null {
  let best: ColumnMapping | null = null;
  let bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const { columns, score } = scoreHeader(rows[i]);
    if (score > bestScore) {
      best = { headerRow: i, columns };
      bestScore = score;
    }
  }
  return best;
}

// ───────────── Turning rows into items ─────────────

export interface StatementItem {
  /** 1-based line number in the file, for messages. */
  line: number;
  date: string;
  description: string;
  direction: 'debit' | 'credit';
  /** Digits with decimal point, positive. Converted to minor units by the caller using the account's decimals. */
  amountText: string;
  balanceText: string | null;
  reference: string | null;
  raw: string;
}

export interface ExtractResult {
  items: StatementItem[];
  /** Rows that were not transactions (totals, opening balance, blank) with the reason. */
  skipped: { line: number; reason: string }[];
}

const NOT_A_TRANSACTION = /opening balance|closing balance|brought forward|carried forward|total|statement|page \d/i;

/** Reads the rows below the header using a column mapping. */
export function extractStatementItems(rows: string[][], mapping: ColumnMapping): ExtractResult {
  const c = mapping.columns;
  const out: ExtractResult = { items: [], skipped: [] };
  const cell = (row: string[], f: StatementField): string => (c[f] === undefined ? '' : (row[c[f]!] ?? '').trim());

  for (let i = mapping.headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    const line = i + 1;
    if (row.every((x) => !x.trim())) continue;
    const date = parseStatementDate(cell(row, 'date'));
    const description = cell(row, 'description').replace(/\s+/g, ' ');
    if (!date) {
      if (NOT_A_TRANSACTION.test(row.join(' '))) out.skipped.push({ line, reason: 'not a transaction' });
      else if (row.some((x) => x.trim())) out.skipped.push({ line, reason: 'no valid date' });
      continue;
    }
    if (NOT_A_TRANSACTION.test(description) && !cell(row, 'amount') && !cell(row, 'debit') && !cell(row, 'credit')) {
      out.skipped.push({ line, reason: 'not a transaction' });
      continue;
    }

    let direction: 'debit' | 'credit' | null = null;
    let amount: ParsedAmount | null = null;
    const debit = c.debit !== undefined ? parseAmountText(cell(row, 'debit')) : null;
    const credit = c.credit !== undefined ? parseAmountText(cell(row, 'credit')) : null;
    const hasDebit = !!debit && Number(debit.value) > 0;
    const hasCredit = !!credit && Number(credit.value) > 0;
    if (hasDebit && !hasCredit) [direction, amount] = ['debit', debit];
    else if (hasCredit && !hasDebit) [direction, amount] = ['credit', credit];
    else if (hasDebit && hasCredit) {
      out.skipped.push({ line, reason: 'both debit and credit filled in' });
      continue;
    } else if (c.amount !== undefined) {
      amount = parseAmountText(cell(row, 'amount'));
      if (amount) {
        const marker = cell(row, 'drcr').toLowerCase();
        if (/^(dr|d|debit|db)/.test(marker)) direction = 'debit';
        else if (/^(cr|c|credit)/.test(marker)) direction = 'credit';
        else if (amount.sign === -1) direction = 'debit';
        else if (amount.sign === 1) direction = 'credit';
        // Unmarked positive amount: statements list money out as positive, so treat as debit unless told otherwise.
        else direction = 'debit';
      }
    }
    if (!amount || !direction || Number(amount.value) <= 0) {
      out.skipped.push({ line, reason: 'no amount' });
      continue;
    }
    const bal = c.balance !== undefined ? parseAmountText(cell(row, 'balance')) : null;
    out.items.push({
      line,
      date,
      description: description || '(no description)',
      direction,
      amountText: amount.value,
      balanceText: bal ? bal.value : null,
      reference: cell(row, 'reference') || null,
      raw: row.join(' | '),
    });
  }
  return out;
}

// ───────────── Merchant names ─────────────

const NOISE_WORDS = new Set([
  'pos', 'upi', 'neft', 'imps', 'rtgs', 'atm', 'purchase', 'debit', 'credit', 'card', 'visa', 'mastercard', 'master',
  'payment', 'paid', 'to', 'from', 'by', 'txn', 'transaction', 'ref', 'no', 'trf', 'transfer', 'dr', 'cr', 'int',
  'online', 'ecom', 'wdl', 'cash', 'withdrawal', 'ach', 'mob', 'mobile', 'bank', 'a/c', 'ac', 'qa', 'in', 'doha', 'qatar',
]);

/**
 * Reduces a bank description to the merchant, so "POS 4111XXXX1234 LULU HYPERMARKET DOHA" and
 * "LULU HYPERMARKET 21/10" give the same key. Used to remember categories.
 */
export function merchantKey(description: string): string {
  let text = description.toUpperCase();
  // UPI style: UPI/DR/301234567890/SWIGGY/YESB/... -> use the first readable segment
  if (text.includes('/')) {
    const seg = text
      .split('/')
      .map((p) => p.trim())
      .find((p) => /[A-Z]{3,}/.test(p) && !/^\d/.test(p) && !NOISE_WORDS.has(p.toLowerCase()) && !/^(YESB|HDFC|ICIC|SBIN|UTIB|FDRL|PUNB|BARB|KKBK)\b/.test(p));
    if (seg) text = seg;
  }
  const words = text
    .replace(/[^A-Z0-9 &'.@]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !/\d/.test(w.replace(/[&'.@]/g, '')) && !NOISE_WORDS.has(w.toLowerCase()) && !/^[X*]+$/.test(w) && w.length > 1);
  return words.slice(0, 3).join(' ').trim() || description.toUpperCase().replace(/\s+/g, ' ').slice(0, 30);
}
