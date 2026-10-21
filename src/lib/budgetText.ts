import { formatMinor } from '@/domain/money';
import type { BudgetAlert } from '@/db/repositories/budgets';
import { getBaseCurrency } from '@/domain/currencies';

export const formatBudgetAlert = (a: BudgetAlert): string =>
  a.threshold === 100
    ? `${a.categoryName}: budget fully used (${formatMinor(a.spentMinor, getBaseCurrency())} of ${formatMinor(a.availableMinor, getBaseCurrency())})`
    : `${a.categoryName}: 80% of budget used (${formatMinor(a.spentMinor, getBaseCurrency())} of ${formatMinor(a.availableMinor, getBaseCurrency())})`;
