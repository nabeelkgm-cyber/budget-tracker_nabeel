import { firstOnOrAfter, nextAfter, occurrencesBetween, planReminders, scheduleFromDate } from '@/domain/recurrence';

const monthly = (dom: number) => ({ frequency: 'monthly' as const, dayOfMonth: dom, weekday: null });
const weekly = (wd: number) => ({ frequency: 'weekly' as const, dayOfMonth: null, weekday: wd });

describe('schedules', () => {
  it('derives the schedule from a date', () => {
    expect(scheduleFromDate('monthly', '2026-10-31')).toEqual(monthly(31));
    expect(scheduleFromDate('weekly', '2026-10-21')).toEqual(weekly(3)); // a Wednesday
  });
});

describe('monthly', () => {
  it('moves to the same day next month, across year ends', () => {
    expect(nextAfter(monthly(5), '2026-10-05')).toBe('2026-11-05');
    expect(nextAfter(monthly(5), '2026-12-05')).toBe('2027-01-05');
  });
  it('is strictly after the given date, even mid-month', () => {
    expect(nextAfter(monthly(5), '2026-10-03')).toBe('2026-10-05');
    expect(nextAfter(monthly(5), '2026-10-20')).toBe('2026-11-05');
  });
  it('clamps day 31 to month end and returns to 31 afterwards (no drift)', () => {
    const s = monthly(31);
    expect(nextAfter(s, '2026-01-31')).toBe('2026-02-28');
    expect(nextAfter(s, '2026-02-28')).toBe('2026-03-31');
    expect(nextAfter(s, '2026-03-31')).toBe('2026-04-30');
    expect(nextAfter(s, '2028-01-31')).toBe('2028-02-29'); // leap year
  });
  it('day 30 in February', () => {
    expect(nextAfter(monthly(30), '2026-01-30')).toBe('2026-02-28');
  });
});

describe('weekly', () => {
  it('adds seven days on the same weekday', () => {
    expect(nextAfter(weekly(5), '2026-10-23')).toBe('2026-10-30');
    expect(nextAfter(weekly(5), '2026-12-25')).toBe('2027-01-01');
  });
  it('from any date, finds the next matching weekday strictly after it', () => {
    expect(nextAfter(weekly(5), '2026-10-21')).toBe('2026-10-23'); // Wed -> Fri
    expect(nextAfter(weekly(5), '2026-10-23')).toBe('2026-10-30'); // Fri -> next Fri
    expect(nextAfter(weekly(1), '2026-10-23')).toBe('2026-10-26'); // Fri -> Mon
  });
});

describe('occurrencesBetween / firstOnOrAfter', () => {
  it('includes both ends and nothing outside', () => {
    expect(occurrencesBetween(monthly(1), '2026-08-01', '2026-10-01')).toEqual(['2026-08-01', '2026-09-01', '2026-10-01']);
    expect(occurrencesBetween(monthly(1), '2026-08-02', '2026-10-31')).toEqual(['2026-09-01', '2026-10-01']);
    expect(occurrencesBetween(weekly(5), '2026-10-01', '2026-10-31')).toEqual(['2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30']);
  });
  it('respects the limit and empty ranges', () => {
    expect(occurrencesBetween(weekly(5), '2026-01-01', '2026-12-31', 3)).toHaveLength(3);
    expect(occurrencesBetween(monthly(1), '2026-10-02', '2026-10-30')).toEqual([]);
  });
  it('firstOnOrAfter keeps a date that is already an occurrence', () => {
    expect(firstOnOrAfter(monthly(5), '2026-10-05')).toBe('2026-10-05');
    expect(firstOnOrAfter(monthly(5), '2026-10-06')).toBe('2026-11-05');
  });
});

describe('planReminders', () => {
  const fmt = (m: number, c: string) => `${c} ${(m / 100).toFixed(2)}`;
  const rule = (over: Record<string, unknown> = {}) => ({
    id: 'r1', name: 'Rent', mode: 'auto' as const, amountMinor: 380000, currency: 'QAR',
    nextDueDate: '2026-11-02', endDate: null, schedule: monthly(2), ...over,
  });

  it('plans each occurrence within the horizon, with different wording per mode', () => {
    const out = planReminders([rule()], '2026-10-21', fmt, { horizonDays: 60 });
    expect(out.map((p) => p.date)).toEqual(['2026-11-02', '2026-12-02']);
    expect(out[0].title).toBe('Rent is due today');
    expect(out[0].body).toContain('QAR 3800.00');
    expect(out[0].body).toContain('automatically');
    const remind = planReminders([rule({ mode: 'remind' })], '2026-10-21', fmt)[0];
    expect(remind.title).toBe('Time to pay: Rent');
    expect(remind.body).toContain('Open the app');
  });

  it('never plans dates before the next due date or after the end date', () => {
    const out = planReminders([rule({ nextDueDate: '2026-12-02', endDate: '2026-12-31' })], '2026-10-21', fmt, { horizonDays: 90 });
    expect(out.map((p) => p.date)).toEqual(['2026-12-02']);
    expect(planReminders([rule({ endDate: '2026-10-01' })], '2026-10-21', fmt)).toEqual([]);
  });

  it('sorts across rules and caps the total', () => {
    const rules = [
      rule({ id: 'a', nextDueDate: '2026-10-23', schedule: weekly(5) }),
      rule({ id: 'b', name: 'Salary', nextDueDate: '2026-11-01', schedule: monthly(1) }),
    ];
    const out = planReminders(rules, '2026-10-21', fmt, { horizonDays: 30, maxTotal: 4 });
    expect(out).toHaveLength(4);
    expect(out.map((p) => p.date)).toEqual([...out.map((p) => p.date)].sort());
    expect(new Set(out.map((p) => p.key)).size).toBe(4);
  });
});

import { describeSchedule } from '@/domain/recurrence';

describe('describeSchedule', () => {
  it('words monthly and weekly schedules', () => {
    expect(describeSchedule(monthly(1))).toBe('Every month on the 1st');
    expect(describeSchedule(monthly(2))).toBe('Every month on the 2nd');
    expect(describeSchedule(monthly(3))).toBe('Every month on the 3rd');
    expect(describeSchedule(monthly(11))).toBe('Every month on the 11th');
    expect(describeSchedule(monthly(22))).toBe('Every month on the 22nd');
    expect(describeSchedule(monthly(31))).toBe('Every month on the 31st (or the last day)');
    expect(describeSchedule(weekly(5))).toBe('Every Friday');
  });
});
