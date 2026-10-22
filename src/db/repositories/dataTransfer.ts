import { getBaseCurrency, decimalsOf } from '@/domain/currencies';
import { parseCsv, toCsv, unprotectCell, CsvCell } from '@/domain/csv';
import { minorToInput, parseAmountToMinor, parseRateToE8 } from '@/domain/money';
import { validateTransaction } from '@/domain/transactionRules';
import type { Sheet } from '@/domain/xlsx';
import type { PaymentMethod, TransactionInput, TxnType } from '@/types';
import { assertSyncOff } from '../../sync/guard';
import { atomic } from '../atomic';
import { ensureCurrencyCatalog, loadCurrencyRegistry } from '../currencySetup';
import { notifyChange } from '../events';
import { LATEST_VERSION } from '../migrations';
import type { Db } from '../types';
import { listAccounts } from './accounts';
import { listCategories } from './categories';
import { createTransaction, listTransactions } from './transactions';

// ───────────────────────────── Export ─────────────────────────────

export const TRANSACTION_HEADERS = [
  'ID',
  'Date',
  'Type',
  'Account',
  'Amount',
  'Currency',
  'Category',
  'Sub-category',
  'To account',
  'To amount',
  'To currency',
  'Payment method',
  'Note',
  'Rate to base',
  'Amount in base',
  'Recurring',
  'Source',
] as const;

const TYPE_LABEL: Record<TxnType, string> = { expense: 'Expense', income: 'Income', transfer: 'Transfer' };

/** Every transaction as text cells, in the app's own CSV layout. Amounts are exact decimals. */
export async function exportTransactionCells(db: Db): Promise<CsvCell[][]> {
  const rows = await listTransactions(db, { limit: 1_000_000 });
  const base = getBaseCurrency();
  const out: CsvCell[][] = [[...TRANSACTION_HEADERS]];
  for (const t of [...rows].reverse()) {
    const isTransfer = t.type === 'transfer';
    out.push([
      t.id,
      t.date,
      TYPE_LABEL[t.type],
      t.account_name,
      minorToInput(t.amount_minor, t.account_currency),
      t.account_currency,
      isTransfer ? '' : (t.parent_category_name ?? t.category_name ?? ''),
      isTransfer ? '' : t.parent_category_name ? (t.category_name ?? '') : '',
      t.to_account_name ?? '',
      t.to_amount_minor !== null && t.to_account_currency ? minorToInput(t.to_amount_minor, t.to_account_currency) : '',
      t.to_account_currency ?? '',
      t.payment_method,
      t.note,
      (t.fx_rate_e8 / 1e8).toFixed(8),
      minorToInput(t.base_amount_minor, base),
      t.recurring_id ? 'Yes' : '',
      t.source,
    ]);
  }
  return out;
}

export async function exportCsv(db: Db): Promise<string> {
  return toCsv(await exportTransactionCells(db));
}

const major = (minor: number, currency: string) => minor / 10 ** decimalsOf(currency);

