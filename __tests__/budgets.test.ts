/** @jest-environment node */
import { createAccount } from '@/db/repositories/accounts';
import {
  checkBudgetAlerts,
  copyBudgets,
  deleteBudget,
  getMonthBudget,
  upsertBudget,
} from '@/db/repositories/budgets';
import { createCategory, listCategories, setCategoryArchived } from '@/db/repositories/categories';
import { setCurrencyRate } from '@/db/repositories/currencies';
import { createTransaction, deleteTransaction, updateTransaction } from '@/db/repositories/transactions';
import { listPendingDue, listRecurringRules } from '@/db/repositories/recurring';
import { eraseAllData, loadFullDemoData as loadSampleData } from '@/db/seed/sampleData';
import type { Db } from '@/db/types';
import { currentMonth } from '@/domain/budget';
import type { TransactionInput } from '@/types';
import { createReadyDb } from './helpers/testDb';

let db: Db;
let cat: Record<string, string>;
let cbq: string;
let hdfc: string;
const OCT = '2026-10';

const acct = (name: string, currency: string, opening = 0) =>
  createAccount(db, { name, type: 'bank', currency, openingBalanceMinor: opening, creditLimitMinor: null, statementDay: null, dueDay: null, icon: 'business', color: '#000' });

const spend = (date: string, amountMinor: number, category: string, extra: Partial<TransactionInput> = {}) =>
  createTransaction(db, { type: 'expense', date, accountId: cbq, amountMinor, categoryId: cat[category] ?? category, toAccountId: null, toAmountMinor: null, paymentMethod: 'cash', note: '', ...extra });

const budget = (month: string, category: string, amountMinor: number, rollover = false) =>
  upsertBudget(db, { month, categoryId: cat[category], amountMinor, rollover });

const row = async (month: string, category: string) =>
  (await getMonthBudget(db, month)).rows.find((r) => r.categoryName === category)!;

beforeEach(async () => {
  db = await createReadyDb();
  cat = Object.fromEntries((await listCategories(db)).map((c) => [c.name, c.id]));
  cbq = await acct('CBQ', 'QAR', 10000000);
  hdfc = await acct('HDFC', 'INR', 100000000);
});

describe('budget vs actual', () => {
  it('shows spent, remaining and percent', async () => {
    await budget(OCT, 'Groceries', 100000);
    await spend('2026-10-03', 25000, 'Groceries');
    await spend('2026-10-20', 25000, 'Groceries');
    expect(await row(OCT, 'Groceries')).toMatchObject({ amountMinor: 100000, spentMinor: 50000, remainingMinor: 50000, pct: 50, state: 'ok' });
  });

  it('sub-category spending counts towards the main category', async () => {
    const cafe = await createCategory(db, { name: 'Cafe', kind: 'expense', parentId: cat.Dining, icon: 'cafe', color: '#111' });
    await budget(OCT, 'Dining', 100000);
    await spend('2026-10-03', 10000, 'Dining');
    await spend('2026-10-04', 15000, cafe);
    expect((await row(OCT, 'Dining')).spentMinor).toBe(25000);
  });

  it('ignores transfers, income, deleted entries and other months', async () => {
    await budget(OCT, 'Groceries', 100000);
    await spend('2026-10-03', 10000, 'Groceries');
    const gone = await spend('2026-10-04', 99999, 'Groceries');
    await deleteTransaction(db, gone);
    await spend('2026-09-30', 5555, 'Groceries');
    await spend('2026-11-01', 7777, 'Groceries');
    await createTransaction(db, { type: 'income', date: '2026-10-05', accountId: cbq, amountMinor: 500000, categoryId: cat.Salary, toAccountId: null, toAmountMinor: null, paymentMethod: 'bank_transfer', note: '' });
    const bank2 = await acct('Doha', 'QAR');
    await createTransaction(db, { type: 'transfer', date: '2026-10-06', accountId: cbq, amountMinor: 30000, categoryId: null, toAccountId: bank2, toAmountMinor: 30000, paymentMethod: 'bank_transfer', note: '' });
    expect((await row(OCT, 'Groceries')).spentMinor).toBe(10000);
  });

  it('counts foreign-currency spending in QAR at the rate stored on the entry', async () => {
    await budget(OCT, 'Shopping', 100000);
    await spend('2026-10-02', 2410000, 'Shopping', { accountId: hdfc }); // INR 24,100 @ 0.0413
    await setCurrencyRate(db, 'INR', 9_000_000);
    await spend('2026-10-03', 1000000, 'Shopping', { accountId: hdfc }); // INR 10,000 @ 0.09
    expect((await row(OCT, 'Shopping')).spentMinor).toBe(99533 + 90000);
  });

  it('lists categories without a budget, with their spending', async () => {
    await budget(OCT, 'Groceries', 100000);
    await spend('2026-10-03', 4000, 'Fuel');
    await setCategoryArchived(db, cat.Education, true);
    const m = await getMonthBudget(db, OCT);
    const names = m.unbudgeted.map((u) => u.categoryName);
    expect(names).toContain('Fuel');
    expect(names).toContain('Rent');
    expect(names).not.toContain('Groceries');
    expect(names).not.toContain('Education'); // archived and nothing spent
    expect(m.unbudgeted.find((u) => u.categoryName === 'Fuel')!.spentMinor).toBe(4000);
  });

  it('totals add up over budgeted categories only', async () => {
    await budget(OCT, 'Groceries', 100000);
    await budget(OCT, 'Dining', 50000);
    await spend('2026-10-03', 30000, 'Groceries');
    await spend('2026-10-04', 20000, 'Dining');
    await spend('2026-10-05', 99000, 'Fuel'); // not budgeted: excluded from totals
    const { totals } = await getMonthBudget(db, OCT);
    expect(totals).toMatchObject({ availableMinor: 150000, spentMinor: 50000, remainingMinor: 100000, pct: 33, state: 'ok' });
  });
});

