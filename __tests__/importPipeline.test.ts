/** @jest-environment node */
import { createHash } from 'crypto';
import { createAccount, getAccount } from '@/db/repositories/accounts';
import { listCategories } from '@/db/repositories/categories';
import { addBatch, approveItem, findAccountsByLast4, listInbox, setAccountIdentifiers } from '@/db/repositories/inbox';
import { createTransaction, listTransactions } from '@/db/repositories/transactions';
import { parseCsv, toCsv } from '@/domain/csv';
import { convertSms, convertStatementItems } from '@/domain/importConvert';
import { parseSms, splitMessages } from '@/domain/sms';
import { detectColumns, extractStatementItems } from '@/domain/statement';
import { readXlsx } from '@/domain/xlsxRead';
import { buildXlsx } from '@/domain/xlsx';
import type { Db } from '@/db/types';
import { createReadyDb } from './helpers/testDb';

let db: Db;
let cat: Record<string, string>;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const acct = (name: string, currency: string, type: 'bank' | 'credit_card' = 'bank', opening = 0) =>
  createAccount(db, { name, type, currency, openingBalanceMinor: opening, creditLimitMinor: null, statementDay: null, dueDay: null, icon: 'b', color: '#000' });

beforeEach(async () => {
  db = await createReadyDb();
  cat = Object.fromEntries((await listCategories(db)).map((c) => [c.name, c.id]));
});

/** Statement text -> inbox, the way the Import screen does it. */
async function importStatement(rows: string[][], accountId: string, currency: string) {
  const mapping = detectColumns(rows)!;
  const { items } = extractStatementItems(rows, mapping);
  const { items: converted, problems } = convertStatementItems(items, accountId, currency);
  const result = await addBatch(db, { source: 'csv', fileName: 'x.csv', fileHash: sha(JSON.stringify([accountId, rows])), accountId }, converted);
  return { result, problems, items: converted };
}

describe('a Qatari bank CSV with a preamble, debit/credit columns and thousands separators', () => {
  const csv = toCsv([
    ['Commercial Bank of Qatar'],
    ['Account statement', '01/10/2026 - 31/10/2026'],
    [],
    ['Posting Date', 'Value Date', 'Description', 'Reference', 'Debit', 'Credit', 'Balance'],
    ['01/10/2026', '01/10/2026', 'Opening balance', '', '', '', '10,000.00'],
    ['02/10/2026', '02/10/2026', 'POS 4111XXXX1234 LULU HYPERMARKET DOHA QA', 'R1001', '125.50', '', '9,874.50'],
    ['03/10/2026', '03/10/2026', 'SALARY OCT', 'R1002', '', '14,500.00', '24,374.50'],
    ['05/10/2026', '05/10/2026', 'CREDIT CARD PAYMENT', 'R1003', '1,000.00', '', '23,374.50'],
    ['', '', 'Total', '', '1,125.50', '14,500.00', ''],
  ]);

  it('reads it, adds three lines for review, and approving gives the right balances', async () => {
    const cbq = await acct('CBQ', 'QAR', 'bank', 1_000_000);
    const r = await importStatement(parseCsv(csv), cbq, 'QAR');
    expect(r.problems).toEqual([]);
    expect(r.result).toMatchObject({ pending: 3, duplicates: 0 });
    const items = await listInbox(db);
    const byDesc = (s: string) => items.find((i) => i.description.includes(s))!;
    expect(byDesc('CREDIT CARD').suggested_type).toBe('transfer');
    await approveItem(db, byDesc('LULU').id, { type: 'expense', categoryId: cat.Groceries });
    await approveItem(db, byDesc('SALARY').id, { type: 'income', categoryId: cat.Salary });
    expect((await getAccount(db, cbq))!.balance_minor).toBe(1_000_000 - 12_550 + 1_450_000);
  });

  it('the same file again is refused; the same lines in a different file are skipped', async () => {
    const cbq = await acct('CBQ', 'QAR');
    await importStatement(parseCsv(csv), cbq, 'QAR');
    await expect(importStatement(parseCsv(csv), cbq, 'QAR')).rejects.toThrow(/already added/);
    const slightlyDifferent = parseCsv(csv).map((r, i) => (i === 0 ? ['A different title row'] : r));
    const again = await importStatement(slightlyDifferent, cbq, 'QAR');
    expect(again.result).toMatchObject({ pending: 0, duplicates: 3 });
  });

  it('lines the user already typed in by hand are recognised', async () => {
    const cbq = await acct('CBQ', 'QAR');
    await createTransaction(db, { type: 'expense', date: '2026-10-02', accountId: cbq, amountMinor: 12_550, categoryId: cat.Groceries, toAccountId: null, toAmountMinor: null, paymentMethod: 'cash', note: 'Lulu' });
    const r = await importStatement(parseCsv(csv), cbq, 'QAR');
    expect(r.result).toMatchObject({ duplicates: 1, pending: 2 });
    expect(await listTransactions(db)).toHaveLength(1);
  });
});

