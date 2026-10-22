import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Alert } from '@/lib/alert';
import { BudgetBar, stateColor } from '@/components/BudgetBar';
import { Button, Card, Divider, EmptyText, IconCircle, Loading, Row, Screen, SectionTitle } from '@/components/ui';
import { checkBudgetAlerts, copyBudgets, getMonthBudget } from '@/db/repositories/budgets';
import { currentMonth, monthTitle, nextMonth, prevMonth } from '@/domain/budget';
import { formatMinor } from '@/domain/money';
import { useDbQuery } from '@/hooks/useDbQuery';
import { formatBudgetAlert } from '@/lib/budgetText';
import { useTheme } from '@/theme';
import { getBaseCurrency } from '@/domain/currencies';

const q = (n: number) => formatMinor(n, getBaseCurrency());

export default function BudgetScreen() {
  const t = useTheme();
  const db = useSQLiteContext();
  const [month, setMonth] = useState(currentMonth());
  const { data } = useDbQuery(
    async (d) => ({
      budget: await getMonthBudget(d, month),
      prevCount:
        (
          await d.getFirstAsync<{ n: number }>(
            'SELECT COUNT(*) AS n FROM budgets WHERE month = ? AND deleted_at IS NULL',
            [prevMonth(month)],
          )
        )?.n ?? 0,
    }),
    [month],
  );

  const copyFromPrevious = async () => {
    try {
      const added = await copyBudgets(db, prevMonth(month), month);
      if (added === 0) return Alert.alert('Nothing to copy', 'Every category already has a budget this month.');
      const alerts = await checkBudgetAlerts(db, month);
      Alert.alert(
        `Copied ${added} budget${added === 1 ? '' : 's'}`,
        alerts.length ? alerts.map(formatBudgetAlert).join('\n\n') : `From ${monthTitle(prevMonth(month))}.`,
      );
    } catch (e) {
      Alert.alert('Could not copy', String(e instanceof Error ? e.message : e));
    }
  };

  const open = (categoryId: string) => router.push(`/set-budget/${categoryId}?month=${month}`);
  const chevron = <Ionicons name="chevron-forward" size={18} color={t.textMuted as string} />;

  const monthBar = (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <Pressable onPress={() => setMonth(prevMonth(month))} hitSlop={14} accessibilityLabel="Previous month">
        <Ionicons name="chevron-back" size={26} color={t.primary as string} />
      </Pressable>
      <Text style={{ color: t.text, fontSize: 18, fontWeight: '800' }}>{monthTitle(month)}</Text>
      <Pressable onPress={() => setMonth(nextMonth(month))} hitSlop={14} accessibilityLabel="Next month">
        <Ionicons name="chevron-forward" size={26} color={t.primary as string} />
      </Pressable>
    </View>
  );

  if (!data) return <Loading />;
  const { budget, prevCount } = data;
  const { totals } = budget;

  return (
    <Screen>
      {monthBar}

      {budget.rows.length > 0 ? (
        <Card style={{ padding: 16 }}>
          <Text style={{ color: t.textMuted, fontWeight: '600' }}>
            {totals.remainingMinor >= 0 ? 'Remaining this month' : 'Over budget by'}
          </Text>
          <Text style={{ color: stateColor(totals.state, t), fontSize: 28, fontWeight: '800', marginVertical: 4 }}>
            {q(Math.abs(totals.remainingMinor))}
          </Text>
          <BudgetBar pct={totals.pct} state={totals.state} height={10} />
          <Text style={{ color: t.textMuted, fontSize: 12, marginTop: 8 }}>
            {q(totals.spentMinor)} spent of {q(totals.availableMinor)} · {totals.pct}% used
          </Text>
        </Card>
      ) : null}

      {prevCount > 0 ? (
        <Button title={`Copy budgets from ${monthTitle(prevMonth(month))}`} kind="secondary" onPress={copyFromPrevious} />
      ) : null}

      {budget.rows.length > 0 ? (
        <>
          <SectionTitle>Budgets</SectionTitle>
          <Card>
            {budget.rows.map((r, i) => (
              <View key={r.categoryId}>
                {i > 0 ? <Divider /> : null}
                <Pressable onPress={() => open(r.categoryId)} style={{ padding: 12, gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <IconCircle icon={r.icon} color={r.color} size={36} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.text, fontWeight: '700', fontSize: 16 }}>{r.categoryName}</Text>
                      <Text style={{ color: t.textMuted, fontSize: 12 }}>
                        {q(r.spentMinor)} of {q(r.availableMinor)}
                        {r.carryInMinor > 0 ? ` (incl. ${q(r.carryInMinor)} carried over)` : ''}
                      </Text>
                    </View>
                    <Text style={{ color: stateColor(r.state, t), fontWeight: '800' }}>{r.pct}%</Text>
                    {chevron}
                  </View>
                  <BudgetBar pct={r.pct} state={r.state} />
                  <Text style={{ color: r.remainingMinor < 0 ? t.expense : t.textMuted, fontSize: 12 }}>
                    {r.remainingMinor >= 0 ? `${q(r.remainingMinor)} left` : `Over by ${q(-r.remainingMinor)}`}
                    {r.rollover ? ' · rollover on' : ''}
                  </Text>
                </Pressable>
              </View>
            ))}
          </Card>
        </>
      ) : (
        <EmptyText>
          No budgets for {monthTitle(month)} yet. Tap a category below to set one
          {prevCount > 0 ? ', or copy last month’s budgets above' : ''}.
        </EmptyText>
      )}

      {budget.unbudgeted.length > 0 ? (
        <>
          <SectionTitle>{budget.rows.length ? 'Not budgeted' : 'Set a budget for'}</SectionTitle>
          <Card>
            {budget.unbudgeted.map((u, i) => (
              <View key={u.categoryId}>
                {i > 0 ? <Divider /> : null}
                <Row
                  onPress={() => open(u.categoryId)}
                  left={<IconCircle icon={u.icon} color={u.color} size={34} />}
                  title={u.categoryName}
                  subtitle={u.spentMinor > 0 ? `${q(u.spentMinor)} spent` : undefined}
                  right={chevron}
                />
              </View>
            ))}
          </Card>
        </>
      ) : null}
      <Text style={{ color: t.textMuted, fontSize: 12 }}>
        Budgets are in {getBaseCurrency()}. Spending on a sub-category counts towards its main category. Transfers are not
        counted.
      </Text>
    </Screen>
  );
}
