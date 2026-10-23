import { migrate } from './migrations';
import { ensureCurrencyCatalog, isSeeded, loadCurrencyRegistry } from './currencySetup';
import type { Db } from './types';

export const DB_NAME = 'budget-tracker.db';

/** Passed to <SQLiteProvider onInit>. Runs once on app start. */
export async function initDatabase(db: Db): Promise<void> {
  // WAL is not available for the browser's file system; the default mode is fine there.
  await db.execAsync('PRAGMA journal_mode = WAL;').catch(() => undefined);
  await migrate(db);
  // A brand-new database is set up with the default currency by SetupGate.
  if (await isSeeded(db)) {
    await ensureCurrencyCatalog(db);
    await loadCurrencyRegistry(db);
  }
}
