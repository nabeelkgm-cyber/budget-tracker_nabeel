/** @jest-environment node */
import { createHash } from 'crypto';
import { createAccount, getAccount, listAccounts } from '@/db/repositories/accounts';
import { listCategories } from '@/db/repositories/categories';
import { BACKUP_TABLES, createBackup, parseBackup, restoreBackup } from '@/db/repositories/dataTransfer';
import {
  NewItem,
  addBatch,
  addLast4,
  approveAllSuggested,
  approveItem,
  findAccountsByLast4,
  getAccountIdentifiers,
  getInboxItem,
  linkItem,
  listInbox,
  pendingCount,
  rejectAllPending,
  rejectItem,
  restoreDuplicate,
  setAccountIdentifiers,
  suggestForMerchant,
} from '@/db/repositories/inbox';
import { createTransaction, listTransactions } from '@/db/repositories/transactions';
import { eraseAllData } from '@/db/seed/sampleData';
import type { Db } from '@/db/types';
import { convertSms, convertStatementItems } from '@/domain/importConvert';
import { merchantKey } from '@/domain/statement';
import { parseSms } from '@/domain/sms';
import { createReadyDb } from './helpers/testDb';

let db: Db;
let cat: Record<string, string>;
let cbq: string;
let card: string;
let hdfc: string;

const acct = (name: string, currency = 'QAR', type: 'bank' | 'credit_card' = 'bank', opening = 0) =>
  createAccount(db, { name, type, currency, openingBalanceMinor: opening, creditLimitMinor: null, statementDay: null, dueDay: null, icon: 'b', color: '#000' });

const line = (date: string, description: string, amountMinor: number, direction: 'debit' | 'credit' = 'debit', extra: Partial<NewItem> = {}): NewItem => ({
  accountId: cbq, date, description, direction, amountMinor, reference: null, raw: description, ...extra,
});
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const batch = (items: NewItem[], text = JSON.stringify(items)) => addBatch(db, { source: 'csv', fileName: 'a.csv', fileHash: hash(text), accountId: cbq }, items);

beforeEach(async () => {
  db = await createReadyDb();
  cat = Object.fromEntries((await listCategories(db)).map((c) => [c.name, c.id]));
  cbq = await acct('CBQ', 'QAR', 'bank', 1_000_000);
  card = await acct('CBQ Card', 'QAR', 'credit_card');
  hdfc = await acct('HDFC', 'INR');
});

describe('adding a batch', () => {
  it('puts lines in the inbox as pending, creating no transactions', async () => {
    const r = await batch([line('2026-10-02', 'POS LULU HYPERMARKET', 12_550), line('2026-10-03', 'SALARY', 1_450_000, 'credit')]);
    expect(r).toMatchObject({ pending: 2, duplicates: 0, possible: 0 });
    expect(await pendingCount(db)).toBe(2);
    expect(await listTransactions(db)).toHaveLength(0);
    const items = await listInbox(db);
    expect(items.map((i) => [i.description, i.suggested_type])).toEqual([['SALARY', 'income'], ['POS LULU HYPERMARKET', 'expense']]);
  });

  it('refuses the same file or pasted text twice', async () => {
    const items = [line('2026-10-02', 'A', 100)];
    await batch(items, 'file-1');
    await expect(batch(items, 'file-1')).rejects.toThrow(/already added/);
    expect(await pendingCount(db)).toBe(1);
  });

  it('refuses an empty batch', async () => {
    await expect(batch([])).rejects.toThrow(/nothing/);
  });

  it('keeps genuine repeats inside one file', async () => {
    const r = await batch([line('2026-10-02', 'POS COFFEE SHOP', 1500), line('2026-10-02', 'POS COFFEE SHOP', 1500)]);
    expect(r).toMatchObject({ pending: 2, duplicates: 0 });
  });
});

