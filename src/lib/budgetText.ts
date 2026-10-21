import { formatMinor } from '@/domain/money';
import type { BudgetAlert } from '@/db/repositories/budgets';
import { BASE_CURRENCY } from '@/types';

export const formatBudgetAlert = (a: BudgetAlert): string =>
  a.threshold === 100
    ? `${a.categoryName}: budget fully used (${formatMinor(a.spentMinor, BASE_CURRENCY)} of ${formatMinor(a.availableMinor, BASE_CURRENCY)})`
    : `${a.categoryName}: 80% of budget used (${formatMinor(a.spentMinor, BASE_CURRENCY)} of ${formatMinor(a.availableMinor, BASE_CURRENCY)})`;
