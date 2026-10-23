import type { AccountType, CategoryKind } from '@/types';

export interface SuggestedAccount {
  key: string;
  name: string;
  type: AccountType;
  currency: string;
  include: boolean;
}

export const ACCOUNT_TYPE_STYLE: Record<AccountType, { icon: string; color: string; label: string }> = {
  cash: { icon: 'cash', color: '#22C55E', label: 'Cash' },
  bank: { icon: 'business', color: '#0EA5E9', label: 'Bank' },
  credit_card: { icon: 'card', color: '#6C63FF', label: 'Credit card' },
  loan: { icon: 'trending-down', color: '#F97316', label: 'Loan' },
};

/** The accounts offered on the Easy setup screen. The user ticks, renames or removes them. */
export function suggestedAccounts(base: string): SuggestedAccount[] {
  return [
    { key: 'cash', name: 'Cash', type: 'cash', currency: base, include: true },
    { key: 'bank', name: 'Bank Account', type: 'bank', currency: base, include: true },
    { key: 'card', name: 'Credit Card', type: 'credit_card', currency: base, include: true },
    { key: 'savings', name: 'Savings Account', type: 'bank', currency: base, include: false },
    { key: 'loan', name: 'Loan', type: 'loan', currency: base, include: false },
    { key: 'inr', name: 'Bank Account (INR)', type: 'bank', currency: 'INR', include: false },
  ];
}

export interface BankSuggestion {
  name: string;
  currency: string;
}

const BANKS: Record<string, string[]> = {
  QAR: ['QNB', 'Commercial Bank', 'Doha Bank', 'Dukhan Bank', 'Masraf Al Rayan', 'Ahlibank'],
  SAR: ['Al Rajhi Bank', 'Saudi National Bank', 'Riyad Bank', 'Alinma Bank', 'Banque Saudi Fransi', 'SABB'],
  AED: ['Emirates NBD', 'ADCB', 'First Abu Dhabi Bank', 'Dubai Islamic Bank', 'Mashreq', 'RAKBANK'],
  OMR: ['Bank Muscat', 'Bank Dhofar', 'Sohar International', 'National Bank of Oman'],
  KWD: ['NBK', 'Kuwait Finance House', 'Gulf Bank', 'Boubyan Bank', 'Burgan Bank', 'Warba Bank'],
  BHD: ['National Bank of Bahrain', 'BBK', 'Al Salam Bank', 'KFH Bahrain'],
};
const INDIA_BANKS = ['SBI', 'HDFC Bank', 'ICICI Bank', 'Federal Bank', 'Axis Bank', 'Kotak Mahindra Bank'];

/** Common banks to start from: the user's own country first, then India. These are only name suggestions. */
export function popularBanks(base: string): BankSuggestion[] {
  return [
    ...(BANKS[base] ?? []).map((name) => ({ name, currency: base })),
    ...INDIA_BANKS.map((name) => ({ name, currency: 'INR' })),
  ];
}

export interface SetupAccountPlan {
  name: string;
  type: AccountType;
  currency: string;
  /** Signed: negative means money owed (cards and loans). */
  openingBalanceMinor: number;
}

export interface SetupCategoryPlan {
  /** Existing category to keep, rename or hide; null for a new one. */
  id: string | null;
  name: string;
  kind: CategoryKind;
  /** false = hide an existing category (new ones that are not kept are simply not created). */
  keep: boolean;
  icon: string;
  color: string;
}

export interface SetupPlan {
  accounts: SetupAccountPlan[];
  categories: SetupCategoryPlan[];
}

const norm = (s: string) => s.trim().toLowerCase();

/** Returns a message for the first problem found, or null when the plan can be applied. */
export function validateSetupPlan(plan: SetupPlan, existingAccountNames: string[]): string | null {
  if (plan.accounts.length === 0) return 'Tick at least one account.';
  const seen = new Set(existingAccountNames.map(norm));
  for (const a of plan.accounts) {
    if (!a.name.trim()) return 'Every account needs a name.';
    if (seen.has(norm(a.name))) return `There is already an account called "${a.name.trim()}". Give each account a different name.`;
    seen.add(norm(a.name));
    if (!Number.isSafeInteger(a.openingBalanceMinor)) return `The opening balance for "${a.name.trim()}" is not a valid amount.`;
  }
  for (const kind of ['expense', 'income'] as const) {
    const names = new Set<string>();
    for (const c of plan.categories.filter((x) => x.kind === kind && x.keep)) {
      if (!c.name.trim()) return `Every ${kind} category needs a name.`;
      if (names.has(norm(c.name))) return `"${c.name.trim()}" appears twice in the ${kind} categories.`;
      names.add(norm(c.name));
    }
  }
  return null;
}
