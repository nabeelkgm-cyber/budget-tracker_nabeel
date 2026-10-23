/** @jest-environment node */
import { strFromU8, unzipSync } from 'fflate';
import { createAccount, getAccount, listAccounts } from '@/db/repositories/accounts';
import { createCategory, listCategories } from '@/db/repositories/categories';
import { setCurrencyRate } from '@/db/repositories/currencies';
import {
  BACKUP_TABLES,
  applyCsvImport,
  createBackup,
  exportCsv,
  exportWorkbookSheets,
  fingerprintOf,
  parseBackup,
  parseDateText,
  previewCsvImport,
  restoreBackup,
} from '@/db/repositories/dataTransfer';
import { createTransaction, deleteTransaction, listTransactions } from '@/db/repositories/transactions';
import { isSeeded } from '@/db/currencySetup';
import { eraseAllData, loadFullDemoData as loadSampleData } from '@/db/seed/sampleData';
import type { Db } from '@/db/types';
import { getBaseCurrency } from '@/domain/currencies';
import { toCsv } from '@/domain/csv';
import { foreignPerBaseToRateE8 } from '@/domain/money';
import { buildXlsx } from '@/domain/xlsx';
import { createReadyDb } from './helpers/testDb';

let db: Db;
let cat: Record<string, string>;
let cbq: string;
let doha: string;
let hdfc: string;

const acct = (name: string, currency = 'QAR', opening = 0) =>
  createAccount(db, { name, type: 'bank', currency, openingBalanceMinor: opening, creditLimitMinor: null, statementDay: null, dueDay: null, icon: 'business', color: '#000' });

const spend = (date: string, amountMinor: number, category: string, extra: Record<string, unknown> = {}) =>
  createTransaction(db, { type: 'expense', date, accountId: cbq, amountMinor, categoryId: cat[category], toAccountId: null, toAmountMinor: null, paymentMethod: 'cash', note: '', ...extra });

const dump = async (d: Db) => {
  const out: Record<string, unknown[]> = {};
  for (const t of BACKUP_TABLES) out[t] = await d.getAllAsync(`SELECT * FROM ${t} ORDER BY 1, 2`);
  return out;
};
const balances = async (d: Db) => Object.fromEntries((await listAccounts(d, { includeArchived: true })).map((a) => [a.name, a.balance_minor]));

beforeEach(async () => {
  db = await createReadyDb();
  cat = Object.fromEntries((await listCategories(db)).map((c) => [c.name, c.id]));
  cbq = await acct('CBQ', 'QAR', 1_000_000);
  doha = await acct('Doha', 'QAR');
  hdfc = await acct('HDFC', 'INR');
});

describe('export', () => {
  it('CSV has a header and one exact row per transaction, oldest first', async () => {
    await spend('2026-10-02', 12_550, 'Groceries', { note: 'Lulu, "Hyper"' });
    await createTransaction(db, { type: 'transfer', date: '2026-10-01', accountId: cbq, amountMinor: 100_000, categoryId: null, toAccountId: hdfc, toAmountMinor: 2_410_000, paymentMethod: 'bank_transfer', note: '' });
    const lines = (await exportCsv(db)).trim().split('\r\n');
    expect(lines[0]).toBe('ID,Date,Type,Account,Amount,Currency,Category,Sub-category,To account,To amount,To currency,Payment method,Note,Rate to base,Amount in base,Recurring,Source');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(',2026-10-01,Transfer,CBQ,1000.00,QAR,,,HDFC,24100.00,INR,bank_transfer,');
    expect(lines[2]).toContain(',2026-10-02,Expense,CBQ,125.50,QAR,Groceries,,,,,cash,"Lulu, ""Hyper""",');
  });

  it('the workbook has four sheets and real numbers, and the file is a valid zip', async () => {
    await spend('2026-10-02', 12_550, 'Groceries');
    const sheets = await exportWorkbookSheets(db);
    expect(sheets.map((s) => s.name)).toEqual(['Transactions', 'Accounts', 'Categories', 'Budgets']);
    expect(sheets[0].rows[0][3]).toBe(125.5);
    expect(sheets[1].rows.find((r) => r[0] === 'CBQ')![4]).toBe(9874.5);
    const zip = unzipSync(buildXlsx(sheets));
    expect(strFromU8(zip['xl/workbook.xml'])).toContain('name="Transactions"');
  });
});

