import dayjs from 'dayjs';
import { DATE_FMT } from '@/lib/dates';
import { Match, MatchCandidate, MAX_POSTING_DAYS, bestMatch, itemFingerprint, referenceKey } from '@/domain/dedupe';
import { merchantKey } from '@/domain/statement';
import { newId, nowIso } from '@/lib/id';
import type { PaymentMethod, TransactionInput, TxnType } from '@/types';
import { atomic } from '../atomic';
import { notifyChange } from '../events';
import type { Db } from '../types';
import { createTransaction } from './transactions';

// ───────────────────── Account identifiers (card digits, SMS senders) ─────────────────────

export interface AccountIdentifiers {
  last4: string[];
  senders: string[];
}

export async function getAccountIdentifiers(db: Db, accountId: string): Promise<AccountIdentifiers> {
  const rows = await db.getAllAsync<{ kind: string; value: string }>(
    'SELECT kind, value FROM account_identifiers WHERE account_id = ? ORDER BY value',
    [accountId],
  );
  return {
    last4: rows.filter((r) => r.kind === 'last4').map((r) => r.value),
    senders: rows.filter((r) => r.kind === 'sender').map((r) => r.value),
  };
}

/** Replaces the saved card/account digits and SMS sender names of an account. */
export async function setAccountIdentifiers(db: Db, accountId: string, ids: AccountIdentifiers): Promise<void> {
  const last4 = [...new Set(ids.last4.map((v) => v.replace(/\D/g, '').slice(-4)).filter((v) => v.length === 4))];
  const senders = [...new Set(ids.senders.map((v) => v.trim().toUpperCase()).filter(Boolean))];
  await atomic(db, async () => {
    await db.runAsync('DELETE FROM account_identifiers WHERE account_id = ?', [accountId]);
    for (const [kind, values] of [['last4', last4], ['sender', senders]] as const) {
      for (const value of values) {
        await db.runAsync('INSERT INTO account_identifiers (id, account_id, kind, value) VALUES (?,?,?,?)', [newId(), accountId, kind, value]);
      }
    }
  });
  notifyChange();
}

/** Accounts that have this card/account ending. More than one means the digits are ambiguous. */
export async function findAccountsByLast4(db: Db, last4: string): Promise<string[]> {
  return (
    await db.getAllAsync<{ account_id: string }>(
      `SELECT i.account_id FROM account_identifiers i JOIN accounts a ON a.id = i.account_id
       WHERE i.kind = 'last4' AND i.value = ? AND a.is_archived = 0`,
      [last4],
    )
  ).map((r) => r.account_id);
}

export async function addLast4(db: Db, accountId: string, last4: string): Promise<void> {
  await db.runAsync('INSERT OR IGNORE INTO account_identifiers (id, account_id, kind, value) VALUES (?,?,?,?)', [newId(), accountId, 'last4', last4]);
  notifyChange();
}

// ───────────────────────────── Merchant memory ─────────────────────────────

export interface MerchantSuggestion {
  categoryId: string;
  type: 'expense' | 'income';
}

export async function suggestForMerchant(db: Db, key: string): Promise<MerchantSuggestion | null> {
  if (!key) return null;
  const r = await db.getFirstAsync<{ category_id: string; type: 'expense' | 'income' }>(
    `SELECT r.category_id, r.type FROM merchant_rules r JOIN categories c ON c.id = r.category_id
     WHERE r.key = ? AND c.is_archived = 0 AND c.deleted_at IS NULL`,
    [key],
  );
  return r ? { categoryId: r.category_id, type: r.type } : null;
}

export async function learnMerchant(db: Db, key: string, categoryId: string, type: 'expense' | 'income'): Promise<void> {
  if (!key) return;
  const now = nowIso();
  await db.runAsync(
    `INSERT INTO merchant_rules (id, key, category_id, type, hits, created_at, updated_at) VALUES (?,?,?,?,1,?,?)
     ON CONFLICT (key) DO UPDATE SET category_id = excluded.category_id, type = excluded.type,
       hits = hits + 1, updated_at = excluded.updated_at`,
    [newId(), key, categoryId, type, now, now],
  );
}

// ───────────────────────────── Adding items ─────────────────────────────

