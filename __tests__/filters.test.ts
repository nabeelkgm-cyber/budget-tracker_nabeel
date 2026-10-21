/** @jest-environment node */
import { createAccount } from '@/db/repositories/accounts';
import { listCategories } from '@/db/repositories/categories';
import { setCurrencyRate } from '@/db/repositories/currencies';
import {
  createTransaction,
  deleteTransaction,
  listTransactions,
  summarizeTransactions,
} from '@/db/repositories/transactions';
import { createCategory } from '@/db/repositories/categories';
import { loadSampleData } from '@/db/seed/sampleData';
import type { Db } from '@/db/types';
import { monthRange, today } from '@/lib/dates';
import type { TransactionInput } from '@/types';
import { createReadyDb } from './helpers/testDb';

let db: Db;
let cat: Record<string, string>;
let cbq: string;
let hdfc: string;
let doha: string;

const acct = (name: string, currency: string) =>
  createAccount(db, { name, type: 'bank', currency, openingBalanceMinor: 0, creditLimitMinor: null, statementDay: null, dueDay: null, icon: 'business', color: '#000' });

const add = (p: Partial<TransactionInput> & Pick<TransactionInput, 'accountId' | 'amountMinor' | 'date'>) =>
  createTransaction(db, { type: 'expense', categoryId: cat.Groceries, toAccountId: null, toAmountMinor: null, paymentMethod: 'cash', note: '', ...p });

beforeEach(async () => {
  db = await createReadyDb();
  cat = Object.fromEntries((await listCategories(db)).map((c) => [c.name, c.id]));
  cbq = await acct('CBQ', 'QAR');
  doha = await acct('Doha', 'QAR');
  hdfc = await acct('HDFC', 'INR');
});

describe('summarizeTransactions (month totals)', () => {
  it('counts income and expense in QAR, excludes transfers and deleted entries', async () => {
    await add({ accountId: cbq, amountMinor: 1000000, date: '2026-10-01', type: 'income', categoryId: cat.Salary });
    await add({ accountId: cbq, amountMinor: 250000, date: '2026-10-05' });
    await add({ accountId: hdfc, amountMinor: 2410000, date: '2026-10-06' }); // INR 24,100 @0.0413 = QAR 995.33
    await add({ type: 'transfer', categoryId: null, accountId: cbq, amountMinor: 300000, toAccountId: doha, toAmountMinor: 300000, date: '2026-10-07' });
    const gone = await add({ accountId: cbq, amountMinor: 999999, date: '2026-10-08' });
    await deleteTransaction(db, gone);

    const { from, to } = monthRange('2026-10-15');
    const t = await summarizeTransactions(db, { dateFrom: from, dateTo: to });
    expect(t.incomeMinor).toBe(1000000);
    expect(t.expenseMinor).toBe(250000 + 99533);
    expect(t.count).toBe(4); // income, 2 expenses, 1 transfer
  });

  it('month boundaries are inclusive and other months are excluded', async () => {
    await add({ accountId: cbq, amountMinor: 100, date: '2026-09-30' });
    await add({ accountId: cbq, amountMinor: 200, date: '2026-10-01' });
    await add({ accountId: cbq, amountMinor: 400, date: '2026-10-31' });
    await add({ accountId: cbq, amountMinor: 800, date: '2026-11-01' });
    const { from, to } = monthRange('2026-10-10');
    expect((await summarizeTransactions(db, { dateFrom: from, dateTo: to })).expenseMinor).toBe(600);
  });

  it('uses the rate frozen on each entry, not the current rate', async () => {
    await add({ accountId: hdfc, amountMinor: 1000000, date: '2026-10-02' });
    await setCurrencyRate(db, 'INR', 9_000_000);
    expect((await summarizeTransactions(db)).expenseMinor).toBe(41300);
  });
});

