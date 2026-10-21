import { BudgetStatus, budgetStatus, BudgetLine, carryIn, nextMonth, reached100, reached80 } from '@/domain/budget';
import { newId, nowIso } from '@/lib/id';
import { atomic } from '../atomic';
import { notifyChange } from '../events';
import type { Db } from '../types';

export interface BudgetRowStatus extends BudgetStatus {
  categoryId: string;
  categoryName: string;
  icon: string;
  color: string;
  rollover: boolean;
}

export interface UnbudgetedCategory {
  categoryId: string;
  categoryName: string;
  icon: string;
  color: string;
  spentMinor: number;
}

export interface MonthBudget {
  month: string;
  rows: BudgetRowStatus[];
  /** Main expense categories with no budget this month (with what was spent on them). */
  unbudgeted: UnbudgetedCategory[];
  /** Sum over budgeted categories only. */
  totals: BudgetStatus;
}

interface CategoryRow {
  id: string;
  name: string;
  icon: string;
  color: string;
  is_archived: number;
}

/**
 * Budget vs actual for one month. Budgets sit on main expense categories; spending on a
 * sub-category counts towards its main category. Everything is in base currency (QAR), using
 * the rate stored on each transaction. Transfers and deleted entries are never counted.
 */
export async function getMonthBudget(db: Db, month: string): Promise<MonthBudget> {
  const [cats, budgetRows, actualRows] = await Promise.all([
    db.getAllAsync<CategoryRow>(
      `SELECT id, name, icon, color, is_archived FROM categories
       WHERE kind = 'expense' AND parent_id IS NULL AND deleted_at IS NULL
       ORDER BY sort_order, name`,
    ),
    db.getAllAsync<{ month: string; category_id: string; amount_minor: number; rollover: number }>(
      'SELECT month, category_id, amount_minor, rollover FROM budgets WHERE deleted_at IS NULL AND month <= ?',
      [month],
    ),
    db.getAllAsync<{ month: string; root: string; spent: number }>(
      `SELECT substr(t.date, 1, 7) AS month, COALESCE(c.parent_id, c.id) AS root,
              SUM(t.base_amount_minor) AS spent
       FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE t.deleted_at IS NULL AND t.type = 'expense' AND t.date < ?
       GROUP BY month, root`,
      [`${nextMonth(month)}-01`],
    ),
  ]);

  const budgetsByCat = new Map<string, Map<string, BudgetLine>>();
  for (const b of budgetRows) {
    if (!budgetsByCat.has(b.category_id)) budgetsByCat.set(b.category_id, new Map());
    budgetsByCat.get(b.category_id)!.set(b.month, { amountMinor: b.amount_minor, rollover: !!b.rollover });
  }
  const actualsByCat = new Map<string, Map<string, number>>();
  for (const a of actualRows) {
    if (!actualsByCat.has(a.root)) actualsByCat.set(a.root, new Map());
    actualsByCat.get(a.root)!.set(a.month, a.spent);
  }

  const rows: BudgetRowStatus[] = [];
  const unbudgeted: UnbudgetedCategory[] = [];
  for (const c of cats) {
    const budgets = budgetsByCat.get(c.id) ?? new Map<string, BudgetLine>();
    const actuals = actualsByCat.get(c.id) ?? new Map<string, number>();
    const line = budgets.get(month);
    const spent = actuals.get(month) ?? 0;
    if (line) {
      rows.push({
        ...budgetStatus(line.amountMinor, carryIn(month, budgets, actuals), spent),
        categoryId: c.id,
        categoryName: c.name,
        icon: c.icon,
        color: c.color,
        rollover: line.rollover,
      });
    } else if (!c.is_archived || spent > 0) {
      unbudgeted.push({ categoryId: c.id, categoryName: c.name, icon: c.icon, color: c.color, spentMinor: spent });
    }
  }

  const available = rows.reduce((s, r) => s + r.availableMinor, 0);
  const amount = rows.reduce((s, r) => s + r.amountMinor, 0);
  const spent = rows.reduce((s, r) => s + r.spentMinor, 0);
  return { month, rows, unbudgeted, totals: budgetStatus(amount, available - amount, spent) };
}

export interface BudgetInput {
  month: string;
  categoryId: string;
  amountMinor: number;
  rollover: boolean;
}