export interface NewItem {
  accountId: string;
  date: string;
  description: string;
  direction: 'debit' | 'credit';
  amountMinor: number;
  reference: string | null;
  balanceMinor?: number | null;
  raw: string;
}

export interface BatchInput {
  source: 'sms' | 'csv' | 'xlsx' | 'pdf';
  fileName: string | null;
  /** Hash of the file or pasted text; the same one cannot be added twice. */
  fileHash: string | null;
  accountId: string | null;
}

export interface BatchResult {
  batchId: string;
  /** Items waiting for review. */
  pending: number;
  /** Items recognised as already recorded and skipped. */
  duplicates: number;
  /** Of the pending ones, how many look like an existing transaction and need a decision. */
  possible: number;
}

const TRANSFER_WORDS = /credit card|card payment|card bill|payment received|thank you|bill pay|own account|self transfer|transfer to a\/c|transfer from a\/c/i;

async function candidatesFor(db: Db, accountId: string, from: string, to: string, refs: string[]): Promise<(MatchCandidate & { txnType: string })[]> {
  const lo = dayjs(from).subtract(MAX_POSTING_DAYS, 'day').format(DATE_FMT);
  const hi = dayjs(to).add(MAX_POSTING_DAYS, 'day').format(DATE_FMT);
  const rows = await db.getAllAsync<{
    id: string; type: string; date: string; account_id: string; amount_minor: number; to_account_id: string | null;
    to_amount_minor: number | null; note: string; external_ref: string | null; category_name: string | null;
  }>(
    `SELECT t.id, t.type, t.date, t.account_id, t.amount_minor, t.to_account_id, t.to_amount_minor, t.note,
            t.external_ref, c.name AS category_name
     FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.deleted_at IS NULL AND (t.account_id = ? OR t.to_account_id = ?)
       AND (t.date BETWEEN ? AND ?${refs.length ? ` OR t.external_ref IN (${refs.map(() => '?').join(',')})` : ''})`,
    [accountId, accountId, lo, hi, ...refs],
  );
  const out: (MatchCandidate & { txnType: string })[] = [];
  for (const t of rows) {
    // Compare with what the user wrote; fall back to the category name when there is no note.
    const note = t.note.trim() || (t.category_name ?? '');
    const base = { id: t.id, date: t.date, note, externalRef: t.external_ref, txnType: t.type };
    if (t.type === 'income' && t.account_id === accountId) out.push({ ...base, amountMinor: t.amount_minor, direction: 'credit' });
    else if (t.type === 'expense' && t.account_id === accountId) out.push({ ...base, amountMinor: t.amount_minor, direction: 'debit' });
    else if (t.type === 'transfer') {
      if (t.account_id === accountId) out.push({ ...base, amountMinor: t.amount_minor, direction: 'debit' });
      if (t.to_account_id === accountId && t.to_amount_minor) out.push({ ...base, amountMinor: t.to_amount_minor, direction: 'credit' });
    }
  }
  return out;
}

/**
 * Puts SMS / statement lines into the review inbox. Nothing becomes a transaction yet.
 * Each line is checked against what is already in the app:
 *  - the same file or pasted text cannot be added twice;
 *  - a line seen before (same date, account, amount, merchant) is skipped as a duplicate, except
 *    that genuine repeats inside one file are kept;
 *  - a line matching an existing transaction by reference, or same day/amount/wording, is skipped;
 *  - one that only looks similar (same amount, a few days apart) is kept for review with the match shown.
 */
