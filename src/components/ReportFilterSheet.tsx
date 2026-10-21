import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import type { Account, Category } from '@/types';
import { Chip, ChipRow, Label } from './ui';

export interface ReportFilterState {
  accountId: string | null;
  categoryId: string | null;
}

export const EMPTY_REPORT_FILTER: ReportFilterState = { accountId: null, categoryId: null };

export function ReportFilterSheet({
  visible,
  value,
  onChange,
  onClose,
  accounts,
  categories,
}: {
  visible: boolean;
  value: ReportFilterState;
  onChange: (f: ReportFilterState) => void;
  onClose: () => void;
  accounts: Account[];
  categories: Category[];
}) {
  const t = useTheme();
  const options: { id: string; label: string; color: string }[] = [];
  for (const p of categories.filter((c) => !c.parent_id)) {
    options.push({ id: p.id, label: p.name, color: p.color });
    for (const s of categories.filter((c) => c.parent_id === p.id)) {
      options.push({ id: s.id, label: `${p.name} › ${s.name}`, color: s.color });
    }
  }
  const expense = options.filter((o) => categories.find((c) => c.id === o.id)?.kind === 'expense');
  const income = options.filter((o) => categories.find((c) => c.id === o.id)?.kind === 'income');

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 16, alignItems: 'center' }}>
          <Pressable onPress={() => onChange(EMPTY_REPORT_FILTER)} hitSlop={10}>
            <Text style={{ color: t.danger, fontWeight: '600', fontSize: 16 }}>Clear</Text>
          </Pressable>
          <Text style={{ color: t.text, fontWeight: '700', fontSize: 17 }}>Report filters</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={{ color: t.primary, fontWeight: '700', fontSize: 16 }}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4 }}>
          <Label>Account</Label>
          <ChipRow>
            <Chip label="All accounts" selected={value.accountId === null} onPress={() => onChange({ ...value, accountId: null })} />
            {accounts.map((a) => (
              <Chip key={a.id} label={a.name} color={a.color} selected={value.accountId === a.id} onPress={() => onChange({ ...value, accountId: a.id })} />
            ))}
          </ChipRow>

          <Label>Category (a main category includes its sub-categories)</Label>
          <ChipRow>
            <Chip label="All categories" selected={value.categoryId === null} onPress={() => onChange({ ...value, categoryId: null })} />
          </ChipRow>
          <Label>Expense categories</Label>
          <ChipRow>
            {expense.map((c) => (
              <Chip key={c.id} label={c.label} color={c.color} selected={value.categoryId === c.id} onPress={() => onChange({ ...value, categoryId: c.id })} />
            ))}
          </ChipRow>
          <Label>Income categories</Label>
          <ChipRow>
            {income.map((c) => (
              <Chip key={c.id} label={c.label} color={c.color} selected={value.categoryId === c.id} onPress={() => onChange({ ...value, categoryId: c.id })} />
            ))}
          </ChipRow>
        </ScrollView>
      </View>
    </Modal>
  );
}
