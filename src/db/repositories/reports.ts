import { periodBounds, previousPeriod, ReportPeriod, seriesMonths } from '@/domain/reportPeriod';
import type { Db } from '../types';
import { buildWhere, FROM_SQL, summarizeTransactions, TransactionTotals } from './transactions';

/** Report filters. Amounts are always in base currency (QAR) at each entry's stored rate. */
export interface ReportFilter {
  accountId?: string;
  /** A main category includes its sub-categories and splits the breakdown by sub-category. */
  categoryId?: string;
}

export interface CategorySlice {
  categoryId: string;
  name: string;
  color: string;
  icon: string;
  totalMinor: number;
  count: number;
}

export interface MonthPoint {
  month: string; // YYYY-MM
  incomeMinor: number;
  expenseMinor: number;
}

export interface Report {
  from: string;
  to: string;
  totals: TransactionTotals;
  /** Same figures for the period immediately before, for comparison. */
  previous: TransactionTotals;
  expenseBreakdown: CategorySlice[];
  incomeBreakdown: CategorySlice[];
  series: MonthPoint[];
}

const dated = (filter: ReportFilter, from: string, to: string) => ({
  accountId: filter.accountId,
  categoryId: filter.categoryId,
  dateFrom: from,
  dateTo: to,
});

async function breakdown(
  db: Db,
  kind: 'expense' | 'income',
  from: string,
  to: string,
  filter: ReportFilter,
): Promise<CategorySlice[]> {
  const { sql, params } = buildWhere({ ...dated(filter, from, to), type: kind });
  // With a category filter, split by the exact category; otherwise roll sub-categories up.
  const bySub = !!filter.categoryId;
  const key = bySub ? 'c.id' : 'COALESCE(p.id, c.id)';
  const name = bySub ? 'c.name' : 'COALESCE(p.name, c.name)';
  const color = bySub ? 'c.color' : 'COALESCE(p.color, c.color)';
  const icon = bySub ? 'c.icon' : 'COALESCE(p.icon, c.icon)';
  const rows = await db.getAllAsync<{
    id: string;
    name: string;
    color: string;
    icon: string;
    total: number;
    n: number;
  }>(
    `SELECT ${key} AS id, ${name} AS name, ${color} AS color, ${icon} AS icon,
            SUM(t.base_amount_minor) AS total, COUNT(*) AS n
     ${FROM_SQL}
     WHERE ${sql}
     GROUP BY ${key}
     ORDER BY total DESC, name`,
    params,
  );
  return rows.map((r) => ({
    categoryId: r.id,
    name: bySub && r.id === filter.categoryId && rows.length > 1 ? `${r.name} (direct)` : r.name,
    color: r.color,
    icon: r.icon,
    totalMinor: r.total,
    count: r.n,
  }));
}

async function monthSeries(
  db: Db,
  period: ReportPeriod,
  from: string,
  to: string,
  filter: ReportFilter,
): Promise<MonthPoint[]> {
  const months = seriesMonths(period);
  // The month view looks back 12 months; a custom range stays exactly inside its dates.
  const lo = period.mode === 'range' ? from : `${months[0]}-01`;
  const hi = period.mode === 'range' ? to : `${months[months.length - 1]}-31`;
  const { sql, params } = buildWhere(dated(filter, lo, hi));
  const rows = await db.getAllAsync<{ month: string; income: number; expense: number }>(
    `SELECT substr(t.date, 1, 7) AS month,
       COALESCE(SUM(CASE WHEN t.type = 'income'  THEN t.base_amount_minor END), 0) AS income,
       COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.base_amount_minor END), 0) AS expense
     ${FROM_SQL}
     WHERE ${sql}
     GROUP BY month`,
    params,
  );
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  return months.map((m) => ({
    month: m,
    incomeMinor: byMonth.get(m)?.income ?? 0,
    expenseMinor: byMonth.get(m)?.expense ?? 0,
  }));
}

/** Everything the Reports screen shows for one period and filter. */
export async function getReport(db: Db, period: ReportPeriod, filter: ReportFilter = {}): Promise<Report> {
  const { from, to } = periodBounds(period);
  const prev = periodBounds(previousPeriod(period));
  const [totals, previous, expenseBreakdown, incomeBreakdown, series] = await Promise.all([
    summarizeTransactions(db, dated(filter, from, to)),
    summarizeTransactions(db, dated(filter, prev.from, prev.to)),
    breakdown(db, 'expense', from, to, filter),
    breakdown(db, 'income', from, to, filter),
    monthSeries(db, period, from, to, filter),
  ]);
  return { from, to, totals, previous, expenseBreakdown, incomeBreakdown, series };
}
