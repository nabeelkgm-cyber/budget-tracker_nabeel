import dayjs from 'dayjs';
import { DATE_FMT } from '@/lib/dates';

export type ReportPeriod =
  | { mode: 'month'; month: string } // 'YYYY-MM'
  | { mode: 'year'; year: number }
  | { mode: 'range'; from: string; to: string };

const MAX_BAR_MONTHS = 24;

/** Inclusive date bounds (YYYY-MM-DD) of a period. */
export function periodBounds(p: ReportPeriod): { from: string; to: string } {
  switch (p.mode) {
    case 'month': {
      const d = dayjs(`${p.month}-01`);
      return { from: d.format(DATE_FMT), to: d.endOf('month').format(DATE_FMT) };
    }
    case 'year':
      return { from: `${p.year}-01-01`, to: `${p.year}-12-31` };
    case 'range':
      return p.from <= p.to ? { from: p.from, to: p.to } : { from: p.to, to: p.from };
  }
}

/** The period of the same kind and length immediately before this one. */
export function previousPeriod(p: ReportPeriod): ReportPeriod {
  switch (p.mode) {
    case 'month':
      return { mode: 'month', month: dayjs(`${p.month}-01`).subtract(1, 'month').format('YYYY-MM') };
    case 'year':
      return { mode: 'year', year: p.year - 1 };
    case 'range': {
      const { from, to } = periodBounds(p);
      const days = dayjs(to).diff(dayjs(from), 'day') + 1;
      return {
        mode: 'range',
        from: dayjs(from).subtract(days, 'day').format(DATE_FMT),
        to: dayjs(from).subtract(1, 'day').format(DATE_FMT),
      };
    }
  }
}

/** Move to the previous (-1) or next (+1) month or year. A range does not move. */
export function shiftPeriod(p: ReportPeriod, delta: 1 | -1): ReportPeriod {
  if (p.mode === 'month') {
    return { mode: 'month', month: dayjs(`${p.month}-01`).add(delta, 'month').format('YYYY-MM') };
  }
  if (p.mode === 'year') return { mode: 'year', year: p.year + delta };
  return p;
}

export function periodLabel(p: ReportPeriod): string {
  switch (p.mode) {
    case 'month':
      return dayjs(`${p.month}-01`).format('MMMM YYYY');
    case 'year':
      return String(p.year);
    case 'range': {
      const { from, to } = periodBounds(p);
      return `${dayjs(from).format('D MMM YYYY')} - ${dayjs(to).format('D MMM YYYY')}`;
    }
  }
}

/** Months shown on the bar chart: 12 ending at the month, the 12 of the year, or the range (last 24 at most). */
export function seriesMonths(p: ReportPeriod): string[] {
  let first: dayjs.Dayjs;
  let last: dayjs.Dayjs;
  if (p.mode === 'month') {
    last = dayjs(`${p.month}-01`);
    first = last.subtract(11, 'month');
  } else {
    const { from, to } = periodBounds(p);
    first = dayjs(from).startOf('month');
    last = dayjs(to).startOf('month');
    if (p.mode === 'range' && last.diff(first, 'month') + 1 > MAX_BAR_MONTHS) {
      first = last.subtract(MAX_BAR_MONTHS - 1, 'month');
    }
  }
  const out: string[] = [];
  for (let m = first; !m.isAfter(last, 'month'); m = m.add(1, 'month')) out.push(m.format('YYYY-MM'));
  return out;
}

/** Percent change from `previous` to `current`; null when there is nothing to compare with. */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) * 1000) / previous) / 10;
}
