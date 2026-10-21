import { migrate } from './migrations';
import { seedDefaults } from './seed/defaults';
import type { Db } from './types';

export const DB_NAME = 'budget-tracker.db';

/** Passed to <SQLiteProvider onInit>. Runs once on app start. */
export async function initDatabase(db: Db): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await migrate(db);
  await seedDefaults(db);
}