describe('overlapping statements', () => {
  it('a later statement that repeats earlier lines only adds the new ones', async () => {
    const early = [line('2026-10-02', 'POS LULU', 5000), line('2026-10-05', 'POS CARREFOUR', 7000)];
    await batch(early, 'oct-first-half');
    for (const i of await listInbox(db)) await approveItem(db, i.id, { type: 'expense', categoryId: cat.Groceries });
    const full = [...early, line('2026-10-20', 'POS WOQOD FUEL', 9000)];
    const r = await batch(full, 'oct-full');
    expect(r).toMatchObject({ pending: 1, duplicates: 2 });
    expect((await listInbox(db)).map((i) => i.description)).toEqual(['POS WOQOD FUEL']);
  });

  it('also skips lines still waiting in the inbox from an earlier file', async () => {
    await batch([line('2026-10-02', 'POS LULU', 5000)], 'a');
    const r = await batch([line('2026-10-02', 'POS LULU', 5000), line('2026-10-03', 'POS X', 100)], 'b');
    expect(r).toMatchObject({ pending: 1, duplicates: 1 });
  });

  it('two identical lines in a file, one already known: only the extra one is new', async () => {
    await batch([line('2026-10-02', 'POS COFFEE', 1500)], 'a');
    const r = await batch([line('2026-10-02', 'POS COFFEE', 1500), line('2026-10-02', 'POS COFFEE', 1500)], 'b');
    expect(r).toMatchObject({ pending: 1, duplicates: 1 });
  });
});

describe('matching transactions already in the app', () => {
  const manual = (date: string, amountMinor: number, note: string, category = 'Groceries') =>
    createTransaction(db, { type: 'expense', date, accountId: cbq, amountMinor, categoryId: cat[category], toAccountId: null, toAmountMinor: null, paymentMethod: 'cash', note });

  it('same day, amount and wording as a manual entry: skipped as a duplicate, and its reference remembered', async () => {
    const id = await manual('2026-10-02', 12_550, 'Lulu Hypermarket');
    const r = await batch([line('2026-10-02', 'POS LULU HYPERMARKET DOHA', 12_550, 'debit', { reference: 'ref998877' })]);
    expect(r).toMatchObject({ pending: 0, duplicates: 1 });
    const txn = (await listTransactions(db)).find((t) => t.id === id)!;
    expect(txn.external_ref).toBe('ref:REF998877');
    expect(await listTransactions(db)).toHaveLength(1);
  });

  it('same amount a day later with different wording: kept for review with the match shown', async () => {
    const id = await manual('2026-10-02', 12_550, 'Lunch');
    const r = await batch([line('2026-10-03', 'POS UNKNOWN MERCHANT', 12_550)]);
    expect(r).toMatchObject({ pending: 1, possible: 1 });
    const [item] = await listInbox(db);
    expect([item.dup_kind, item.dup_txn_id, item.dup_note, item.dup_date]).toEqual(['possible', id, 'Lunch', '2026-10-02']);
  });

  it('"link" confirms the existing entry instead of adding another', async () => {
    const id = await manual('2026-10-02', 12_550, 'Lunch', 'Dining');
    await batch([line('2026-10-03', 'POS UNKNOWN CAFE', 12_550, 'debit', { reference: 'R12345678' })]);
    const [item] = await listInbox(db);
    await linkItem(db, item.id, id);
    expect(await listTransactions(db)).toHaveLength(1);
    expect(await pendingCount(db)).toBe(0);
    expect((await listTransactions(db))[0].external_ref).toBe('ref:R12345678');
    // The category of the linked entry is remembered for that merchant.
    expect(await suggestForMerchant(db, merchantKey('POS UNKNOWN CAFE'))).toEqual({ categoryId: cat.Dining, type: 'expense' });
    // Next time the same reference shows up it is recognised for certain, even with a different date.
    const again = await batch([line('2026-10-09', 'SOMETHING ELSE', 12_550, 'debit', { reference: 'R12345678' })], 'again');
    expect(again).toMatchObject({ duplicates: 1, pending: 0 });
  });

  it('an SMS approved earlier is recognised when the statement arrives', async () => {
    await batch([line('2026-10-02', 'CAREEM', 3500)], 'sms');
    const [sms] = await listInbox(db);
    await approveItem(db, sms.id, { type: 'expense', categoryId: cat.Transport });
    const r = await batch([line('2026-10-03', 'CAREEM RIDE DOHA', 3500)], 'statement'); // posted a day later
    expect(r.duplicates + r.possible).toBe(1);
    expect(await listTransactions(db)).toHaveLength(1);
  });

  it('two real purchases of the same amount are not both folded into one entry', async () => {
    await manual('2026-10-02', 5000, 'Lunch', 'Dining');
    const r = await batch([line('2026-10-02', 'POS LUNCH SPOT', 5000), line('2026-10-02', 'POS LUNCH SPOT TWO', 5000)]);
    expect(r.duplicates + r.possible).toBe(1); // only one can match the one existing entry
    expect(r.pending).toBeGreaterThanOrEqual(1);
  });

  it('a skipped duplicate can be put back for review', async () => {
    await manual('2026-10-02', 12_550, 'Lulu Hypermarket');
    await batch([line('2026-10-02', 'POS LULU HYPERMARKET', 12_550)]);
    const skipped = await listInbox(db, 'duplicate');
    expect(skipped).toHaveLength(1);
    await restoreDuplicate(db, skipped[0].id);
    expect(await pendingCount(db)).toBe(1);
  });
});

