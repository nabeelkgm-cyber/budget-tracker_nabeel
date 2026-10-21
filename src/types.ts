export type AccountType = 'cash' | 'bank' | 'credit_card' | 'loan';
export type TxnType = 'expense' | 'income' | 'transfer';
export type CategoryKind = 'expense' | 'income';
export type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'upi' | 'other';

export const BASE_CURRENCY = 'QAR';

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  minor_units: number;
  /** Base-currency (QAR) value of 1 unit of this currency, scaled by 1e8. */
  rate_to_base_e8: number;
  updated_at: string;
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  /** Signed. For credit cards a negative number means money owed. */
  opening_balance_minor: number;
  credit_limit_minor: number | null;
  statement_day: number | null;
  due_day: number | null;
  icon: string;
  color: string;
  is_archived: number;
  sort_order: number;
}

export interface AccountWithBalance extends Account {
  balance_minor: number;
}

export interface Category {
  id: string;
  parent_id: string | null;
  name: string;
  kind: CategoryKind;
  icon: string;
  color: string;
  is_archived: number;
  sort_order: number;
}

export interface Transaction {
  id: string;
  type: TxnType;
  date: string; // YYYY-MM-DD
  account_id: string;
  amount_minor: number;
  fx_rate_e8: number;
  base_amount_minor: number;
  category_id: string | null;
  to_account_id: string | null;
  to_amount_minor: number | null;
  payment_method: PaymentMethod;
  note: string;
  recurring_id: string | null;
  /** For a transfer fee: the id of the transfer it belongs to. */
  linked_txn_id: string | null;
  source: string;
  external_ref: string | null;
  fingerprint: string | null;
}

/** Transaction joined with display fields for lists. */
export interface TransactionRow extends Transaction {
  account_name: string;
  account_currency: string;
  to_account_name: string | null;
  to_account_currency: string | null;
  category_name: string | null;
  category_icon: string | null;
  category_color: string | null;
  parent_category_name: string | null;
}

export interface TransactionInput {
  type: TxnType;
  date: string;
  accountId: string;
  amountMinor: number;
  categoryId: string | null;
  toAccountId: string | null;
  toAmountMinor: number | null;
  paymentMethod: PaymentMethod;
  note: string;
  source?: string;
  externalRef?: string | null;
  fingerprint?: string | null;
  /** Transfers only: optional fee charged on the From account, saved as a Bank Charges expense. */
  feeMinor?: number | null;
}
