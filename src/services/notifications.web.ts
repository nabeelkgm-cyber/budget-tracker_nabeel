import type { Db } from '@/db/types';

/** Browsers cannot schedule reminders while the app is closed, so the web app has none. */
export const REMINDER_HOUR = 9;
export function configureNotificationHandler(): void {}
export async function notificationsAllowed(): Promise<boolean> {
  return false;
}
export async function ensureNotificationPermission(): Promise<boolean> {
  return false;
}
export async function rescheduleReminders(_db: Db): Promise<number> {
  return 0;
}
export async function sendTestNotification(): Promise<void> {
  throw new Error('Reminders are not available in the web app.');
}
