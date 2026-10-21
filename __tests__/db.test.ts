/** @jest-environment node */
import { LATEST_VERSION, migrate } from '@/db/migrations';
import { seedDefaults } from '@/db/seed/defaults';
import { loadSampleData } from '@/db/seed/sampleData';
import { createAccount, getAccount, listAccounts, setAccountArchived } from '@/db/repositories/accounts';
import { listCategories, setCategoryArchived, createCategory } from '@/db/repositories/categories';
import { setCurrencyRate } from '@/db/repositories/currencies';
import {
  createTransaction,
  deleteTransaction,
  duplicateTransaction,
  getTransaction,
  listTransactions,
  updateTransaction,
} from '@/db/repositories/transactions';
import type { Db } from '@/db/types';
import type { TransactionInput } from '@/types';
import { createReadyDb, createTestDb } from './helpers/testDb';

let db: Db;
let cat: Record<string, string>;

const acct = (name: string, type: 'cash' | 'bank' | 'credit_card', currency: string, opening = 0) =>
  createAccount(db, {
    name,
    type,
    currency,
    openingBalanceMinor: opening,
    creditLimitMinor: null,
    statementDay: null,
    dueDay: null,
    icon: 'wallet',
    color: '#000',
  });

const txn = (p: Partial<TransactionInput> & Pick<TransactionInput, 'accountId' | 'amountMinor'>): TransactionInput => ({
  type: 'expense',
  date: '2026-10-01',
  categoryId: cat.Groceries,
  toAccountId: null,
  toAmountMinor: null,
  paymentMethod: 'cash',
  note: '',
  ...p,
});

const balance = async (id: string) => (await getAccount(db, id))!.balance_minor;

beforeEach(async () => {
  db = await createReadyDb();
  const cats = await listCategories(db);
  cat = Object.fromEntries(cats.map((c) => [c.name, c.id]));
});

describe('migrations and seed', () => {
  it('creates the schema at the latest version and is idempotent', async () => {
    const fresh = createTestDb();
    await migrate(fresh);
    await migrate(fresh);
    const v = await fresh.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(v?.user_version).toBe(LATEST_VERSION);
    await seedDefaults(fresh);
    await seedDefaults(fresh);
    const n = await fresh.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM categories');
    expect(n?.n).toBe(17);
  });
  it('seeds the preset categories, QAR and INR', async () => {
    const names = Object.keys(cat);
    for (const n of ['Rent', 'Groceries', 'Fuel', 'Utilities', 'Dining', 'Transport',
      'Family Remittance', 'Shopping', 'Health', 'Education', 'Entertainment', 'Savings', 'Others', 'Loan Interest', 'Bank Charges']) {
      expect(names).toContain(n);
    }
    const cur = await db.getAllAsync<{ code: string }>('SELECT code FROM currencies ORDER BY code');
    expect(cur.map((c) => c.code)).toEqual(['INR', 'QAR']);
  });
});

