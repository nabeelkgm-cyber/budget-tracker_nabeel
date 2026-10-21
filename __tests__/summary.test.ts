import dayjs from 'dayjs';
import { periodRange } from '@/domain/dateRanges';
import { formatPercent, savingsOf, savingsRatePercent } from '@/domain/summary';
import { monthRange } from '@/lib/dates';

describe('savings', () => {
  it('is income minus expense', () => {
    expect(savingsOf(1000000, 600000)).toBe(400000);
    expect(savingsOf(100000, 130000)).toBe(-30000);
  });
  it('rate is a percent of income with one decimal', () => {
    expect(savingsRatePercent(1000000, 600000)).toBe(40);
    expect(savingsRatePercent(300000, 100000)).toBe(66.7);
    expect(savingsRatePercent(100000, 130000)).toBe(-30);
  });
  it('rate is null with no income, and formats as a dash', () => {
    expect(savingsRatePercent(0, 5000)).toBeNull();
    expect(formatPercent(null)).toBe('-');
    expect(formatPercent(66.7)).toBe('66.7%');
  });
});

describe('date ranges', () => {
  const now = dayjs('2026-10-21');
  it('month range handles month ends and leap years', () => {
    expect(monthRange('2026-10-21')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(monthRange('2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
  it('periods', () => {
    expect(periodRange('this_month', now)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(periodRange('last_month', now)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(periodRange('last_3_months', now)).toEqual({ from: '2026-08-01', to: '2026-10-31' });
    expect(periodRange('this_year', now)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(periodRange('all', now)).toEqual({});
    expect(periodRange('custom', now, { from: '2026-03-01', to: '2026-03-15' })).toEqual({
      from: '2026-03-01',
      to: '2026-03-15',
    });
  });
  it('last month from January goes to the previous year', () => {
    expect(periodRange('last_month', dayjs('2027-01-05'))).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});
