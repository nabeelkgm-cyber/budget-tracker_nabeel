import { listAccounts } from '@/db/repositories/accounts';
import { getMonthBudget } from '@/db/repositories/budgets';
import { listCurrencies } from '@/db/repositories/currencies';
import { pendingCount } from '@/db/repositories/inbox';
import { getReport } from '@/db/repositories/reports';
import { listPendingDue } from '@/db/repositories/recurring';
import { listTransactions, summarizeTransactions } from '@/db/repositories/transactions';
import { currentMonth } from '@/domain/budget';
import { useDbQuery } from '@/hooks/useDbQuery';
import { monthRange, today } from '@/lib/dates';

/** Everything the Home dashboard and the Net assets tab show. */
export function useHomeData() {
  return useDbQuery(async (db) => {
    const { from, to } = monthRange(today());
    return {
      accounts: await listAccounts(db),
      currencies: await listCurrencies(db),
      month: await summarizeTransactions(db, { dateFrom: from, dateTo: to }),
      recent: await listTransactions(db, { limit: 5 }),
      budget: await getMonthBudget(db, currentMonth()),
      pending: await listPendingDue(db),
      inbox: await pendingCount(db),
      report: await getReport(db, { mode: 'month', month: currentMonth() }),
    };
  });
}

export type HomeData = NonNullable<ReturnType<typeof useHomeData>['data']>;
