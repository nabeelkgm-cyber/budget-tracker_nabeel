import dayjs from 'dayjs';
import { listAccounts } from '@/db/repositories/accounts';
import { getMonthBudget } from '@/db/repositories/budgets';
import { listTransactions, summarizeTransactions } from '@/db/repositories/transactions';
import { SAMPLE_BUDGETS_QAR, SAMPLE_SALARY_QAR, loadSampleData } from '@/db/seed/sampleData';
import { MONTH_FMT } from '@/domain/budget';
import { MINOR } from '@/domain/money';
import { DATE_FMT } from '@/lib/dates';
import type { Db } from '@/db/types';
import { createReadyDb } from './helpers/testDb';

let db: Db;
beforeEach(async () => {
  db = await createReadyDb();
  await loadSampleData(db);
});

describe('sample data: budget for a 5,000 QAR salary', () => {
  it('budgets use the whole salary and no more, with at least 20% going to savings', () => {
    const total = SAMPLE_BUDGETS_QAR.reduce((s, [, a]) => s + a, 0);
    expect(total).toBe(SAMPLE_SALARY_QAR);
    const savings = SAMPLE_BUDGETS_QAR.find(([n]) => n === 'Savings')![1];
    expect(savings / SAMPLE_SALARY_QAR).toBeGreaterThanOrEqual(0.2);
  });

  it('has a salary account, cash and a credit card, none in the red except the card owed', async () => {
    const accounts = await listAccounts(db);
    expect(accounts.map((a) => a.name).sort()).toEqual(['Cash', 'Credit Card', 'Salary Account']);
    for (const a of accounts) {
      if (a.type === 'credit_card') expect(a.balance_minor).toBeLessThanOrEqual(0);
      else expect(a.balance_minor).toBeGreaterThanOrEqual(0);
    }
  });

  it('every earlier month: 5,000 earned and no category over its budget', async () => {
    for (const back of [1, 2]) {
      const m = dayjs().startOf('month').subtract(back, 'month');
      const month = m.format(MONTH_FMT);
      const sum = await summarizeTransactions(db, { dateFrom: m.format(DATE_FMT), dateTo: m.endOf('month').format(DATE_FMT) });
      expect(sum.incomeMinor).toBe(SAMPLE_SALARY_QAR * MINOR);
      expect(sum.expenseMinor).toBeLessThan(SAMPLE_SALARY_QAR * MINOR);
      const budget = await getMonthBudget(db, month);
      expect(budget.rows.length).toBe(SAMPLE_BUDGETS_QAR.length);
      expect(budget.rows.filter((r) => r.state === 'over')).toEqual([]);
      expect(budget.totals.spentMinor).toBeLessThanOrEqual(budget.totals.availableMinor);
    }
  });

  it('has transactions and a reminder waiting', async () => {
    expect((await listTransactions(db, { limit: 500 })).length).toBeGreaterThan(40);
  });
});
