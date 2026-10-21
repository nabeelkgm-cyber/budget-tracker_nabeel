/** @jest-environment node */
import { createAccount, getAccount } from '@/db/repositories/accounts';
import { getMonthBudget, upsertBudget } from '@/db/repositories/budgets';
import { listCategories } from '@/db/repositories/categories';
import { setCurrencyRate } from '@/db/repositories/currencies';
import { getReport } from '@/db/repositories/reports';
import { createTransaction, getTransaction, listTransactions } from '@/db/repositories/transactions';
import { completeSetup, ensureCurrencyCatalog, isSeeded, loadCurrencyRegistry } from '@/db/currencySetup';
import { migrate } from '@/db/migrations';
import { eraseAllData, loadSampleData } from '@/db/seed/sampleData';
import { seedDefaults } from '@/db/seed/defaults';
import type { Db } from '@/db/types';
import { decimalsOf, getBaseCurrency, setCurrencyRegistry } from '@/domain/currencies';
import { foreignPerBaseToRateE8, formatMinor } from '@/domain/money';
import { createReadyDb, createTestDb } from './helpers/testDb';

afterEach(() => setCurrencyRegistry('QAR', {}));

const acct = (db: Db, name: string, currency: string, opening = 0, type: 'bank' | 'cash' = 'bank') =>
  createAccount(db, { name, type, currency, openingBalanceMinor: opening, creditLimitMinor: null, statementDay: null, dueDay: null, icon: 'business', color: '#000' });

const spend = async (db: Db, accountId: string, date: string, amountMinor: number, category: string, extra = {}) => {
  const cats = await listCategories(db);
  return createTransaction(db, { type: 'expense', date, accountId, amountMinor, categoryId: cats.find((c) => c.name === category)!.id, toAccountId: null, toAmountMinor: null, paymentMethod: 'cash', note: '', ...extra });
};

describe('first-run setup', () => {
  it('a new database is not set up until a currency is chosen', async () => {
    const db = createTestDb();
    await migrate(db);
    expect(await isSeeded(db)).toBe(false);
    await completeSetup(db, 'SAR');
    expect(await isSeeded(db)).toBe(true);
    expect(getBaseCurrency()).toBe('SAR');
  });

  it('only GCC currencies can be the base', async () => {
    const db = createTestDb();
    await migrate(db);
    await expect(seedDefaults(db, 'INR')).rejects.toThrow(/cannot be used/);
    await expect(seedDefaults(db, 'USD')).rejects.toThrow(/cannot be used/);
    expect(await isSeeded(db)).toBe(false);
  });

  it.each([
    ['QAR', 2],
    ['SAR', 2],
    ['AED', 2],
    ['OMR', 3],
    ['KWD', 3],
    ['BHD', 3],
  ])('%s as base: all currencies exist, base rate is 1, decimals are %i', async (base, decimals) => {
    const db = await createReadyDb(base);
    expect(getBaseCurrency()).toBe(base);
    expect(decimalsOf(base)).toBe(decimals);
    const rows = await db.getAllAsync<{ code: string; rate_to_base_e8: number; minor_units: number }>('SELECT * FROM currencies');
    expect(rows).toHaveLength(7);
    expect(rows.find((r) => r.code === base)!.rate_to_base_e8).toBe(100_000_000);
    expect(rows.find((r) => r.code === 'INR')!.rate_to_base_e8).toBeGreaterThan(0);
    const saved = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'base_currency'");
    expect(saved?.value).toBe(base);
  });

  it('INR is about 23-24 per SAR/QAR/AED and about 230 per OMR', async () => {
    for (const [base, approx] of [['QAR', 24.2], ['SAR', 23.5], ['AED', 24.0], ['OMR', 229], ['KWD', 287], ['BHD', 234]] as const) {
      const db = await createReadyDb(base);
      const inr = await db.getFirstAsync<{ rate_to_base_e8: number }>("SELECT rate_to_base_e8 FROM currencies WHERE code='INR'");
      const perBase = base === 'QAR' ? 1e8 / 4_130_000 : 1e8 / inr!.rate_to_base_e8; // QAR rate is pinned by the test helper
      expect(perBase).toBeGreaterThan(approx * 0.97);
      expect(perBase).toBeLessThan(approx * 1.03);
    }
  });
});