describe('approving', () => {
  it('creates the transaction with the line date, amount, account and bank reference', async () => {
    await batch([line('2026-10-02', 'POS LULU HYPERMARKET', 12_550, 'debit', { reference: 'ABC12345' })]);
    const [item] = await listInbox(db);
    const id = await approveItem(db, item.id, { type: 'expense', categoryId: cat.Groceries });
    const [t] = await listTransactions(db);
    expect([t.id, t.date, t.type, t.account_id, t.amount_minor, t.category_id, t.source, t.external_ref, t.note]).toEqual([id, '2026-10-02', 'expense', cbq, 12_550, cat.Groceries, 'import', 'ref:ABC12345', 'POS LULU HYPERMARKET']);
    expect((await getAccount(db, cbq))!.balance_minor).toBe(1_000_000 - 12_550);
    expect(await pendingCount(db)).toBe(0);
  });

  it('income for credits; refuses a direction/type mismatch; cannot be approved twice', async () => {
    await batch([line('2026-10-01', 'SALARY', 1_450_000, 'credit'), line('2026-10-02', 'SHOP', 100)]);
    const items = await listInbox(db);
    const salary = items.find((i) => i.description === 'SALARY')!;
    const shop = items.find((i) => i.description === 'SHOP')!;
    await expect(approveItem(db, salary.id, { type: 'expense', categoryId: cat.Rent })).rejects.toThrow(/cannot be an expense/);
    await expect(approveItem(db, shop.id, { type: 'income', categoryId: cat.Salary })).rejects.toThrow(/cannot be income/);
    await approveItem(db, salary.id, { type: 'income', categoryId: cat.Salary });
    await expect(approveItem(db, salary.id, { type: 'income', categoryId: cat.Salary })).rejects.toThrow(/already handled/);
    expect((await getAccount(db, cbq))!.balance_minor).toBe(1_000_000 + 1_450_000);
  });

  it('remembers the merchant: next time it arrives with the category filled in', async () => {
    await batch([line('2026-10-02', 'POS 4111XXXX1234 LULU HYPERMARKET DOHA', 5000)], 'a');
    await approveItem(db, (await listInbox(db))[0].id, { type: 'expense', categoryId: cat.Groceries });
    await batch([line('2026-11-05', 'POS 9999XXXX0000 LULU HYPERMARKET', 8000)], 'b');
    const [item] = await listInbox(db);
    expect([item.suggested_category_id, item.suggested_category_name]).toEqual([cat.Groceries, 'Groceries']);
  });

  it('does not remember when told not to; a suggestion never overrides the direction', async () => {
    await batch([line('2026-10-02', 'POS SHOP A', 100)], 'a');
    await approveItem(db, (await listInbox(db))[0].id, { type: 'expense', categoryId: cat.Groceries, learn: false });
    expect(await suggestForMerchant(db, 'SHOP A')).toBeNull();
    await batch([line('2026-10-03', 'POS REFUND SHOP B', 100, 'debit')], 'b');
    await approveItem(db, (await listInbox(db))[0].id, { type: 'expense', categoryId: cat.Shopping });
    await batch([line('2026-10-09', 'POS REFUND SHOP B', 500, 'credit')], 'c'); // money in from a merchant learned as an expense
    expect((await listInbox(db))[0].suggested_category_id).toBeNull();
  });

  it('"approve all suggested" adds only the safe ones', async () => {
    await batch([line('2026-10-02', 'POS LULU', 100)], 'a');
    await approveItem(db, (await listInbox(db))[0].id, { type: 'expense', categoryId: cat.Groceries });
    await createTransaction(db, { type: 'expense', date: '2026-11-04', accountId: cbq, amountMinor: 900, categoryId: cat.Dining, toAccountId: null, toAmountMinor: null, paymentMethod: 'cash', note: 'Snack' });
    await batch([line('2026-11-02', 'POS LULU', 200), line('2026-11-03', 'POS NEW PLACE', 300), line('2026-11-05', 'POS LULU', 900)], 'b');
    // 900 on the 5th looks like the manual 900 on the 4th, so it needs a decision; the 3rd has no category yet.
    expect(await approveAllSuggested(db)).toBe(1);
    expect((await listInbox(db)).map((i) => i.description).sort()).toEqual(['POS LULU', 'POS NEW PLACE']);
  });

  it('reject and reject-all leave no transactions', async () => {
    await batch([line('2026-10-02', 'A', 100), line('2026-10-03', 'B', 200)]);
    const [first] = await listInbox(db);
    await rejectItem(db, first.id);
    expect(await pendingCount(db)).toBe(1);
    expect(await rejectAllPending(db)).toBe(1);
    expect(await listTransactions(db)).toHaveLength(0);
  });
});

