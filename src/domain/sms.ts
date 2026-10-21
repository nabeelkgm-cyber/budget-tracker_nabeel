import { parseStatementDate } from './statement';

export interface ParsedSms {
  /** Digits with decimal point, e.g. "1250.00". */
  amountText: string;
  /** ISO code if the message names one (QAR, INR...). */
  currency: string | null;
  direction: 'debit' | 'credit';
  /** Last 4 digits of the card or account, used to pick the account. */
  last4: string | null;
  /** YYYY-MM-DD, or null if the message has no readable date. */
  date: string | null;
  merchant: string | null;
  reference: string | null;
  balanceText: string | null;
  raw: string;
}

const CURRENCY_CODES = 'QAR|QR|SAR|AED|OMR|KWD|BHD|INR';
const AMOUNT_RE = new RegExp(
  `(?:\\b(${CURRENCY_CODES})\\b|Rs\\.?|₹)\\s*([0-9][0-9,]*(?:\\.[0-9]{1,3})?)|([0-9][0-9,]*(?:\\.[0-9]{1,3})?)\\s*(${CURRENCY_CODES})\\b`,
  'i',
);
const BALANCE_RE = /\b(?:avl\.?\s*(?:bal(?:ance)?|lmt|limit)|available\s+(?:balance|limit|credit)|total\s+(?:bal(?:ance)?|outstanding)|current\s+balance|closing\s+balance|bal(?:ance)?\s*[:\-])/i;
const PROMO_RE = /\b(cashback|offer|discount|win|reward|coupon|apply now|click|emi offer|pre-?approved)\b|https?:|www\./i;
const STRONG_RE = /\b(debited|credited|spent|withdrawn|deposited|received|refund(?:ed)?|transferred)\b/i;
const DEBIT_RE = /\b(debited|spent|purchase[ds]?|withdrawn|withdrawal|paid|payment|sent|charged|used|deducted|debit)\b/i;
const CREDIT_RE = /\b(credited|received|deposited|deposit|refund(?:ed)?|reversed|reversal|credit)\b/i;

const normCurrency = (c: string | null | undefined): string | null => {
  if (!c) return null;
  const u = c.toUpperCase();
  return u === 'QR' ? 'QAR' : u;
};

/** Splits pasted text into separate messages (blank lines between them). */
export function splitMessages(text: string): string[] {
  return text
    .split(/\n\s*\n+/)
    .map((m) => m.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * Reads one bank/card SMS. Returns null for messages that are not a debit or credit alert
 * (OTP codes, offers, balance-only messages).
 *
 * The patterns cover common wording from Gulf and Indian banks; every bank words things a little
 * differently, so the result is always shown for review before anything is saved.
 */
export function parseSms(raw: string): ParsedSms | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return null;

  // Everything after "Avl Bal ..." describes the account, not the transaction.
  const balAt = text.search(BALANCE_RE);
  const main = balAt > 12 ? text.slice(0, balAt) : text;
  const tail = balAt > 12 ? text.slice(balAt) : '';

  if (PROMO_RE.test(main) && !STRONG_RE.test(main)) return null;
  const am = AMOUNT_RE.exec(main);
  if (!am) return null;
  const currency = normCurrency(am[1] ?? am[4]) ?? (/\bRs\.?|₹/i.test(am[0]) ? 'INR' : null);
  const amountText = (am[2] ?? am[3]).replace(/,/g, '');
  if (!(Number(amountText) > 0)) return null;

  const d = DEBIT_RE.exec(main);
  const c = CREDIT_RE.exec(main);
  if (!d && !c) return null;
  const direction: 'debit' | 'credit' = d && (!c || d.index < c.index) ? 'debit' : 'credit';

  let last4: string | null = null;
  const l1 = /(?:card|a\/c|acct?|account|\bac\b)\b[^0-9]{0,25}(?:x+|\*+|#)?\s*(\d{4})\b/i.exec(main);
  const l2 = /(?:x{2,}|\*{2,}|\bx)\s*(\d{4})\b/i.exec(main);
  last4 = l1?.[1] ?? l2?.[1] ?? null;

  const dm = /(\d{4}-\d{2}-\d{2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}[- ]?[A-Za-z]{3,9}[-, ]*\d{2,4})/.exec(main);
  const date = dm ? parseStatementDate(dm[1]) : null;

  let merchant: string | null = null;
  const merchantRe = /\b(?:at|to|from|towards|merchant|vpa|info[:\-]?)\s+([A-Za-z0-9][A-Za-z0-9&.@_' \-]{2,40}?)(?=\s+(?:on|dated|ref|avl|available|bal|upi|if|not|call|using|via|with|for|is|has)\b|[.,;(]|\s*$)/gi;
  let m: RegExpExecArray | null;
  while ((m = merchantRe.exec(main))) {
    const candidate = m[1].trim().replace(/^(?:vpa|merchant|info)\s+/i, '');
    if (/^(?:a\/c|acct?|account|card|your|my|the|x+|\*+|\d)/i.test(candidate)) {
      merchantRe.lastIndex = m.index + 1; // look again inside this phrase ("from your account ... at SHELL")
      continue;
    }
    merchant = candidate;
    break;
  }

  const refM = /(?:ref(?:erence)?\s*(?:no\.?|number)?|utr|rrn|txn\s*(?:id|no)?)[\s:.#-]*([A-Za-z0-9]{6,})/i.exec(main);

  let balanceText: string | null = null;
  if (tail) {
    const bm = AMOUNT_RE.exec(tail);
    if (bm) balanceText = (bm[2] ?? bm[3]).replace(/,/g, '');
  }

  return { amountText, currency, direction, last4, date, merchant, reference: refM?.[1] ?? null, balanceText, raw: text };
}
