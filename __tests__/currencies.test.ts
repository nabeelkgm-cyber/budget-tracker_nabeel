import {
  CATALOG,
  GCC_CURRENCIES,
  decimalsOf,
  defaultRateE8,
  getBaseCurrency,
  setCurrencyRegistry,
} from '@/domain/currencies';
import {
  convertMinor,
  foreignPerBaseToRateE8,
  formatMinor,
  impliedRate,
  minorToInput,
  parseAmountToMinor,
  rateE8ToForeignPerBaseAuto,
} from '@/domain/money';

afterEach(() => setCurrencyRegistry('QAR', {}));

describe('catalog', () => {
  it('offers the six GCC currencies as base options, and INR for conversions', () => {
    expect(GCC_CURRENCIES.map((c) => c.code)).toEqual(['QAR', 'SAR', 'AED', 'OMR', 'KWD', 'BHD']);
    expect(CATALOG.find((c) => c.code === 'INR')!.gcc).toBe(false);
  });
  it('OMR, KWD and BHD have 3 decimals; the rest have 2', () => {
    for (const c of ['OMR', 'KWD', 'BHD']) expect(decimalsOf(c)).toBe(3);
    for (const c of ['QAR', 'SAR', 'AED', 'INR']) expect(decimalsOf(c)).toBe(2);
    expect(decimalsOf('XYZ')).toBe(2); // unknown: safe default
  });
});

describe('starting rates', () => {
  it('base against itself is exactly 1', () => {
    for (const c of CATALOG) expect(defaultRateE8(c.code, c.code)).toBe(100_000_000);
  });
  it('GCC pegs cross correctly', () => {
    expect(defaultRateE8('SAR', 'QAR') / 1e8).toBeCloseTo(3.64 / 3.75, 5);
    expect(defaultRateE8('AED', 'SAR') / 1e8).toBeCloseTo(3.75 / 3.6725, 5);
    expect(defaultRateE8('OMR', 'QAR') / 1e8).toBeCloseTo(3.64 / 0.3845, 4);
  });
  it('INR is about 24 per QAR and 23 per SAR', () => {
    expect(1e8 / defaultRateE8('INR', 'QAR')).toBeCloseTo(24.2, 0);
    expect(1e8 / defaultRateE8('INR', 'SAR')).toBeCloseTo(23.5, 0);
  });
});

describe('3-decimal amounts', () => {
  it('parse, edit and format with three decimals', () => {
    expect(parseAmountToMinor('1.250', 'OMR')).toBe(1250);
    expect(parseAmountToMinor('12', 'KWD')).toBe(12000);
    expect(parseAmountToMinor('0.005', 'BHD')).toBe(5);
    expect(parseAmountToMinor('1.2345', 'OMR')).toBeNull();
    expect(parseAmountToMinor('1.25', 'OMR')).toBe(1250);
    expect(minorToInput(1250, 'OMR')).toBe('1.250');
    expect(minorToInput(-5, 'BHD')).toBe('-0.005');
    expect(formatMinor(1250, 'OMR')).toBe('OMR 1.250');
    expect(formatMinor(1234567, 'KWD')).toBe('KWD 1,234.567');
    expect(formatMinor(-5, 'BHD')).toBe('-BHD 0.005');
  });
  it('2-decimal currencies are unchanged, and a 2-decimal currency rejects a third decimal', () => {
    expect(parseAmountToMinor('1.25', 'SAR')).toBe(125);
    expect(parseAmountToMinor('1.255', 'SAR')).toBeNull();
    expect(formatMinor(123456, 'AED')).toBe('AED 1,234.56');
  });
  it('with no currency, uses the base currency', () => {
    setCurrencyRegistry('OMR', {});
    expect(getBaseCurrency()).toBe('OMR');
    expect(parseAmountToMinor('2.5')).toBe(2500);
    expect(minorToInput(2500)).toBe('2.500');
  });
});

describe('conversion between currencies with different decimals', () => {
  it('INR (2 decimals) to an OMR base (3 decimals)', () => {
    const rate = defaultRateE8('INR', 'OMR');
    // INR 24,100.00 -> about OMR 105.181
    expect(convertMinor(2_410_000, rate, 'INR', 'OMR')).toBe(105_181);
  });
  it('OMR to a QAR base', () => {
    const rate = defaultRateE8('OMR', 'QAR'); // about 9.4668 QAR per OMR
    expect(convertMinor(1000, rate, 'OMR', 'QAR')).toBe(947); // OMR 1.000 -> QAR 9.47
  });
  it('same currency at rate 1 is the identity for 2 and 3 decimals', () => {
    expect(convertMinor(123456, 100_000_000, 'QAR', 'QAR')).toBe(123456);
    expect(convertMinor(1234567, 100_000_000, 'KWD', 'KWD')).toBe(1234567);
  });
  it('rounds half away from zero in the target decimals', () => {
    expect(convertMinor(1, 50_000_000, 'KWD', 'KWD')).toBe(1); // 0.5 baisa -> 1
    expect(convertMinor(-1, 50_000_000, 'KWD', 'KWD')).toBe(-1);
  });
  it('2-decimal to 2-decimal matches the old behaviour', () => {
    expect(convertMinor(2_410_000, 4_130_000, 'INR', 'QAR')).toBe(99_533);
  });
});

describe('implied rate across decimals', () => {
  it('base OMR sending, INR receiving: "1 OMR = 229 INR"', () => {
    const r = impliedRate(100_000, 'OMR', 2_290_000, 'INR', 'OMR')!; // OMR 100.000 -> INR 22,900.00
    expect(r.label).toBe('1 OMR = 229.0000 INR');
  });
  it('INR sending, OMR base receiving gives the same quote', () => {
    expect(impliedRate(2_290_000, 'INR', 100_000, 'OMR', 'OMR')!.label).toBe('1 OMR = 229.0000 INR');
  });
  it('quotes small rates with six decimals (QAR base, KWD)', () => {
    const r = impliedRate(100_000, 'QAR', 8_430, 'KWD', 'QAR')!; // QAR 1,000.00 -> KWD 8.430
    expect(r.label).toBe('1 QAR = 0.008430 KWD');
  });
});

describe('rate display', () => {
  it('shows four decimals normally and six when below one', () => {
    expect(rateE8ToForeignPerBaseAuto(foreignPerBaseToRateE8('24.2')!)).toBe('24.2000');
    expect(rateE8ToForeignPerBaseAuto(foreignPerBaseToRateE8('0.0843')!)).toBe('0.084300');
  });
});