describe('rollover', () => {
  it('adds last month unused budget when rollover is on, and does not carry overspend', async () => {
    await budget('2026-09', 'Groceries', 100000);
    await spend('2026-09-10', 60000, 'Groceries');
    await budget(OCT, 'Groceries', 100000, true);
    await spend('2026-10-10', 150000, 'Groceries');
    expect(await row(OCT, 'Groceries')).toMatchObject({ carryInMinor: 40000, availableMinor: 140000, remainingMinor: -10000, state: 'over' });
    await budget('2026-11', 'Groceries', 100000, true);
    expect((await row('2026-11', 'Groceries')).carryInMinor).toBe(0);
  });

  it('no carry when rollover is off or last month had no budget', async () => {
    await budget('2026-09', 'Groceries', 100000);
    await budget(OCT, 'Groceries', 100000, false);
    expect((await row(OCT, 'Groceries')).carryInMinor).toBe(0);
    await budget('2026-11', 'Dining', 100000, true);
    expect((await row('2026-11', 'Dining')).carryInMinor).toBe(0);
  });
});

describe('setting budgets', () => {
  it('updates an existing budget instead of duplicating', async () => {
    await budget(OCT, 'Groceries', 100000);
    await budget(OCT, 'Groceries', 120000, true);
    const m = await getMonthBudget(db, OCT);
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0]).toMatchObject({ amountMinor: 120000, rollover: true });
  });

  it('rejects sub-categories, income categories, bad amounts and bad months', async () => {
    const cafe = await createCategory(db, { name: 'Cafe', kind: 'expense', parentId: cat.Dining, icon: 'cafe', color: '#111' });
    await expect(upsertBudget(db, { month: OCT, categoryId: cafe, amountMinor: 1000, rollover: false })).rejects.toThrow(/main category/);
    await expect(upsertBudget(db, { month: OCT, categoryId: cat.Salary, amountMinor: 1000, rollover: false })).rejects.toThrow(/expense/);
    await expect(budget(OCT, 'Groceries', 0)).rejects.toThrow(/greater than zero/);
    await expect(upsertBudget(db, { month: '2026-1', categoryId: cat.Groceries, amountMinor: 1, rollover: false })).rejects.toThrow(/month/);
  });

  it('a removed budget can be set again', async () => {
    await budget(OCT, 'Groceries', 100000);
    await deleteBudget(db, OCT, cat.Groceries);
    expect((await getMonthBudget(db, OCT)).rows).toHaveLength(0);
    await budget(OCT, 'Groceries', 70000);
    expect((await row(OCT, 'Groceries')).amountMinor).toBe(70000);
  });
});

describe('copy last month budget', () => {
  it('copies amounts and rollover, leaves existing budgets in the target month alone', async () => {
    await budget('2026-09', 'Groceries', 100000, true);
    await budget('2026-09', 'Dining', 50000);
    await budget('2026-09', 'Fuel', 30000);
    await budget(OCT, 'Dining', 99900); // already set: must survive
    const added = await copyBudgets(db, '2026-09', OCT);
    expect(added).toBe(2);
    const m = await getMonthBudget(db, OCT);
    expect(m.rows.map((r) => [r.categoryName, r.amountMinor, r.rollover]).sort()).toEqual([
      ['Dining', 99900, false],
      ['Fuel', 30000, false],
      ['Groceries', 100000, true],
    ]);
  });

  it('copies nothing from an empty month or onto the same month, and is repeatable', async () => {
    expect(await copyBudgets(db, '2026-08', OCT)).toBe(0);
    await budget('2026-09', 'Groceries', 100000);
    expect(await copyBudgets(db, '2026-09', '2026-09')).toBe(0);
    expect(await copyBudgets(db, '2026-09', OCT)).toBe(1);
    expect(await copyBudgets(db, '2026-09', OCT)).toBe(0);
  });

  it('revives a budget that was removed in the target month', async () => {
    await budget('2026-09', 'Groceries', 100000);
    await budget(OCT, 'Groceries', 1000);
    await deleteBudget(db, OCT, cat.Groceries);
    expect(await copyBudgets(db, '2026-09', OCT)).toBe(1);
    expect((await row(OCT, 'Groceries')).amountMinor).toBe(100000);
  });
});

