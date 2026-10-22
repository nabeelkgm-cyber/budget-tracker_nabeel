import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Pressable, Text, View } from 'react-native';
import { Alert } from '@/lib/alert';
import { Button, Card, Divider, EmptyText, IconCircle, Loading, Screen, SectionTitle } from '@/components/ui';
import { checkBudgetAlerts } from '@/db/repositories/budgets';
import {
  RecurringRuleRow,
  confirmDue,
  listPendingDue,
  listRecurringRules,
  scheduleOf,
  skipDue,
} from '@/db/repositories/recurring';
import { describeSchedule } from '@/domain/recurrence';
import { formatMinor } from '@/domain/money';
import { useDbQuery } from '@/hooks/useDbQuery';
import { formatBudgetAlert } from '@/lib/budgetText';
import { prettyDate } from '@/lib/dates';
import { rescheduleReminders } from '@/services/notifications';
import { useTheme } from '@/theme';

export default function RecurringScreen() {
  const t = useTheme();
  const db = useSQLiteContext();
  const { data } = useDbQuery(async (d) => ({ rules: await listRecurringRules(d), pending: await listPendingDue(d) }));
  if (!data) return <Loading />;

  const active = data.rules.filter((r) => r.is_active);
  const inactive = data.rules.filter((r) => !r.is_active);

  const addNow = async (dueId: string) => {
    try {
      const { month } = await confirmDue(db, dueId);
      const alerts = await checkBudgetAlerts(db, month);
      rescheduleReminders(db).catch(() => 0);
      if (alerts.length) Alert.alert('Budget alert', alerts.map(formatBudgetAlert).join('\n\n'));
    } catch (e) {
      Alert.alert('Could not add', String(e instanceof Error ? e.message : e));
    }
  };

  const skip = (dueId: string, name: string, date: string) =>
    Alert.alert('Skip this one?', `${name} on ${prettyDate(date)} will not be added.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Skip',
        style: 'destructive',
        onPress: async () => {
          await skipDue(db, dueId);
          rescheduleReminders(db).catch(() => 0);
        },
      },
    ]);

  const ruleRow = (r: RecurringRuleRow, i: number) => (
    <View key={r.id}>
      {i > 0 ? <Divider /> : null}
      <Pressable
        onPress={() => router.push(`/recurring/${r.id}`)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, opacity: r.is_active ? 1 : 0.55 }}>
        <IconCircle
          icon={r.type === 'transfer' ? 'swap-horizontal' : (r.category_icon ?? 'repeat')}
          color={r.type === 'transfer' ? t.textMuted : (r.category_color ?? t.primary)}
        />
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.text, fontWeight: '700', fontSize: 16 }} numberOfLines={1}>
            {r.name}
          </Text>
          <Text style={{ color: t.textMuted, fontSize: 12 }} numberOfLines={1}>
            {describeSchedule(scheduleOf(r))} · {r.mode === 'auto' ? 'adds automatically' : 'reminder'}
          </Text>
          <Text style={{ color: t.textMuted, fontSize: 12 }} numberOfLines={1}>
            {r.is_active ? `Next: ${prettyDate(r.next_due_date)}` : r.end_date && r.next_due_date > r.end_date ? 'Finished' : 'Paused'}
            {' · '}
            {r.account_name}
            {r.to_account_name ? ` → ${r.to_account_name}` : ''}
          </Text>
          {r.last_error ? (
            <Text style={{ color: t.expense, fontSize: 12 }} numberOfLines={2}>
              Problem: {r.last_error}
            </Text>
          ) : null}
        </View>
        <Text style={{ color: r.type === 'income' ? t.income : t.text, fontWeight: '700' }}>
          {formatMinor(r.amount_minor, r.account_currency)}
        </Text>
        <Ionicons name="chevron-forward" size={18} color={t.textMuted as string} />
      </Pressable>
    </View>
  );

  return (
    <Screen>
      <Button title="+ Add recurring item" onPress={() => router.push('/recurring/new')} />

      {data.pending.length > 0 ? (
        <>
          <SectionTitle>Due now</SectionTitle>
          <Card>
            {data.pending.map((p, i) => (
              <View key={p.id}>
                {i > 0 ? <Divider /> : null}
                <View style={{ padding: 12, gap: 10 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.text, fontWeight: '700', fontSize: 16 }}>{p.name}</Text>
                      <Text style={{ color: t.textMuted, fontSize: 12 }}>
                        Due {prettyDate(p.due_date)} · {p.account_name}
                      </Text>
                    </View>
                    <Text style={{ color: p.type === 'income' ? t.income : t.text, fontWeight: '700' }}>
                      {formatMinor(p.amount_minor, p.currency)}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Button title="Add now" onPress={() => addNow(p.id)} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button title="Skip" kind="secondary" onPress={() => skip(p.id, p.name, p.due_date)} />
                    </View>
                  </View>
                </View>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {active.length > 0 ? (
        <>
          <SectionTitle>Active</SectionTitle>
          <Card>{active.map(ruleRow)}</Card>
        </>
      ) : (
        <EmptyText>
          Nothing set up yet. Add rent, salary, subscriptions or a monthly remittance and the app will add them for you
          or remind you on the due date.
        </EmptyText>
      )}

      {inactive.length > 0 ? (
        <>
          <SectionTitle>Paused or finished</SectionTitle>
          <Card>{inactive.map(ruleRow)}</Card>
        </>
      ) : null}
    </Screen>
  );
}
