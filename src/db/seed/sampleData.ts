import dayjs from 'dayjs';
import { MONTH_FMT } from '@/domain/budget';
import { nextAfter, scheduleFromDate } from '@/domain/recurrence';
import { DATE_FMT, today } from '@/lib/dates';
import { MINOR } from '@/domain/money';
import type { PaymentMethod } from '@/types';
import { atomic } from '../atomic';
import { notifyChange } from '../events';
import { createAccount } from '../repositories/accounts';
import { upsertBudget } from '../repositories/budgets';
import { createRecurringRule, processRecurring } from '../repositories/recurring';
import { listCategories } from '../repositories/categories';
import { createTransaction } from '../repositories/transactions';
import type { Db } from '../types';
import { seedDefaults } from './defaults';

/** Wipes every table and re-creates currencies and preset categories. */
export async function eraseAllData(db: Db): Promise<void> {
  await atomic(db, async () => {
    await db.execAsync(`
      DELETE FROM recurring_due;
      DELETE FROM recurring_rules;
      DELETE FROM budget_alerts_sent;
      DELETE FROM budgets;
      DELETE FROM transactions;
      DELETE FROM accounts;
      DELETE FROM categories;
      DELETE FROM currencies;
      DELETE FROM settings;
    `);
  });
  await seedDefaults(db);
  notifyChange();
}