describe('account balances', () => {
  it('adds income and subtracts expenses from the opening balance', async () => {
    const a = await acct('Bank', 'bank', 'QAR', 100000);
    await createTransaction(db, txn({ accountId: a, amountMinor: 25000 }));
    await createTransaction(db, txn({ accountId: a, amountMinor: 50000, type: 'income', categoryId: cat.Salary }));
    expect(await balance(a)).toBe(100000 - 25000 + 50000);
  });

  it('transfers move money without counting as expense or income', async () => {
    const a = await acct('Bank', 'bank', 'QAR', 100000);
    const b = await acct('Cash', 'cash', 'QAR', 0);
    await createTransaction(db, txn({ type: 'transfer', categoryId: null, accountId: a, amountMinor: 30000, toAccountId: b, toAmountMinor: 30000 }));
    expect(await balance(a)).toBe(70000);
    expect(await balance(b)).toBe(30000);
    const income = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM transactions WHERE type IN ('income','expense')");
    expect(income?.n).toBe(0);
  });

  it('cross-currency transfer credits the destination amount and records the QAR value', async () => {
    const q = await acct('CBQ', 'bank', 'QAR', 500000);
    const i = await acct('HDFC', 'bank', 'INR', 0);
    const id = await createTransaction(db, txn({ type: 'transfer', categoryId: null, accountId: q, amountMinor: 100000, toAccountId: i, toAmountMinor: 2410000 }));
    expect(await balance(q)).toBe(400000);
    expect(await balance(i)).toBe(2410000);
    expect((await getTransaction(db, id))!.base_amount_minor).toBe(100000);
  });

  it('credit card: spend increases amount owed, payment (transfer) reduces it', async () => {
    const bank = await acct('Bank', 'bank', 'QAR', 200000);
    const card = await acct('Card', 'credit_card', 'QAR', 0);
    await createTransaction(db, txn({ accountId: card, amountMinor: 80000, paymentMethod: 'card' }));
    expect(await balance(card)).toBe(-80000);
    await createTransaction(db, txn({ type: 'transfer', categoryId: null, accountId: bank, amountMinor: 50000, toAccountId: card, toAmountMinor: 50000 }));
    expect(await balance(card)).toBe(-30000);
    expect(await balance(bank)).toBe(150000);
  });

  it('deleted transactions no longer affect balances', async () => {
    const a = await acct('Bank', 'bank', 'QAR', 100000);
    const id = await createTransaction(db, txn({ accountId: a, amountMinor: 25000 }));
    await deleteTransaction(db, id);
    expect(await balance(a)).toBe(100000);
    expect(await getTransaction(db, id)).toBeNull();
    expect(await listTransactions(db)).toHaveLength(0);
  });
});

describe('exchange rates', () => {
  it('freezes the rate on each transaction when the rate is later updated', async () => {
    const i = await acct('HDFC', 'bank', 'INR', 0);
    const first = await createTransaction(db, txn({ accountId: i, amountMinor: 2410000 })); // at 0.0413
    await setCurrencyRate(db, 'INR', 4_500_000); // 0.045
    const second = await createTransaction(db, txn({ accountId: i, amountMinor: 2410000 }));
    expect((await getTransaction(db, first))!.base_amount_minor).toBe(99533);
    expect((await getTransaction(db, second))!.base_amount_minor).toBe(108450);
  });

  it('keeps the original rate when editing amount on the same account', async () => {
    const i = await acct('HDFC', 'bank', 'INR', 0);
    const id = await createTransaction(db, txn({ accountId: i, amountMinor: 1000000 }));
    await setCurrencyRate(db, 'INR', 5_000_000);
    await updateTransaction(db, id, txn({ accountId: i, amountMinor: 2000000 }));
    const t = (await getTransaction(db, id))!;
    expect(t.fx_rate_e8).toBe(4_130_000);
    expect(t.base_amount_minor).toBe(82600);
  });
});

describe('edit, duplicate, validate', () => {
  it('edits a transaction', async () => {
    const a = await acct('Bank', 'bank', 'QAR', 0);
    const id = await createTransaction(db, txn({ accountId: a, amountMinor: 1000, note: ' old ' }));
    await updateTransaction(db, id, txn({ accountId: a, amountMinor: 2000, categoryId: cat.Dining, note: 'new' }));
    const t = (await getTransaction(db, id))!;
    expect([t.amount_minor, t.category_id, t.note]).toEqual([2000, cat.Dining, 'new']);
  });

  it('duplicates with the same details dated today', async () => {
    const a = await acct('Bank', 'bank', 'QAR', 0);
    const id = await createTransaction(db, txn({ accountId: a, amountMinor: 1234, note: 'coffee', date: '2020-01-01' }));
    const copy = (await getTransaction(db, await duplicateTransaction(db, id)))!;
    expect(copy.id).not.toBe(id);
    expect([copy.amount_minor, copy.note, copy.category_id]).toEqual([1234, 'coffee', cat.Groceries]);
    expect(copy.date).not.toBe('2020-01-01');
    expect(await balance(a)).toBe(-2468);
  });

  it('rejects invalid input and stores nothing', async () => {
    const a = await acct('Bank', 'bank', 'QAR', 0);
    await expect(createTransaction(db, txn({ accountId: a, amountMinor: 0 }))).rejects.toThrow(/greater than zero/);
    await expect(createTransaction(db, txn({ accountId: a, amountMinor: 5, categoryId: cat.Salary }))).rejects.toThrow(/expense category/);
    expect(await listTransactions(db)).toHaveLength(0);
  });
});

