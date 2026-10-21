import { monthOf } from '@/domain/budget';
import { Frequency, nextAfter, Schedule, scheduleFromDate } from '@/domain/recurrence';
import { validateTransaction } from '@/domain/transactionRules';
import { newId, nowIso } from '@/lib/id';
import type { PaymentMethod, TransactionInput, TxnType } from '@/types';
import { atomic } from '../atomic';
import { notifyChange } from '../events';
import type { Db } from '../types';
import { listAccounts } from './accounts';
import { BudgetAlert, checkBudgetAlerts } from './budgets';
import { listCategories } from './categories';
import { createTransaction } from './transactions';

export type RecurringMode = 'auto' | 'remind';

export interface RecurringRule {
  id: string;
  name: string;
  type: TxnType;
  account_id: string;
  amount_minor: number;
  category_id: string | null;
  to_account_id: string | null;
  to_amount_minor: number | null;
  payment_method: PaymentMethod;
  note: string;
  frequency: Frequency;
  day_of_month: number | null;
  weekday: number | null;
  end_date: string | null;
  next_due_date: string;
  mode: RecurringMode;
  is_active: number;
  last_error: string | null;
}

export interface RecurringRuleRow extends RecurringRule {
  account_name: string;
  account_currency: string;
  to_account_name: string | null;
  category_name: string | null;
  category_icon: string | null;
  category_color: string | null;
}

export interface RecurringInput {
  name: string;
  type: TxnType;
  accountId: string;
  amountMinor: number;
  categoryId: string | null;
  toAccountId: string | null;
  toAmountMinor: number | null;
  paymentMethod: PaymentMethod;
  note: string;
  frequency: Frequency;
  /** The next date this should happen. The day of month / weekday is taken from it. */
  nextDueDate: string;
  endDate: string | null;
  mode: RecurringMode;
}

export const scheduleOf = (r: Pick<RecurringRule, 'frequency' | 'day_of_month' | 'weekday'>): Schedule => ({
  frequency: r.frequency,
  dayOfMonth: r.day_of_month,
  weekday: r.weekday,
});

const SELECT_ROWS = `
  SELECT r.*, a.name AS account_name, a.currency AS account_currency,
         ta.name AS to_account_name,
         c.name AS category_name, c.icon AS category_icon, c.color AS category_color
  FROM recurring_rules r
  JOIN accounts a ON a.id = r.account_id
  LEFT JOIN accounts ta ON ta.id = r.to_account_id
  LEFT JOIN categories c ON c.id = r.category_id
  WHERE r.deleted_at IS NULL`;

export const listRecurringRules = (db: Db) =>
  db.getAllAsync<RecurringRuleRow>(`${SELECT_ROWS} ORDER BY r.is_active DESC, r.next_due_date, r.name`);

export const getRecurringRule = (db: Db, id: string) =>
  db.getFirstAsync<RecurringRuleRow>(`${SELECT_ROWS} AND r.id = ?`, [id]);

/** What the rule would create on a given due date. */
function transactionFor(rule: RecurringRule, date: string): TransactionInput {
  return {
    type: rule.type,
    date,
    accountId: rule.account_id,
    amountMinor: rule.amount_minor,
    categoryId: rule.category_id,
    toAccountId: rule.to_account_id,
    toAmountMinor: rule.to_amount_minor,
    paymentMethod: rule.payment_method,
    note: rule.note.trim() || rule.name,
    source: 'recurring',
    recurringId: rule.id,
    recurringDueDate: date,
  };
}

