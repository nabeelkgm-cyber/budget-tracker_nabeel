import { Text } from 'react-native';
import { formatMinor } from '@/domain/money';
import { useTheme } from '@/theme';
import type { TransactionRow as Txn } from '@/types';
import { IconCircle, Row } from './ui';

const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  bank_transfer: 'Bank transfer',
  upi: 'UPI',
  other: 'Other',
};

export function TransactionRow({ t, onPress }: { t: Txn; onPress: () => void }) {
  const theme = useTheme();
  const isTransfer = t.type === 'transfer';
  const color = isTransfer ? theme.textMuted : t.type === 'income' ? theme.income : theme.expense;
  const title = isTransfer
    ? `${t.account_name} → ${t.to_account_name}`
    : t.parent_category_name
      ? `${t.parent_category_name} › ${t.category_name}`
      : (t.category_name ?? 'Uncategorised');
  const subtitle = [t.note, isTransfer ? 'Transfer' : t.account_name, METHOD_LABEL[t.payment_method], t.recurring_id ? 'Recurring' : '']
    .filter(Boolean)
    .join(' · ');
  const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '-' : '';
  return (
    <Row
      onPress={onPress}
      left={
        <IconCircle
          icon={isTransfer ? 'swap-horizontal' : (t.category_icon ?? 'help')}
          color={isTransfer ? theme.textMuted : (t.category_color ?? theme.primary)}
        />
      }
      title={title}
      subtitle={subtitle}
      right={
        <Text style={{ color, fontWeight: '700', fontSize: 15 }}>
          {sign}
          {formatMinor(t.amount_minor, t.account_currency)}
        </Text>
      }
    />
  );
}