/** Creates or updates the budget for a category in a month. */
export async function upsertBudget(db: Db, input: BudgetInput): Promise<void> {
  if (!/^\d{4}-\d{2}$/.test(input.month)) throw new Error('Choose a valid month.');
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error('Enter a budget amount greater than zero.');
  }
  const cat = await db.getFirstAsync<{ kind: string; parent_id: string | null }>(
    'SELECT kind, parent_id FROM categories WHERE id = ? AND deleted_at IS NULL',
    [input.categoryId],
  );
  if (!cat) throw new Error('Category not found.');
  if (cat.kind !== 'expense') throw new Error('Budgets are for expense categories.');
  if (cat.parent_id) throw new Error('Set the budget on the main category; its sub-categories are included.');
  const now = nowIso();
  await db.runAsync(
    `INSERT INTO budgets (id, month, category_id, amount_minor, rollover, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT (month, category_id) DO UPDATE SET
       amount_minor = excluded.amount_minor, rollover = excluded.rollover,
       deleted_at = NULL, updated_at = excluded.updated_at`,
    [newId(), input.month, input.categoryId, input.amountMinor, input.rollover ? 1 : 0, now, now],
  );
  notifyChange();
}

export async function deleteBudget(db: Db, month: string, categoryId: string): Promise<void> {
  const now = nowIso();
  await atomic(db, async () => {
    await db.runAsync(
      'UPDATE budgets SET deleted_at = ?, updated_at = ? WHERE month = ? AND category_id = ? AND deleted_at IS NULL',
      [now, now, month, categoryId],
    );
    await db.runAsync('DELETE FROM budget_alerts_sent WHERE month = ? AND category_id = ?', [month, categoryId]);
  });
  notifyChange();
}

/**
 * Copies every budget from one month into another. Categories that already have a budget in the
 * target month are left alone. Returns how many budgets were added.
 */
export async function copyBudgets(db: Db, fromMonth: string, toMonth: string): Promise<number> {
  if (fromMonth === toMonth) return 0;
  const source = await db.getAllAsync<{ category_id: string; amount_minor: number; rollover: number }>(
    'SELECT category_id, amount_minor, rollover FROM budgets WHERE month = ? AND deleted_at IS NULL',
    [fromMonth],
  );
  const existing = new Set(
    (
      await db.getAllAsync<{ category_id: string }>(
        'SELECT category_id FROM budgets WHERE month = ? AND deleted_at IS NULL',
        [toMonth],
      )
    ).map((r) => r.category_id),
  );
  let added = 0;
  await atomic(db, async () => {
    for (const b of source) {
      if (existing.has(b.category_id)) continue;
      await upsertBudget(db, {
        month: toMonth,
        categoryId: b.category_id,
        amountMinor: b.amount_minor,
        rollover: !!b.rollover,
      });
      added++;
    }
  });
  return added;
}

export interface BudgetAlert {
  categoryId: string;
  categoryName: string;
  /** The highest threshold newly reached: 80 or 100. */
  threshold: 80 | 100;
  spentMinor: number;
  availableMinor: number;
}

/**
 * Compares spending with budgets and returns the thresholds (80% / 100%) that were newly reached
 * since the last check. Each is reported once; if spending later falls back under a threshold
 * (an entry was edited or deleted), the flag resets and it can be reported again.
 */
export async function checkBudgetAlerts(db: Db, month: string): Promise<BudgetAlert[]> {
  const { rows } = await getMonthBudget(db, month);
  const sent = await db.getAllAsync<{ category_id: string; threshold: number }>(
    'SELECT category_id, threshold FROM budget_alerts_sent WHERE month = ?',
    [month],
  );
  const sentKey = new Set(sent.map((s) => `${s.category_id}:${s.threshold}`));
  const alerts: BudgetAlert[] = [];
  const now = nowIso();

  await atomic(db, async () => {
    const stillMet = new Set<string>();
    for (const r of rows) {
      const met: (80 | 100)[] = [];
      if (reached80(r.spentMinor, r.availableMinor)) met.push(80);
      if (reached100(r.spentMinor, r.availableMinor)) met.push(100);
      let newest: 80 | 100 | null = null;
      for (const th of met) {
        const key = `${r.categoryId}:${th}`;
        stillMet.add(key);
        if (!sentKey.has(key)) {
          await db.runAsync(
            'INSERT INTO budget_alerts_sent (month, category_id, threshold, sent_at) VALUES (?,?,?,?)',
            [month, r.categoryId, th, now],
          );
          newest = th;
        }
      }
      if (newest) {
        alerts.push({
          categoryId: r.categoryId,
          categoryName: r.categoryName,
          threshold: newest,
          spentMinor: r.spentMinor,
          availableMinor: r.availableMinor,
        });
      }
    }
    // Forget thresholds that are no longer exceeded (or whose budget is gone).
    for (const s of sent) {
      if (!stillMet.has(`${s.category_id}:${s.threshold}`)) {
        await db.runAsync(
          'DELETE FROM budget_alerts_sent WHERE month = ? AND category_id = ? AND threshold = ?',
          [month, s.category_id, s.threshold],
        );
      }
    }
  });
  return alerts;
}
