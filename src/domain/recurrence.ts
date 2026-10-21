import dayjs from 'dayjs';
import { DATE_FMT } from '@/lib/dates';

export type Frequency = 'weekly' | 'monthly';

/** When a rule repeats. Monthly uses a day of the month (clamped in short months); weekly a weekday (0 = Sunday). */
export interface Schedule {
  frequency: Frequency;
  dayOfMonth: number | null;
  weekday: number | null;
}

/** Builds the schedule that makes `date` an occurrence. */
export function scheduleFromDate(frequency: Frequency, date: string): Schedule {
  const d = dayjs(date);
  return frequency === 'monthly'
    ? { frequency, dayOfMonth: d.date(), weekday: null }
    : { frequency, dayOfMonth: null, weekday: d.day() };
}

function monthlyOn(year: number, month: number, dayOfMonth: number): dayjs.Dayjs {
  const first = dayjs(new Date(year, month, 1));
  return first.date(Math.min(dayOfMonth, first.daysInMonth()));
}

/** The first occurrence strictly after `date`. */
export function nextAfter(schedule: Schedule, date: string): string {
  const d = dayjs(date);
  if (schedule.frequency === 'weekly') {
    const target = schedule.weekday ?? d.day();
    const ahead = ((target - d.day() + 7) % 7) || 7;
    return d.add(ahead, 'day').format(DATE_FMT);
  }
  const dom = schedule.dayOfMonth ?? d.date();
  const thisMonth = monthlyOn(d.year(), d.month(), dom);
  if (thisMonth.isAfter(d, 'day')) return thisMonth.format(DATE_FMT);
  const next = d.startOf('month').add(1, 'month');
  return monthlyOn(next.year(), next.month(), dom).format(DATE_FMT);
}

/** Occurrences in [from, to] inclusive, oldest first, at most `limit`. */
export function occurrencesBetween(schedule: Schedule, from: string, to: string, limit = 500): string[] {
  const out: string[] = [];
  let cur = firstOnOrAfter(schedule, from);
  while (cur <= to && out.length < limit) {
    out.push(cur);
    cur = nextAfter(schedule, cur);
  }
  return out;
}

export function firstOnOrAfter(schedule: Schedule, date: string): string {
  const before = dayjs(date).subtract(1, 'day').format(DATE_FMT);
  return nextAfter(schedule, before);
}

export interface ReminderRule {
  id: string;
  name: string;
  mode: 'auto' | 'remind';
  amountMinor: number;
  currency: string;
  nextDueDate: string;
  endDate: string | null;
  schedule: Schedule;
}

export interface PlannedReminder {
  /** Stable identifier: one reminder per rule per due date. */
  key: string;
  ruleId: string;
  date: string;
  title: string;
  body: string;
}

/**
 * Which due-date reminders to schedule on the phone: every occurrence from each rule's next
 * due date until `horizonDays` ahead, soonest first, capped (iOS keeps at most 64 pending).
 */
export function planReminders(
  rules: ReminderRule[],
  today: string,
  formatAmount: (minor: number, currency: string) => string,
  opts: { horizonDays?: number; maxTotal?: number } = {},
): PlannedReminder[] {
  const horizon = dayjs(today).add(opts.horizonDays ?? 60, 'day').format(DATE_FMT);
  const out: PlannedReminder[] = [];
  for (const r of rules) {
    const to = r.endDate && r.endDate < horizon ? r.endDate : horizon;
    const from = r.nextDueDate > today ? r.nextDueDate : today;
    for (const date of occurrencesBetween(r.schedule, from, to, 30)) {
      if (date < r.nextDueDate) continue;
      const amount = formatAmount(r.amountMinor, r.currency);
      out.push({
        key: `rule:${r.id}:${date}`,
        ruleId: r.id,
        date,
        title: r.mode === 'auto' ? `${r.name} is due today` : `Time to pay: ${r.name}`,
        body:
          r.mode === 'auto'
            ? `${amount}. It will be added automatically when you open the app.`
            : `${amount}. Open the app to add it to your transactions.`,
      });
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  return out.slice(0, opts.maxTotal ?? 60);
}

const ORDINALS = (n: number) => {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
};
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Every month on the 5th" / "Every Friday" */
export function describeSchedule(s: Schedule): string {
  if (s.frequency === 'weekly') return `Every ${WEEKDAYS[s.weekday ?? 0]}`;
  const dom = s.dayOfMonth ?? 1;
  return dom >= 29 ? `Every month on the ${ORDINALS(dom)} (or the last day)` : `Every month on the ${ORDINALS(dom)}`;
}