describe('alerts at 80% and 100%', () => {
  beforeEach(async () => {
    await budget(OCT, 'Groceries', 100000);
  });

  it('is silent below 80%', async () => {
    await spend('2026-10-03', 79900, 'Groceries');
    expect(await checkBudgetAlerts(db, OCT)).toEqual([]);
  });

  it('reports 80% once, then 100% once', async () => {
    await spend('2026-10-03', 80000, 'Groceries');
    expect(await checkBudgetAlerts(db, OCT)).toMatchObject([{ categoryName: 'Groceries', threshold: 80 }]);
    expect(await checkBudgetAlerts(db, OCT)).toEqual([]);
    await spend('2026-10-04', 5000, 'Groceries');
    expect(await checkBudgetAlerts(db, OCT)).toEqual([]);
    await spend('2026-10-05', 15000, 'Groceries');
    expect(await checkBudgetAlerts(db, OCT)).toMatchObject([{ threshold: 100, spentMinor: 100000, availableMinor: 100000 }]);
    expect(await checkBudgetAlerts(db, OCT)).toEqual([]);
    await spend('2026-10-06', 1, 'Groceries');
    expect(await checkBudgetAlerts(db, OCT)).toEqual([]);
  });

  it('jumping straight past 100% reports only the 100% alert', async () => {
    await spend('2026-10-03', 120000, 'Groceries');
    const alerts = await checkBudgetAlerts(db, OCT);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].threshold).toBe(100);
  });

  it('resets when spending falls back under a threshold, so it can alert again', async () => {
    const id = await spend('2026-10-03', 85000, 'Groceries');
    expect(await checkBudgetAlerts(db, OCT)).toHaveLength(1);
    await deleteTransaction(db, id);
    expect(await checkBudgetAlerts(db, OCT)).toEqual([]);
    await spend('2026-10-04', 90000, 'Groceries');
    expect(await checkBudgetAlerts(db, OCT)).toMatchObject([{ threshold: 80 }]);
  });

  it('editing an entry down below 80% resets; editing a budget up resets', async () => {
    const id = await spend('2026-10-03', 85000, 'Groceries');
    await checkBudgetAlerts(db, OCT);
    await updateTransaction(db, id, { type: 'expense', date: '2026-10-03', accountId: cbq, amountMinor: 10000, categoryId: cat.Groceries, toAccountId: null, toAmountMinor: null, paymentMethod: 'cash', note: '' });
    expect(await checkBudgetAlerts(db, OCT)).toEqual([]);
    await spend('2026-10-04', 75000, 'Groceries'); // 85,000 again
    expect(await checkBudgetAlerts(db, OCT)).toHaveLength(1);
    await budget(OCT, 'Groceries', 200000); // now 42%
    expect(await checkBudgetAlerts(db, OCT)).toEqual([]);
  });

  it('removing the budget clears its alert state; other months are independent', async () => {
    await spend('2026-10-03', 90000, 'Groceries');
    await checkBudgetAlerts(db, OCT);
    await deleteBudget(db, OCT, cat.Groceries);
    const left = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM budget_alerts_sent');
    expect(left?.n).toBe(0);
    await budget('2026-11', 'Groceries', 10000);
    await spend('2026-11-03', 9000, 'Groceries');
    expect(await checkBudgetAlerts(db, '2026-11')).toHaveLength(1);
  });

  it('rollover counts towards what is available before alerting', async () => {
    await budget('2026-11', 'Groceries', 100000, true); // October unused rolls in
    await spend('2026-10-03', 20000, 'Groceries'); // 80,000 carries into November
    await spend('2026-11-03', 100000, 'Groceries'); // 100,000 of 180,000 available = 56%
    expect(await checkBudgetAlerts(db, '2026-11')).toEqual([]);
    await spend('2026-11-04', 50000, 'Groceries'); // 150,000 of 180,000 = 83%
    expect(await checkBudgetAlerts(db, '2026-11')).toMatchObject([{ threshold: 80 }]);
  });
});

describe('sample data month', () => {
  it('loads without error and the current month has budgets after Phase 3 sample data', async () => {
    await loadSampleData(db);
    const m = await getMonthBudget(db, currentMonth());
    expect(m.rows.length).toBeGreaterThan(0);
    for (const r of m.rows) {
      expect(r.availableMinor).toBeGreaterThan(0);
      expect(r.spentMinor).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('sample data can be reloaded and erased', () => {
  it('loads twice, includes recurring items and a waiting reminder, and erases cleanly', async () => {
    await loadSampleData(db);
    await loadSampleData(db); // would fail on leftover recurring rows if they were not cleared
    const rules = await listRecurringRules(db);
    expect(rules.map((r) => r.name).sort()).toEqual(['Internet bill', 'Rent', 'Salary', 'Weekly groceries']);
    expect(rules.find((r) => r.name === 'Rent')!.mode).toBe('auto');
    expect((await listPendingDue(db)).map((p) => p.name)).toEqual(['Internet bill']);
    await eraseAllData(db);
    expect(await listRecurringRules(db)).toEqual([]);
    expect(await listPendingDue(db)).toEqual([]);
  });
});
