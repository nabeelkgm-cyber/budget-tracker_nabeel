import {
  BudgetLine,
  budgetStatus,
  carryIn,
  monthOf,
  nextMonth,
  prevMonth,
  reached100,
  reached80,
} from '@/domain/budget';

const line = (amountMinor: number, rollover = false): BudgetLine => ({ amountMinor, rollover });
const b = (entries: Record<string, BudgetLine>) => new Map(Object.entries(entries));
const a = (entries: Record<string, number>) => new Map(Object.entries(entries));

describe('months', () => {
  it('moves across year ends', () => {
    expect(prevMonth('2026-01')).toBe('2025-12');
    expect(nextMonth('2026-12')).toBe('2027-01');
    expect(monthOf('2026-10-21')).toBe('2026-10');
  });
});

describe('thresholds use exact integer maths', () => {
  it('80% is reached at exactly 80 and not at 79.99', () => {
    expect(reached80(80000, 100000)).toBe(true);
    expect(reached80(79999, 100000)).toBe(false);
  });
  it('100% is reached at exactly the budget', () => {
    expect(reached100(100000, 100000)).toBe(true);
    expect(reached100(99999, 100000)).toBe(false);
  });
});

describe('budgetStatus', () => {
  it('ok / warn / over with remaining and percent', () => {
    expect(budgetStatus(100000, 0, 50000)).toMatchObject({ pct: 50, remainingMinor: 50000, state: 'ok' });
    expect(budgetStatus(100000, 0, 85000)).toMatchObject({ pct: 85, state: 'warn' });
    expect(budgetStatus(100000, 0, 100000)).toMatchObject({ pct: 100, remainingMinor: 0, state: 'over' });
    expect(budgetStatus(100000, 0, 125000)).toMatchObject({ pct: 125, remainingMinor: -25000, state: 'over' });
  });
  it('carry-in raises what is available', () => {
    expect(budgetStatus(100000, 40000, 120000)).toMatchObject({ availableMinor: 140000, remainingMinor: 20000, state: 'warn' });
  });
});

describe('carryIn (rollover)', () => {
  it('carries last month unused amount when rollover is on', () => {
    expect(carryIn('2026-10', b({ '2026-09': line(100000), '2026-10': line(100000, true) }), a({ '2026-09': 60000 }))).toBe(40000);
  });
  it('carries nothing when rollover is off', () => {
    expect(carryIn('2026-10', b({ '2026-09': line(100000), '2026-10': line(100000) }), a({ '2026-09': 60000 }))).toBe(0);
  });
  it('does not carry an overspend', () => {
    expect(carryIn('2026-10', b({ '2026-09': line(100000), '2026-10': line(100000, true) }), a({ '2026-09': 130000 }))).toBe(0);
  });
  it('carries nothing when last month has no budget', () => {
    expect(carryIn('2026-10', b({ '2026-10': line(100000, true) }), a({}))).toBe(0);
  });
  it('chains over several months and stops where rollover is off', () => {
    const budgets = b({
      '2026-07': line(100000), // no rollover: start of the chain
      '2026-08': line(100000, true),
      '2026-09': line(100000, true),
      '2026-10': line(100000, true),
    });
    const actuals = a({ '2026-07': 0, '2026-08': 70000, '2026-09': 50000, '2026-10': 0 });
    // Aug: Jul's 100000 unused carries in.
    expect(carryIn('2026-08', budgets, actuals)).toBe(100000);
    // Sep: Aug available (100000 + 100000) minus 70000 spent = 130000.
    expect(carryIn('2026-09', budgets, actuals)).toBe(130000);
    // Oct: Sep available (100000 + 130000) minus 50000 spent = 180000.
    expect(carryIn('2026-10', budgets, actuals)).toBe(180000);
  });
  it('a month with rollover off breaks the chain for the following month', () => {
    const budgets = b({ '2026-08': line(100000, true), '2026-09': line(100000, false), '2026-10': line(100000, true) });
    // Sep itself has no carry-in, so only Sep's own unused amount (100000 - 20000) rolls to Oct.
    expect(carryIn('2026-10', budgets, a({ '2026-08': 0, '2026-09': 20000 }))).toBe(80000);
  });
});
