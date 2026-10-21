import { newId, nowIso } from '@/lib/id';
import type { Db } from '../types';

/** Placeholder rate (QAR per 1 INR, x1e8). Update it in Settings. */
const DEFAULT_INR_RATE_E8 = 4_130_000; // 0.0413 QAR per INR (about 24.2 INR per QAR)

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

/** Idempotent: inserts currencies and preset categories only on a fresh database. */
export async function seedDefaults(db: Db): Promise<void> {
  const done = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'seeded'",
  );
  if (done) return;
  const now = nowIso();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'INSERT INTO currencies (code,name,symbol,minor_units,rate_to_base_e8,updated_at) VALUES (?,?,?,?,?,?)',
      ['QAR', 'Qatari Riyal', 'QAR', 2, 100_000_000, now],
    );
    await db.runAsync(
      'INSERT INTO currencies (code,name,symbol,minor_units,rate_to_base_e8,updated_at) VALUES (?,?,?,?,?,?)',
      ['INR', 'Indian Rupee', 'INR', 2, DEFAULT_INR_RATE_E8, now],
    );
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
    await db.runAsync("INSERT INTO settings (key,value) VALUES ('base_currency','QAR')");
    await db.runAsync("INSERT INTO settings (key,value) VALUES ('seeded','1')");
  });
}
