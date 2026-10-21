import dayjs from 'dayjs';

export const DATE_FMT = 'YYYY-MM-DD';

export const today = (): string => dayjs().format(DATE_FMT);

export function addDays(date: string, days: number): string {
  return dayjs(date).add(days, 'day').format(DATE_FMT);
}

/** "2026-10-21" -> "Wed, 21 Oct 2026" */
export function prettyDate(date: string): string {
  return dayjs(date).format('ddd, D MMM YYYY');
}

/** Parse YYYY-MM-DD as a local-time Date (avoids UTC shift). */
export function toLocalDate(date: string): Date {
  return dayjs(date).toDate();
}

export function fromLocalDate(d: Date): string {
  return dayjs(d).format(DATE_FMT);
}

/** First and last day (inclusive) of the month containing `date`. */
export function monthRange(date: string): { from: string; to: string } {
  const d = dayjs(date);
  return { from: d.startOf('month').format(DATE_FMT), to: d.endOf('month').format(DATE_FMT) };
}

/** "2026-10-21" -> "October 2026" */
export const monthLabel = (date: string): string => dayjs(date).format('MMMM YYYY');
