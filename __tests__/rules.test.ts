import { validateTransaction } from '@/domain/transactionRules';
import type { TransactionInput } from '@/types';

const accounts = [
  { id: 'q1', currency: 'QAR' },
  { id: 'q2', currency: 'QAR' },
  { id: 'i1', currency: 'INR' },
];
const categories = [
  { id: 'e', kind: 'expense' as const },
  { id: 'i', kind: 'income' as const },
];
const base: TransactionInput = {
  type: 'expense',
  date: '2026-10-21',
  accountId: 'q1',
  amountMinor: 1000,
  categoryId: 'e',
  toAccountId: null,
  toAmountMinor: null,
  paymentMethod: 'cash',
  note: '',
};
const check = (patch: Partial<TransactionInput>) =>
  validateTransaction({ ...base, ...patch }, accounts, categories);

describe('validateTransaction', () => {
  it('accepts a valid expense and income', () => {
    expect(check({})).toBeNull();
    expect(check({ type: 'income', categoryId: 'i' })).toBeNull();
  });
  it('rejects bad amount, date, account', () => {
    expect(check({ amountMinor: 0 })).toMatch(/greater than zero/);
    expect(check({ amountMinor: 10.5 })).toMatch(/greater than zero/);
    expect(check({ date: '21/10/2026' })).toMatch(/date/);
    expect(check({ accountId: 'zz' })).toMatch(/account/);
  });
  it('requires a category of the matching kind', () => {
    expect(check({ categoryId: null })).toMatch(/category/);
    expect(check({ categoryId: 'i' })).toMatch(/expense category/);
  });
  it('validates transfers', () => {
    const t = { type: 'transfer' as const, categoryId: null };
    expect(check({ ...t, toAccountId: 'q2', toAmountMinor: 1000 })).toBeNull();
    expect(check({ ...t, toAccountId: 'q1', toAmountMinor: 1000 })).toMatch(/different/);
    expect(check({ ...t, toAccountId: null })).toMatch(/transfer to/);
    expect(check({ ...t, toAccountId: 'q2', toAmountMinor: 900 })).toMatch(/must match/);
    expect(check({ ...t, toAccountId: 'i1', toAmountMinor: 24100 })).toBeNull();
    expect(check({ ...t, toAccountId: 'i1', toAmountMinor: null })).toMatch(/received/);
  });
});
