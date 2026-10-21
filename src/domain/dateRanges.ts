import dayjs, { Dayjs } from 'dayjs';
import { DATE_FMT } from '@/lib/dates';

export type PeriodKey = 'all' | 'this_month' | 'last_month' | 'last_3_months' | 'this_year' | 'custom';

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  all: 'All time',
  this_month: 'This month',
  last_month: 'Last month',
  last_3_months: 'Last 3 months',
  this_year: 'This year',
  custom: 'Custom',
};

export interface DateRange {
  from?: string;
  to?: string;
}

/** Inclusive date range (YYYY-MM-DD) for a period. "Last 3 months" includes the current month. */
export function periodRange(key: PeriodKey, now: Dayjs = dayjs(), custom: DateRange = {}): DateRange {
  const f = (d: Dayjs) => d.format(DATE_FMT);
  switch (key) {
    case 'this_month':
      return { from: f(now.startOf('month')), to: f(now.endOf('month')) };
    case 'last_month': {
      const m = now.subtract(1, 'month');
      return { from: f(m.startOf('month')), to: f(m.endOf('month')) };
    }
    case 'last_3_months':
      return { from: f(now.subtract(2, 'month').startOf('month')), to: f(now.endOf('month')) };
    case 'this_year':
      return { from: f(now.startOf('year')), to: f(now.endOf('year')) };
    case 'custom':
      return custom;
    default:
      return {};
  }
}
