import { DatabaseSync } from 'node:sqlite';
import type { Db } from '@/db/types';
import { migrate } from '@/db/migrations';
import { loadCurrencyRegistry } from '@/db/currencySetup';
import { seedDefaults } from '@/db/seed/defaults';

/** In-memory SQLite (Node built-in) exposing the same async API the app uses. */
export function createTestDb(): Db {
  const sqlite = new DatabaseSync(':memory:');
  return {
    async execAsync(sql: string) {
      sqlite.exec(sql);
    },
    async runAsync(sql: string, params: any[] = []) {
      const r = sqlite.prepare(sql).run(...params);
      return { changes: Number(r.changes) };
    },
    async getAllAsync(sql: string, params: any[] = []) {
      return sqlite.prepare(sql).all(...params) as any[];
    },
    async getFirstAsync(sql: string, params: any[] = []) {
      return (sqlite.prepare(sql).get(...params) as any) ?? null;
    },
    async withTransactionAsync(task: () => Promise<void>) {
      sqlite.exec('BEGIN');
      try {
        await task();
        sqlite.exec('COMMIT');
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

/** A set-up database. The INR rate is pinned to 0.0413 QAR so amounts in tests are predictable. */
export async function createReadyDb(base: string = 'QAR'): Promise<Db> {
  const db = createTestDb();
  await migrate(db);
  await seedDefaults(db, base);
  await loadCurrencyRegistry(db);
  if (base === 'QAR') await db.runAsync("UPDATE currencies SET rate_to_base_e8 = 4130000 WHERE code = 'INR'");
  return db;
}
