import { convertMinor, parseAmountToMinor } from '@/domain/money';
import { validateTransaction } from '@/domain/transactionRules';
import { today } from '@/lib/dates';
import { newId, nowIso } from '@/lib/id';
import type { Transaction, TransactionInput, TransactionRow, TxnType } from '@/types';
import { atomic } from '../atomic';
import { notifyChange } from '../events';
import type { Db } from '../types';
import { listAccounts } from './accounts';
import { listCategories } from './categories';

export interface TransactionFilter {
  /** Matches note, account, category and parent category names, or an exact amount. */
  search?: string;
  type?: TxnType;
  /** Matches transactions leaving or entering this account. */
  accountId?: string;
  /** A parent category also matches its sub-categories. */
  categoryId?: string;
  /** Inclusive YYYY-MM-DD bounds. */
  dateFrom?: string;
  dateTo?: string;
}

const FROM_SQL = `
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN accounts ta ON ta.id = t.to_account_id
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN categories p ON p.id = c.parent_id`;

function buildWhere(filter: TransactionFilter = {}): { sql: string; params: any[] } {
  const where = ['t.deleted_at IS NULL'];
  const params: any[] = [];
  if (filter.type) {
    where.push('t.type = ?');
    params.push(filter.type);
  }
  if (filter.accountId) {
    where.push('(t.account_id = ? OR t.to_account_id = ?)');
    params.push(filter.accountId, filter.accountId);
  }
  if (filter.categoryId) {
    where.push('(c.id = ? OR c.parent_id = ?)');
    params.push(filter.categoryId, filter.categoryId);
  }
  if (filter.dateFrom) {
    where.push('t.date >= ?');
    params.push(filter.dateFrom);
  }
  if (filter.dateTo) {
    where.push('t.date <= ?');
    params.push(filter.dateTo);
  }
  const q = filter.search?.trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const parts = ['t.note', 'a.name', 'ta.name', 'c.name', 'p.name'].map(
      (col) => `${col} LIKE ? ESCAPE '\\'`,
    );
    params.push(like, like, like, like, like);
    const amount = parseAmountToMinor(q);
    if (amount !== null) {
      parts.push('t.amount_minor = ?');
      params.push(amount);
    }
    where.push(`(${parts.join(' OR ')})`);
  }
  return { sql: where.join(' AND '), params };
}

export function listTransactions(
  db: Db,
  opts: { limit?: number; offset?: number; filter?: TransactionFilter } = {},
) {
  const { sql, params } = buildWhere(opts.filter);
  return db.getAllAsync<TransactionRow>(
    `SELECT t.*,
       a.name AS account_name, a.currency AS account_currency,
       ta.name AS to_account_name, ta.currency AS to_account_currency,
       c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
       p.name AS parent_category_name
     ${FROM_SQL}
     WHERE ${sql}
     ORDER BY t.date DESC, t.created_at DESC LIMIT ? OFFSET ?`,
    [...params, opts.limit ?? 200, opts.offset ?? 0],
  );
}

export interface TransactionTotals {
  count: number;
  /** Income and expense in base currency (QAR). Transfers are excluded from both. */
  incomeMinor: number;
  expenseMinor: number;
}

