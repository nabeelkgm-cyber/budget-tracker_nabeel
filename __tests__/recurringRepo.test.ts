/** @jest-environment node */
import { createAccount, getAccount } from '@/db/repositories/accounts';
import { upsertBudget } from '@/db/repositories/budgets';
import { listCategories } from '@/db/repositories/categories';
import {
  RecurringInput,
  confirmDue,
  createRecurringRule,
  deleteRecurringRule,
  getRecurringRule,
  listPendingDue,
  listRecurringRules,
  processRecurring,
  setRecurringActive,
  skipDue,
  updateRecurringRule,
} from '@/db/repositories/recurring';
import { createTransaction, deleteTransaction, listTransactions } from '@/db/repositories/transactions';
import type { Db } from '@/db/types';
import { createReadyDb } from './helpers/testDb';

let db: Db;
let cat: Record<string, string>;
let cbq: string;
let doha: string;
let hdfc: string;

const acct = (name: string, currency: string, opening = 0) =>
  createAccount(db, { name, type: 'bank', currency, openingBalanceMinor: opening, creditLimitMinor: null, statementDay: null, dueDay: null, icon: 'business', color: '#000' });

const rule = (over: Partial<RecurringInput> = {}): RecurringInput => ({
  name: 'Rent', type: 'expense', accountId: cbq, amountMinor: 380000, categoryId: cat.Rent,
  toAccountId: null, toAmountMinor: null, paymentMethod: 'bank_transfer', note: '',
  frequency: 'monthly', nextDueDate: '2026-08-02', endDate: null, mode: 'auto', ...over,
});

const txns = async () => (await listTransactions(db, { limit: 1000 })).filter((t) => t.recurring_id);

beforeEach(async () => {
  db = await createReadyDb();
  cat = Object.fromEntries((await listCategories(db)).map((c) => [c.name, c.id]));
  cbq = await acct('CBQ', 'QAR', 10000000);
  doha = await acct('Doha', 'QAR');
  hdfc = await acct('HDFC', 'INR');
});

