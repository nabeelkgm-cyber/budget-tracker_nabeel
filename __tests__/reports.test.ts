/** @jest-environment node */
import { createAccount } from '@/db/repositories/accounts';
import { createCategory, listCategories } from '@/db/repositories/categories';
import { getReport } from '@/db/repositories/reports';
import { createTransaction, deleteTransaction } from '@/db/repositories/transactions';
import { loadSampleData } from '@/db/seed/sampleData';
import type { Db } from '@/db/types';
import { currentMonth } from '@/domain/budget';
import type { TransactionInput } from '@/types';
import { createReadyDb } from './helpers/testDb';

let db: Db;
let cat: Record<string, string>;
let cbq: string;
let hdfc: string;
let doha: string;

const acct = (name: string, currency: string) =>
  createAccount(db, { name, type: 'bank', currency, openingBalanceMinor: 0, creditLimitMinor: null, statementDay: null, dueDay: null, icon: 'business', color: '#000' });

const add = (date: string, amountMinor: number, category: string, extra: Partial<TransactionInput> = {}) =>
  createTransaction(db, { type: 'expense', date, accountId: cbq, amountMinor, categoryId: cat[category] ?? category, toAccountId: null, toAmountMinor: null, paymentMethod: 'cash', note: '', ...extra });

const income = (date: string, amountMinor: number, extra: Partial<TransactionInput> = {}) =>
  add(date, amountMinor, 'Salary', { type: 'income', ...extra });

const OCT = { mode: 'month' as const, month: '2026-10' };

beforeEach(async () => {
  db = await createReadyDb();
  cat = Object.fromEntries((await listCategories(db)).map((c) => [c.name, c.id]));
  cbq = await acct('CBQ', 'QAR');
  doha = await acct('Doha', 'QAR');
  hdfc = await acct('HDFC', 'INR');
});

describe('summary totals', () => {
  it('income, expense for the month; transfers and deleted entries excluded', async () => {
    await income('2026-10-01', 1000000);
    await add('2026-10-05', 250000, 'Groceries');
    const gone = await add('2026-10-06', 99999, 'Groceries');
    await deleteTransaction(db, gone);
    await createTransaction(db, { type: 'transfer', date: '2026-10-07', accountId: cbq, amountMinor: 300000, categoryId: null, toAccountId: doha, toAmountMinor: 300000, paymentMethod: 'bank_transfer', note: '' });
    const r = await getReport(db, OCT);
    expect([r.totals.incomeMinor, r.totals.expenseMinor]).toEqual([1000000, 250000]);
    expect([r.from, r.to]).toEqual(['2026-10-01', '2026-10-31']);
  });

  it('year totals cover Jan-Dec only', async () => {
    await add('2025-12-31', 111, 'Rent');
    await add('2026-01-01', 200, 'Rent');
    await add('2026-12-31', 400, 'Rent');
    await add('2027-01-01', 800, 'Rent');
    expect((await getReport(db, { mode: 'year', year: 2026 })).totals.expenseMinor).toBe(600);
  });

  it('custom range is inclusive on both ends', async () => {
    await add('2026-10-09', 1, 'Rent');
    await add('2026-10-10', 2, 'Rent');
    await add('2026-10-20', 4, 'Rent');
    await add('2026-10-21', 8, 'Rent');
    expect((await getReport(db, { mode: 'range', from: '2026-10-10', to: '2026-10-20' })).totals.expenseMinor).toBe(6);
  });

  it('counts foreign-currency entries in QAR at the stored rate', async () => {
    await add('2026-10-02', 2410000, 'Shopping', { accountId: hdfc }); // INR 24,100 @ 0.0413
    expect((await getReport(db, OCT)).totals.expenseMinor).toBe(99533);
  });

  it('compares with the previous period', async () => {
    await add('2026-09-10', 100000, 'Rent');
    await add('2026-10-10', 120000, 'Rent');
    const r = await getReport(db, OCT);
    expect([r.previous.expenseMinor, r.totals.expenseMinor]).toEqual([100000, 120000]);
  });
});

describe('category breakdown', () => {
  it('rolls sub-categories into the main category, biggest first', async () => {
    const cafe = await createCategory(db, { name: 'Cafe', kind: 'expense', parentId: cat.Dining, icon: 'cafe', color: '#111' });
    await add('2026-10-02', 10000, 'Dining');
    await add('2026-10-03', 15000, cafe);
    await add('2026-10-04', 30000, 'Groceries');
    await add('2026-09-04', 99000, 'Rent'); // other month
    const r = await getReport(db, OCT);
    expect(r.expenseBreakdown.map((s) => [s.name, s.totalMinor, s.count])).toEqual([
      ['Groceries', 30000, 1],
      ['Dining', 25000, 2],
    ]);
  });

  it('sums of the slices equal the total expense', async () => {
    await add('2026-10-02', 1111, 'Dining');
    await add('2026-10-03', 2222, 'Fuel');
    await add('2026-10-04', 3333, 'Rent', { accountId: hdfc });
    const r = await getReport(db, OCT);
    expect(r.expenseBreakdown.reduce((s, x) => s + x.totalMinor, 0)).toBe(r.totals.expenseMinor);
  });

  it('has a separate income breakdown', async () => {
    await income('2026-10-01', 1000000);
    await add('2026-10-02', 5000, 'Other Income', { type: 'income', categoryId: cat['Other Income'] });
    const r = await getReport(db, OCT);
    expect(r.incomeBreakdown.map((s) => [s.name, s.totalMinor])).toEqual([['Salary', 1000000], ['Other Income', 5000]]);
    expect(r.expenseBreakdown).toEqual([]);
  });

  it('with a main-category filter, splits into its sub-categories and direct spending', async () => {
    const cafe = await createCategory(db, { name: 'Cafe', kind: 'expense', parentId: cat.Dining, icon: 'cafe', color: '#111' });
    await add('2026-10-02', 10000, 'Dining');
    await add('2026-10-03', 15000, cafe);
    await add('2026-10-04', 30000, 'Groceries');
    const r = await getReport(db, OCT, { categoryId: cat.Dining });
    expect(r.expenseBreakdown.map((s) => [s.name, s.totalMinor])).toEqual([['Cafe', 15000], ['Dining (direct)', 10000]]);
    expect(r.totals.expenseMinor).toBe(25000);
  });
});

