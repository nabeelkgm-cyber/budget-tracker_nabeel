import {
  convertMinor,
  foreignPerBaseToRateE8,
  formatMinor,
  minorToInput,
  parseAmountToMinor,
  parseRateToE8,
  rateE8ToForeignPerBase,
} from '@/domain/money';

describe('parseAmountToMinor', () => {
  it.each([
    ['12', 1200],
    ['12.5', 1250],
    ['1,234.56', 123456],
    ['.99', 99],
    ['0.07', 7],
    ['19.99', 1999],
  ])('%s -> %i', (input, expected) => expect(parseAmountToMinor(input)).toBe(expected));

  it.each(['', 'abc', '12.345', '1.2.3', '-5', '.'])('rejects %p', (input) =>
    expect(parseAmountToMinor(input)).toBeNull(),
  );
});

describe('format', () => {
  it('formats with grouping and sign', () => {
    expect(formatMinor(123456, 'QAR')).toBe('QAR 1,234.56');
    expect(formatMinor(-5, 'INR')).toBe('-INR 0.05');
    expect(formatMinor(100000000, 'QAR')).toBe('QAR 1,000,000.00');
  });
  it('round-trips to input text', () => {
    expect(minorToInput(123456)).toBe('1234.56');
    expect(parseAmountToMinor(minorToInput(7))).toBe(7);
  });
});

describe('convertMinor', () => {
  it('converts INR to QAR with integer maths', () => {
    // INR 24,100.00 at 0.0413 QAR/INR = QAR 995.33
    expect(convertMinor(2_410_000, 4_130_000)).toBe(99533);
  });
  it('is identity at rate 1', () => {
    expect(convertMinor(123456, 100_000_000)).toBe(123456);
  });
  it('rounds half away from zero', () => {
    expect(convertMinor(1, 50_000_000)).toBe(1); // 0.5 -> 1
    expect(convertMinor(-1, 50_000_000)).toBe(-1);
    expect(convertMinor(1, 49_999_999)).toBe(0);
  });
  it('does not overflow on large amounts', () => {
    expect(convertMinor(9_000_000_000_000, 100_000_000)).toBe(9_000_000_000_000);
  });
});

describe('rates', () => {
  it('parses decimals to e8', () => {
    expect(parseRateToE8('0.0413')).toBe(4_130_000);
    expect(parseRateToE8('1')).toBe(100_000_000);
    expect(parseRateToE8('0.123456789')).toBeNull();
    expect(parseRateToE8('0')).toBeNull();
  });
  it('converts "1 QAR = X INR" to QAR per INR', () => {
    expect(foreignPerBaseToRateE8('24.2')).toBe(4_132_231);
    expect(foreignPerBaseToRateE8('0')).toBeNull();
  });
  it('shows INR per QAR with 4 decimals', () => {
    expect(rateE8ToForeignPerBase(4_132_231)).toBe('24.2000');
    expect(rateE8ToForeignPerBase(100_000_000)).toBe('1.0000');
  });
});
