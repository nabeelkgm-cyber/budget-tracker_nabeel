/**
 * The currencies the app knows, and which one is the "base" (the currency of budgets,
 * reports and totals). The base is chosen once, at first setup.
 */
export interface CatalogCurrency {
  code: string;
  name: string;
  country: string;
  /** Digits after the decimal point: 2 for most, 3 for OMR / KWD / BHD. */
  minorUnits: number;
  /** Indicative market level, in units per 1 USD x 10,000. Only used for starting rates. */
  unitsPerUsdX10k: number;
  /** Can be chosen as the base (reporting) currency. */
  gcc: boolean;
}

export const CATALOG: CatalogCurrency[] = [
  { code: 'QAR', name: 'Qatari Riyal', country: 'Qatar', minorUnits: 2, unitsPerUsdX10k: 36400, gcc: true },
  { code: 'SAR', name: 'Saudi Riyal', country: 'Saudi Arabia', minorUnits: 2, unitsPerUsdX10k: 37500, gcc: true },
  { code: 'AED', name: 'UAE Dirham', country: 'United Arab Emirates', minorUnits: 2, unitsPerUsdX10k: 36725, gcc: true },
  { code: 'OMR', name: 'Omani Rial', country: 'Oman', minorUnits: 3, unitsPerUsdX10k: 3845, gcc: true },
  { code: 'KWD', name: 'Kuwaiti Dinar', country: 'Kuwait', minorUnits: 3, unitsPerUsdX10k: 3070, gcc: true },
  { code: 'BHD', name: 'Bahraini Dinar', country: 'Bahrain', minorUnits: 3, unitsPerUsdX10k: 3760, gcc: true },
  { code: 'INR', name: 'Indian Rupee', country: 'India', minorUnits: 2, unitsPerUsdX10k: 881000, gcc: false },
];

export const GCC_CURRENCIES = CATALOG.filter((c) => c.gcc);
export const catalogEntry = (code: string): CatalogCurrency | undefined => CATALOG.find((c) => c.code === code);

/**
 * Starting exchange rate, as base-currency value of 1 major unit of `code`, scaled by 1e8.
 * These are only placeholders: the user sets real rates in Settings.
 */
export function defaultRateE8(code: string, base: string): number {
  if (code === base) return 100_000_000;
  const c = catalogEntry(code);
  const b = catalogEntry(base);
  if (!c || !b) return 100_000_000;
  return Math.round((100_000_000 * b.unitsPerUsdX10k) / c.unitsPerUsdX10k);
}

// ---- live settings, loaded from the database when the app starts ----

let baseCurrency = 'QAR';
let decimals: Record<string, number> = Object.fromEntries(CATALOG.map((c) => [c.code, c.minorUnits]));

export function setCurrencyRegistry(base: string, minorUnits: Record<string, number>): void {
  baseCurrency = base;
  decimals = { ...Object.fromEntries(CATALOG.map((c) => [c.code, c.minorUnits])), ...minorUnits };
}

export const getBaseCurrency = (): string => baseCurrency;

/** Known currency codes that use exactly `d` decimals. */
export const currenciesWithDecimals = (d: number): string[] =>
  CATALOG.map((c) => c.code).filter((code) => decimalsOf(code) === d);
export const decimalsOf = (code: string): number => decimals[code] ?? catalogEntry(code)?.minorUnits ?? 2;
