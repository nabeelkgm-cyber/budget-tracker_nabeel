import { decimalsOf } from './currencies';
import type { ParsedSms } from './sms';
import type { StatementItem } from './statement';
import { formatMinor, parseAmountToMinor } from './money';

/** "1250.00" in INR -> "INR 1,250.00" (or the plain text if it does not fit the currency). */
export function displayAmount(amountText: string, currency: string): string {
  const minor = parseAmountToMinor(amountText, currency);
  return minor === null ? `${currency} ${amountText}` : formatMinor(minor, currency);
}

export interface ConvertedItem {
  accountId: string;
  date: string;
  description: string;
  direction: 'debit' | 'credit';
  amountMinor: number;
  reference: string | null;
  balanceMinor: number | null;
  raw: string;
}

export interface ConvertResult {
  items: ConvertedItem[];
  problems: { line: number; message: string }[];
}

/** Statement lines -> inbox items in the account's own currency. Amounts with too many decimals are reported. */
export function convertStatementItems(items: StatementItem[], accountId: string, currency: string): ConvertResult {
  const out: ConvertResult = { items: [], problems: [] };
  for (const s of items) {
    const amountMinor = parseAmountToMinor(s.amountText, currency);
    if (amountMinor === null || amountMinor <= 0) {
      out.problems.push({ line: s.line, message: `Amount ${s.amountText} does not fit ${currency} (${decimalsOf(currency)} decimals).` });
      continue;
    }
    out.items.push({
      accountId,
      date: s.date,
      description: s.description,
      direction: s.direction,
      amountMinor,
      reference: s.reference,
      balanceMinor: s.balanceText ? parseAmountToMinor(s.balanceText, currency) : null,
      raw: s.raw,
    });
  }
  return out;
}

/** A parsed SMS -> an inbox item. `fallbackDate` is used when the message has no date. */
export function convertSms(sms: ParsedSms, accountId: string, currency: string, fallbackDate: string): ConvertedItem | { error: string } {
  if (sms.currency && sms.currency !== currency) {
    return { error: `The message is in ${sms.currency} but this account is in ${currency}.` };
  }
  const amountMinor = parseAmountToMinor(sms.amountText, currency);
  if (amountMinor === null || amountMinor <= 0) return { error: `Amount ${sms.amountText} does not fit ${currency}.` };
  return {
    accountId,
    date: sms.date ?? fallbackDate,
    description: sms.merchant ?? 'Bank message',
    direction: sms.direction,
    amountMinor,
    reference: sms.reference,
    balanceMinor: sms.balanceText ? parseAmountToMinor(sms.balanceText, currency) : null,
    raw: sms.raw,
  };
}