describe('search and filters', () => {
  beforeEach(async () => {
    await add({ accountId: cbq, amountMinor: 12550, date: '2026-10-01', note: 'Lulu Hypermarket' });
    await add({ accountId: cbq, amountMinor: 8000, date: '2026-10-02', categoryId: cat.Dining, note: 'Pizza' });
    await add({ accountId: doha, amountMinor: 5000, date: '2026-09-15', categoryId: cat.Fuel, note: '100% petrol_card' });
    await add({ accountId: cbq, amountMinor: 500000, date: '2026-10-03', type: 'income', categoryId: cat.Salary, note: 'Salary Oct' });
    await add({ type: 'transfer', categoryId: null, accountId: cbq, amountMinor: 20000, toAccountId: doha, toAmountMinor: 20000, date: '2026-10-04', note: 'Top up' });
  });

  const notes = async (filter: Parameters<typeof listTransactions>[1]) =>
    (await listTransactions(db, { filter: filter?.filter })).map((t) => t.note).sort();

  it('searches note, category and account names (case-insensitive)', async () => {
    expect(await notes({ filter: { search: 'lulu' } })).toEqual(['Lulu Hypermarket']);
    expect(await notes({ filter: { search: 'dining' } })).toEqual(['Pizza']);
    expect(await notes({ filter: { search: 'doha' } })).toEqual(['100% petrol_card', 'Top up']);
  });

  it('searches by exact amount', async () => {
    expect(await notes({ filter: { search: '125.50' } })).toEqual(['Lulu Hypermarket']);
    expect(await notes({ filter: { search: '80' } })).toEqual(['Pizza']);
  });

  it('treats % and _ in the search text literally', async () => {
    expect(await notes({ filter: { search: '100%' } })).toEqual(['100% petrol_card']);
    expect(await notes({ filter: { search: 'petrol_' } })).toEqual(['100% petrol_card']);
    expect(await notes({ filter: { search: '%' } })).toEqual(['100% petrol_card']);
  });

  it('filters by type, account (either side of a transfer) and category', async () => {
    expect(await notes({ filter: { type: 'income' } })).toEqual(['Salary Oct']);
    expect(await notes({ filter: { type: 'transfer' } })).toEqual(['Top up']);
    expect(await notes({ filter: { accountId: doha } })).toEqual(['100% petrol_card', 'Top up']);
    expect(await notes({ filter: { categoryId: cat.Dining } })).toEqual(['Pizza']);
  });

  it('a parent category includes its sub-categories', async () => {
    const sub = await createCategory(db, { name: 'Cafe', kind: 'expense', parentId: cat.Dining, icon: 'cafe', color: '#111' });
    await add({ accountId: cbq, amountMinor: 1500, date: '2026-10-09', categoryId: sub, note: 'Latte' });
    expect(await notes({ filter: { categoryId: cat.Dining } })).toEqual(['Latte', 'Pizza']);
    expect(await notes({ filter: { categoryId: sub } })).toEqual(['Latte']);
  });

  it('filters by an inclusive date range', async () => {
    expect(await notes({ filter: { dateFrom: '2026-10-01', dateTo: '2026-10-02' } })).toEqual(['Lulu Hypermarket', 'Pizza']);
    expect(await notes({ filter: { dateTo: '2026-09-30' } })).toEqual(['100% petrol_card']);
  });

  it('combines filters, and totals follow the same filter', async () => {
    const f = { accountId: cbq, dateFrom: '2026-10-01', dateTo: '2026-10-31', type: 'expense' as const };
    expect(await notes({ filter: f })).toEqual(['Lulu Hypermarket', 'Pizza']);
    const t = await summarizeTransactions(db, f);
    expect(t).toEqual({ count: 2, incomeMinor: 0, expenseMinor: 20550 });
  });

  it('returns nothing for a search with no match', async () => {
    expect(await notes({ filter: { search: 'zzz' } })).toEqual([]);
    expect((await summarizeTransactions(db, { search: 'zzz' })).count).toBe(0);
  });
});

describe('sample data summary', () => {
  it('this month totals equal the sum of this month entries', async () => {
    await loadSampleData(db);
    const { from, to } = monthRange(today());
    const rows = await listTransactions(db, { limit: 1000, filter: { dateFrom: from, dateTo: to } });
    const income = rows.filter((r) => r.type === 'income').reduce((s, r) => s + r.base_amount_minor, 0);
    const expense = rows.filter((r) => r.type === 'expense').reduce((s, r) => s + r.base_amount_minor, 0);
    const t = await summarizeTransactions(db, { dateFrom: from, dateTo: to });
    expect([t.incomeMinor, t.expenseMinor]).toEqual([income, expense]);
  });
});
