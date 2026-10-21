/**
 * All money is held as integer minor units (fils / paise = 1/100).
 * Every currency supported by the app has 2 decimals, so MINOR = 100.
 * Exchange rates are integers scaled by 1e8 and multiplied with BigInt,
 * so no floating point is ever used on an amount.
 */
export const MINOR = 100;
export const RATE_SCALE = 100_000_000n;

/** Parse "1,234.56" -> 123456. Returns null if invalid or has more than 2 decimals. */
export function parseAmountToMinor(input: string): number | null {
  const s = input.replace(/[,\s]/g, '');
  if (!/^\d*\.?\d*$/.test(s) || !/\d/.test(s)) return null;
  const [whole = '', frac = ''] = s.split('.');
  if (frac.length > 2) return null;
  const minor = Number(whole || '0') * MINOR + Number(frac.padEnd(2, '0') || '0');
  return Number.isSafeInteger(minor) ? minor : null;
}

/** 123456 -> "1234.56" (no grouping; used to fill input fields). */
export function minorToInput(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / MINOR)}.${String(abs % MINOR).padStart(2, '0')}`;
}

/** 123456, "QAR" -> "QAR 1,234.56"; negatives -> "-QAR 1,234.56". */
export function formatMinor(minor: number, currency: string): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const whole = String(Math.floor(abs / MINOR)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${currency} ${whole}.${String(abs % MINOR).padStart(2, '0')}`;
}

function bigAbs(n: bigint): bigint {
  return n < 0n ? -n : n;
}

/** amount * rate / 1e8, rounded half away from zero. */
export function convertMinor(amountMinor: number, rateE8: number): number {
  const product = BigInt(amountMinor) * BigInt(rateE8);
  const q = (bigAbs(product) + RATE_SCALE / 2n) / RATE_SCALE;
  return Number(product < 0n ? -q : q);
}

/** Parse a decimal like "0.0413" into an e8-scaled integer (max 8 decimals). */
export function parseRateToE8(input: string): number | null {
  const s = input.replace(/[,\s]/g, '');
  if (!/^\d*\.?\d*$/.test(s) || !/\d/.test(s)) return null;
  const [whole = '', frac = ''] = s.split('.');
  if (frac.length > 8) return null;
  const e8 = BigInt(whole || '0') * RATE_SCALE + BigInt(frac.padEnd(8, '0') || '0');
  return e8 > 0n && e8 <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(e8) : null;
}

/**
 * "1 QAR = 24.2 INR" -> value of 1 INR in QAR, e8-scaled.
 * Users think in "foreign units per QAR"; storage is "QAR per foreign unit".
 */
export function foreignPerBaseToRateE8(input: string): number | null {
  const x = parseRateToE8(input);
  if (x === null) return null;
  const r = (RATE_SCALE * RATE_SCALE + BigInt(x) / 2n) / BigInt(x);
  return r > 0n ? Number(r) : null;
}

/** Inverse of foreignPerBaseToRateE8, as a display string with 4 decimals. */
export function rateE8ToForeignPerBase(rateE8: number): string {
  const x = (RATE_SCALE * RATE_SCALE + BigInt(rateE8) / 2n) / BigInt(rateE8); // e8-scaled
  const scaled = (x + 5000n) / 10000n; // 4 decimals
  return `${scaled / 10000n}.${String(scaled % 10000n).padStart(4, '0')}`;
}