export async function addBatch(db: Db, batch: BatchInput, items: NewItem[]): Promise<BatchResult> {
  if (batch.fileHash) {
    const dup = await db.getFirstAsync<{ created_at: string }>('SELECT created_at FROM import_batches WHERE file_hash = ?', [batch.fileHash]);
    if (dup) throw new Error(`This was already added on ${dayjs(dup.created_at).format('D MMM YYYY')}. Nothing was imported again.`);
  }
  if (items.length === 0) throw new Error('There is nothing to add.');

  const result: BatchResult = { batchId: newId(), pending: 0, duplicates: 0, possible: 0 };
  const now = nowIso();

  await atomic(db, async () => {
    await db.runAsync('INSERT INTO import_batches (id, source, file_name, file_hash, account_id, created_at) VALUES (?,?,?,?,?,?)', [
      result.batchId, batch.source, batch.fileName, batch.fileHash, batch.accountId, now,
    ]);

    // Lines already in the inbox or already approved (so overlapping statements do not double up).
    const known = new Map<string, number>();
    for (const r of await db.getAllAsync<{ fingerprint: string; n: number }>(
      "SELECT fingerprint, COUNT(*) AS n FROM import_items WHERE status IN ('pending','approved') GROUP BY fingerprint",
    )) known.set(r.fingerprint, r.n);

    const dates = items.map((i) => i.date).sort();
    const accounts = [...new Set(items.map((i) => i.accountId))];
    const candidates = new Map<string, (MatchCandidate & { txnType: string })[]>();
    // A bank reference identifies a transaction whatever its date, so those are always looked up.
    const refs = [...new Set(items.filter((i) => i.reference).map((i) => referenceKey(i.reference!)))];
    for (const a of accounts) candidates.set(a, await candidatesFor(db, a, dates[0], dates[dates.length - 1], refs));
    const taken = new Set<string>();

    for (const it of items) {
      const key = merchantKey(it.description);
      const fingerprint = itemFingerprint({ date: it.date, accountId: it.accountId, direction: it.direction, amountMinor: it.amountMinor, merchant: key });
      let status: 'pending' | 'duplicate' = 'pending';
      let dupKind: 'none' | 'possible' = 'none';
      let dupTxn: string | null = null;

      const seen = known.get(fingerprint) ?? 0;
      if (seen > 0) {
        known.set(fingerprint, seen - 1);
        status = 'duplicate';
      } else {
        const m: Match = bestMatch(
          { date: it.date, amountMinor: it.amountMinor, direction: it.direction, description: it.description, reference: it.reference },
          candidates.get(it.accountId) ?? [],
          taken,
        );
        if (m.candidate) {
          taken.add(m.candidate.id);
          dupTxn = m.candidate.id;
          // The same money moving between two of the user's own accounts shows on both statements.
          const isTransfer = candidates.get(it.accountId)?.find((c) => c.id === m.candidate!.id)?.txnType === 'transfer';
          if (m.kind === 'exact' || isTransfer) {
            status = 'duplicate';
            // Remember the bank's reference on the existing entry so a later copy is recognised for certain.
            if (it.reference) {
              await db.runAsync('UPDATE transactions SET external_ref = COALESCE(external_ref, ?) WHERE id = ?', [referenceKey(it.reference), m.candidate.id]);
            }
          } else dupKind = 'possible';
        }
      }

      let suggestedType: string | null = it.direction === 'debit' ? 'expense' : 'income';
      let suggestedCategory: string | null = null;
      if (status === 'pending') {
        if (TRANSFER_WORDS.test(it.description)) suggestedType = 'transfer';
        else {
          const s = await suggestForMerchant(db, key);
          if (s && ((s.type === 'expense') === (it.direction === 'debit'))) {
            suggestedCategory = s.categoryId;
            suggestedType = s.type;
          }
        }
      }

      await db.runAsync(
        `INSERT INTO import_items (id, batch_id, status, account_id, date, description, direction, amount_minor, reference,
           balance_minor, raw, fingerprint, suggested_type, suggested_category_id, dup_kind, dup_txn_id, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [newId(), result.batchId, status, it.accountId, it.date, it.description, it.direction, it.amountMinor, it.reference,
          it.balanceMinor ?? null, it.raw, fingerprint, suggestedType, suggestedCategory, dupKind, dupTxn, now, now],
      );
      if (status === 'duplicate') result.duplicates++;
      else {
        result.pending++;
        if (dupKind === 'possible') result.possible++;
      }
    }
  });
  notifyChange();
  return result;
}

// ───────────────────────────── Reading the inbox ─────────────────────────────

export interface InboxItem {
  id: string;
  batch_id: string;
  status: 'pending' | 'approved' | 'rejected' | 'duplicate';
  account_id: string;
  account_name: string;
  account_currency: string;
  date: string;
  description: string;
  direction: 'debit' | 'credit';
  amount_minor: number;
  reference: string | null;
  raw: string;
  suggested_type: string | null;
  suggested_category_id: string | null;
  suggested_category_name: string | null;
  dup_kind: 'none' | 'possible';
  dup_txn_id: string | null;
  dup_date: string | null;
  dup_note: string | null;
  dup_amount_minor: number | null;
  source: string;
}

const ITEM_SQL = `
  SELECT i.*, a.name AS account_name, a.currency AS account_currency,
         c.name AS suggested_category_name, b.source AS source,
         t.date AS dup_date, t.note AS dup_note, t.amount_minor AS dup_amount_minor
  FROM import_items i
  JOIN accounts a ON a.id = i.account_id
  JOIN import_batches b ON b.id = i.batch_id
  LEFT JOIN categories c ON c.id = i.suggested_category_id
  LEFT JOIN transactions t ON t.id = i.dup_txn_id`;

export const listInbox = (db: Db, status: 'pending' | 'duplicate' = 'pending') =>
  db.getAllAsync<InboxItem>(`${ITEM_SQL} WHERE i.status = ? ORDER BY i.date DESC, i.created_at DESC, i.rowid ASC`, [status]);

export const getInboxItem = (db: Db, id: string) => db.getFirstAsync<InboxItem>(`${ITEM_SQL} WHERE i.id = ?`, [id]);

export async function pendingCount(db: Db): Promise<number> {
  return (await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM import_items WHERE status = 'pending'"))?.n ?? 0;
}

// ───────────────────────────── Deciding ─────────────────────────────

export interface Decision {
  type: TxnType;
  /** For expense / income. */
  categoryId: string | null;
  /** For a transfer: the account on the other side, and its amount if the currencies differ. */
  otherAccountId?: string | null;
  otherAmountMinor?: number | null;
  note?: string;
  paymentMethod?: PaymentMethod;
  /** Remember this merchant's category for next time (default true). */
  learn?: boolean;
}

/** Turns a reviewed item into a real transaction. */
export async function approveItem(db: Db, itemId: string, d: Decision): Promise<string> {
  const item = await db.getFirstAsync<{
    id: string; status: string; account_id: string; date: string; description: string; direction: 'debit' | 'credit';
    amount_minor: number; reference: string | null; fingerprint: string;
  }>('SELECT * FROM import_items WHERE id = ?', [itemId]);
  if (!item || item.status !== 'pending') throw new Error('This item was already handled.');
  if (d.type === 'expense' && item.direction === 'credit') throw new Error('Money coming in cannot be an expense. Choose Income or Transfer.');
  if (d.type === 'income' && item.direction === 'debit') throw new Error('Money going out cannot be income. Choose Expense or Transfer.');

  const base: TransactionInput = {
    type: d.type,
    date: item.date,
    accountId: item.account_id,
    amountMinor: item.amount_minor,
    categoryId: d.type === 'transfer' ? null : d.categoryId,
    toAccountId: null,
    toAmountMinor: null,
    paymentMethod: d.paymentMethod ?? 'other',
    note: (d.note ?? item.description).trim(),
    source: 'import',
    externalRef: item.reference ? referenceKey(item.reference) : null,
    fingerprint: item.fingerprint,
  };
  let input = base;
  if (d.type === 'transfer') {
    if (!d.otherAccountId) throw new Error('Choose the account on the other side of the transfer.');
    const other = await db.getFirstAsync<{ currency: string }>('SELECT currency FROM accounts WHERE id = ?', [d.otherAccountId]);
    const mine = await db.getFirstAsync<{ currency: string }>('SELECT currency FROM accounts WHERE id = ?', [item.account_id]);
    const sameCurrency = other?.currency === mine?.currency;
    const otherAmount = sameCurrency ? item.amount_minor : (d.otherAmountMinor ?? 0);
    input =
      item.direction === 'debit'
        ? { ...base, toAccountId: d.otherAccountId, toAmountMinor: otherAmount }
        : { ...base, accountId: d.otherAccountId, amountMinor: otherAmount, toAccountId: item.account_id, toAmountMinor: item.amount_minor };
  }

  let txnId = '';
  await atomic(db, async () => {
    txnId = await createTransaction(db, input);
    const now = nowIso();
    await db.runAsync("UPDATE import_items SET status='approved', resolved_txn_id=?, updated_at=? WHERE id=?", [txnId, now, itemId]);
    if (d.type !== 'transfer' && d.categoryId && d.learn !== false) {
      await learnMerchant(db, merchantKey(item.description), d.categoryId, d.type);
    }
    if (d.type === 'transfer' && d.otherAccountId) {
      // The other side's statement will show the same money moving. Mark that line as covered.
      const lo = dayjs(item.date).subtract(MAX_POSTING_DAYS, 'day').format(DATE_FMT);
      const hi = dayjs(item.date).add(MAX_POSTING_DAYS, 'day').format(DATE_FMT);
      const otherSideDirection = item.direction === 'debit' ? 'credit' : 'debit';
      const otherAmount = input.type === 'transfer' ? (item.direction === 'debit' ? input.toAmountMinor : input.amountMinor) : null;
      if (otherAmount) {
        await db.runAsync(
          `UPDATE import_items SET status='duplicate', dup_txn_id=?, dup_kind='none', updated_at=?
           WHERE status='pending' AND id <> ? AND account_id = ? AND direction = ? AND amount_minor = ? AND date BETWEEN ? AND ?`,
          [txnId, now, itemId, d.otherAccountId, otherSideDirection, otherAmount, lo, hi],
        );
      }
    }
  });
  notifyChange();
  return txnId;
}

/** "This is that transaction": keeps the existing entry and marks the item as confirmed by the bank. */
export async function linkItem(db: Db, itemId: string, txnId: string): Promise<void> {
  const item = await db.getFirstAsync<{ status: string; description: string; reference: string | null; fingerprint: string }>(
    'SELECT status, description, reference, fingerprint FROM import_items WHERE id = ?', [itemId]);
  if (!item || item.status !== 'pending') throw new Error('This item was already handled.');
  const txn = await db.getFirstAsync<{ id: string; type: string; category_id: string | null }>(
    'SELECT id, type, category_id FROM transactions WHERE id = ? AND deleted_at IS NULL', [txnId]);
  if (!txn) throw new Error('That transaction no longer exists.');
  await atomic(db, async () => {
    const now = nowIso();
    await db.runAsync("UPDATE import_items SET status='approved', resolved_txn_id=?, updated_at=? WHERE id=?", [txnId, now, itemId]);
    await db.runAsync('UPDATE transactions SET external_ref = COALESCE(external_ref, ?), fingerprint = COALESCE(fingerprint, ?) WHERE id = ?', [
      item.reference ? referenceKey(item.reference) : null, item.fingerprint, txnId,
    ]);
    if ((txn.type === 'expense' || txn.type === 'income') && txn.category_id) {
      await learnMerchant(db, merchantKey(item.description), txn.category_id, txn.type);
    }
  });
  notifyChange();
}

export async function rejectItem(db: Db, itemId: string): Promise<void> {
  await db.runAsync("UPDATE import_items SET status='rejected', updated_at=? WHERE id=? AND status='pending'", [nowIso(), itemId]);
  notifyChange();
}

/** A skipped duplicate that is really a different transaction: put it back for review. */
export async function restoreDuplicate(db: Db, itemId: string): Promise<void> {
  await db.runAsync("UPDATE import_items SET status='pending', dup_kind='none', dup_txn_id=NULL, updated_at=? WHERE id=? AND status='duplicate'", [nowIso(), itemId]);
  notifyChange();
}

/**
 * Approves every pending item that has a remembered category, no doubts about duplicates and is a
 * plain expense or income. Returns how many were added.
 */
export async function approveAllSuggested(db: Db): Promise<number> {
  const rows = await db.getAllAsync<{ id: string; suggested_type: string; suggested_category_id: string }>(
    `SELECT id, suggested_type, suggested_category_id FROM import_items
     WHERE status = 'pending' AND dup_kind = 'none' AND suggested_category_id IS NOT NULL
       AND suggested_type IN ('expense','income') ORDER BY date`,
  );
  let n = 0;
  await atomic(db, async () => {
    for (const r of rows) {
      await approveItem(db, r.id, { type: r.suggested_type as 'expense' | 'income', categoryId: r.suggested_category_id });
      n++;
    }
  });
  return n;
}

export async function rejectAllPending(db: Db): Promise<number> {
  const r = await db.runAsync("UPDATE import_items SET status='rejected', updated_at=? WHERE status='pending'", [nowIso()]);
  notifyChange();
  return r.changes;
}
