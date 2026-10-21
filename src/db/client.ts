import { migrate } from './migrations';
import { ensureCurrencyCatalog, isSeeded, loadCurrencyRegistry } from './currencySetup';
import type { Db } from './types';

export const DB_NAME = 'budget-tracker.db';

/** Passed to <SQLiteProvider onInit>. Runs once on app start. */
export async function initDatabase(db: Db): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await migrate(db);
  // A brand-new database waits for the user to choose a currency (see SetupGate).
  if (await isSeeded(db)) {
    await ensureCurrencyCatalog(db);
    await loadCurrencyRegistry(db);
  }
}
