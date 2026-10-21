import { convertMinor } from '@/domain/money';
import { validateTransaction } from '@/domain/transactionRules';
import { today } from '@/lib/dates';
import { newId, nowIso } from '@/lib/id';
import type { Transaction, TransactionInput, TransactionRow } from '@/types';
import { notifyChange } from '../events';
import type { Db } from '../types';
import { listAccounts } from './accounts';
import { listCategories } from './categories';

const ROW_SQL = `
  SELECT t.*,
    a.name AS account_name, a.currency AS account_currency,
    ta.name AS to_account_name, ta.currency AS to_account_currency,
    c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
    p.name AS parent_category_name
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN accounts ta ON ta.id = t.to_account_id
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN categories p ON p.id = c.parent_id
  WHERE t.deleted_at IS NULL`;

export function listTransactions(
  db: Db,
  opts: { limit?: number; offset?: number; accountId?: string } = {},
) {
  const params: any[] = [];
  let filter = '';
  if (opts.accountId) {
    filter = ' AND (t.account_id = ? OR t.to_account_id = ?)';
    params.push(opts.accountId, opts.accountId);
  }
  params.push(opts.limit ?? 200, opts.offset ?? 0);
  return db.getAllAsync<TransactionRow>(
    `${ROW_SQL}${filter} ORDER BY t.date DESC, t.created_at DESC LIMIT ? OFFSET ?`,
    params,
  );
}

export const getTransaction = (db: Db, id: string) =>
  db.getFirstAsync<Transaction>('SELECT * FROM transactions WHERE id = ? AND deleted_at IS NULL', [
    id,
  ]);

async function rateFor(db: Db, accountId: string): Promise<number> {
  const row = await db.getFirstAsync<{ rate: number }>(
    `SELECT c.rate_to_base_e8 AS rate FROM accounts a JOIN currencies c ON c.code = a.currency
     WHERE a.id = ?`,
    [accountId],
  );
  if (!row) throw new Error('Account not found.');
  return row.rate;
}

async function check(db: Db, input: TransactionInput): Promise<void> {
  const [accounts, categories] = await Promise.all([
    listAccounts(db, { includeArchived: true }),
    listCategories(db, { includeArchived: true }),
  ]);
  const error = validateTransaction(input, accounts, categories);
  if (error) throw new Error(error);
}

export async function createTransaction(db: Db, input: TransactionInput): Promise<string> {
  await check(db, input);
  const id = newId();
  const now = nowIso();
  const rate = await rateFor(db, input.accountId);
  const isTransfer = input.type === 'transfer';
  await db.runAsync(
    `INSERT INTO transactions (id,type,date,account_id,amount_minor,fx_rate_e8,base_amount_minor,
       category_id,to_account_id,to_amount_minor,payment_method,note,source,external_ref,fingerprint,
       created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      input.type,
      input.date,
      input.accountId,
      input.amountMinor,
      rate,
      convertMinor(input.amountMinor, rate),
      isTransfer ? null : input.categoryId,
      isTransfer ? input.toAccountId : null,
      isTransfer ? input.toAmountMinor : null,
      input.paymentMethod,
      input.note.trim(),
      input.source ?? 'manual',
      input.externalRef ?? null,
      input.fingerprint ?? null,
      now,
      now,
    ],
  );
  notifyChange();
  return id;
}

export async function updateTransaction(
  db: Db,
  id: string,
  input: TransactionInput,
): Promise<void> {
  await check(db, input);
  const existing = await getTransaction(db, id);
  if (!existing) throw new Error('Transaction not found.');
  // Keep the rate the entry was recorded with unless it moves to a different account.
  const rate =
    existing.account_id === input.accountId
      ? existing.fx_rate_e8
      : await rateFor(db, input.accountId);
  const isTransfer = input.type === 'transfer';
  await db.runAsync(
    `UPDATE transactions SET type=?, date=?, account_id=?, amount_minor=?, fx_rate_e8=?,
       base_amount_minor=?, category_id=?, to_account_id=?, to_amount_minor=?, payment_method=?,
       note=?, updated_at=? WHERE id=?`,
    [
      input.type,
      input.date,
      input.accountId,
      input.amountMinor,
      rate,
      convertMinor(input.amountMinor, rate),
      isTransfer ? null : input.categoryId,
      isTransfer ? input.toAccountId : null,
      isTransfer ? input.toAmountMinor : null,
      input.paymentMethod,
      input.note.trim(),
      nowIso(),
      id,
    ],
  );
  notifyChange();
}

/** Soft delete, so a future sync can propagate the deletion. */
export async function deleteTransaction(db: Db, id: string): Promise<void> {
  const now = nowIso();
  await db.runAsync('UPDATE transactions SET deleted_at=?, updated_at=? WHERE id=?', [now, now, id]);
  notifyChange();
}

/** Copies a transaction dated today (at the current rate) and returns the new id. */
export async function duplicateTransaction(db: Db, id: string): Promise<string> {
  const t = await getTransaction(db, id);
  if (!t) throw new Error('Transaction not found.');
  return createTransaction(db, {
    type: t.type,
    date: today(),
    accountId: t.account_id,
    amountMinor: t.amount_minor,
    categoryId: t.category_id,
    toAccountId: t.to_account_id,
    toAmountMinor: t.to_amount_minor,
    paymentMethod: t.payment_method,
    note: t.note,
  });
}
