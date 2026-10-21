import type { Account, Category, TransactionInput } from '@/types';

/**
 * Business rules for a transaction. Returns an error message, or null if valid.
 * Kept separate from the UI and the DB so it is easy to test.
 */
export function validateTransaction(
  input: TransactionInput,
  accounts: Pick<Account, 'id' | 'currency'>[],
  categories: Pick<Category, 'id' | 'kind'>[],
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return 'Choose a valid date.';
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    return 'Enter an amount greater than zero.';
  }
  const account = accounts.find((a) => a.id === input.accountId);
  if (!account) return 'Choose an account.';
  if (input.feeMinor != null && (!Number.isSafeInteger(input.feeMinor) || input.feeMinor < 0)) {
    return 'The fee must be zero or more.';
  }

  if (input.type === 'transfer') {
    const to = accounts.find((a) => a.id === input.toAccountId);
    if (!to) return 'Choose the account to transfer to.';
    if (to.id === account.id) return 'Transfer must be between two different accounts.';
    if (!input.toAmountMinor || input.toAmountMinor <= 0) {
      return 'Enter the amount received in the destination account.';
    }
    if (to.currency === account.currency && input.toAmountMinor !== input.amountMinor) {
      return 'Both accounts use the same currency, so the amounts must match.';
    }
    return null;
  }

  const category = categories.find((c) => c.id === input.categoryId);
  if (!category) return 'Choose a category.';
  if (category.kind !== input.type) return `Choose an ${input.type} category.`;
  return null;
}
