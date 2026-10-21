/** Savings = income - expense (transfers are never part of either). */
export const savingsOf = (incomeMinor: number, expenseMinor: number): number =>
  incomeMinor - expenseMinor;

/** Savings as a percentage of income, one decimal. Null when there is no income. */
export function savingsRatePercent(incomeMinor: number, expenseMinor: number): number | null {
  if (incomeMinor <= 0) return null;
  return Math.round(((incomeMinor - expenseMinor) * 1000) / incomeMinor) / 10;
}

export const formatPercent = (p: number | null): string => (p === null ? '-' : `${p.toFixed(1)}%`);