describe('card payments and transfers', () => {
  it('a bank line that pays the card is suggested as a transfer', async () => {
    await batch([line('2026-10-14', 'CREDIT CARD PAYMENT THANK YOU', 100_000)]);
    expect((await listInbox(db))[0].suggested_type).toBe('transfer');
  });

  it('approving it as a transfer covers the card statement line, so it is not counted twice', async () => {
    await batch([line('2026-10-14', 'CREDIT CARD PAYMENT', 100_000)], 'bank');
    await batch([line('2026-10-15', 'PAYMENT RECEIVED THANK YOU', 100_000, 'credit', { accountId: card })], 'card');
    expect(await pendingCount(db)).toBe(2);
    const bank = (await listInbox(db)).find((i) => i.account_id === cbq)!;
    await approveItem(db, bank.id, { type: 'transfer', categoryId: null, otherAccountId: card });
    expect(await pendingCount(db)).toBe(0); // the card-side line is now a skipped duplicate
    expect((await listInbox(db, 'duplicate'))).toHaveLength(1);
    expect((await getAccount(db, card))!.balance_minor).toBe(100_000);
    expect((await getAccount(db, cbq))!.balance_minor).toBe(900_000);
    expect((await listTransactions(db)).filter((t) => t.type === 'transfer')).toHaveLength(1);
  });

  it('approving a card-side credit as a transfer takes the money from the chosen bank account', async () => {
    await batch([line('2026-10-15', 'PAYMENT RECEIVED', 50_000, 'credit', { accountId: card })]);
    await approveItem(db, (await listInbox(db))[0].id, { type: 'transfer', categoryId: null, otherAccountId: cbq });
    expect((await getAccount(db, cbq))!.balance_minor).toBe(950_000);
    expect((await getAccount(db, card))!.balance_minor).toBe(50_000);
  });

  it('a transfer between currencies needs the amount on the other side', async () => {
    await batch([line('2026-10-14', 'REMITTANCE TO INDIA', 100_000)]);
    const [item] = await listInbox(db);
    await expect(approveItem(db, item.id, { type: 'transfer', categoryId: null, otherAccountId: hdfc })).rejects.toThrow(/received/);
    await approveItem(db, item.id, { type: 'transfer', categoryId: null, otherAccountId: hdfc, otherAmountMinor: 2_410_000 });
    expect((await getAccount(db, hdfc))!.balance_minor).toBe(2_410_000);
  });
});