describe('an Indian bank file with Indian grouping and a single signed amount (Excel)', () => {
  it('reads an .xlsx with real dates and numbers', async () => {
    const hdfc = await acct('HDFC', 'INR', 'bank', 0);
    const bytes = buildXlsx([
      {
        name: 'Statement',
        columns: [{ header: 'Date', kind: 'date' }, { header: 'Narration' }, { header: 'Chq./Ref.No.' }, { header: 'Withdrawal Amt.', kind: 'amount2' }, { header: 'Deposit Amt.', kind: 'amount2' }, { header: 'Closing Balance', kind: 'amount2' }],
        rows: [
          ['2026-10-02', 'UPI-SWIGGY-SWIGGY@YBL-YESB0YBLUPI-629012345678-PAYMENT', '0000629012345678', 1250, null, 98750],
          ['2026-10-03', 'NEFT CR-ACME CORP-SALARY', 'N123456789', null, 125000.5, 223750.5],
        ],
      },
    ]);
    const [sheet] = readXlsx(bytes);
    const mapping = detectColumns(sheet.rows)!;
    expect(mapping.columns).toMatchObject({ date: 0, description: 1, reference: 2, debit: 3, credit: 4, balance: 5 });
    const { items } = extractStatementItems(sheet.rows, mapping);
    expect(items.map((i) => [i.date, i.direction, i.amountText])).toEqual([['2026-10-02', 'debit', '1250'], ['2026-10-03', 'credit', '125000.5']]);
    const conv = convertStatementItems(items, hdfc, 'INR');
    const r = await addBatch(db, { source: 'xlsx', fileName: 'x.xlsx', fileHash: sha('x'), accountId: hdfc }, conv.items);
    expect(r.pending).toBe(2);
    const inbox = await listInbox(db);
    await approveItem(db, inbox.find((i) => i.direction === 'credit')!.id, { type: 'income', categoryId: cat.Salary });
    expect((await getAccount(db, hdfc))!.balance_minor).toBe(12_500_050);
  });
});

describe('a credit card statement', () => {
  it('purchases and a payment: the payment pairs with the bank transfer already approved', async () => {
    const cbq = await acct('CBQ', 'QAR', 'bank', 1_000_000);
    const card = await acct('CBQ Card', 'QAR', 'credit_card');
    // Bank side first: the card payment is approved as a transfer.
    await importStatement(parseCsv(toCsv([['Date', 'Description', 'Debit', 'Credit'], ['05/10/2026', 'CREDIT CARD PAYMENT', '1,000.00', '']])), cbq, 'QAR');
    await approveItem(db, (await listInbox(db))[0].id, { type: 'transfer', categoryId: null, otherAccountId: card });
    // Then the card statement arrives, listing purchases and the payment received.
    const stmt = parseCsv(toCsv([
      ['Transaction Date', 'Details', 'Amount', 'Dr/Cr'],
      ['01/10/2026', 'CARREFOUR DOHA', '300.00', 'DR'],
      ['02/10/2026', 'CAREEM', '35.00', 'DR'],
      ['06/10/2026', 'PAYMENT RECEIVED THANK YOU', '1,000.00', 'CR'],
    ]));
    const r = await importStatement(stmt, card, 'QAR');
    expect(r.result).toMatchObject({ pending: 2, duplicates: 1 }); // the payment line is the bank transfer already recorded
    expect((await getAccount(db, card))!.balance_minor).toBe(100_000);
  });
});

