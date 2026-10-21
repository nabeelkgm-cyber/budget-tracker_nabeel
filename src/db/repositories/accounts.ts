import { newId, nowIso } from '@/lib/id';
import type { Account, AccountType, AccountWithBalance } from '@/types';
import { notifyChange } from '../events';
import type { Db } from '../types';

/**
 * Running balance = opening balance + income - expense - transfers out + transfers in.
 * Credit cards use the same maths; a negative balance means money owed.
 */
const BALANCE_SQL = `
  a.opening_balance_minor + COALESCE((
    SELECT SUM(CASE
      WHEN t.account_id = a.id AND t.type = 'income'   THEN  t.amount_minor
      WHEN t.account_id = a.id AND t.type = 'expense'  THEN -t.amount_minor
      WHEN t.account_id = a.id AND t.type = 'transfer' THEN -t.amount_minor
      WHEN t.to_account_id = a.id AND t.type = 'transfer' THEN t.to_amount_minor
      ELSE 0 END)
    FROM transactions t
    WHERE t.deleted_at IS NULL AND (t.account_id = a.id OR t.to_account_id = a.id)
  ), 0)`;

export function listAccounts(db: Db, opts: { includeArchived?: boolean } = {}) {
  const where = opts.includeArchived ? '' : 'AND a.is_archived = 0';
  return db.getAllAsync<AccountWithBalance>(
    `SELECT a.*, ${BALANCE_SQL} AS balance_minor
     FROM accounts a WHERE a.deleted_at IS NULL ${where}
     ORDER BY a.is_archived, a.sort_order, a.name`,
  );
}

export const getAccount = (db: Db, id: string) =>
  db.getFirstAsync<AccountWithBalance>(
    `SELECT a.*, ${BALANCE_SQL} AS balance_minor FROM accounts a WHERE a.id = ?`,
    [id],
  );

export interface AccountInput {
  name: string;
  type: AccountType;
  currency: string;
  openingBalanceMinor: number;
  creditLimitMinor: number | null;
  statementDay: number | null;
  dueDay: number | null;
  icon: string;
  color: string;
}

export async function createAccount(db: Db, input: AccountInput): Promise<string> {
  const id = newId();
  const now = nowIso();
  const next = await db.getFirstAsync<{ n: number }>(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM accounts',
  );
  await db.runAsync(
    `INSERT INTO accounts (id,name,type,currency,opening_balance_minor,credit_limit_minor,
       statement_day,due_day,icon,color,sort_order,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      input.name.trim(),
      input.type,
      input.currency,
      input.openingBalanceMinor,
      input.creditLimitMinor,
      input.statementDay,
      input.dueDay,
      input.icon,
      input.color,
      next?.n ?? 0,
      now,
      now,
    ],
  );
  notifyChange();
  return id;
}

export async function updateAccount(
  db: Db,
  id: string,
  input: Omit<AccountInput, 'currency'>,
): Promise<void> {
  // Currency is fixed after creation: changing it would silently re-denominate history.
  await db.runAsync(
    `UPDATE accounts SET name=?, type=?, opening_balance_minor=?, credit_limit_minor=?,
       statement_day=?, due_day=?, icon=?, color=?, updated_at=? WHERE id=?`,
    [
      input.name.trim(),
      input.type,
      input.openingBalanceMinor,
      input.creditLimitMinor,
      input.statementDay,
      input.dueDay,
      input.icon,
      input.color,
      nowIso(),
      id,
    ],
  );
  notifyChange();
}

export async function setAccountArchived(db: Db, id: string, archived: boolean): Promise<void> {
  await db.runAsync('UPDATE accounts SET is_archived=?, updated_at=? WHERE id=?', [
    archived ? 1 : 0,
    nowIso(),
    id,
  ]);
  notifyChange();
}

export type { Account };