describe('statement and SMS conversion into inbox lines', () => {
  it('converts statement amounts with the account decimals and reports ones that do not fit', () => {
    const r = convertStatementItems(
      [
        { line: 2, date: '2026-10-02', description: 'A', direction: 'debit', amountText: '125.50', balanceText: '9000.00', reference: null, raw: '' },
        { line: 3, date: '2026-10-02', description: 'B', direction: 'debit', amountText: '125.505', balanceText: null, reference: null, raw: '' },
      ],
      cbq, 'QAR',
    );
    expect(r.items.map((i) => [i.amountMinor, i.balanceMinor])).toEqual([[12_550, 900_000]]);
    expect(r.problems[0]).toMatchObject({ line: 3 });
    expect(convertStatementItems([{ line: 2, date: '2026-10-02', description: 'A', direction: 'debit', amountText: '12.505', balanceText: null, reference: null, raw: '' }], cbq, 'OMR').items[0].amountMinor).toBe(12_505);
  });

  it('converts an SMS, uses today when it has no date, and refuses a currency mismatch', () => {
    const sms = parseSms('Spent Rs.499 At AMAZON on card 5678')!;
    expect(convertSms(sms, hdfc, 'INR', '2026-10-21')).toMatchObject({ amountMinor: 49_900, date: '2026-10-21', description: 'AMAZON', direction: 'debit' });
    expect(convertSms(sms, cbq, 'QAR', '2026-10-21')).toEqual({ error: expect.stringMatching(/INR but this account is in QAR/) });
  });
});

describe('card and account identifiers', () => {
  it('saves digits and sender names, normalised, and finds the account', async () => {
    await setAccountIdentifiers(db, cbq, { last4: ['xx1234', '1234', '99'], senders: [' cbq ', 'CBQ'] });
    expect(await getAccountIdentifiers(db, cbq)).toEqual({ last4: ['1234'], senders: ['CBQ'] });
    expect(await findAccountsByLast4(db, '1234')).toEqual([cbq]);
    expect(await findAccountsByLast4(db, '0000')).toEqual([]);
  });
  it('digits shared by two accounts are reported as ambiguous', async () => {
    await setAccountIdentifiers(db, cbq, { last4: ['1234'], senders: [] });
    await addLast4(db, card, '1234');
    expect((await findAccountsByLast4(db, '1234')).sort()).toEqual([card, cbq].sort());
  });
  it('replacing identifiers removes the old ones', async () => {
    await setAccountIdentifiers(db, cbq, { last4: ['1111'], senders: ['A'] });
    await setAccountIdentifiers(db, cbq, { last4: ['2222'], senders: [] });
    expect(await getAccountIdentifiers(db, cbq)).toEqual({ last4: ['2222'], senders: [] });
  });
});

describe('inbox data is part of backups and erase', () => {
  it('survives a backup and restore', async () => {
    await setAccountIdentifiers(db, cbq, { last4: ['1234'], senders: ['CBQ'] });
    await batch([line('2026-10-02', 'POS LULU', 5000), line('2026-10-03', 'POS X', 100)]);
    await approveItem(db, (await listInbox(db))[0].id, { type: 'expense', categoryId: cat.Groceries });
    const dump = async () => Object.fromEntries(await Promise.all(BACKUP_TABLES.map(async (t) => [t, await db.getAllAsync(`SELECT * FROM ${t} ORDER BY 1, 2`)] as const)));
    const before = await dump();
    const text = await createBackup(db);
    await eraseAllData(db);
    expect(await pendingCount(db)).toBe(0);
    await restoreBackup(db, parseBackup(text).backup);
    expect(await dump()).toEqual(before);
    expect(await pendingCount(db)).toBe(1);
  });

  it('erase clears the inbox, merchant memory and identifiers', async () => {
    await setAccountIdentifiers(db, cbq, { last4: ['1234'], senders: [] });
    await batch([line('2026-10-02', 'POS LULU', 5000)]);
    await approveItem(db, (await listInbox(db))[0].id, { type: 'expense', categoryId: cat.Groceries });
    await eraseAllData(db, 'QAR');
    for (const t of ['import_items', 'import_batches', 'merchant_rules', 'account_identifiers']) {
      expect((await db.getAllAsync(`SELECT * FROM ${t}`)).length).toBe(0);
    }
    expect(await getInboxItem(db, 'nope')).toBeNull();
    expect(await listAccounts(db)).toHaveLength(0);
  });
});
