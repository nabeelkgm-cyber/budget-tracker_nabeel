import { View } from 'react-native';
import type { BudgetState } from '@/domain/budget';
import { Palette, useTheme } from '@/theme';

export const stateColor = (state: BudgetState, t: Palette): string =>
  state === 'over' ? t.expense : state === 'warn' ? '#F59E0B' : t.income;

/** Horizontal progress bar; fills up to 100% and changes colour at 80% and 100%. */
export function BudgetBar({ pct, state, height = 8 }: { pct: number; state: BudgetState; height?: number }) {
  const t = useTheme();
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: t.inputBg, overflow: 'hidden' }}>
      <View
        style={{
          width: `${Math.max(0, Math.min(100, pct))}%`,
          height: '100%',
          borderRadius: height / 2,
          backgroundColor: stateColor(state, t),
        }}
      />
    </View>
  );
}