async function validateRule(db: Db, input: RecurringInput): Promise<void> {
  if (!input.name.trim()) throw new Error('Give this recurring item a name.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.nextDueDate)) throw new Error('Choose a valid due date.');
  if (input.endDate && input.endDate < input.nextDueDate) {
    throw new Error('The end date cannot be before the due date.');
  }
  const [accounts, categories] = await Promise.all([
    listAccounts(db, { includeArchived: true }),
    listCategories(db, { includeArchived: true }),
  ]);
  const error = validateTransaction(
    {
      type: input.type,
      date: input.nextDueDate,
      accountId: input.accountId,
      amountMinor: input.amountMinor,
      categoryId: input.categoryId,
      toAccountId: input.toAccountId,
      toAmountMinor: input.toAmountMinor,
      paymentMethod: input.paymentMethod,
      note: input.note,
    },
    accounts,
    categories,
  );
  if (error) throw new Error(error);
}

export async function createRecurringRule(db: Db, input: RecurringInput): Promise<string> {
  await validateRule(db, input);
  const id = newId();
  const now = nowIso();
  const s = scheduleFromDate(input.frequency, input.nextDueDate);
  const isTransfer = input.type === 'transfer';
  await db.runAsync(
    `INSERT INTO recurring_rules (id,name,type,account_id,amount_minor,category_id,to_account_id,
       to_amount_minor,payment_method,note,frequency,day_of_month,weekday,end_date,next_due_date,
       mode,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, input.name.trim(), input.type, input.accountId, input.amountMinor,
      isTransfer ? null : input.categoryId,
      isTransfer ? input.toAccountId : null,
      isTransfer ? input.toAmountMinor : null,
      input.paymentMethod, input.note.trim(), input.frequency, s.dayOfMonth, s.weekday,
      input.endDate, input.nextDueDate, input.mode, now, now,
    ],
  );
  notifyChange();
  return id;
}

export async function updateRecurringRule(db: Db, id: string, input: RecurringInput): Promise<void> {
  await validateRule(db, input);
  const s = scheduleFromDate(input.frequency, input.nextDueDate);
  const isTransfer = input.type === 'transfer';
  await db.runAsync(
    `UPDATE recurring_rules SET name=?, type=?, account_id=?, amount_minor=?, category_id=?,
       to_account_id=?, to_amount_minor=?, payment_method=?, note=?, frequency=?, day_of_month=?,
       weekday=?, end_date=?, next_due_date=?, mode=?, last_error=NULL, updated_at=? WHERE id=?`,
    [
      input.name.trim(), input.type, input.accountId, input.amountMinor,
      isTransfer ? null : input.categoryId,
      isTransfer ? input.toAccountId : null,
      isTransfer ? input.toAmountMinor : null,
      input.paymentMethod, input.note.trim(), input.frequency, s.dayOfMonth, s.weekday,
      input.endDate, input.nextDueDate, input.mode, nowIso(), id,
    ],
  );
  notifyChange();
}

export async function setRecurringActive(db: Db, id: string, active: boolean): Promise<void> {
  await db.runAsync('UPDATE recurring_rules SET is_active=?, last_error=NULL, updated_at=? WHERE id=?', [
    active ? 1 : 0,
    nowIso(),
    id,
  ]);
  notifyChange();
}

/** Soft delete. Transactions already created from the rule stay. */
export async function deleteRecurringRule(db: Db, id: string): Promise<void> {
  const now = nowIso();
  await db.runAsync('UPDATE recurring_rules SET deleted_at=?, is_active=0, updated_at=? WHERE id=?', [now, now, id]);
  notifyChange();
}

// ---------- Reminders that wait for the user ----------

export interface PendingDue {
  id: string;
  rule_id: string;
  due_date: string;
  name: string;
  type: TxnType;
  amount_minor: number;
  currency: string;
  account_name: string;
}

export const listPendingDue = (db: Db) =>
  db.getAllAsync<PendingDue>(
    `SELECT d.id, d.rule_id, d.due_date, r.name, r.type, r.amount_minor,
            a.currency AS currency, a.name AS account_name
     FROM recurring_due d
     JOIN recurring_rules r ON r.id = d.rule_id AND r.deleted_at IS NULL
     JOIN accounts a ON a.id = r.account_id
     WHERE d.status = 'pending'
     ORDER BY d.due_date, r.name`,
  );

async function liveOccurrence(db: Db, ruleId: string, dueDate: string): Promise<{ id: string } | null> {
  return db.getFirstAsync<{ id: string }>(
    `SELECT id FROM transactions
     WHERE recurring_id = ? AND recurring_due_date = ? AND deleted_at IS NULL`,
    [ruleId, dueDate],
  );
}

/** "Add now": creates the transaction for a reminder and marks it done. */
export async function confirmDue(db: Db, dueId: string): Promise<{ transactionId: string; month: string }> {
  const due = await db.getFirstAsync<{ id: string; rule_id: string; due_date: string; status: string }>(
    'SELECT id, rule_id, due_date, status FROM recurring_due WHERE id = ?',
    [dueId],
  );
  if (!due || due.status !== 'pending') throw new Error('This reminder was already handled.');
  const rule = await db.getFirstAsync<RecurringRule>(
    'SELECT * FROM recurring_rules WHERE id = ? AND deleted_at IS NULL',
    [due.rule_id],
  );
  if (!rule) throw new Error('This recurring item no longer exists.');
  let transactionId = '';
  await atomic(db, async () => {
    const existing = await liveOccurrence(db, rule.id, due.due_date);
    transactionId = existing ? existing.id : await createTransaction(db, transactionFor(rule, due.due_date));
    await db.runAsync("UPDATE recurring_due SET status='done', transaction_id=?, updated_at=? WHERE id=?", [
      transactionId,
      nowIso(),
      dueId,
    ]);
  });
  notifyChange();
  return { transactionId, month: monthOf(due.due_date) };
}

export async function skipDue(db: Db, dueId: string): Promise<void> {
  await db.runAsync("UPDATE recurring_due SET status='skipped', updated_at=? WHERE id=? AND status='pending'", [
    nowIso(),
    dueId,
  ]);
  notifyChange();
}

// ---------- Catching up on app open ----------

export interface ProcessResult {
  /** Transactions created automatically. */
  created: { ruleName: string; date: string }[];
  /** New reminders waiting for the user. */
  reminders: { ruleName: string; date: string }[];
  /** Rules that could not run, with the reason. */
  errors: { ruleName: string; message: string }[];
  /** Budget thresholds newly reached by the automatic entries. */
  alerts: BudgetAlert[];
}

const MAX_CATCH_UP = 500;

/**
 * Brings every active rule up to `today`. For each due date that has arrived:
 *  - mode "auto": creates the transaction, dated on the due date;
 *  - mode "remind": creates a reminder to confirm or skip.
 * Each occurrence is handled in one all-or-nothing step that also moves the rule's next due date,
 * so running this twice (or while the app is reopened) never creates anything twice.
 */
export async function processRecurring(db: Db, today: string): Promise<ProcessResult> {
  const result: ProcessResult = { created: [], reminders: [], errors: [], alerts: [] };
  const rules = await db.getAllAsync<RecurringRule>(
    `SELECT * FROM recurring_rules
     WHERE deleted_at IS NULL AND is_active = 1 AND next_due_date <= ? ORDER BY next_due_date, name`,
    [today],
  );
  const months = new Set<string>();

  for (const rule of rules) {
    const schedule = scheduleOf(rule);
    let due = rule.next_due_date;
    let steps = 0;
    while (due <= today && (!rule.end_date || due <= rule.end_date) && steps++ < MAX_CATCH_UP) {
      const next = nextAfter(schedule, due);
      try {
        await atomic(db, async () => {
          if (rule.mode === 'auto') {
            if (!(await liveOccurrence(db, rule.id, due))) {
              await createTransaction(db, transactionFor(rule, due));
            }
          } else {
            const now = nowIso();
            await db.runAsync(
              `INSERT OR IGNORE INTO recurring_due (id, rule_id, due_date, created_at, updated_at)
               VALUES (?,?,?,?,?)`,
              [newId(), rule.id, due, now, now],
            );
          }
          await db.runAsync('UPDATE recurring_rules SET next_due_date=?, last_error=NULL, updated_at=? WHERE id=?', [
            next,
            nowIso(),
            rule.id,
          ]);
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await db.runAsync('UPDATE recurring_rules SET last_error=?, updated_at=? WHERE id=?', [message, nowIso(), rule.id]);
        result.errors.push({ ruleName: rule.name, message });
        break;
      }
      if (rule.mode === 'auto') {
        result.created.push({ ruleName: rule.name, date: due });
        months.add(monthOf(due));
      } else {
        result.reminders.push({ ruleName: rule.name, date: due });
      }
      due = next;
    }
    // A rule whose end date has passed is finished.
    if (rule.end_date && due > rule.end_date) {
      await db.runAsync('UPDATE recurring_rules SET is_active=0, updated_at=? WHERE id=?', [nowIso(), rule.id]);
    }
  }

  for (const m of months) result.alerts.push(...(await checkBudgetAlerts(db, m)));
  if (rules.length) notifyChange();
  return result;
}
