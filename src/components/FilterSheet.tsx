import DateTimePicker from '@/components/DatePicker';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { PERIOD_LABELS, PeriodKey } from '@/domain/dateRanges';
import { fromLocalDate, toLocalDate, today } from '@/lib/dates';
import { useTheme } from '@/theme';
import type { Account, Category, TxnType } from '@/types';
import { Chip, ChipRow, Label } from './ui';

export interface FilterState {
  type: TxnType | 'all';
  accountId: string | null;
  categoryId: string | null;
  period: PeriodKey;
  customFrom: string;
  customTo: string;
}

export const EMPTY_FILTER: FilterState = {
  type: 'all',
  accountId: null,
  categoryId: null,
  period: 'all',
  customFrom: today(),
  customTo: today(),
};

export const countActiveFilters = (f: FilterState): number =>
  (f.type !== 'all' ? 1 : 0) + (f.accountId ? 1 : 0) + (f.categoryId ? 1 : 0) + (f.period !== 'all' ? 1 : 0);

const TYPES: { value: TxnType | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
];

const PERIODS: PeriodKey[] = ['all', 'this_month', 'last_month', 'last_3_months', 'this_year', 'custom'];

export function FilterSheet({
  visible,
  value,
  onChange,
  onClose,
  accounts,
  categories,
}: {
  visible: boolean;
  value: FilterState;
  onChange: (f: FilterState) => void;
  onClose: () => void;
  accounts: Account[];
  categories: Category[];
}) {
  const t = useTheme();
  const set = (patch: Partial<FilterState>) => onChange({ ...value, ...patch });
  const kindFilter = value.type === 'income' ? 'income' : value.type === 'expense' ? 'expense' : null;

  // Main categories followed by their sub-categories, limited to the chosen type.
  const catOptions: { id: string; label: string; color: string }[] = [];
  const visibleCats = categories.filter((c) => !kindFilter || c.kind === kindFilter);
  for (const p of visibleCats.filter((c) => !c.parent_id)) {
    catOptions.push({ id: p.id, label: p.name, color: p.color });
    for (const s of visibleCats.filter((c) => c.parent_id === p.id)) {
      catOptions.push({ id: s.id, label: `${p.name} › ${s.name}`, color: s.color });
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 16, alignItems: 'center' }}>
          <Pressable onPress={() => onChange(EMPTY_FILTER)} hitSlop={10}>
            <Text style={{ color: t.danger, fontWeight: '600', fontSize: 16 }}>Clear</Text>
          </Pressable>
          <Text style={{ color: t.text, fontWeight: '700', fontSize: 17 }}>Filters</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={{ color: t.primary, fontWeight: '700', fontSize: 16 }}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4 }}>
          <Label>Type</Label>
          <ChipRow>
            {TYPES.map((x) => (
              <Chip
                key={x.value}
                label={x.label}
                selected={value.type === x.value}
                onPress={() =>
                  // A category of the other kind (or any category for transfers) would match nothing.
                  set({ type: x.value, categoryId: x.value === 'transfer' ? null : value.categoryId })
                }
              />
            ))}
          </ChipRow>

          <Label>Period</Label>
          <ChipRow>
            {PERIODS.map((p) => (
              <Chip key={p} label={PERIOD_LABELS[p]} selected={value.period === p} onPress={() => set({ period: p })} />
            ))}
          </ChipRow>
          {value.period === 'custom' ? (
            <View style={{ marginBottom: 14, gap: 8 }}>
              {(['customFrom', 'customTo'] as const).map((key) => (
                <View key={key} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: t.text, fontWeight: '600' }}>{key === 'customFrom' ? 'From' : 'To'}</Text>
                  <DateTimePicker
                    value={toLocalDate(value[key])}
                    mode="date"
                    display="compact"
                    onChange={(_, d) => d && set({ [key]: fromLocalDate(d) })}
                  />
                </View>
              ))}
            </View>
          ) : null}

          <Label>Account</Label>
          <ChipRow>
            <Chip label="All accounts" selected={value.accountId === null} onPress={() => set({ accountId: null })} />
            {accounts.map((a) => (
              <Chip
                key={a.id}
                label={a.name}
                color={a.color}
                selected={value.accountId === a.id}
                onPress={() => set({ accountId: a.id })}
              />
            ))}
          </ChipRow>

          {value.type !== 'transfer' ? (
            <>
              <Label>Category (a main category includes its sub-categories)</Label>
              <ChipRow>
                <Chip label="All categories" selected={value.categoryId === null} onPress={() => set({ categoryId: null })} />
                {catOptions.map((c) => (
                  <Chip
                    key={c.id}
                    label={c.label}
                    color={c.color}
                    selected={value.categoryId === c.id}
                    onPress={() => set({ categoryId: c.id })}
                  />
                ))}
              </ChipRow>
            </>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}