describe('auto mode', () => {
  it('creates every missed occurrence, dated on its due date, and moves the next due date on', async () => {
    const id = await createRecurringRule(db, rule({ nextDueDate: '2026-08-02' }));
    const r = await processRecurring(db, '2026-10-21');
    expect(r.created.map((c) => c.date)).toEqual(['2026-08-02', '2026-09-02', '2026-10-02']);
    const made = await txns();
    expect(made.map((t) => t.date).sort()).toEqual(['2026-08-02', '2026-09-02', '2026-10-02']);
    expect(made.every((t) => t.source === 'recurring' && t.recurring_id === id && t.amount_minor === 380000)).toBe(true);
    expect(made[0].note).toBe('Rent'); // falls back to the rule name
    expect((await getRecurringRule(db, id))!.next_due_date).toBe('2026-11-02');
    expect((await getAccount(db, cbq))!.balance_minor).toBe(10000000 - 3 * 380000);
  });

  it('running again, or on the same day, creates nothing more', async () => {
    await createRecurringRule(db, rule());
    await processRecurring(db, '2026-10-21');
    const again = await processRecurring(db, '2026-10-21');
    expect(again.created).toEqual([]);
    expect(await txns()).toHaveLength(3);
    const later = await processRecurring(db, '2026-11-02');
    expect(later.created.map((c) => c.date)).toEqual(['2026-11-02']);
    expect(await txns()).toHaveLength(4);
  });

  it('does nothing before the due date, and nothing while paused or deleted', async () => {
    const id = await createRecurringRule(db, rule({ nextDueDate: '2026-11-02' }));
    expect((await processRecurring(db, '2026-10-21')).created).toEqual([]);
    await setRecurringActive(db, id, false);
    expect((await processRecurring(db, '2026-12-31')).created).toEqual([]);
    await setRecurringActive(db, id, true);
    await deleteRecurringRule(db, id);
    expect((await processRecurring(db, '2026-12-31')).created).toEqual([]);
    expect(await listRecurringRules(db)).toHaveLength(0);
  });

  it('weekly rules create one entry per week', async () => {
    await createRecurringRule(db, rule({ name: 'Groceries', categoryId: cat.Groceries, amountMinor: 20000, frequency: 'weekly', nextDueDate: '2026-10-02' })); // a Friday
    const r = await processRecurring(db, '2026-10-21');
    expect(r.created.map((c) => c.date)).toEqual(['2026-10-02', '2026-10-09', '2026-10-16']);
  });

  it('handles income, transfers (incl. cross-currency) and foreign-currency accounts', async () => {
    await createRecurringRule(db, rule({ name: 'Salary', type: 'income', categoryId: cat.Salary, amountMinor: 1450000, nextDueDate: '2026-10-01', paymentMethod: 'bank_transfer' }));
    await createRecurringRule(db, rule({ name: 'To HDFC', type: 'transfer', categoryId: null, amountMinor: 100000, toAccountId: hdfc, toAmountMinor: 2410000, nextDueDate: '2026-10-05' }));
    await createRecurringRule(db, rule({ name: 'Card bill', type: 'transfer', categoryId: null, amountMinor: 50000, toAccountId: doha, toAmountMinor: 50000, nextDueDate: '2026-10-10' }));
    await processRecurring(db, '2026-10-21');
    expect((await getAccount(db, cbq))!.balance_minor).toBe(10000000 + 1450000 - 100000 - 50000);
    expect((await getAccount(db, hdfc))!.balance_minor).toBe(2410000);
    expect((await getAccount(db, doha))!.balance_minor).toBe(50000);
  });

  it('a deleted generated entry is not recreated', async () => {
    await createRecurringRule(db, rule({ nextDueDate: '2026-10-02' }));
    await processRecurring(db, '2026-10-21');
    const [t] = await txns();
    await deleteTransaction(db, t.id);
    await processRecurring(db, '2026-10-22');
    expect(await txns()).toHaveLength(0);
  });

  it('never creates a second live entry for the same rule and due date (database guard)', async () => {
    const id = await createRecurringRule(db, rule({ nextDueDate: '2026-10-02' }));
    await processRecurring(db, '2026-10-21');
    await expect(
      createTransaction(db, { type: 'expense', date: '2026-10-02', accountId: cbq, amountMinor: 1, categoryId: cat.Rent, toAccountId: null, toAmountMinor: null, paymentMethod: 'cash', note: '', recurringId: id, recurringDueDate: '2026-10-02' }),
    ).rejects.toThrow(/UNIQUE/i);
  });
});

describe('remind mode', () => {
  it('creates reminders instead of transactions', async () => {
    const id = await createRecurringRule(db, rule({ name: 'Internet', categoryId: cat.Utilities, mode: 'remind', nextDueDate: '2026-09-06' }));
    const r = await processRecurring(db, '2026-10-21');
    expect(r.reminders.map((x) => x.date)).toEqual(['2026-09-06', '2026-10-06']);
    expect(await txns()).toHaveLength(0);
    expect((await listPendingDue(db)).map((p) => p.due_date)).toEqual(['2026-09-06', '2026-10-06']);
    expect((await getRecurringRule(db, id))!.next_due_date).toBe('2026-11-06');
    expect((await processRecurring(db, '2026-10-21')).reminders).toEqual([]);
    expect(await listPendingDue(db)).toHaveLength(2);
  });

  it('"Add now" creates the entry on the due date and clears the reminder; it cannot be done twice', async () => {
    await createRecurringRule(db, rule({ mode: 'remind', nextDueDate: '2026-10-02' }));
    await processRecurring(db, '2026-10-21');
    const [due] = await listPendingDue(db);
    const done = await confirmDue(db, due.id);
    expect(done.month).toBe('2026-10');
    const made = await txns();
    expect(made).toHaveLength(1);
    expect([made[0].date, made[0].recurring_due_date, made[0].id]).toEqual(['2026-10-02', '2026-10-02', done.transactionId]);
    expect(await listPendingDue(db)).toEqual([]);
    await expect(confirmDue(db, due.id)).rejects.toThrow(/already handled/);
    expect(await txns()).toHaveLength(1);
  });

  it('"Skip" clears the reminder without creating anything', async () => {
    await createRecurringRule(db, rule({ mode: 'remind', nextDueDate: '2026-10-02' }));
    await processRecurring(db, '2026-10-21');
    const [due] = await listPendingDue(db);
    await skipDue(db, due.id);
    expect(await listPendingDue(db)).toEqual([]);
    expect(await txns()).toHaveLength(0);
    await expect(confirmDue(db, due.id)).rejects.toThrow(/already handled/);
  });

  it('reminders of a deleted rule disappear', async () => {
    const id = await createRecurringRule(db, rule({ mode: 'remind', nextDueDate: '2026-10-02' }));
    await processRecurring(db, '2026-10-21');
    await deleteRecurringRule(db, id);
    expect(await listPendingDue(db)).toEqual([]);
  });
});