describe('a Saudi user: SAR base, INR and AED accounts', () => {
  it('records spending in INR and AED converted to SAR', async () => {
    const db = await createReadyDb('SAR');
    const sar = await acct(db, 'Al Rajhi', 'SAR', 1_000_000);
    const inr = await acct(db, 'SBI', 'INR', 10_000_000);
    const aed = await acct(db, 'Emirates NBD', 'AED', 500_000);
    await setCurrencyRate(db, 'INR', foreignPerBaseToRateE8('23.5')!); // 1 SAR = 23.5 INR
    const a = await spend(db, inr, '2026-10-02', 2_350_000, 'Shopping'); // INR 23,500 = SAR 1,000
    expect((await getTransaction(db, a))!.base_amount_minor).toBe(100_000);
    const b = await spend(db, aed, '2026-10-03', 10_000, 'Dining'); // AED 100 = SAR 102.11
    expect((await getTransaction(db, b))!.base_amount_minor).toBe(10_211);
    const report = await getReport(db, { mode: 'month', month: '2026-10' });
    expect(report.totals.expenseMinor).toBe(110_211);
    expect(formatMinor(report.totals.expenseMinor, getBaseCurrency())).toBe('SAR 1,102.11');
    expect((await getAccount(db, sar))!.balance_minor).toBe(1_000_000);
  });
});

describe('an Omani user: OMR base (3 decimals), INR account', () => {
  it('converts INR (2 decimals) to OMR (3 decimals) and reports in baisa', async () => {
    const db = await createReadyDb('OMR');
    const omr = await acct(db, 'Bank Muscat', 'OMR', 1_000_000); // OMR 1,000.000
    const inr = await acct(db, 'HDFC', 'INR', 5_000_000);
    await setCurrencyRate(db, 'INR', foreignPerBaseToRateE8('229')!); // 1 OMR = 229 INR
    const id = await spend(db, inr, '2026-10-05', 2_290_000, 'Groceries'); // INR 22,900 = OMR 100.000
    expect((await getTransaction(db, id))!.base_amount_minor).toBe(100_000);
    await spend(db, omr, '2026-10-06', 12_500, 'Fuel'); // OMR 12.500
    const r = await getReport(db, { mode: 'month', month: '2026-10' });
    expect(r.totals.expenseMinor).toBe(112_500);
    expect(formatMinor(r.totals.expenseMinor, 'OMR')).toBe('OMR 112.500');
    expect(r.expenseBreakdown.map((s) => [s.name, s.totalMinor])).toEqual([['Groceries', 100_000], ['Fuel', 12_500]]);
  });

  it('budgets are in OMR with three decimals', async () => {
    const db = await createReadyDb('OMR');
    const omr = await acct(db, 'Bank Muscat', 'OMR', 1_000_000);
    const cats = await listCategories(db);
    await upsertBudget(db, { month: '2026-10', categoryId: cats.find((c) => c.name === 'Groceries')!.id, amountMinor: 200_000, rollover: false }); // OMR 200.000
    await spend(db, omr, '2026-10-02', 160_000, 'Groceries'); // 80%
    const m = await getMonthBudget(db, '2026-10');
    expect(m.rows[0]).toMatchObject({ amountMinor: 200_000, spentMinor: 160_000, pct: 80, state: 'warn' });
  });

  it('searching "125.5" finds OMR 125.500 and INR 125.50, and nothing else', async () => {
    const db = await createReadyDb('OMR');
    const omr = await acct(db, 'Bank Muscat', 'OMR');
    const inr = await acct(db, 'HDFC', 'INR');
    await spend(db, omr, '2026-10-02', 125_500, 'Fuel', { note: 'omr match' });
    await spend(db, inr, '2026-10-03', 12_550, 'Fuel', { note: 'inr match' });
    await spend(db, omr, '2026-10-04', 12_550, 'Fuel', { note: 'omr 12.550 no' });
    await spend(db, inr, '2026-10-05', 125_500, 'Fuel', { note: 'inr 1255.00 no' });
    const found = await listTransactions(db, { filter: { search: '125.5' } });
    expect(found.map((t) => t.note).sort()).toEqual(['inr match', 'omr match']);
  });

  it('a transfer between OMR and INR accounts keeps both balances right', async () => {
    const db = await createReadyDb('OMR');
    const omr = await acct(db, 'Bank Muscat', 'OMR', 1_000_000);
    const inr = await acct(db, 'HDFC', 'INR', 0);
    await createTransaction(db, { type: 'transfer', date: '2026-10-02', accountId: omr, amountMinor: 100_000, categoryId: null, toAccountId: inr, toAmountMinor: 2_290_000, paymentMethod: 'bank_transfer', note: '', feeMinor: 2_500 });
    expect((await getAccount(db, omr))!.balance_minor).toBe(1_000_000 - 100_000 - 2_500);
    expect((await getAccount(db, inr))!.balance_minor).toBe(2_290_000);
    const fee = (await listTransactions(db)).find((t) => t.category_name === 'Bank Charges')!;
    expect([fee.amount_minor, fee.base_amount_minor]).toEqual([2_500, 2_500]); // OMR 2.500, base is OMR
  });
});

