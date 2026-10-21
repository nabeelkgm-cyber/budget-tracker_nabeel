import { router } from 'expo-router';
import { SectionList, Text, View } from 'react-native';
import { EmptyText, Fab, Loading } from '@/components/ui';
import { TransactionRow } from '@/components/TransactionRow';
import { listTransactions } from '@/db/repositories/transactions';
import { useDbQuery } from '@/hooks/useDbQuery';
import { prettyDate } from '@/lib/dates';
import { useTheme } from '@/theme';
import type { TransactionRow as Txn } from '@/types';

export default function TransactionsScreen() {
  const t = useTheme();
  const { data } = useDbQuery((db) => listTransactions(db, { limit: 300 }));
  if (!data) return <Loading />;

  const groups: { date: string; data: Txn[] }[] = [];
  for (const row of data) {
    const last = groups[groups.length - 1];
    if (last && last.date === row.date) last.data.push(row);
    else groups.push({ date: row.date, data: [row] });
  }

  return (
    <View style={{ flex: 1 }}>
    <SectionList
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
      sections={groups}
      keyExtractor={(x) => x.id}
      stickySectionHeadersEnabled={false}
      ListEmptyComponent={<EmptyText>No transactions yet. Tap + to add one.</EmptyText>}
      renderSectionHeader={({ section }) => (
        <Text style={{ color: t.textMuted, fontWeight: '700', marginTop: 8, marginBottom: 6, fontSize: 12 }}>
          {prettyDate(section.date)}
        </Text>
      )}
      renderItem={({ item, index, section }) => (
        <View
          style={{
            backgroundColor: t.card,
            borderTopLeftRadius: index === 0 ? 16 : 0,
            borderTopRightRadius: index === 0 ? 16 : 0,
            borderBottomLeftRadius: index === section.data.length - 1 ? 16 : 0,
            borderBottomRightRadius: index === section.data.length - 1 ? 16 : 0,
            overflow: 'hidden',
          }}>
          <TransactionRow t={item} onPress={() => router.push(`/transaction/${item.id}`)} />
        </View>
      )}
      SectionSeparatorComponent={() => <View style={{ height: 6 }} />}
    />
    <Fab onPress={() => router.push('/transaction/new')} />
    </View>
  );
}