describe('pasted bank SMS', () => {
  const paste = [
    'Rs.1,250.00 debited from a/c XX1234 on 21-10-26 to VPA swiggy@ybl (UPI Ref No 629012345678). Avl Bal Rs 15,000.50',
    'Your OTP is 556677. Do not share.',
    'Dear Customer, your A/C X1234 is credited with Rs 25,000.00 on 21Oct26 by NEFT from ACME CORP. Avl Bal Rs 40,000',
  ].join('\n\n');

  const run = async (text: string, accountId: string, currency: string) => {
    const items = splitMessages(text).map(parseSms).filter(Boolean).map((s) => convertSms(s!, accountId, currency, '2026-10-21'));
    const good = items.filter((i) => !('error' in i)) as Exclude<(typeof items)[number], { error: string }>[];
    return addBatch(db, { source: 'sms', fileName: null, fileHash: sha(text + accountId), accountId: null }, good);
  };

  it('reads the real alerts, ignores the OTP, finds the account from the digits', async () => {
    const hdfc = await acct('HDFC', 'INR');
    await acct('Another INR', 'INR');
    await setAccountIdentifiers(db, hdfc, { last4: ['1234'], senders: ['HDFCBK'] });
    expect(await findAccountsByLast4(db, '1234')).toEqual([hdfc]);
    const r = await run(paste, hdfc, 'INR');
    expect(r).toMatchObject({ pending: 2, duplicates: 0 });
    const items = await listInbox(db);
    expect(items.map((i) => [i.description, i.direction, i.amount_minor])).toEqual([
      ['swiggy@ybl', 'debit', 125_000],
      ['ACME CORP', 'credit', 2_500_000],
    ]);
  });

  it('pasting the same messages again, or the same message inside a longer paste, adds nothing twice', async () => {
    const hdfc = await acct('HDFC', 'INR');
    await run(paste, hdfc, 'INR');
    await expect(run(paste, hdfc, 'INR')).rejects.toThrow(/already added/);
    const longer = paste + '\n\nSpent Rs.499 On HDFC Bank Card 5678 At AMAZON On 2026-10-20.';
    const r = await run(longer, hdfc, 'INR');
    expect(r).toMatchObject({ pending: 1, duplicates: 2 });
  });

  it('an SMS and the later bank statement line for the same purchase are not counted twice', async () => {
    const hdfc = await acct('HDFC', 'INR');
    await run('Rs.1,250.00 debited from a/c XX1234 on 21-10-26 to VPA swiggy@ybl (UPI Ref No 629012345678).', hdfc, 'INR');
    await approveItem(db, (await listInbox(db))[0].id, { type: 'expense', categoryId: cat.Dining });
    const r = await importStatement(parseCsv(toCsv([
      ['Date', 'Narration', 'Chq./Ref.No.', 'Withdrawal Amt.', 'Deposit Amt.'],
      ['21/10/26', 'UPI-SWIGGY-SWIGGY@YBL-629012345678', '629012345678', '1,250.00', ''],
    ])), hdfc, 'INR');
    expect(r.result).toMatchObject({ pending: 0, duplicates: 1 });
    expect(await listTransactions(db)).toHaveLength(1);
  });
});
