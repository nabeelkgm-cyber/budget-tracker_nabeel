import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { processRecurring } from '@/db/repositories/recurring';
import { formatBudgetAlert } from '@/lib/budgetText';
import { prettyDate, today } from '@/lib/dates';
import { configureNotificationHandler, rescheduleReminders } from '@/services/notifications';
import { useLock } from './LockProvider';

/**
 * Runs when the app opens and whenever it returns to the foreground:
 * adds recurring entries that have come due, then refreshes the phone reminders.
 */
export function AppStartup() {
  const db = useSQLiteContext();
  const running = useRef(false);
  const { locked } = useLock();
  // Messages about what was just added stay hidden while the app is locked.
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (pending && !locked) {
      Alert.alert('Recurring items', pending);
      setPending(null);
    }
  }, [pending, locked]);

  useEffect(() => {
    configureNotificationHandler();

    const run = async () => {
      if (running.current) return;
      running.current = true;
      try {
        const r = await processRecurring(db, today());
        await rescheduleReminders(db).catch(() => 0);

        const lines: string[] = [];
        if (r.created.length) {
          const shown = r.created.slice(0, 6).map((c) => `${c.ruleName} (${prettyDate(c.date)})`);
          lines.push(
            `Added ${r.created.length} recurring transaction${r.created.length === 1 ? '' : 's'}:\n${shown.join('\n')}${
              r.created.length > shown.length ? `\n…and ${r.created.length - shown.length} more` : ''
            }`,
          );
        }
        for (const e of r.errors) lines.push(`Could not add "${e.ruleName}": ${e.message}`);
        if (r.alerts.length) lines.push(r.alerts.map(formatBudgetAlert).join('\n'));
        if (lines.length) setPending((old) => (old ? `${old}\n\n${lines.join('\n\n')}` : lines.join('\n\n')));
      } catch (e) {
        console.warn('Recurring processing failed', e);
      } finally {
        running.current = false;
      }
    };

    run();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    return () => sub.remove();
  }, [db]);

  return null;
}
