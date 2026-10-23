import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';
import { completeSetup, isSeeded } from '@/db/currencySetup';
import { subscribeToChanges } from '@/db/events';
import { getMeta } from '@/sync/engine';

/** The currency a new app starts with. It can be changed in Settings. */
export const DEFAULT_BASE_CURRENCY = 'QAR';

/**
 * First run: sets the app up with the default currency, without asking anything.
 * It waits while a device is being connected to the cloud, because that fills the app with the cloud copy.
 */
export function SetupGate() {
  const db = useSQLiteContext();

  useEffect(() => {
    let alive = true;
    let busy = false;
    const check = async () => {
      if (busy) return;
      busy = true;
      try {
        if ((await isSeeded(db)) || (await getMeta(db, 'user_id'))) return;
        if (alive) await completeSetup(db, DEFAULT_BASE_CURRENCY);
      } catch (e) {
        console.warn('First-run setup failed', e);
      } finally {
        busy = false;
      }
    };
    check();
    const unsubscribe = subscribeToChanges(check);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [db]);

  return null;
}