describe('CSV import', () => {
  it('round trip: export, delete the transactions, import them back as they were', async () => {
    await loadSampleData(db);
    const beforeBalances = await balances(db);
    const before = await listTransactions(db, { limit: 5000 });
    const csv = await exportCsv(db);
    await db.execAsync('DELETE FROM recurring_due; DELETE FROM recurring_rules; DELETE FROM transactions;');
    expect(Object.values(await balances(db)).some((b, i) => b !== Object.values(beforeBalances)[i])).toBe(true);

    const preview = await previewCsvImport(db, csv);
    expect(preview.fatal).toBeNull();
    expect(preview.errors).toEqual([]);
    expect(preview.duplicates).toBe(0);
    expect(preview.toImport).toHaveLength(before.length);
    expect(await applyCsvImport(db, preview)).toBe(before.length);

    expect(await balances(db)).toEqual(beforeBalances);
    const after = await listTransactions(db, { limit: 5000 });
    const key = (t: (typeof after)[number]) => [t.id, t.date, t.type, t.account_id, t.amount_minor, t.category_id, t.to_account_id, t.to_amount_minor, t.note, t.fx_rate_e8, t.base_amount_minor].join('|');
    expect(after.map(key).sort()).toEqual(before.map(key).sort());
  });

  it('importing the same file again adds nothing (all duplicates)', async () => {
    await spend('2026-10-02', 5000, 'Dining', { note: 'Pizza' });
    await spend('2026-10-03', 7000, 'Dining', { note: 'Burger' });
    const csv = await exportCsv(db);
    const again = await previewCsvImport(db, csv);
    expect(again.toImport).toHaveLength(0);
    expect(again.duplicates).toBe(2);
    await applyCsvImport(db, again);
    expect(await listTransactions(db)).toHaveLength(2);
  });

  it('without IDs it still recognises transactions already in the app, and keeps genuine repeats', async () => {
    await spend('2026-10-02', 1000, 'Dining', { note: 'Coffee' });
    const csv = toCsv([
      ['Date', 'Type', 'Account', 'Amount', 'Category', 'Note'],
      ['2026-10-02', 'Expense', 'CBQ', '10.00', 'Dining', 'coffee '], // same as the existing one
      ['2026-10-02', 'Expense', 'CBQ', '10.00', 'Dining', 'Coffee'], // a genuine second coffee
      ['2026-10-02', 'Expense', 'CBQ', '10.00', 'Dining', 'Coffee'], // and a third
    ]);
    const p = await previewCsvImport(db, csv);
    expect([p.duplicates, p.toImport.length]).toEqual([1, 2]);
    await applyCsvImport(db, p);
    expect(await listTransactions(db)).toHaveLength(3);
  });

  it('reports problems per row and imports nothing it cannot understand', async () => {
    const csv = toCsv([
      ['Date', 'Type', 'Account', 'Amount', 'Category', 'To account', 'To amount', 'Currency'],
      ['2026-10-02', 'Expense', 'Nope', '10', 'Dining', '', '', ''],
      ['31/02/2026', 'Expense', 'CBQ', '10', 'Dining', '', '', ''],
      ['2026-10-02', 'Spend', 'CBQ', '10', 'Dining', '', '', ''],
      ['2026-10-02', 'Expense', 'CBQ', '-10', 'Dining', '', '', ''],
      ['2026-10-02', 'Expense', 'CBQ', '10.123', 'Dining', '', '', ''],
      ['2026-10-02', 'Expense', 'CBQ', '10', 'Unknown', '', '', ''],
      ['2026-10-02', 'Expense', 'CBQ', '10', 'Salary', '', '', ''],
      ['2026-10-02', 'Expense', 'CBQ', '10', 'Dining', '', '', 'INR'],
      ['2026-10-02', 'Transfer', 'CBQ', '10', '', 'HDFC', '', ''],
      ['2026-10-02', 'Transfer', 'CBQ', '10', '', 'CBQ', '', ''],
      ['2026-10-02', 'Expense', 'CBQ', '10', 'Dining', '', '', ''], // the one good row
    ]);
    const p = await previewCsvImport(db, csv);
    expect(p.toImport).toHaveLength(1);
    expect(p.errors.map((e) => e.rowNumber)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(p.errors[0].message).toMatch(/Account "Nope" does not exist/);
    expect(p.errors[1].message).toMatch(/Date/);
    expect(p.errors[3].message).toMatch(/positive/);
    expect(p.errors[7].message).toMatch(/does not match account/);
    expect(p.errors[8].message).toMatch(/different currencies/);
  });

  it('rejects files with no usable header, or empty files', async () => {
    expect((await previewCsvImport(db, '')).fatal).toMatch(/empty/);
    expect((await previewCsvImport(db, 'a,b\n1,2')).fatal).toMatch(/Missing: date, type, account, amount/);
  });

  it('reads day-first dates, semicolon files, a BOM, and header names in any case', async () => {
    const text = '﻿DATE;TYPE;ACCOUNT;AMOUNT;CATEGORY;NOTES\r\n21/10/2026;expense;cbq;12.50;dining;Lunch\r\n';
    const p = await previewCsvImport(db, text);
    expect(p.errors).toEqual([]);
    expect(p.toImport[0].input).toMatchObject({ date: '2026-10-21', amountMinor: 1250, note: 'Lunch', type: 'expense' });
  });

  it('finds sub-categories, and treats the rate column as the historical rate', async () => {
    const cafe = await createCategory(db, { name: 'Cafe', kind: 'expense', parentId: cat.Dining, icon: 'cafe', color: '#111' });
    const csv = toCsv([
      ['Date', 'Type', 'Account', 'Amount', 'Category', 'Sub-category', 'Rate to base'],
      ['2026-10-02', 'Expense', 'HDFC', '2410.00', 'Dining', 'Cafe', '0.05000000'],
    ]);
    const p = await previewCsvImport(db, csv);
    await applyCsvImport(db, p);
    const [t] = await listTransactions(db);
    expect([t.category_id, t.fx_rate_e8, t.base_amount_minor]).toEqual([cafe, 5_000_000, 12_050]);
  });

  it('restores notes that were protected against spreadsheet formulas', async () => {
    await spend('2026-10-02', 1000, 'Dining', { note: '=HYPERLINK("x")' });
    const csv = await exportCsv(db);
    expect(csv).toContain("'=HYPERLINK");
    await deleteTransaction(db, (await listTransactions(db))[0].id);
    await db.execAsync('DELETE FROM transactions;');
    const p = await previewCsvImport(db, csv);
    expect(p.toImport[0].input.note).toBe('=HYPERLINK("x")');
  });

  it('imports 3-decimal amounts for an OMR account', async () => {
    const odb = await createReadyDb('OMR');
    await createAccount(odb, { name: 'Muscat', type: 'bank', currency: 'OMR', openingBalanceMinor: 0, creditLimitMinor: null, statementDay: null, dueDay: null, icon: 'b', color: '#000' });
    const p = await previewCsvImport(odb, toCsv([['Date', 'Type', 'Account', 'Amount', 'Category'], ['2026-10-02', 'Expense', 'Muscat', '12.505', 'Fuel']]));
    expect(p.errors).toEqual([]);
    expect(p.toImport[0].input.amountMinor).toBe(12_505);
    const bad = await previewCsvImport(odb, toCsv([['Date', 'Type', 'Account', 'Amount', 'Category'], ['2026-10-02', 'Expense', 'Muscat', '12.5055', 'Fuel']]));
    expect(bad.errors[0].message).toMatch(/max 3 decimals/);
  });

  it('the import is all-or-nothing', async () => {
    const p = await previewCsvImport(db, toCsv([['Date', 'Type', 'Account', 'Amount', 'Category'], ['2026-10-02', 'Expense', 'CBQ', '10', 'Dining'], ['2026-10-03', 'Expense', 'CBQ', '20', 'Dining']]));
    p.toImport[1].input.accountId = 'missing-account'; // make the second fail
    await expect(applyCsvImport(db, p)).rejects.toThrow();
    expect(await listTransactions(db)).toHaveLength(0);
  });

  it('date parsing', () => {
    expect(parseDateText('2026-10-21')).toBe('2026-10-21');
    expect(parseDateText('21/10/2026')).toBe('2026-10-21');
    expect(parseDateText('1-2-2026')).toBe('2026-02-01');
    expect(parseDateText('2026-10-21T08:00:00Z')).toBe('2026-10-21');
    for (const bad of ['', '2026-13-01', '31/04/2026', '10/21/2026', 'yesterday']) expect(parseDateText(bad)).toBeNull();
  });

  it('fingerprint ignores case and extra spaces in notes only', () => {
    const base = { date: '2026-10-02', type: 'expense', accountId: 'a', amountMinor: 100, toAccountId: null };
    expect(fingerprintOf({ ...base, note: ' Coffee  Shop ' })).toBe(fingerprintOf({ ...base, note: 'coffee shop' }));
    expect(fingerprintOf({ ...base, note: 'x' })).not.toBe(fingerprintOf({ ...base, amountMinor: 101, note: 'x' }));
  });
});

describe('backup and restore', () => {
  it('a restored backup is identical to the original, including deleted entries and budgets', async () => {
    await loadSampleData(db);
    const gone = (await listTransactions(db))[0];
    await deleteTransaction(db, gone.id);
    const original = await dump(db);
    const originalBalances = await balances(db);
    const text = await createBackup(db);

    await eraseAllData(db);
    expect(await isSeeded(db)).toBe(false);
    const { backup, summary } = parseBackup(text);
    expect(summary.baseCurrency).toBe('QAR');
    expect(summary.accounts).toBe(8);
    expect(summary.transactions).toBeGreaterThan(40);
    await restoreBackup(db, backup);

    expect(await dump(db)).toEqual(original);
    expect(await balances(db)).toEqual(originalBalances);
    expect(await isSeeded(db)).toBe(true);
  });

  it('replaces whatever is in the app now', async () => {
    await spend('2026-10-02', 1000, 'Dining');
    const text = await createBackup(db);
    await acct('Extra account');
    await spend('2026-10-03', 5000, 'Fuel');
    await restoreBackup(db, parseBackup(text).backup);
    expect((await listAccounts(db, { includeArchived: true })).map((a) => a.name).sort()).toEqual(['CBQ', 'Doha', 'HDFC']);
    expect(await listTransactions(db)).toHaveLength(1);
  });

  it('restores the chosen currency and its decimals', async () => {
    const omr = await createReadyDb('OMR');
    const a = await createAccount(omr, { name: 'Muscat', type: 'bank', currency: 'OMR', openingBalanceMinor: 1_000_000, creditLimitMinor: null, statementDay: null, dueDay: null, icon: 'b', color: '#000' });
    const text = await createBackup(omr);
    await eraseAllData(omr);
    await restoreBackup(omr, parseBackup(text).backup);
    expect(getBaseCurrency()).toBe('OMR');
    expect((await getAccount(omr, a))!.balance_minor).toBe(1_000_000);
    await createReadyDb('QAR'); // leave the shared settings as other tests expect
  });

  it('keeps exchange rates and custom rates', async () => {
    await setCurrencyRate(db, 'INR', foreignPerBaseToRateE8('23.5')!);
    const text = await createBackup(db);
    await setCurrencyRate(db, 'INR', foreignPerBaseToRateE8('30')!);
    await restoreBackup(db, parseBackup(text).backup);
    const inr = await db.getFirstAsync<{ rate_to_base_e8: number }>("SELECT rate_to_base_e8 FROM currencies WHERE code='INR'");
    expect(inr!.rate_to_base_e8).toBe(foreignPerBaseToRateE8('23.5'));
  });

  it('refuses files that are not backups, or are damaged, or are from a newer app', async () => {
    const good = JSON.parse(await createBackup(db));
    expect(() => parseBackup('not json')).toThrow(/not valid JSON/);
    expect(() => parseBackup('{"a":1}')).toThrow(/not a Budget Tracker backup/);
    expect(() => parseBackup(JSON.stringify({ ...good, formatVersion: 99 }))).toThrow(/format/);
    expect(() => parseBackup(JSON.stringify({ ...good, schemaVersion: 999 }))).toThrow(/newer version/);
    expect(() => parseBackup(JSON.stringify({ ...good, tables: undefined }))).toThrow(/damaged/);
    expect(() => parseBackup(JSON.stringify({ ...good, tables: { ...good.tables, accounts: 'x' } }))).toThrow(/damaged/);
    expect(() => parseBackup(JSON.stringify({ ...good, tables: { ...good.tables, accounts: [{ id: { a: 1 } }] } }))).toThrow(/damaged/);
    expect(() => parseBackup(JSON.stringify({ ...good, tables: { settings: [], currencies: [] } }))).toThrow(/no data/);
  });

  it('a damaged backup leaves the existing data untouched', async () => {
    await spend('2026-10-02', 1000, 'Dining');
    const before = await dump(db);
    const bad = JSON.parse(await createBackup(db));
    bad.tables.transactions[0].account_id = 'does-not-exist'; // broken link
    await expect(restoreBackup(db, parseBackup(JSON.stringify(bad)).backup)).rejects.toThrow(/inconsistent/);
    expect(await dump(db)).toEqual(before);
  });

  it('ignores unknown columns and cannot be used to inject SQL through column names', async () => {
    await spend('2026-10-02', 1000, 'Dining');
    const data = JSON.parse(await createBackup(db));
    data.tables.accounts[0]['x); DROP TABLE accounts; --'] = 'boom';
    data.tables.accounts[0].future_column = 'ignored';
    await restoreBackup(db, parseBackup(JSON.stringify(data)).backup);
    expect((await listAccounts(db, { includeArchived: true })).length).toBe(3);
  });

  it('an older backup (fewer tables and columns) restores into the current app', async () => {
    const data = JSON.parse(await createBackup(db));
    delete data.tables.recurring_rules;
    delete data.tables.recurring_due;
    delete data.tables.budget_alerts_sent;
    data.schemaVersion = 3;
    for (const t of data.tables.transactions) { delete t.recurring_due_date; }
    await restoreBackup(db, parseBackup(JSON.stringify(data)).backup);
    expect((await listAccounts(db)).length).toBe(3);
  });
});
