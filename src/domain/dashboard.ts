import dayjs from 'dayjs';

export interface MonthProgress {
  daysInMonth: number;
  /** Days gone including today (0 for a future month, all of them for a past month). */
  daysElapsed: number;
  /** Days still to come including today. */
  daysLeft: number;
  isCurrent: boolean;
  isPast: boolean;
  /** 0-100 */
  pctElapsed: number;
}

/** How far through `month` ("YYYY-MM") we are on `todayDate` ("YYYY-MM-DD"). */
export function monthProgress(month: string, todayDate: string): MonthProgress {
  const first = dayjs(`${month}-01`);
  const daysInMonth = first.daysInMonth();
  const todayMonth = todayDate.slice(0, 7);
  const isCurrent = todayMonth === month;
  const isPast = month < todayMonth;
  const daysElapsed = isCurrent ? dayjs(todayDate).date() : isPast ? daysInMonth : 0;
  return {
    daysInMonth,
    daysElapsed,
    daysLeft: isCurrent ? daysInMonth - daysElapsed + 1 : isPast ? 0 : daysInMonth,
    isCurrent,
    isPast,
    pctElapsed: Math.round((daysElapsed * 100) / daysInMonth),
  };
}

export type PaceStatus = 'on-track' | 'tight' | 'over' | 'none';

export interface Pace {
  remainingMinor: number;
  /** What can still be spent each remaining day without exceeding the budget (0 when none left). */
  safePerDayMinor: number;
  /** Month-end spending if the pace so far continues (equals spent for a finished month). */
  projectedMinor: number;
  status: PaceStatus;
}

/**
 * Planning figures from what is budgeted and what is spent so far.
 *  - on-track: projected to finish at most 95% of the budget
 *  - tight: projected to finish within the budget
 *  - over: already over, or projected to go over
 */
export function paceOf(availableMinor: number, spentMinor: number, p: MonthProgress): Pace {
  if (availableMinor <= 0) return { remainingMinor: 0, safePerDayMinor: 0, projectedMinor: spentMinor, status: 'none' };
  const remainingMinor = availableMinor - spentMinor;
  const projectedMinor = p.isCurrent && p.daysElapsed > 0 ? Math.round((spentMinor / p.daysElapsed) * p.daysInMonth) : spentMinor;
  const daysLeft = p.isCurrent ? p.daysInMonth - p.daysElapsed + 1 : 0;
  const safePerDayMinor = p.isCurrent && remainingMinor > 0 && daysLeft > 0 ? Math.floor(remainingMinor / daysLeft) : 0;
  const status: PaceStatus =
    spentMinor > availableMinor || projectedMinor > availableMinor ? 'over' : projectedMinor > availableMinor * 0.95 ? 'tight' : 'on-track';
  return { remainingMinor, safePerDayMinor, projectedMinor, status };
}

export interface NetBreakdown {
  /** Cash and bank balances (base currency). */
  assetsMinor: number;
  /** Credit card balances owed, as a positive number. */
  cardsOwedMinor: number;
  /** Loans owed, as a positive number. */
  loansOwedMinor: number;
  netMinor: number;
}

/** Splits all accounts into what you have and what you owe, converted to the base currency by `toBase`. */
export function netBreakdown(
  accounts: { type: string; balance_minor: number; currency: string }[],
  toBase: (amountMinor: number, currency: string) => number,
): NetBreakdown {
  let assets = 0;
  let cards = 0;
  let loans = 0;
  for (const a of accounts) {
    const v = toBase(a.balance_minor, a.currency);
    if (a.type === 'credit_card') cards += v;
    else if (a.type === 'loan') loans += v;
    else assets += v;
  }
  // Cards and loans normally hold negative balances (owed); a positive balance reduces what is owed to zero side.
  return {
    assetsMinor: assets,
    cardsOwedMinor: -cards,
    loansOwedMinor: -loans,
    netMinor: assets + cards + loans,
  };
}

/** Average of income minus expense over the months that have any activity; null when there are none. */
export function averageMonthlySaving(series: { incomeMinor: number; expenseMinor: number }[]): number | null {
  const used = series.filter((s) => s.incomeMinor > 0 || s.expenseMinor > 0);
  if (used.length === 0) return null;
  return Math.round(used.reduce((sum, s) => sum + (s.incomeMinor - s.expenseMinor), 0) / used.length);
}

export const SAVINGS_TARGET_PCT = 20;
