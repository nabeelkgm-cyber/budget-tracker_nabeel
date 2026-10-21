import { decimalsOf, getBaseCurrency } from './currencies';

/**
 * All money is held as integer minor units: 1/100 of the currency for most (fils, paise),
 * 1/1000 for OMR, KWD and BHD (baisa, fils). Amounts are never floats.
 * Exchange rates are integers scaled by 1e8 and multiplied with BigInt.
 * Functions take a currency code so the right number of decimals is used; with no code they
 * use the base currency.
 */

/** Minor units per major unit for 2-decimal currencies (used by the QAR sample data). */
export const MINOR = 100;
export const RATE_SCALE = 100_000_000n;

const pow10 = (d: number): number => 10 ** d;
const big10 = (d: number): bigint => 10n ** BigInt(d);

/** Parse "1,234.56" -> 123456 (or "1,234.567" -> 1234567 for a 3-decimal currency). Null if invalid. */
export function parseAmountToMinor(input: string, currency: string = getBaseCurrency()): number | null {
  const d = decimalsOf(currency);
  const s = input.replace(/[,\s]/g, '');
  if (!/^\d*\.?\d*$/.test(s) || !/\d/.test(s)) return null;
  const [whole = '', frac = ''] = s.split('.');
  if (frac.length > d) return null;
  const minor = Number(whole || '0') * pow10(d) + Number(frac.padEnd(d, '0') || '0');
  return Number.isSafeInteger(minor) ? minor : null;
}

/** 123456 -> "1234.56" (no grouping; used to fill input fields). */
export function minorToInput(minor: number, currency: string = getBaseCurrency()): string {
  const d = decimalsOf(currency);
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / pow10(d))}.${String(abs % pow10(d)).padStart(d, '0')}`;
}

/** Placeholder text for an empty amount field: "0.00", or "0.000" for OMR, KWD and BHD. */
export const zeroText = (currency: string = getBaseCurrency()): string => minorToInput(0, currency);

/** 123456, "QAR" -> "QAR 1,234.56"; negatives -> "-QAR 1,234.56". */
export function formatMinor(minor: number, currency: string): string {
  const d = decimalsOf(currency);
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const whole = String(Math.floor(abs / pow10(d))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${currency} ${whole}.${String(abs % pow10(d)).padStart(d, '0')}`;
}

function bigAbs(n: bigint): bigint {
  return n < 0n ? -n : n;
}

/**
 * Converts an amount in `fromCurrency` minor units to `toCurrency` minor units (default: the base).
 * `rateE8` is the base-currency value of 1 major unit of the from-currency, x1e8.
 * Rounds half away from zero.
 */
export function convertMinor(
  amountMinor: number,
  rateE8: number,
  fromCurrency: string = getBaseCurrency(),
  toCurrency: string = getBaseCurrency(),
): number {
  const numerator = BigInt(amountMinor) * BigInt(rateE8) * big10(decimalsOf(toCurrency));
  const denominator = RATE_SCALE * big10(decimalsOf(fromCurrency));
  const q = (bigAbs(numerator) + denominator / 2n) / denominator;
  return Number(numerator < 0n ? -q : q);
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
 * Users think in "foreign units per base unit"; storage is "base per foreign unit".
 */
export function foreignPerBaseToRateE8(input: string): number | null {
  const x = parseRateToE8(input);
  if (x === null) return null;
  const r = (RATE_SCALE * RATE_SCALE + BigInt(x) / 2n) / BigInt(x);
  return r > 0n ? Number(r) : null;
}

function fixed(scaled: bigint, digits: number): string {
  const p = big10(digits);
  return `${scaled / p}.${String(scaled % p).padStart(digits, '0')}`;
}

/** Inverse of foreignPerBaseToRateE8, as a display string (4 decimals by default). */
export function rateE8ToForeignPerBase(rateE8: number, digits = 4): string {
  const x = (RATE_SCALE * RATE_SCALE + BigInt(rateE8) / 2n) / BigInt(rateE8); // e8-scaled
  const drop = big10(8 - digits);
  return fixed((x + drop / 2n) / drop, digits);
}

/** Like rateE8ToForeignPerBase, but shows 6 decimals when the number is below 1 (e.g. 0.084337). */
export function rateE8ToForeignPerBaseAuto(rateE8: number): string {
  const four = rateE8ToForeignPerBase(rateE8, 4);
  return Number(four) < 1 ? rateE8ToForeignPerBase(rateE8, 6) : four;
}

export interface ImpliedRate {
  /** e.g. "1 QAR = 24.1000 INR" */
  label: string;
  /** The number in the label. */
  value: string;
  /** The currency quoted per unit of the first currency in the label. */
  foreignCurrency: string;
}

/** numerator / denominator with `digits` decimals, rounded half up. */
function ratio(numerator: bigint, denominator: bigint, digits: number): string {
  const scaled = (numerator * big10(digits) + denominator / 2n) / denominator;
  return fixed(scaled, digits);
}

/** 4 decimals, or 6 when the result is below 1. */
function adaptiveRatio(numerator: bigint, denominator: bigint): string {
  const four = ratio(numerator, denominator, 4);
  return Number(four) < 1 ? ratio(numerator, denominator, 6) : four;
}

/**
 * The exchange rate you actually got on a cross-currency transfer, in the form people quote it:
 * "1 <base> = X <other>". If neither side is the base currency, it is "1 <from> = X <to>".
 * Accounts for currencies with different numbers of decimals.
 */
export function impliedRate(
  fromMinor: number,
  fromCurrency: string,
  toMinor: number,
  toCurrency: string,
  baseCurrency: string,
): ImpliedRate | null {
  if (fromMinor <= 0 || toMinor <= 0 || fromCurrency === toCurrency) return null;
  const fromMajorScale = big10(decimalsOf(fromCurrency));
  const toMajorScale = big10(decimalsOf(toCurrency));
  if (toCurrency === baseCurrency) {
    // other-per-base = (from major) / (to major)
    const v = adaptiveRatio(BigInt(fromMinor) * toMajorScale, BigInt(toMinor) * fromMajorScale);
    return { label: `1 ${baseCurrency} = ${v} ${fromCurrency}`, value: v, foreignCurrency: fromCurrency };
  }
  const v = adaptiveRatio(BigInt(toMinor) * fromMajorScale, BigInt(fromMinor) * toMajorScale);
  return { label: `1 ${fromCurrency} = ${v} ${toCurrency}`, value: v, foreignCurrency: toCurrency };
}