/** Four sheets for Excel: transactions, accounts, categories, budgets. Amounts are real numbers. */
export async function exportWorkbookSheets(db: Db): Promise<Sheet[]> {
  const base = getBaseCurrency();
  const txns = await listTransactions(db, { limit: 1_000_000 });
  const accounts = await listAccounts(db, { includeArchived: true });
  const cats = await listCategories(db, { includeArchived: true });
  const budgets = await db.getAllAsync<{ month: string; name: string; amount_minor: number; rollover: number }>(
    `SELECT b.month, c.name, b.amount_minor, b.rollover FROM budgets b
     JOIN categories c ON c.id = b.category_id WHERE b.deleted_at IS NULL ORDER BY b.month, c.name`,
  );
  const baseKind = decimalsOf(base) === 3 ? 'amount3' : 'amount2';

  return [
    {
      name: 'Transactions',
      columns: [
        { header: 'Date', kind: 'date', width: 12 },
        { header: 'Type', width: 10 },
        { header: 'Account', width: 22 },
        { header: 'Amount', kind: 'amount3', width: 14 },
        { header: 'Currency', width: 9 },
        { header: 'Category', width: 20 },
        { header: 'Sub-category', width: 18 },
        { header: 'To account', width: 22 },
        { header: 'To amount', kind: 'amount3', width: 14 },
        { header: 'To currency', width: 11 },
        { header: 'Payment method', width: 15 },
        { header: 'Note', width: 34 },
        { header: `Amount in ${base}`, kind: baseKind, width: 16 },
        { header: 'Rate to base', kind: 'number', width: 13 },
      ],
      rows: [...txns].reverse().map((t) => [
        t.date,
        TYPE_LABEL[t.type],
        t.account_name,
        major(t.amount_minor, t.account_currency),
        t.account_currency,
        t.type === 'transfer' ? '' : (t.parent_category_name ?? t.category_name ?? ''),
        t.type === 'transfer' ? '' : t.parent_category_name ? (t.category_name ?? '') : '',
        t.to_account_name ?? '',
        t.to_amount_minor !== null && t.to_account_currency ? major(t.to_amount_minor, t.to_account_currency) : null,
        t.to_account_currency ?? '',
        t.payment_method,
        t.note,
        major(t.base_amount_minor, base),
        t.fx_rate_e8 / 1e8,
      ]),
    },
    {
      name: 'Accounts',
      columns: [
        { header: 'Name', width: 24 },
        { header: 'Type', width: 12 },
        { header: 'Currency', width: 9 },
        { header: 'Opening balance', kind: 'amount3', width: 16 },
        { header: 'Current balance', kind: 'amount3', width: 16 },
        { header: 'Credit limit', kind: 'amount3', width: 14 },
        { header: 'Statement day', kind: 'number', width: 14 },
        { header: 'Due day', kind: 'number', width: 9 },
        { header: 'Archived', width: 9 },
      ],
      rows: accounts.map((a) => [
        a.name,
        a.type.replace('_', ' '),
        a.currency,
        major(a.opening_balance_minor, a.currency),
        major(a.balance_minor, a.currency),
        a.credit_limit_minor === null ? null : major(a.credit_limit_minor, a.currency),
        a.statement_day,
        a.due_day,
        a.is_archived ? 'Yes' : '',
      ]),
    },
    {
      name: 'Categories',
      columns: [
        { header: 'Name', width: 24 },
        { header: 'Main category', width: 20 },
        { header: 'Type', width: 10 },
        { header: 'Archived', width: 9 },
      ],
      rows: cats.map((c) => [
        c.name,
        cats.find((p) => p.id === c.parent_id)?.name ?? '',
        c.kind,
        c.is_archived ? 'Yes' : '',
      ]),
    },
    {
      name: 'Budgets',
      columns: [
        { header: 'Month', width: 10 },
        { header: 'Category', width: 22 },
        { header: `Budget (${base})`, kind: baseKind, width: 16 },
        { header: 'Rollover', width: 9 },
      ],
      rows: budgets.map((b) => [b.month, b.name, major(b.amount_minor, base), b.rollover ? 'Yes' : '']),
    },
  ];
}

// ─────────────────────────── CSV import ───────────────────────────

export const MAX_IMPORT_ROWS = 20_000;

export interface ImportRow {
  rowNumber: number;
  input: TransactionInput;
}

export interface ImportError {
  rowNumber: number;
  message: string;
}

export interface ImportPreview {
  totalRows: number;
  toImport: ImportRow[];
  /** Rows skipped because the same transaction is already in the app. */
  duplicates: number;
  errors: ImportError[];
  /** Set when the file itself cannot be used (no header, missing columns...). */
  fatal: string | null;
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const HEADER_ALIASES: Record<string, string[]> = {
  id: ['id'],
  date: ['date', 'transactiondate', 'txndate'],
  type: ['type', 'transactiontype'],
  account: ['account', 'accountname'],
  amount: ['amount'],
  currency: ['currency'],
  category: ['category'],
  subcategory: ['subcategory', 'subcat'],
  toaccount: ['toaccount', 'transferto'],
  toamount: ['toamount'],
  paymentmethod: ['paymentmethod', 'method'],
  note: ['note', 'notes', 'description', 'memo'],
  ratetobase: ['ratetobase', 'exchangerate', 'fxrate'],
};

/** "21/10/2026", "21-10-2026", "21.10.2026" (day first) and "2026-10-21" -> "2026-10-21", or null. */
export function parseDateText(text: string): string | null {
  const s = text.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(s))) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else return null;
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function paymentMethodOf(text: string): PaymentMethod {
  const k = text.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return (['cash', 'card', 'bank_transfer', 'upi', 'other'] as const).find((m) => m === k) ?? 'other';
}

