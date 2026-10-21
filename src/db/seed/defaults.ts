import { CATALOG, catalogEntry, defaultRateE8 } from '@/domain/currencies';
import { newId, nowIso } from '@/lib/id';
import { atomic } from '../atomic';
import type { Db } from '../types';

const EXPENSE_CATEGORIES: [name: string, icon: string, color: string][] = [
  ['Rent', 'home', '#6C63FF'],
  ['Groceries', 'cart', '#2EB872'],
  ['Fuel', 'speedometer', '#F59E0B'],
  ['Utilities', 'flash', '#0EA5E9'],
  ['Dining', 'restaurant', '#EF4444'],
  ['Transport', 'bus', '#8B5CF6'],
  ['Family Remittance', 'send', '#14B8A6'],
  ['Shopping', 'bag', '#EC4899'],
  ['Health', 'medkit', '#F43F5E'],
  ['Education', 'school', '#3B82F6'],
  ['Entertainment', 'film', '#A855F7'],
  ['Savings', 'wallet', '#22C55E'],
  ['Others', 'ellipsis-horizontal-circle', '#64748B'],
  ['Loan Interest', 'trending-up', '#F97316'],
  ['Bank Charges', 'receipt', '#64748B'],
];

const INCOME_CATEGORIES: [name: string, icon: string, color: string][] = [
  ['Salary', 'cash', '#16A34A'],
  ['Other Income', 'add-circle', '#0D9488'],
];

/**
 * Idempotent: on a fresh database, inserts every known currency (rates are placeholders relative to
 * `base`, to be updated in Settings), the preset categories, and records the base currency.
 * Existing databases are left alone.
 */
export async function seedDefaults(db: Db, base: string = 'QAR'): Promise<void> {
  const done = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'seeded'");
  if (done) return;
  if (!catalogEntry(base)?.gcc) throw new Error(`${base} cannot be used as the base currency.`);
  const now = nowIso();
  await atomic(db, async () => {
    for (const c of CATALOG) {
      await db.runAsync(
        'INSERT INTO currencies (code,name,symbol,minor_units,rate_to_base_e8,updated_at) VALUES (?,?,?,?,?,?)',
        [c.code, c.name, c.code, c.minorUnits, defaultRateE8(c.code, base), now],
      );
    }
    let order = 0;
    for (const [name, icon, color] of EXPENSE_CATEGORIES) {
      await db.runAsync(
        `INSERT INTO categories (id,parent_id,name,kind,icon,color,sort_order,created_at,updated_at)
         VALUES (?,NULL,?,'expense',?,?,?,?,?)`,
        [newId(), name, icon, color, order++, now, now],
      );
    }
    for (const [name, icon, color] of INCOME_CATEGORIES) {
      await db.runAsync(
        `INSERT INTO categories (id,parent_id,name,kind,icon,color,sort_order,created_at,updated_at)
         VALUES (?,NULL,?,'income',?,?,?,?,?)`,
        [newId(), name, icon, color, order++, now, now],
      );
    }
    await db.runAsync("INSERT INTO settings (key,value) VALUES ('base_currency', ?)", [base]);
    await db.runAsync("INSERT INTO settings (key,value) VALUES ('seeded','1')");
  });
}
