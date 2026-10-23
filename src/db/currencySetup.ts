import { CATALOG, defaultRateE8, setCurrencyRegistry } from '@/domain/currencies';
import { nowIso } from '@/lib/id';
import { notifyChange } from './events';
import { seedDefaults } from './seed/defaults';
import type { Db } from './types';

/** True once the user has chosen a base currency (or the database predates that choice). */
export async function isSeeded(db: Db): Promise<boolean> {
  return !!(await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'seeded'"));
}

/** True once the user has added any account or transaction (default categories alone do not count). */
export async function hasUserData(db: Db): Promise<boolean> {
  const a = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM accounts');
  const t = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM transactions');
  return (a?.n ?? 0) + (t?.n ?? 0) > 0;
}

/**
 * Makes sure every known currency exists in an already-set-up database (older versions only had
 * QAR and INR). Missing ones get a placeholder rate against the base; existing rates are untouched.
 */
export async function ensureCurrencyCatalog(db: Db): Promise<void> {
  const base = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'base_currency'");
  if (!base) return;
  const now = nowIso();
  for (const c of CATALOG) {
    await db.runAsync(
      `INSERT OR IGNORE INTO currencies (code,name,symbol,minor_units,rate_to_base_e8,updated_at)
       VALUES (?,?,?,?,?,?)`,
      [c.code, c.name, c.code, c.minorUnits, defaultRateE8(c.code, base.value), now],
    );
  }
}

/** Loads the base currency and each currency's decimals into the app's live settings. */
export async function loadCurrencyRegistry(db: Db): Promise<void> {
  const base = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'base_currency'");
  const rows = await db.getAllAsync<{ code: string; minor_units: number }>('SELECT code, minor_units FROM currencies');
  setCurrencyRegistry(base?.value ?? 'QAR', Object.fromEntries(rows.map((r) => [r.code, r.minor_units])));
}

/** First-run: records the chosen base currency, creates the presets, and refreshes the app. */
export async function completeSetup(db: Db, base: string): Promise<void> {
  await seedDefaults(db, base);
  await loadCurrencyRegistry(db);
  notifyChange();
}
