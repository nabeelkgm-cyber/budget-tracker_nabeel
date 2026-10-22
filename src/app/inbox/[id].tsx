import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { Alert } from '@/lib/alert';
import { Button, Card, Chip, ChipRow, Field, Label, Loading, Screen, Segmented } from '@/components/ui';
import { listAccounts } from '@/db/repositories/accounts';
import { listCategories } from '@/db/repositories/categories';
import { approveItem, getInboxItem, linkItem, rejectItem } from '@/db/repositories/inbox';
import { formatMinor, parseAmountToMinor, zeroText } from '@/domain/money';
import { useDbQuery } from '@/hooks/useDbQuery';
import { prettyDate } from '@/lib/dates';
import { useTheme } from '@/theme';
import type { TxnType } from '@/types';

export default function ReviewItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const t = useTheme();
  const { data } = useDbQuery(async (d) => ({
    item: await getInboxItem(d, id),
    accounts: await listAccounts(d),
    categories: await listCategories(d),
  }));

  const [type, setType] = useState<TxnType | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [otherAccountId, setOtherAccountId] = useState<string | null>(null);
  const [otherAmount, setOtherAmount] = useState('');
  const [note, setNote] = useState('');
  const [learn, setLearn] = useState(true);
  const [ready, setReady] = useState(false);

  const item = data?.item;
  useEffect(() => {
    if (!item || ready) return;
    setType((item.suggested_type as TxnType) ?? (item.direction === 'debit' ? 'expense' : 'income'));
    setCategoryId(item.suggested_category_id);
    setNote(item.description);
    setReady(true);
  }, [item, ready]);

  const kind = type === 'income' ? 'income' : 'expense';
  const categoryOptions = useMemo(() => {
    if (!data || type === 'transfer') return [];
    const visible = data.categories.filter((c) => c.kind === kind);
    const out: { id: string; label: string; color: string; icon: string }[] = [];
    for (const p of visible.filter((c) => !c.parent_id)) {
      out.push({ id: p.id, label: p.name, color: p.color, icon: p.icon });
      for (const s of visible.filter((c) => c.parent_id === p.id)) out.push({ id: s.id, label: `${p.name} › ${s.name}`, color: s.color, icon: s.icon });
    }
    return out;
  }, [data, type, kind]);

  if (!data || !item || !ready) {
    return data && !item ? <Screen><Text style={{ color: t.textMuted }}>This item no longer exists.</Text></Screen> : <Loading />;
  }
  if (item.status !== 'pending') return <Screen><Text style={{ color: t.textMuted }}>This item was already handled.</Text></Screen>;

  const credit = item.direction === 'credit';
  const other = data.accounts.find((a) => a.id === otherAccountId);
  const sameCurrency = other?.currency === item.account_currency;

  const approve = async () => {
    try {
      await approveItem(db, item.id, {
        type: type ?? (credit ? 'income' : 'expense'),
        categoryId,
        otherAccountId,
        otherAmountMinor: other && !sameCurrency ? parseAmountToMinor(otherAmount, other.currency) : null,
        note,
        learn,
      });
      router.back();
    } catch (e) {
      Alert.alert('Check the entry', String(e instanceof Error ? e.message : e));
    }
  };

  const link = async () => {
    if (!item.dup_txn_id) return;
    try {
      await linkItem(db, item.id, item.dup_txn_id);
      router.back();
    } catch (e) {
      Alert.alert('Could not link', String(e instanceof Error ? e.message : e));
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Review' }} />
      <Card style={{ padding: 16 }}>
        <Text style={{ color: t.textMuted, fontSize: 12 }}>{prettyDate(item.date)} · {item.account_name}</Text>
        <Text style={{ color: credit ? t.income : t.expense, fontSize: 26, fontWeight: '800', marginVertical: 4 }}>
          {credit ? '+' : '-'}
          {formatMinor(item.amount_minor, item.account_currency)}
        </Text>
        <Text style={{ color: t.text, fontWeight: '600' }}>{item.description}</Text>
        {item.reference ? <Text style={{ color: t.textMuted, fontSize: 12, marginTop: 2 }}>Reference {item.reference}</Text> : null}
        {item.raw && item.raw !== item.description ? (
          <Text style={{ color: t.textMuted, fontSize: 11, marginTop: 6 }} numberOfLines={4}>
            {item.raw}
          </Text>
        ) : null}
      </Card>

      {item.dup_kind === 'possible' && item.dup_txn_id ? (
        <Card style={{ padding: 16, borderColor: '#F59E0B' }}>
          <Text style={{ color: '#F59E0B', fontWeight: '800' }}>Looks like an entry you already have</Text>
          <Text style={{ color: t.text, marginVertical: 6 }}>
            {prettyDate(item.dup_date ?? item.date)} · {item.dup_note || '(no note)'} ·{' '}
            {formatMinor(item.dup_amount_minor ?? item.amount_minor, item.account_currency)}
          </Text>
          <Button title="Same transaction: link it (adds nothing)" onPress={link} />
          <Text style={{ color: t.textMuted, fontSize: 12 }}>If it is a different purchase, just approve it below.</Text>
        </Card>
      ) : null}

      <Segmented
        value={type ?? 'expense'}
        onChange={(v) => {
          setType(v);
          setCategoryId(null);
        }}
        options={[
          credit ? { value: 'income', label: 'Income', color: t.income } : { value: 'expense', label: 'Expense', color: t.expense },
          { value: 'transfer', label: 'Transfer', color: t.primary },
        ]}
      />

      {type !== 'transfer' ? (
        <>
          <Label>Category</Label>
          <ChipRow>
            {categoryOptions.map((c) => (
              <Chip key={c.id} label={c.label} icon={c.icon} color={c.color} selected={categoryId === c.id} onPress={() => setCategoryId(c.id)} />
            ))}
          </ChipRow>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.text, fontWeight: '600' }}>Remember this merchant</Text>
              <Text style={{ color: t.textMuted, fontSize: 12 }}>Next time it arrives with this category filled in.</Text>
            </View>
            <Switch value={learn} onValueChange={setLearn} />
          </View>
        </>
      ) : (
        <>
          <Label>{credit ? 'Money came from account' : 'Money went to account'}</Label>
          <ChipRow>
            {data.accounts
              .filter((a) => a.id !== item.account_id)
              .map((a) => (
                <Chip key={a.id} label={`${a.name} (${a.currency})`} color={a.color} selected={otherAccountId === a.id} onPress={() => setOtherAccountId(a.id)} />
              ))}
          </ChipRow>
          {other && !sameCurrency ? (
            <Field
              label={`Amount ${credit ? 'sent from' : 'received in'} ${other.name} (${other.currency})`}
              value={otherAmount}
              onChangeText={setOtherAmount}
              keyboardType="decimal-pad"
              placeholder={zeroText(other.currency)}
            />
          ) : null}
          <Text style={{ color: t.textMuted, fontSize: 12, marginBottom: 14 }}>
            Moving money between your own accounts (including card payments) is not an expense. The matching line on the other account's statement is skipped automatically.
          </Text>
        </>
      )}

      <Field label="Note" value={note} onChangeText={setNote} />
      <Button title="Approve and add" onPress={approve} />
      <Button
        title="Reject (do not add)"
        kind="danger"
        onPress={async () => {
          await rejectItem(db, item.id);
          router.back();
        }}
      />
    </Screen>
  );
}