describe('a Kuwaiti user: KWD base with a QAR-style 2-decimal foreign account', () => {
  it('KWD amounts keep three decimals through a month report', async () => {
    const db = await createReadyDb('KWD');
    const kwd = await acct(db, 'NBK', 'KWD', 2_500_000);
    await spend(db, kwd, '2026-10-02', 7_250, 'Dining'); // KWD 7.250
    const r = await getReport(db, { mode: 'month', month: '2026-10' });
    expect(formatMinor(r.totals.expenseMinor, 'KWD')).toBe('KWD 7.250');
    expect(r.series.find((m) => m.month === '2026-10')!.expenseMinor).toBe(7_250);
  });
});

describe('existing QAR databases', () => {
  it('gain the other GCC currencies without changing existing rates or the base', async () => {
    const db = await createReadyDb('QAR');
    await db.runAsync("DELETE FROM currencies WHERE code NOT IN ('QAR','INR')"); // how a Phase 1-5 database looks
    await setCurrencyRate(db, 'INR', 4_132_231);
    await ensureCurrencyCatalog(db);
    await ensureCurrencyCatalog(db); // repeatable
    const rows = await db.getAllAsync<{ code: string; rate_to_base_e8: number }>('SELECT code, rate_to_base_e8 FROM currencies ORDER BY code');
    expect(rows.map((r) => r.code)).toEqual(['AED', 'BHD', 'INR', 'KWD', 'OMR', 'QAR', 'SAR']);
    expect(rows.find((r) => r.code === 'INR')!.rate_to_base_e8).toBe(4_132_231);
    expect(rows.find((r) => r.code === 'QAR')!.rate_to_base_e8).toBe(100_000_000);
    await loadCurrencyRegistry(db);
    expect(getBaseCurrency()).toBe('QAR');
    expect(decimalsOf('OMR')).toBe(3);
  });

  it('keep working exactly as before', async () => {
    const db = await createReadyDb('QAR');
    const q = await acct(db, 'CBQ', 'QAR', 100_000);
    const i = await acct(db, 'HDFC', 'INR', 0);
    const id = await spend(db, i, '2026-10-02', 2_410_000, 'Shopping');
    expect((await getTransaction(db, id))!.base_amount_minor).toBe(99_533);
    expect((await getAccount(db, q))!.balance_minor).toBe(100_000);
  });
});

describe('changing the base currency', () => {
  it('erase returns to the setup state; a new currency can then be chosen', async () => {
    const db = await createReadyDb('QAR');
    await acct(db, 'CBQ', 'QAR', 100_000);
    await eraseAllData(db);
    expect(await isSeeded(db)).toBe(false);
    expect((await db.getAllAsync('SELECT * FROM currencies')).length).toBe(0);
    expect((await db.getAllAsync('SELECT * FROM accounts')).length).toBe(0);
    await completeSetup(db, 'OMR');
    expect(getBaseCurrency()).toBe('OMR');
    expect(decimalsOf('OMR')).toBe(3);
    const cats = await listCategories(db);
    expect(cats.length).toBe(17);
  });

  it('loading the sample data always uses QAR', async () => {
    const db = await createReadyDb('OMR');
    await loadSampleData(db);
    expect(getBaseCurrency()).toBe('QAR');
    expect((await getAccount(db, (await db.getFirstAsync<{ id: string }>("SELECT id FROM accounts WHERE name='CBQ Account'"))!.id))!.currency).toBe('QAR');
  });
});
