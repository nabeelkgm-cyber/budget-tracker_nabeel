import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, SectionList, Text, TextInput, View } from 'react-native';
import { EMPTY_FILTER, FilterSheet, FilterState, countActiveFilters } from '@/components/FilterSheet';
import { TransactionRow } from '@/components/TransactionRow';
import { EmptyText, Fab, Loading } from '@/components/ui';
import { PERIOD_LABELS, periodRange } from '@/domain/dateRanges';
import { formatMinor } from '@/domain/money';
import { listAccounts } from '@/db/repositories/accounts';
import { listCategories } from '@/db/repositories/categories';
import { TransactionFilter, listTransactions, summarizeTransactions } from '@/db/repositories/transactions';
import { useDbQuery } from '@/hooks/useDbQuery';
import { prettyDate } from '@/lib/dates';
import { useTheme } from '@/theme';
import { TransactionRow as Txn } from '@/types';
import { getBaseCurrency } from '@/domain/currencies';

const PAGE_LIMIT = 500;

export default function TransactionsScreen() {
  const t = useTheme();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);
  const [sheetOpen, setSheetOpen] = useState(false);

  const query: TransactionFilter = useMemo(() => {
    const range = periodRange(filter.period, undefined, { from: filter.customFrom, to: filter.customTo });
    return {
      search,
      type: filter.type === 'all' ? undefined : filter.type,
      accountId: filter.accountId ?? undefined,
      categoryId: filter.categoryId ?? undefined,
      dateFrom: range.from,
      dateTo: range.to,
    };
  }, [search, filter]);

  const queryKey = JSON.stringify(query);
  const { data } = useDbQuery(
    async (db) => ({
      rows: await listTransactions(db, { limit: PAGE_LIMIT, filter: query }),
      totals: await summarizeTransactions(db, query),
      accounts: await listAccounts(db, { includeArchived: true }),
      categories: await listCategories(db, { includeArchived: true }),
    }),
    [queryKey],
  );

  const active = countActiveFilters(filter);
  const searching = search.trim().length > 0;
  const filtered = active > 0 || searching;

  const groups = useMemo(() => {
    const out: { date: string; data: Txn[] }[] = [];
    for (const row of data?.rows ?? []) {
      const last = out[out.length - 1];
      if (last && last.date === row.date) last.data.push(row);
      else out.push({ date: row.date, data: [row] });
    }
    return out;
  }, [data]);

  const accountName = data?.accounts.find((a) => a.id === filter.accountId)?.name;
  const categoryName = data?.categories.find((c) => c.id === filter.categoryId)?.name;
  const summaryParts = [
    filter.type !== 'all' ? filter.type : null,
    filter.period !== 'all' ? PERIOD_LABELS[filter.period] : null,
    accountName,
    categoryName,
  ].filter(Boolean);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ flex: 1, width: '100%', maxWidth: 820, alignSelf: 'center' }}>
      <View style={{ flexDirection: 'row', gap: 10, padding: 16, paddingBottom: 8, alignItems: 'center' }}>
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: t.inputBg,
            borderRadius: 12,
            paddingHorizontal: 12,
          }}>
          <Ionicons name="search" size={18} color={t.textMuted as string} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search note, category, account, amount"
            placeholderTextColor={t.textMuted}
            returnKeyType="search"
            autoCorrect={false}
            style={{ flex: 1, paddingVertical: 11, fontSize: 15, color: t.text }}
          />
          {searching ? (
            <Pressable onPress={() => setSearch('')} hitSlop={10}>
              <Ionicons name="close-circle" size={18} color={t.textMuted as string} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={() => setSheetOpen(true)}
          accessibilityLabel="Filters"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: 12,
            paddingVertical: 11,
            borderRadius: 12,
            backgroundColor: active ? t.primary : t.inputBg,
          }}>
          <Ionicons name="options" size={18} color={(active ? t.onPrimary : t.text) as string} />
          {active ? <Text style={{ color: t.onPrimary, fontWeight: '700' }}>{active}</Text> : null}
        </Pressable>
      </View>

      {data && (filtered || data.totals.count > 0) ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 6 }}>
          {summaryParts.length ? (
            <Text style={{ color: t.textMuted, fontSize: 12, textTransform: 'capitalize' }}>
              {summaryParts.join(' · ')}
            </Text>
          ) : null}
          <Text style={{ color: t.textMuted, fontSize: 12, marginTop: 2 }}>
            {data.totals.count} transaction{data.totals.count === 1 ? '' : 's'}
            {data.totals.count > PAGE_LIMIT ? ` (showing latest ${PAGE_LIMIT})` : ''} ·{' '}
            <Text style={{ color: t.income }}>In {formatMinor(data.totals.incomeMinor, getBaseCurrency())}</Text> ·{' '}
            <Text style={{ color: t.expense }}>Out {formatMinor(data.totals.expenseMinor, getBaseCurrency())}</Text>
          </Text>
        </View>
      ) : null}

      {!data ? (
        <Loading />
      ) : (
        <SectionList
          contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 110 }}
          sections={groups}
          keyExtractor={(x) => x.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          stickySectionHeadersEnabled={false}
          ListEmptyComponent={
            <EmptyText>{filtered ? 'No transactions match your search or filters.' : 'No transactions yet. Tap + to add one.'}</EmptyText>
          }
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
      )}

      <FilterSheet
        visible={sheetOpen}
        value={filter}
        onChange={setFilter}
        onClose={() => setSheetOpen(false)}
        accounts={data?.accounts.filter((a) => !a.is_archived || a.id === filter.accountId) ?? []}
        categories={data?.categories.filter((c) => !c.is_archived || c.id === filter.categoryId) ?? []}
      />
      </View>
      <Fab onPress={() => router.push('/transaction/new')} />
    </View>
  );
}