/** Small deterministic generator so sample data is the same every time. */
function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** Erases everything, then loads realistic accounts and ~3 months of transactions. */
export async function loadSampleData(db: Db): Promise<void> {
  await eraseAllData(db);
  const cats = await listCategories(db);
  const cat = (name: string) => {
    const c = cats.find((x) => x.name === name);
    if (!c) throw new Error(`Missing preset category ${name}`);
    return c.id;
  };
  const acct = (
    name: string,
    type: 'cash' | 'bank' | 'credit_card' | 'loan',
    currency: string,
    opening: number,
    icon: string,
    color: string,
    card?: { limit: number; statementDay: number; dueDay: number },
    dueDay?: number,
  ) =>
    createAccount(db, {
      name,
      type,
      currency,
      openingBalanceMinor: opening * MINOR,
      creditLimitMinor: card ? card.limit * MINOR : null,
      statementDay: card?.statementDay ?? null,
      dueDay: card?.dueDay ?? dueDay ?? null,
      icon,
      color,
    });

  const cbq = await acct('CBQ Account', 'bank', 'QAR', 15000, 'business', '#0EA5E9');
  const cbqCard = await acct('CBQ Credit Card', 'credit_card', 'QAR', 0, 'card', '#6C63FF', {
    limit: 20000,
    statementDay: 25,
    dueDay: 15,
  });
  const doha = await acct('Doha Bank Account', 'bank', 'QAR', 4000, 'business', '#EF4444');
  const dohaCard = await acct('Doha Bank Credit Card', 'credit_card', 'QAR', 0, 'card', '#F59E0B', {
    limit: 10000,
    statementDay: 20,
    dueDay: 10,
  });
  const cash = await acct('Cash', 'cash', 'QAR', 600, 'cash', '#22C55E');
  const hdfc = await acct('HDFC Savings', 'bank', 'INR', 250000, 'business', '#3B82F6');
  // Loans are amounts owed, so the opening balance is negative.
  const carLoan = await acct('CBQ Car Loan', 'loan', 'QAR', -30000, 'car', '#F97316', undefined, 5);
  const homeLoan = await acct('HDFC Home Loan', 'loan', 'INR', -2500000, 'home', '#6C63FF', undefined, 10);

  const rnd = lcg(42);
  const t0 = today();

  const add = async (
    date: dayjs.Dayjs,
    type: 'expense' | 'income',
    accountId: string,
    amount: number,
    category: string,
    note: string,
    paymentMethod: PaymentMethod,
  ) => {
    const d = date.format(DATE_FMT);
    if (d > t0) return;
    await createTransaction(db, {
      type,
      date: d,
      accountId,
      amountMinor: Math.round(amount * MINOR),
      categoryId: cat(category),
      toAccountId: null,
      toAmountMinor: null,
      paymentMethod,
      note,
      source: 'sample',
    });
  };
  const transfer = async (
    date: dayjs.Dayjs,
    from: string,
    to: string,
    amount: number,
    toAmount: number,
    note: string,
    fee?: number,
  ) => {
    const d = date.format(DATE_FMT);
    if (d > t0) return;
    await createTransaction(db, {
      type: 'transfer',
      date: d,
      accountId: from,
      amountMinor: Math.round(amount * MINOR),
      categoryId: null,
      toAccountId: to,
      toAmountMinor: Math.round(toAmount * MINOR),
      paymentMethod: 'bank_transfer',
      note,
      source: 'sample',
      feeMinor: fee ? Math.round(fee * MINOR) : null,
    });
  };
  const amt = (min: number, max: number) => Math.round(min + rnd() * (max - min));

  await atomic(db, async () => {
    for (let back = 2; back >= 0; back--) {
      const m = dayjs().startOf('month').subtract(back, 'month');
      const day = (n: number) => m.add(n - 1, 'day');

      // Monthly budgets (QAR). Groceries rolls unused budget over.
      const month = m.format(MONTH_FMT);
      const budgets: [string, number, boolean?][] = [
        ['Rent', 3800], ['Groceries', 1200, true], ['Dining', 500], ['Fuel', 300], ['Utilities', 500],
        ['Shopping', 600], ['Transport', 150], ['Health', 300], ['Entertainment', 100],
        ['Family Remittance', 2000], ['Savings', 1000],
      ];
      for (const [name, amount, rollover] of budgets) {
        await upsertBudget(db, { month, categoryId: cat(name), amountMinor: amount * MINOR, rollover: !!rollover });
      }

      await add(day(1), 'income', cbq, 14500, 'Salary', 'Monthly salary', 'bank_transfer');
      await add(day(2), 'expense', cbq, 3800, 'Rent', 'Apartment rent', 'bank_transfer');
      await add(day(3), 'expense', cbq, 2000, 'Family Remittance', 'Money to family', 'bank_transfer');
      await add(day(5), 'expense', cbq, 280, 'Utilities', 'Kahramaa electricity & water', 'bank_transfer');
      await add(day(6), 'expense', doha, 150, 'Utilities', 'Internet', 'bank_transfer');
      await add(day(4), 'expense', cbq, 1000, 'Savings', 'Monthly saving', 'bank_transfer');
      for (const wk of [3, 10, 17, 24]) {
        await add(day(wk), 'expense', cbqCard, amt(220, 420), 'Groceries', 'Supermarket', 'card');
      }
      for (const d of [7, 14, 21, 28]) {
        await add(day(d), 'expense', cash, amt(40, 70), 'Fuel', 'Petrol', 'cash');
      }
      for (const d of [8, 15, 22]) {
        await add(day(d), 'expense', dohaCard, amt(60, 190), 'Dining', 'Restaurant', 'card');
      }
      await add(day(12), 'expense', cbqCard, amt(150, 600), 'Shopping', 'Mall', 'card');
      await add(day(18), 'expense', cash, amt(20, 60), 'Transport', 'Taxi', 'cash');
      await add(day(20), 'expense', doha, amt(80, 250), 'Health', 'Pharmacy / clinic', 'card');
      await add(day(23), 'expense', cbqCard, 55, 'Entertainment', 'Streaming subscription', 'card');
      // Credit card bill payments are transfers, not expenses.
      await transfer(day(14), cbq, cbqCard, 1000, 1000, 'Card bill payment');
      await transfer(day(9), doha, dohaCard, 200, 200, 'Card bill payment');
      // ATM withdrawal: bank to cash.
      await transfer(day(2), cbq, cash, 600, 600, 'ATM withdrawal');
      // QAR -> INR remittance to own Indian account (cross-currency transfer).
      await transfer(day(10), cbq, hdfc, 1000, 24100, 'To HDFC', 25);
      // Loan EMIs: principal is a transfer to the loan; interest is an expense on the loan.
      await transfer(day(5), cbq, carLoan, 1200, 1200, 'Car loan EMI (principal)');
      await add(day(5), 'expense', carLoan, 150, 'Loan Interest', 'Car loan interest', 'bank_transfer');
      await transfer(day(10), hdfc, homeLoan, 18000, 18000, 'Home loan EMI (principal)');
      await add(day(10), 'expense', homeLoan, 17000, 'Loan Interest', 'Home loan interest', 'bank_transfer');
      await add(day(26), 'expense', hdfc, amt(5000, 15000), 'Others', 'India expenses', 'upi');
    }
  });

  // Recurring items. Auto rules start after today so they do not duplicate the sample history.
  const dateNext = (freq: 'monthly' | 'weekly', day: number) => {
    const sched = scheduleFromDate(freq, dayjs().date(freq === 'monthly' ? day : 1).format(DATE_FMT));
    return nextAfter(freq === 'weekly' ? { ...sched, weekday: day } : sched, t0);
  };
  const rule = (over: Partial<Parameters<typeof createRecurringRule>[1]>) =>
    createRecurringRule(db, {
      name: '', type: 'expense', accountId: cbq, amountMinor: 0, categoryId: null, toAccountId: null,
      toAmountMinor: null, paymentMethod: 'bank_transfer', note: '', frequency: 'monthly',
      nextDueDate: t0, endDate: null, mode: 'auto', ...over,
    });
  await rule({ name: 'Rent', amountMinor: 380000, categoryId: cat('Rent'), nextDueDate: dateNext('monthly', 2) });
  await rule({ name: 'Salary', type: 'income', amountMinor: 1450000, categoryId: cat('Salary'), nextDueDate: dateNext('monthly', 1) });
  await rule({ name: 'Weekly groceries', accountId: cash, amountMinor: 15000, categoryId: cat('Groceries'), paymentMethod: 'cash', frequency: 'weekly', nextDueDate: dateNext('weekly', 5) });
  // A reminder that is already due, so Home and Recurring show something to act on.
  await rule({ name: 'Internet bill', accountId: doha, amountMinor: 15000, categoryId: cat('Utilities'), mode: 'remind', nextDueDate: dayjs().subtract(1, 'day').format(DATE_FMT) });
  await processRecurring(db, t0);
  notifyChange();
}