/** Two rows are "the same transaction" when these match (note ignores case and spacing). */
export const fingerprintOf = (t: {
  date: string;
  type: string;
  accountId: string;
  amountMinor: number;
  toAccountId: string | null;
  note: string;
}): string =>
  [t.date, t.type, t.accountId, t.amountMinor, t.toAccountId ?? '', t.note.trim().replace(/\s+/g, ' ').toLowerCase()].join('|');

/**
 * Reads CSV text into transactions without saving anything: finds problems row by row and skips
 * transactions that are already in the app. Accounts and categories must already exist.
 */
export async function previewCsvImport(db: Db, text: string): Promise<ImportPreview> {
  const empty = (fatal: string): ImportPreview => ({ totalRows: 0, toImport: [], duplicates: 0, errors: [], fatal });
  const rows = parseCsv(text);
  if (rows.length === 0) return empty('The file is empty.');
  if (rows.length - 1 > MAX_IMPORT_ROWS) return empty(`The file has more than ${MAX_IMPORT_ROWS} rows. Split it and import in parts.`);

  const headerIndex: Record<string, number> = {};
  rows[0].forEach((h, i) => {
    const key = norm(h);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(key) && headerIndex[field] === undefined) headerIndex[field] = i;
    }
  });
  const missing = ['date', 'type', 'account', 'amount'].filter((f) => headerIndex[f] === undefined);
  if (missing.length) {
    return empty(`The first row must be a header with these columns: Date, Type, Account, Amount. Missing: ${missing.join(', ')}.`);
  }

  const [accounts, categories] = await Promise.all([
    listAccounts(db, { includeArchived: true }),
    listCategories(db, { includeArchived: true }),
  ]);
  const accountByName = new Map<string, (typeof accounts)[number][]>();
  for (const a of accounts) {
    const k = a.name.trim().toLowerCase();
    accountByName.set(k, [...(accountByName.get(k) ?? []), a]);
  }
  const base = getBaseCurrency();

  const knownIds = new Set(
    (await db.getAllAsync<{ id: string }>('SELECT id FROM transactions')).map((r) => r.id),
  );
  const existing = new Map<string, number>();
  for (const r of await db.getAllAsync<{
    date: string; type: string; account_id: string; amount_minor: number; to_account_id: string | null; note: string;
  }>('SELECT date, type, account_id, amount_minor, to_account_id, note FROM transactions WHERE deleted_at IS NULL')) {
    const k = fingerprintOf({ date: r.date, type: r.type, accountId: r.account_id, amountMinor: r.amount_minor, toAccountId: r.to_account_id, note: r.note });
    existing.set(k, (existing.get(k) ?? 0) + 1);
  }

  const preview: ImportPreview = { totalRows: rows.length - 1, toImport: [], duplicates: 0, errors: [], fatal: null };
  const get = (row: string[], field: string): string =>
    headerIndex[field] === undefined ? '' : unprotectCell((row[headerIndex[field]] ?? '').trim());

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 1; // as shown in a spreadsheet
    const fail = (message: string) => preview.errors.push({ rowNumber, message });

    const date = parseDateText(get(row, 'date'));
    if (!date) { fail(`Date "${get(row, 'date')}" is not valid. Use YYYY-MM-DD or DD/MM/YYYY.`); continue; }

    const typeText = get(row, 'type').toLowerCase();
    const type = (['expense', 'income', 'transfer'] as const).find((t) => t === typeText);
    if (!type) { fail(`Type "${get(row, 'type')}" must be Expense, Income or Transfer.`); continue; }

    const matches = accountByName.get(get(row, 'account').toLowerCase()) ?? [];
    if (matches.length === 0) { fail(`Account "${get(row, 'account')}" does not exist. Create it first.`); continue; }
    if (matches.length > 1) { fail(`Account name "${get(row, 'account')}" is used by more than one account.`); continue; }
    const account = matches[0];

    const currencyText = get(row, 'currency').toUpperCase();
    if (currencyText && currencyText !== account.currency) {
      fail(`Currency ${currencyText} does not match account "${account.name}" (${account.currency}).`);
      continue;
    }

    if (get(row, 'amount').startsWith('-')) { fail('Amount must be positive. Use the Type column for the direction.'); continue; }
    const amountMinor = parseAmountToMinor(get(row, 'amount'), account.currency);
    if (amountMinor === null || amountMinor <= 0) {
      fail(`Amount "${get(row, 'amount')}" is not valid (max ${decimalsOf(account.currency)} decimals).`);
      continue;
    }

    let categoryId: string | null = null;
    let toAccountId: string | null = null;
    let toAmountMinor: number | null = null;
    if (type === 'transfer') {
      const toMatches = accountByName.get(get(row, 'toaccount').toLowerCase()) ?? [];
      if (toMatches.length !== 1) { fail(`To account "${get(row, 'toaccount')}" ${toMatches.length ? 'is ambiguous' : 'does not exist'}.`); continue; }
      const to = toMatches[0];
      toAccountId = to.id;
      if (to.currency === account.currency) toAmountMinor = amountMinor;
      else {
        toAmountMinor = parseAmountToMinor(get(row, 'toamount'), to.currency);
        if (toAmountMinor === null || toAmountMinor <= 0) {
          fail(`The accounts use different currencies, so "To amount" in ${to.currency} is required.`);
          continue;
        }
      }
    } else {
      const catName = get(row, 'category').toLowerCase();
      const subName = get(row, 'subcategory').toLowerCase();
      const main = categories.find((c) => !c.parent_id && c.kind === type && c.name.trim().toLowerCase() === catName);
      if (!main) { fail(`${type === 'income' ? 'Income' : 'Expense'} category "${get(row, 'category')}" does not exist.`); continue; }
      categoryId = main.id;
      if (subName) {
        const sub = categories.find((c) => c.parent_id === main.id && c.name.trim().toLowerCase() === subName);
        if (!sub) { fail(`Sub-category "${get(row, 'subcategory')}" does not exist under "${main.name}".`); continue; }
        categoryId = sub.id;
      }
    }

    let fxRateE8: number | null = null;
    if (get(row, 'ratetobase')) {
      fxRateE8 = parseRateToE8(get(row, 'ratetobase'));
      if (fxRateE8 === null) { fail(`Rate "${get(row, 'ratetobase')}" is not valid.`); continue; }
      if (account.currency === base) fxRateE8 = 100_000_000;
    }

    const rawId = get(row, 'id');
    const input: TransactionInput = {
      type, date, accountId: account.id, amountMinor, categoryId, toAccountId, toAmountMinor,
      paymentMethod: paymentMethodOf(get(row, 'paymentmethod')),
      note: get(row, 'note'), source: 'import', fxRateE8,
      id: rawId && !knownIds.has(rawId) ? rawId : undefined,
    };
    const problem = validateTransaction(input, accounts, categories);
    if (problem) { fail(problem); continue; }

    // Already in the app? (same id, or the same transaction by date/amount/account/note)
    if (rawId && knownIds.has(rawId)) { preview.duplicates++; continue; }
    const key = fingerprintOf({ date, type, accountId: account.id, amountMinor, toAccountId, note: input.note });
    const have = existing.get(key) ?? 0;
    if (have > 0) { existing.set(key, have - 1); preview.duplicates++; continue; }

    input.fingerprint = key;
    preview.toImport.push({ rowNumber, input });
  }
  return preview;
}

