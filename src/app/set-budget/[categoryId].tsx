import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, Switch, Text, View } from 'react-native';
import { BudgetBar } from '@/components/BudgetBar';
import { Button, Card, Field, IconCircle, Loading, Screen } from '@/components/ui';
import { checkBudgetAlerts, deleteBudget, getMonthBudget, upsertBudget } from '@/db/repositories/budgets';
import { monthTitle, prevMonth } from '@/domain/budget';
import { formatMinor, minorToInput, parseAmountToMinor } from '@/domain/money';
import { useDbQuery } from '@/hooks/useDbQuery';
import { formatBudgetAlert } from '@/lib/budgetText';
import { useTheme } from '@/theme';
import { BASE_CURRENCY } from '@/types';

export default function SetBudgetScreen() {
  const { categoryId, month } = useLocalSearchParams<{ categoryId: string; month: string }>();
  const db = useSQLiteContext();
  const t = useTheme();
  const { data } = useDbQuery((d) => getMonthBudget(d, month), [month]);
  const [amount, setAmount] = useState('');
  const [rollover, setRollover] = useState(false);
  const [filled, setFilled] = useState(false);

  const row = data?.rows.find((r) => r.categoryId === categoryId);
  const free = data?.unbudgeted.find((u) => u.categoryId === categoryId);

  useEffect(() => {
    if (!data || filled) return;
    if (row) {
      setAmount(minorToInput(row.amountMinor));
      setRollover(row.rollover);
    }
    setFilled(true);
  }, [data, row, filled]);

  if (!data || !filled) return <Loading />;
  const name = row?.categoryName ?? free?.categoryName ?? 'Category';
  const icon = row?.icon ?? free?.icon ?? 'pricetag';
  const color = row?.color ?? free?.color ?? t.primary;
  const spent = row?.spentMinor ?? free?.spentMinor ?? 0;
  const q = (n: number) => formatMinor(n, BASE_CURRENCY);

  const save = async () => {
    const amountMinor = parseAmountToMinor(amount);
    if (amountMinor === null || amountMinor <= 0) {
      return Alert.alert('Invalid amount', `Enter a budget like 1500.00 (${BASE_CURRENCY}).`);
    }
    try {
      await upsertBudget(db, { month, categoryId, amountMinor, rollover });
      const alerts = await checkBudgetAlerts(db, month);
      if (alerts.length) {
        Alert.alert('Budget alert', alerts.map(formatBudgetAlert).join('\n\n'), [{ text: 'OK', onPress: () => router.back() }]);
      } else router.back();
    } catch (e) {
      Alert.alert('Could not save', String(e instanceof Error ? e.message : e));
    }
  };

  const remove = () =>
    Alert.alert('Remove this budget?', `${name} will have no budget for ${monthTitle(month)}.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await deleteBudget(db, month, categoryId);
          router.back();
        },
      },
    ]);

  return (
    <Screen>
      <Stack.Screen options={{ title: row ? 'Edit budget' : 'Set budget' }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <IconCircle icon={icon} color={color} />
        <View>
          <Text style={{ color: t.text, fontWeight: '800', fontSize: 18 }}>{name}</Text>
          <Text style={{ color: t.textMuted }}>{monthTitle(month)}</Text>
        </View>
      </View>

      <Field
        label={`Budget for the month (${BASE_CURRENCY})`}
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder="0.00"
        autoFocus={!row}
        style={{ fontSize: 24, fontWeight: '700' }}
      />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.text, fontWeight: '600' }}>Roll over unused budget</Text>
          <Text style={{ color: t.textMuted, fontSize: 12 }}>
            Adds whatever was left unspent from {monthTitle(prevMonth(month))} to this month. Overspending is not
            carried forward.
          </Text>
        </View>
        <Switch value={rollover} onValueChange={setRollover} />
      </View>

      <Card style={{ padding: 14 }}>
        <Text style={{ color: t.textMuted, fontSize: 12, fontWeight: '600' }}>Spent so far this month</Text>
        <Text style={{ color: t.text, fontWeight: '800', fontSize: 18, marginBottom: row ? 8 : 0 }}>{q(spent)}</Text>
        {row ? (
          <>
            <BudgetBar pct={row.pct} state={row.state} />
            <Text style={{ color: t.textMuted, fontSize: 12, marginTop: 6 }}>
              {row.pct}% of {q(row.availableMinor)}
              {row.carryInMinor > 0 ? ` (includes ${q(row.carryInMinor)} carried over)` : ''}
            </Text>
          </>
        ) : null}
      </Card>

      <Button title={row ? 'Save changes' : 'Set budget'} onPress={save} />
      {row ? <Button title="Remove budget" kind="danger" onPress={remove} /> : null}
      <Text style={{ color: t.textMuted, fontSize: 12 }}>
        Includes spending on this category’s sub-categories. You’ll get an alert when spending reaches 80% and 100%.
      </Text>
    </Screen>
  );
}