describe('archive', () => {
  it('archiving an account hides it from the active list but keeps history', async () => {
    const a = await acct('Old', 'bank', 'QAR', 0);
    await createTransaction(db, txn({ accountId: a, amountMinor: 100 }));
    await setAccountArchived(db, a, true);
    expect(await listAccounts(db)).toHaveLength(0);
    expect(await listAccounts(db, { includeArchived: true })).toHaveLength(1);
    expect(await listTransactions(db)).toHaveLength(1);
  });

  it('archiving a category archives its sub-categories', async () => {
    const sub = await createCategory(db, { name: 'Cafe', kind: 'expense', parentId: cat.Dining, icon: 'cafe', color: '#111' });
    await setCategoryArchived(db, cat.Dining, true);
    const active = (await listCategories(db)).map((c) => c.id);
    expect(active).not.toContain(cat.Dining);
    expect(active).not.toContain(sub);
  });
});

describe('sample data', () => {
  it('loads, and every account balance equals opening + its transaction effects', async () => {
    await loadSampleData(db);
    const accounts = await listAccounts(db);
    expect(accounts.length).toBe(8);
    const txns = await listTransactions(db, { limit: 1000 });
    expect(txns.length).toBeGreaterThan(40);
    for (const a of accounts) {
      let expected = a.opening_balance_minor;
      for (const t of txns) {
        if (t.account_id === a.id) expected += t.type === 'income' ? t.amount_minor : -t.amount_minor;
        if (t.to_account_id === a.id) expected += t.to_amount_minor!;
      }
      expect(a.balance_minor).toBe(expected);
    }
  });
});

describe('loans / liabilities', () => {
  it('a loan is an amount owed; repaying by transfer reduces it and is not an expense', async () => {
    const bank = await acct('CBQ', 'bank', 'QAR', 500000);
    const loan = await createAccount(db, {
      name: 'Car loan', type: 'loan', currency: 'QAR', openingBalanceMinor: -3000000,
      creditLimitMinor: null, statementDay: null, dueDay: 5, icon: 'car', color: '#000',
    });
    await createTransaction(db, txn({ type: 'transfer', categoryId: null, accountId: bank, amountMinor: 100000, toAccountId: loan, toAmountMinor: 100000 }));
    expect(await balance(loan)).toBe(-2900000);
    expect(await balance(bank)).toBe(400000);
    const spend = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM transactions WHERE type = 'expense'");
    expect(spend?.n).toBe(0);
  });

  it('interest posted as an expense on the loan increases the amount owed', async () => {
    const loan = await createAccount(db, {
      name: 'Home loan', type: 'loan', currency: 'INR', openingBalanceMinor: -500000000,
      creditLimitMinor: null, statementDay: null, dueDay: null, icon: 'home', color: '#000',
    });
    await createTransaction(db, txn({ accountId: loan, amountMinor: 4500000, categoryId: cat.Others, note: 'Interest' }));
    expect(await balance(loan)).toBe(-504500000);
  });

  it('borrowing more (transfer from the loan to a bank) raises the debt and the bank balance', async () => {
    const bank = await acct('HDFC', 'bank', 'INR', 0);
    const loan = await createAccount(db, {
      name: 'Personal loan', type: 'loan', currency: 'INR', openingBalanceMinor: 0,
      creditLimitMinor: null, statementDay: null, dueDay: null, icon: 'cash', color: '#000',
    });
    await createTransaction(db, txn({ type: 'transfer', categoryId: null, accountId: loan, amountMinor: 10000000, toAccountId: bank, toAmountMinor: 10000000 }));
    expect(await balance(loan)).toBe(-10000000);
    expect(await balance(bank)).toBe(10000000);
  });
});