/** Totals over every transaction matching the filter (not just the page shown). */
export async function summarizeTransactions(
  db: Db,
  filter: TransactionFilter = {},
): Promise<TransactionTotals> {
  const { sql, params } = buildWhere(filter);
  const row = await db.getFirstAsync<{ count: number; income: number; expense: number }>(
    `SELECT COUNT(*) AS count,
       COALESCE(SUM(CASE WHEN t.type = 'income'  THEN t.base_amount_minor END), 0) AS income,
       COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.base_amount_minor END), 0) AS expense
     ${FROM_SQL}
     WHERE ${sql}`,
    params,
  );
  return { count: row?.count ?? 0, incomeMinor: row?.income ?? 0, expenseMinor: row?.expense ?? 0 };
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

interface InsertExtras {
  linkedTxnId?: string | null;
}

async function insertRow(db: Db, id: string, input: TransactionInput, extras: InsertExtras = {}) {
  const now = nowIso();
  const rate = await rateFor(db, input.accountId);
  const isTransfer = input.type === 'transfer';
  await db.runAsync(
    `INSERT INTO transactions (id,type,date,account_id,amount_minor,fx_rate_e8,base_amount_minor,
       category_id,to_account_id,to_amount_minor,payment_method,note,linked_txn_id,source,external_ref,
       fingerprint,recurring_id,recurring_due_date,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
      extras.linkedTxnId ?? null,
      input.source ?? 'manual',
      input.externalRef ?? null,
      input.fingerprint ?? null,
      input.recurringId ?? null,
      input.recurringDueDate ?? null,
      now,
      now,
    ],
  );
}

async function feeCategoryId(db: Db): Promise<string> {
  const row = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM categories
     WHERE name = 'Bank Charges' AND kind = 'expense' AND parent_id IS NULL AND deleted_at IS NULL`,
  );
  if (!row) throw new Error('The "Bank Charges" category is missing. Add it under More > Categories.');
  return row.id;
}

/** The fee expense saved together with a transfer, if any. */
export const getLinkedFee = (db: Db, transferId: string) =>
  db.getFirstAsync<Transaction>(
    'SELECT * FROM transactions WHERE linked_txn_id = ? AND deleted_at IS NULL',
    [transferId],
  );

async function insertFee(db: Db, transferId: string, input: TransactionInput) {
  await insertRow(
    db,
    newId(),
    {
      type: 'expense',
      date: input.date,
      accountId: input.accountId,
      amountMinor: input.feeMinor!,
      categoryId: await feeCategoryId(db),
      toAccountId: null,
      toAmountMinor: null,
      paymentMethod: 'bank_transfer',
      note: 'Transfer fee',
      source: input.source,
    },
    { linkedTxnId: transferId },
  );
}

/** Creates the entry (and, for a transfer with a fee, the fee expense) as one unit. */
export async function createTransaction(db: Db, input: TransactionInput): Promise<string> {
  await check(db, input);
  const id = newId();
  await atomic(db, async () => {
    await insertRow(db, id, input);
    if (input.type === 'transfer' && input.feeMinor && input.feeMinor > 0) {
      await insertFee(db, id, input);
    }
  });
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
  await atomic(db, async () => {
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

    // Keep the linked fee in step with the transfer.
    const fee = await getLinkedFee(db, id);
    const wantFee = isTransfer && !!input.feeMinor && input.feeMinor > 0;
    if (wantFee && fee) {
      const feeRate =
        fee.account_id === input.accountId ? fee.fx_rate_e8 : await rateFor(db, input.accountId);
      await db.runAsync(
        `UPDATE transactions SET date=?, account_id=?, amount_minor=?, fx_rate_e8=?,
           base_amount_minor=?, updated_at=? WHERE id=?`,
        [
          input.date,
          input.accountId,
          input.feeMinor!,
          feeRate,
          convertMinor(input.feeMinor!, feeRate),
          nowIso(),
          fee.id,
        ],
      );
    } else if (wantFee) {
      await insertFee(db, id, input);
    } else if (fee) {
      await softDelete(db, fee.id);
    }
  });
  notifyChange();
}

async function softDelete(db: Db, id: string): Promise<void> {
  const now = nowIso();
  await db.runAsync('UPDATE transactions SET deleted_at=?, updated_at=? WHERE id=?', [now, now, id]);
}

/** Soft delete (so a future sync can propagate it). A transfer's fee goes with it. */
export async function deleteTransaction(db: Db, id: string): Promise<void> {
  await atomic(db, async () => {
    const fee = await getLinkedFee(db, id);
    if (fee) await softDelete(db, fee.id);
    await softDelete(db, id);
  });
  notifyChange();
}

/** Copies a transaction (and a transfer's fee) dated today at the current rate; returns the new id. */
export async function duplicateTransaction(db: Db, id: string): Promise<string> {
  const t = await getTransaction(db, id);
  if (!t) throw new Error('Transaction not found.');
  const fee = t.type === 'transfer' ? await getLinkedFee(db, id) : null;
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
    feeMinor: fee?.amount_minor ?? null,
  });
}
