import { averageMonthlySaving, monthProgress, netBreakdown, paceOf } from '@/domain/dashboard';

describe('monthProgress', () => {
  it('counts days gone including today in the current month', () => {
    const p = monthProgress('2026-10', '2026-10-23');
    expect(p).toMatchObject({ daysInMonth: 31, daysElapsed: 23, daysLeft: 9, isCurrent: true, isPast: false, pctElapsed: 74 });
  });
  it('treats earlier months as finished and later months as not started', () => {
    expect(monthProgress('2026-09', '2026-10-23')).toMatchObject({ daysElapsed: 30, daysLeft: 0, isPast: true, pctElapsed: 100 });
    expect(monthProgress('2026-11', '2026-10-23')).toMatchObject({ daysElapsed: 0, daysLeft: 30, isCurrent: false, isPast: false });
  });
  it('knows February', () => {
    expect(monthProgress('2027-02', '2027-02-14')).toMatchObject({ daysInMonth: 28, daysElapsed: 14, pctElapsed: 50 });
  });
});

describe('paceOf', () => {
  const mid = monthProgress('2026-10', '2026-10-16'); // 16 of 31 days gone, 16 left
  it('works out a safe daily amount for the days left', () => {
    const r = paceOf(310000, 150000, mid);
    expect(r.remainingMinor).toBe(160000);
    expect(r.safePerDayMinor).toBe(10000); // 1,600.00 over 16 days
  });
  it('projects month-end spending from the pace so far', () => {
    const r = paceOf(310000, 155000, mid);
    expect(r.projectedMinor).toBe(300313); // 155,000 / 16 * 31
    expect(r.status).toBe('tight'); // inside the budget but above 95% of it
  });
  it('is on track when the projection stays well inside the budget', () => {
    expect(paceOf(500000, 100000, mid).status).toBe('on-track');
  });
  it('is over when already over, or when the pace will go over', () => {
    expect(paceOf(100000, 120000, mid)).toMatchObject({ status: 'over', safePerDayMinor: 0 });
    expect(paceOf(300000, 250000, mid).status).toBe('over'); // projects to 484,375
  });
  it('for a finished month the projection is simply what was spent', () => {
    const past = monthProgress('2026-09', '2026-10-23');
    expect(paceOf(100000, 90000, past)).toMatchObject({ projectedMinor: 90000, safePerDayMinor: 0, status: 'on-track' });
  });
  it('has no status without a budget', () => {
    expect(paceOf(0, 5000, mid).status).toBe('none');
  });
});

describe('netBreakdown', () => {
  it('splits assets from cards and loans and converts currencies', () => {
    const toBase = (amount: number, currency: string) => (currency === 'INR' ? Math.round(amount * 0.04) : amount);
    const r = netBreakdown(
      [
        { type: 'bank', balance_minor: 100000, currency: 'QAR' },
        { type: 'cash', balance_minor: 20000, currency: 'QAR' },
        { type: 'bank', balance_minor: 1000000, currency: 'INR' },
        { type: 'credit_card', balance_minor: -30000, currency: 'QAR' },
        { type: 'loan', balance_minor: -500000, currency: 'QAR' },
      ],
      toBase,
    );
    expect(r).toEqual({ assetsMinor: 160000, cardsOwedMinor: 30000, loansOwedMinor: 500000, netMinor: -370000 });
  });
});

describe('averageMonthlySaving', () => {
  it('averages only months with activity', () => {
    expect(
      averageMonthlySaving([
        { incomeMinor: 0, expenseMinor: 0 },
        { incomeMinor: 500000, expenseMinor: 400000 },
        { incomeMinor: 500000, expenseMinor: 300000 },
      ]),
    ).toBe(150000);
    expect(averageMonthlySaving([])).toBeNull();
  });
});