/** Saves a previewed import, all or nothing. */
export async function applyCsvImport(db: Db, preview: ImportPreview): Promise<number> {
  await atomic(db, async () => {
    for (const r of preview.toImport) await createTransaction(db, r.input);
  });
  notifyChange();
  return preview.toImport.length;
}

// ───────────────────────── Backup and restore ─────────────────────────

export const BACKUP_APP = 'budget-tracker';
export const BACKUP_FORMAT = 1;

/** Parents before children. Deleting goes in reverse. */
export const BACKUP_TABLES = [
  'settings',
  'currencies',
  'accounts',
  'categories',
  'account_identifiers',
  'merchant_rules',
  'transactions',
  'budgets',
  'budget_alerts_sent',
  'recurring_rules',
  'recurring_due',
  'import_batches',
  'import_items',
] as const;

type Cell = string | number | null;
export interface Backup {
  app: string;
  formatVersion: number;
  schemaVersion: number;
  createdAt: string;
  tables: Record<string, Record<string, Cell>[]>;
}

/** Everything in the app as one JSON text (deleted entries included, so a restore is exact). */
export async function createBackup(db: Db): Promise<string> {
  const tables: Backup['tables'] = {};
  for (const t of BACKUP_TABLES) tables[t] = await db.getAllAsync<Record<string, Cell>>(`SELECT * FROM ${t}`);
  const backup: Backup = {
    app: BACKUP_APP,
    formatVersion: BACKUP_FORMAT,
    schemaVersion: LATEST_VERSION,
    createdAt: new Date().toISOString(),
    tables,
  };
  return JSON.stringify(backup);
}