describe('filters', () => {
  it('by account', async () => {
    await add('2026-10-02', 1000, 'Rent');
    await add('2026-10-03', 2000, 'Rent', { accountId: doha });
    await income('2026-10-04', 50000, { accountId: doha });
    const r = await getReport(db, OCT, { accountId: doha });
    expect([r.totals.incomeMinor, r.totals.expenseMinor]).toEqual([50000, 2000]);
    expect(r.series.find((m) => m.month === '2026-10')).toMatchObject({ incomeMinor: 50000, expenseMinor: 2000 });
  });

  it('by category and account together', async () => {
    await add('2026-10-02', 1000, 'Rent');
    await add('2026-10-03', 2000, 'Rent', { accountId: doha });
    await add('2026-10-03', 4000, 'Fuel', { accountId: doha });
    const r = await getReport(db, OCT, { accountId: doha, categoryId: cat.Rent });
    expect(r.totals.expenseMinor).toBe(2000);
  });
});

describe('month by month', () => {
  it('covers the 12 months ending at the selected month, with zero months filled in', async () => {
    await add('2026-10-02', 3000, 'Rent');
    await income('2026-08-01', 9000);
    await add('2025-10-30', 777, 'Rent'); // 13 months back: outside
    const r = await getReport(db, OCT);
    expect(r.series).toHaveLength(12);
    expect([r.series[0].month, r.series[11].month]).toEqual(['2025-11', '2026-10']);
    expect(r.series.find((m) => m.month === '2026-10')).toMatchObject({ expenseMinor: 3000, incomeMinor: 0 });
    expect(r.series.find((m) => m.month === '2026-08')).toMatchObject({ incomeMinor: 9000, expenseMinor: 0 });
    expect(r.series.find((m) => m.month === '2026-09')).toMatchObject({ incomeMinor: 0, expenseMinor: 0 });
    expect(r.series.reduce((s, m) => s + m.expenseMinor, 0)).toBe(3000);
  });

  it('year view shows Jan-Dec of that year', async () => {
    await add('2026-03-15', 100, 'Rent');
    await add('2026-12-31', 200, 'Rent');
    const r = await getReport(db, { mode: 'year', year: 2026 });
    expect(r.series.map((m) => m.month)[0]).toBe('2026-01');
    expect(r.series).toHaveLength(12);
    expect(r.series[2].expenseMinor).toBe(100);
    expect(r.series[11].expenseMinor).toBe(200);
  });

  it('a custom range only counts days inside the range, even in partial months', async () => {
    await add('2026-03-05', 1, 'Rent');
    await add('2026-03-20', 2, 'Rent');
    await add('2026-04-02', 4, 'Rent');
    await add('2026-04-25', 8, 'Rent');
    const r = await getReport(db, { mode: 'range', from: '2026-03-15', to: '2026-04-10' });
    expect(r.series.map((m) => [m.month, m.expenseMinor])).toEqual([['2026-03', 2], ['2026-04', 4]]);
    expect(r.totals.expenseMinor).toBe(6);
  });

  it('each month total matches the summary for that month', async () => {
    await add('2026-09-03', 5000, 'Rent');
    await add('2026-10-03', 7000, 'Rent');
    const series = (await getReport(db, OCT)).series;
    for (const m of ['2026-09', '2026-10']) {
      const month = await getReport(db, { mode: 'month', month: m });
      expect(series.find((p) => p.month === m)!.expenseMinor).toBe(month.totals.expenseMinor);
    }
  });
});

describe('sample data', () => {
  it('produces a report for the current month and year', async () => {
    await loadSampleData(db);
    const m = await getReport(db, { mode: 'month', month: currentMonth() });
    expect(m.totals.incomeMinor).toBeGreaterThan(0);
    expect(m.expenseBreakdown.length).toBeGreaterThan(3);
    expect(m.expenseBreakdown.reduce((s, x) => s + x.totalMinor, 0)).toBe(m.totals.expenseMinor);
    const y = await getReport(db, { mode: 'year', year: new Date().getFullYear() });
    expect(y.totals.expenseMinor).toBeGreaterThanOrEqual(m.totals.expenseMinor);
  });
});
