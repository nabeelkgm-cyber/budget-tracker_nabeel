import dayjs from 'dayjs';
import * as Notifications from 'expo-notifications';
import type { Db } from '@/db/types';
import { listPendingDue, listRecurringRules, scheduleOf } from '@/db/repositories/recurring';
import { formatMinor } from '@/domain/money';
import { planReminders } from '@/domain/recurrence';
import { today } from '@/lib/dates';

/** Reminders arrive at this local hour on the due date. */
export const REMINDER_HOUR = 9;

/** Show reminders as banners even while the app is open. */
export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export async function notificationsAllowed(): Promise<boolean> {
  try {
    return (await Notifications.getPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Asks iOS for permission if it has not been asked yet. Returns whether reminders are allowed. */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    return (await Notifications.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

const atReminderHour = (date: string): Date =>
  dayjs(date).hour(REMINDER_HOUR).minute(0).second(0).millisecond(0).toDate();

/**
 * Re-creates every scheduled reminder from the current rules:
 *  - one notification per upcoming due date (next ~60 days), and
 *  - one summary for reminders already waiting for the user.
 * Safe to call as often as needed. Returns how many were scheduled.
 */
export async function rescheduleReminders(db: Db): Promise<number> {
  if (!(await notificationsAllowed())) return 0;
  const [rules, pending] = await Promise.all([listRecurringRules(db), listPendingDue(db)]);

  const planned = planReminders(
    rules
      .filter((r) => r.is_active)
      .map((r) => ({
        id: r.id,
        name: r.name,
        mode: r.mode,
        amountMinor: r.amount_minor,
        currency: r.account_currency,
        nextDueDate: r.next_due_date,
        endDate: r.end_date,
        schedule: scheduleOf(r),
      })),
    today(),
    formatMinor,
    { maxTotal: 60 },
  );

  await Notifications.cancelAllScheduledNotificationsAsync();
  const now = Date.now();
  let count = 0;

  for (const p of planned) {
    const when = atReminderHour(p.date);
    if (when.getTime() <= now + 60_000) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: p.key,
      content: { title: p.title, body: p.body, data: { ruleId: p.ruleId, date: p.date } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
    });
    count++;
  }

  if (pending.length > 0) {
    let when = atReminderHour(today());
    if (when.getTime() <= now + 60_000) when = atReminderHour(dayjs().add(1, 'day').format('YYYY-MM-DD'));
    const names = [...new Set(pending.map((p) => p.name))];
    await Notifications.scheduleNotificationAsync({
      identifier: 'pending-summary',
      content: {
        title: `${pending.length} recurring item${pending.length === 1 ? '' : 's'} waiting`,
        body: `${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}. Open the app to add or skip.`,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
    });
    count++;
  }
  return count;
}

/** For the Settings screen: confirms notifications work on this phone. */
export async function sendTestNotification(): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: { title: 'Budget Tracker', body: 'Reminders are working.' },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 5 },
  });
}