export interface BackupSummary {
  createdAt: string;
  accounts: number;
  transactions: number;
  categories: number;
  budgets: number;
  baseCurrency: string | null;
}

/** Checks that text is a usable backup. Throws a plain-language error if not. */
export function parseBackup(text: string): { backup: Backup; summary: BackupSummary } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not a backup (it is not valid JSON).');
  }
  const b = data as Partial<Backup> | null;
  if (!b || typeof b !== 'object' || b.app !== BACKUP_APP) throw new Error('This file is not a Budget Tracker backup.');
  if (b.formatVersion !== BACKUP_FORMAT) throw new Error('This backup uses a format this version cannot read.');
  if (typeof b.schemaVersion !== 'number' || b.schemaVersion < 1) throw new Error('This backup is damaged (no version).');
  if (b.schemaVersion > LATEST_VERSION) {
    throw new Error('This backup was made by a newer version of the app. Update the app first, then restore.');
  }
  if (!b.tables || typeof b.tables !== 'object') throw new Error('This backup is damaged (no data).');
  for (const t of BACKUP_TABLES) {
    const rows = (b.tables as Record<string, unknown>)[t];
    if (rows === undefined) continue; // tables added in later versions are simply empty
    if (!Array.isArray(rows)) throw new Error(`This backup is damaged (${t}).`);
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`This backup is damaged (${t}).`);
      for (const v of Object.values(row as object)) {
        if (!(v === null || typeof v === 'string' || typeof v === 'number')) throw new Error(`This backup is damaged (${t}).`);
      }
    }
  }
  const tables = b.tables as Backup['tables'];
  const settings = tables.settings ?? [];
  if (!settings.some((r) => r.key === 'seeded') || !(tables.currencies ?? []).length) {
    throw new Error('This backup has no data in it.');
  }
  return {
    backup: b as Backup,
    summary: {
      createdAt: String(b.createdAt ?? ''),
      accounts: (tables.accounts ?? []).length,
      transactions: (tables.transactions ?? []).filter((r) => r.deleted_at === null).length,
      categories: (tables.categories ?? []).length,
      budgets: (tables.budgets ?? []).filter((r) => r.deleted_at === null).length,
      baseCurrency: (settings.find((r) => r.key === 'base_currency')?.value as string) ?? null,
    },
  };
}

/**
 * Replaces ALL data in the app with the backup. All or nothing: if anything is wrong the
 * existing data is left exactly as it was.
 */
export async function restoreBackup(db: Db, backup: Backup): Promise<void> {
  await assertSyncOff(db);
  await atomic(db, async () => {
    await db.execAsync('PRAGMA defer_foreign_keys = ON;');
    for (const t of [...BACKUP_TABLES].reverse()) await db.execAsync(`DELETE FROM ${t};`);
    for (const t of BACKUP_TABLES) {
      const rows = backup.tables[t] ?? [];
      if (!rows.length) continue;
      // Only columns that really exist are used, so a file cannot inject anything into the SQL.
      const known = new Set((await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${t})`)).map((c) => c.name));
      for (const row of rows) {
        const cols = Object.keys(row).filter((c) => known.has(c));
        if (!cols.length) continue;
        await db.runAsync(
          `INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
          cols.map((c) => row[c]),
        );
      }
    }
    const broken = await db.getAllAsync<unknown>('PRAGMA foreign_key_check');
    if (broken.length) throw new Error('The backup is inconsistent (links between records are broken). Nothing was changed.');
  });
  await ensureCurrencyCatalog(db);
  await loadCurrencyRegistry(db);
  notifyChange();
}

