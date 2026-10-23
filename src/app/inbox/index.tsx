import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Alert } from '@/lib/alert';
import { Button, Card, Divider, EmptyText, Loading, Screen, SectionTitle } from '@/components/ui';
import { approveAllSuggested, listInbox, rejectAllPending, restoreDuplicate } from '@/db/repositories/inbox';
import { formatMinor } from '@/domain/money';
import { useDbQuery } from '@/hooks/useDbQuery';
import { prettyDate } from '@/lib/dates';
import { useTheme } from '@/theme';

export default function InboxScreen() {
  const t = useTheme();
  const db = useSQLiteContext();
  const [showSkipped, setShowSkipped] = useState(false);
  const { data } = useDbQuery(async (d) => ({ pending: await listInbox(d, 'pending'), skipped: await listInbox(d, 'duplicate') }));
  if (!data) return <Loading />;
  const { pending, skipped } = data;
  const easy = pending.filter((i) => i.dup_kind === 'none' && i.suggested_category_id && (i.suggested_type === 'expense' || i.suggested_type === 'income'));

  const approveEasy = () =>
    Alert.alert(`Add ${easy.length} transaction${easy.length === 1 ? '' : 's'}?`, 'These use the categories you chose for the same merchants before, and do not look like anything already recorded.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Add them',
        onPress: () => approveAllSuggested(db).then((n) => Alert.alert('Done', `${n} added.`), (e) => Alert.alert('Failed', String(e))),
      },
    ]);

  const rejectAll = () =>
    Alert.alert('Discard everything waiting?', `${pending.length} item${pending.length === 1 ? '' : 's'} will be dropped. Nothing is added to your transactions.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard all', style: 'destructive', onPress: () => rejectAllPending(db) },
    ]);

  return (
    <Screen>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button title="Statement (PDF / Excel / CSV)" onPress={() => router.push('/statement')} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Paste bank SMS" kind="secondary" onPress={() => router.push('/sms')} />
        </View>
      </View>
      <Text style={{ color: t.textMuted, fontSize: 12, marginBottom: 12 }}>
        Nothing from a statement or SMS is added to your books until you approve it here. Lines already recorded are
        skipped automatically.
      </Text>

      {easy.length > 0 ? <Button title={`Add ${easy.length} with remembered categories`} kind="secondary" onPress={approveEasy} /> : null}

      <SectionTitle>Needs review ({pending.length})</SectionTitle>
      {pending.length === 0 ? (
        <EmptyText>Nothing waiting. Import a bank statement or paste a bank SMS to add transactions.</EmptyText>
      ) : (
        <Card>
          {pending.map((i, idx) => (
            <View key={i.id}>
              {idx > 0 ? <Divider /> : null}
              <Pressable onPress={() => router.push(`/inbox/${i.id}`)} style={{ padding: 12, gap: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <Text style={{ color: t.text, fontWeight: '700', flex: 1 }} numberOfLines={1}>
                    {i.description}
                  </Text>
                  <Text style={{ color: i.direction === 'credit' ? t.income : t.expense, fontWeight: '700' }}>
                    {i.direction === 'credit' ? '+' : '-'}
                    {formatMinor(i.amount_minor, i.account_currency)}
                  </Text>
                </View>
                <Text style={{ color: t.textMuted, fontSize: 12 }}>
                  {prettyDate(i.date)} · {i.account_name}
                  {i.suggested_category_name ? ` · ${i.suggested_category_name}` : i.suggested_type === 'transfer' ? ' · looks like a transfer' : ''}
                </Text>
                {i.dup_kind === 'possible' ? (
                  <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                    <Ionicons name="alert-circle" size={14} color="#F59E0B" />
                    <Text style={{ color: '#F59E0B', fontSize: 12, fontWeight: '600' }}>Looks like an entry you already have</Text>
                  </View>
                ) : null}
              </Pressable>
            </View>
          ))}
        </Card>
      )}
      {pending.length > 0 ? <Button title="Discard all waiting items" kind="danger" onPress={rejectAll} /> : null}

      {skipped.length > 0 ? (
        <>
          <Pressable onPress={() => setShowSkipped(!showSkipped)} style={{ marginTop: 8 }}>
            <Text style={{ color: t.primary, fontWeight: '700' }}>
              {showSkipped ? 'Hide' : 'Show'} {skipped.length} skipped as already recorded
            </Text>
          </Pressable>
          {showSkipped ? (
            <Card style={{ marginTop: 8 }}>
              {skipped.map((i, idx) => (
                <View key={i.id}>
                  {idx > 0 ? <Divider /> : null}
                  <View style={{ padding: 12, gap: 4 }}>
                    <Text style={{ color: t.text, fontWeight: '600' }} numberOfLines={1}>
                      {i.description} · {formatMinor(i.amount_minor, i.account_currency)}
                    </Text>
                    <Text style={{ color: t.textMuted, fontSize: 12 }}>
                      {prettyDate(i.date)} · {i.dup_note ? `matches "${i.dup_note}"` : 'seen before'}
                    </Text>
                    <Pressable onPress={() => restoreDuplicate(db, i.id)}>
                      <Text style={{ color: t.primary, fontSize: 12, fontWeight: '700' }}>Not a duplicate: review it</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </Card>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
