import { nowIso } from '@/lib/id';
import type { Currency } from '@/types';
import { notifyChange } from '../events';
import type { Db } from '../types';

export const listCurrencies = (db: Db) =>
  db.getAllAsync<Currency>('SELECT * FROM currencies ORDER BY code');

/**
 * Update the manual rate. Only affects transactions entered afterwards:
 * each transaction keeps the rate it was recorded with.
 */
export async function setCurrencyRate(db: Db, code: string, rateE8: number): Promise<void> {
  await db.runAsync('UPDATE currencies SET rate_to_base_e8 = ?, updated_at = ? WHERE code = ?', [
    rateE8,
    nowIso(),
    code,
  ]);
  notifyChange();
}