describe('transfer fee', () => {
  const transferInput = (from: string, to: string, extra: Partial<TransactionInput> = {}) =>
    txn({ type: 'transfer', categoryId: null, accountId: from, amountMinor: 100000, toAccountId: to, toAmountMinor: 2410000, ...extra });

  it('creates a Bank Charges expense on the From account, linked to the transfer', async () => {
    const q = await acct('CBQ', 'bank', 'QAR', 500000);
    const i = await acct('HDFC', 'bank', 'INR', 0);
    const id = await createTransaction(db, transferInput(q, i, { feeMinor: 2500 }));
    expect(await balance(q)).toBe(500000 - 100000 - 2500);
    expect(await balance(i)).toBe(2410000);
    const fee = (await listTransactions(db)).find((t) => t.linked_txn_id === id)!;
    expect([fee.type, fee.category_name, fee.amount_minor, fee.account_id]).toEqual(['expense', 'Bank Charges', 2500, q]);
  });

  it('no fee when zero or empty', async () => {
    const q = await acct('CBQ', 'bank', 'QAR', 500000);
    const i = await acct('HDFC', 'bank', 'INR', 0);
    await createTransaction(db, transferInput(q, i, { feeMinor: 0 }));
    await createTransaction(db, transferInput(q, i));
    expect((await listTransactions(db)).filter((t) => t.type === 'expense')).toHaveLength(0);
  });

  it('editing the fee updates, adds or removes it', async () => {
    const q = await acct('CBQ', 'bank', 'QAR', 500000);
    const i = await acct('HDFC', 'bank', 'INR', 0);
    const id = await createTransaction(db, transferInput(q, i));
    await updateTransaction(db, id, transferInput(q, i, { feeMinor: 3000 })); // add
    expect(await balance(q)).toBe(500000 - 100000 - 3000);
    await updateTransaction(db, id, transferInput(q, i, { feeMinor: 4000 })); // change
    expect(await balance(q)).toBe(500000 - 100000 - 4000);
    expect((await listTransactions(db)).filter((t) => t.type === 'expense')).toHaveLength(1);
    await updateTransaction(db, id, transferInput(q, i, { feeMinor: null })); // remove
    expect(await balance(q)).toBe(400000);
    expect((await listTransactions(db)).filter((t) => t.type === 'expense')).toHaveLength(0);
  });

  it('turning a transfer into an expense drops its fee', async () => {
    const q = await acct('CBQ', 'bank', 'QAR', 500000);
    const i = await acct('HDFC', 'bank', 'INR', 0);
    const id = await createTransaction(db, transferInput(q, i, { feeMinor: 2500 }));
    await updateTransaction(db, id, txn({ accountId: q, amountMinor: 1000 }));
    expect((await listTransactions(db)).filter((t) => t.category_name === 'Bank Charges')).toHaveLength(0);
  });

  it('deleting the transfer deletes its fee; duplicating copies it', async () => {
    const q = await acct('CBQ', 'bank', 'QAR', 500000);
    const i = await acct('HDFC', 'bank', 'INR', 0);
    const id = await createTransaction(db, transferInput(q, i, { feeMinor: 2500 }));
    const copy = await duplicateTransaction(db, id);
    expect(await balance(q)).toBe(500000 - 2 * (100000 + 2500));
    await deleteTransaction(db, copy);
    expect(await balance(q)).toBe(500000 - 100000 - 2500);
    await deleteTransaction(db, id);
    expect(await balance(q)).toBe(500000);
    expect(await listTransactions(db)).toHaveLength(0);
  });

  it('a fee in an INR account uses that account currency and is counted in QAR', async () => {
    const i = await acct('HDFC', 'bank', 'INR', 10000000);
    const q = await acct('CBQ', 'bank', 'QAR', 0);
    const id = await createTransaction(db, transferInput(i, q, { amountMinor: 2410000, toAmountMinor: 100000, feeMinor: 50000 }));
    const fee = (await listTransactions(db)).find((t) => t.linked_txn_id === id)!;
    expect([fee.account_currency, fee.base_amount_minor]).toEqual(['INR', 2065]); // INR 500 @0.0413
  });

  it('rejects a negative fee', async () => {
    const q = await acct('CBQ', 'bank', 'QAR', 0);
    const i = await acct('HDFC', 'bank', 'INR', 0);
    await expect(createTransaction(db, transferInput(q, i, { feeMinor: -5 }))).rejects.toThrow(/fee/);
  });
});
