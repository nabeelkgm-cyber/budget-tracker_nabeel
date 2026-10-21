import dayjs from 'dayjs';

/** Months are 'YYYY-MM' strings. Budgets and actuals are integer minor units of the base currency. */
export const MONTH_FMT = 'YYYY-MM';

export const currentMonth = (): string => dayjs().format(MONTH_FMT);
export const prevMonth = (month: string): string => dayjs(`${month}-01`).subtract(1, 'month').format(MONTH_FMT);
export const nextMonth = (month: string): string => dayjs(`${month}-01`).add(1, 'month').format(MONTH_FMT);
export const monthTitle = (month: string): string => dayjs(`${month}-01`).format('MMMM YYYY');
export const monthOf = (date: string): string => date.slice(0, 7);

export interface BudgetLine {
  amountMinor: number;
  rollover: boolean;
}

const MAX_CHAIN = 120;

/**
 * Unused budget carried into `month` for one category.
 *
 * Only applies when this month's budget has rollover switched on. The carry is last month's
 * available amount (its budget plus its own carry) minus what was spent, and never below zero:
 * overspending is not carried forward. A month with no budget carries nothing.
 */
export function carryIn(
  month: string,
  budgets: Map<string, BudgetLine>,
  actuals: Map<string, number>,
  depth = MAX_CHAIN,
): number {
  const line = budgets.get(month);
  if (!line || !line.rollover || depth <= 0) return 0;
  const prev = prevMonth(month);
  const prevLine = budgets.get(prev);
  if (!prevLine) return 0;
  const available = prevLine.amountMinor + carryIn(prev, budgets, actuals, depth - 1);
  return Math.max(0, available - (actuals.get(prev) ?? 0));
}

export type BudgetState = 'ok' | 'warn' | 'over';

export interface BudgetStatus {
  amountMinor: number;
  carryInMinor: number;
  /** Budget plus carry-in. */
  availableMinor: number;
  spentMinor: number;
  /** Negative when overspent. */
  remainingMinor: number;
  /** Whole-number percent of the available amount spent. */
  pct: number;
  state: BudgetState;
}

/** Integer-only threshold checks (no rounding surprises at exactly 80% or 100%). */
export const reached80 = (spent: number, available: number): boolean => spent * 5 >= available * 4;
export const reached100 = (spent: number, available: number): boolean => spent >= available;

export function budgetStatus(amountMinor: number, carryInMinor: number, spentMinor: number): BudgetStatus {
  const available = amountMinor + carryInMinor;
  return {
    amountMinor,
    carryInMinor,
    availableMinor: available,
    spentMinor,
    remainingMinor: available - spentMinor,
    pct: available > 0 ? Math.round((spentMinor * 100) / available) : 0,
    state: reached100(spentMinor, available) ? 'over' : reached80(spentMinor, available) ? 'warn' : 'ok',
  };
}