describe('end date, editing and errors', () => {
  it('stops at the end date and then marks the rule finished', async () => {
    const id = await createRecurringRule(db, rule({ nextDueDate: '2026-08-02', endDate: '2026-09-30' }));
    const r = await processRecurring(db, '2026-12-31');
    expect(r.created.map((c) => c.date)).toEqual(['2026-08-02', '2026-09-02']);
    expect((await getRecurringRule(db, id))!.is_active).toBe(0);
  });

  it('editing the next due date moves the schedule (day of month follows)', async () => {
    const id = await createRecurringRule(db, rule({ nextDueDate: '2026-11-02' }));
    await updateRecurringRule(db, id, rule({ nextDueDate: '2026-11-05' }));
    const r = (await getRecurringRule(db, id))!;
    expect([r.next_due_date, r.day_of_month]).toEqual(['2026-11-05', 5]);
    await processRecurring(db, '2026-12-31');
    expect((await txns()).map((t) => t.date).sort()).toEqual(['2026-11-05', '2026-12-05']);
  });

  it('rejects invalid rules', async () => {
    await expect(createRecurringRule(db, rule({ name: '  ' }))).rejects.toThrow(/name/);
    await expect(createRecurringRule(db, rule({ amountMinor: 0 }))).rejects.toThrow(/greater than zero/);
    await expect(createRecurringRule(db, rule({ categoryId: cat.Salary }))).rejects.toThrow(/expense category/);
    await expect(createRecurringRule(db, rule({ endDate: '2026-01-01' }))).rejects.toThrow(/end date/);
    await expect(createRecurringRule(db, rule({ type: 'transfer', categoryId: null, toAccountId: cbq, toAmountMinor: 1 }))).rejects.toThrow(/different/);
  });

  it('a rule that cannot run reports the error, keeps its due date and does not stop other rules', async () => {
    const bad = await createRecurringRule(db, rule({ name: 'Bad', nextDueDate: '2026-10-02' }));
    await createRecurringRule(db, rule({ name: 'Good', categoryId: cat.Utilities, nextDueDate: '2026-10-03' }));
    // Break it behind the app's back: an income category on an expense rule.
    await db.runAsync('UPDATE recurring_rules SET category_id = ? WHERE id = ?', [cat.Salary, bad]);
    const r = await processRecurring(db, '2026-10-21');
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].ruleName).toBe('Bad');
    expect(r.created.map((c) => c.ruleName)).toEqual(['Good']);
    const row = (await getRecurringRule(db, bad))!;
    expect([row.next_due_date, !!row.last_error]).toEqual(['2026-10-02', true]);
  });
});

describe('budget alerts from automatic entries', () => {
  it('reports a threshold reached by a recurring entry', async () => {
    await upsertBudget(db, { month: '2026-10', categoryId: cat.Rent, amountMinor: 400000, rollover: false });
    await createRecurringRule(db, rule({ nextDueDate: '2026-10-02' })); // 3,800 of 4,000 = 95%
    const r = await processRecurring(db, '2026-10-21');
    expect(r.alerts).toMatchObject([{ categoryName: 'Rent', threshold: 80 }]);
    expect((await processRecurring(db, '2026-10-22')).alerts).toEqual([]);
  });
});
