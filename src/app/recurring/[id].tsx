import DateTimePicker from '@react-native-community/datetimepicker';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { Alert } from '@/lib/alert';
import { Button, Chip, ChipRow, Field, Label, Loading, Screen, Segmented } from '@/components/ui';
import { listAccounts } from '@/db/repositories/accounts';
import { listCategories } from '@/db/repositories/categories';
import {
  createRecurringRule,
  deleteRecurringRule,
  getRecurringRule,
  setRecurringActive,
  updateRecurringRule,
} from '@/db/repositories/recurring';
import { Frequency, describeSchedule, scheduleFromDate } from '@/domain/recurrence';
import { minorToInput, parseAmountToMinor, zeroText } from '@/domain/money';
import { useDbQuery } from '@/hooks/useDbQuery';
import { fromLocalDate, prettyDate, toLocalDate, today } from '@/lib/dates';
import { ensureNotificationPermission, rescheduleReminders } from '@/services/notifications';
import { useTheme } from '@/theme';
import { PaymentMethod, TxnType } from '@/types';
import { getBaseCurrency } from '@/domain/currencies';

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'card', label: 'Card' },
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'upi', label: 'UPI' },
  { value: 'other', label: 'Other' },
];

export default function RecurringForm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const db = useSQLiteContext();
  const t = useTheme();
  const { data: ref } = useDbQuery(async (d) => ({
    accounts: await listAccounts(d, { includeArchived: true }),
    categories: await listCategories(d, { includeArchived: true }),
  }));

  const [ready, setReady] = useState(isNew);
  const [name, setName] = useState('');
  const [type, setType] = useState<TxnType>('expense');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [toAccountId, setToAccountId] = useState<string | null>(null);
  const [toAmount, setToAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer');
  const [frequency, setFrequency] = useState<Frequency>('monthly');
  const [dueDate, setDueDate] = useState(today());
  const [hasEnd, setHasEnd] = useState(false);
  const [endDate, setEndDate] = useState(today());
  const [mode, setMode] = useState<'auto' | 'remind'>('auto');
  const [note, setNote] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isNew) return;
    Promise.all([getRecurringRule(db, id), listAccounts(db, { includeArchived: true })]).then(([r, accs]) => {
      if (!r) return router.back();
      const cur = (accountId: string | null) => accs.find((a) => a.id === accountId)?.currency;
      setName(r.name);
      setType(r.type);
      setAmount(minorToInput(r.amount_minor, cur(r.account_id)));
      setCategoryId(r.category_id);
      setAccountId(r.account_id);
      setToAccountId(r.to_account_id);
      setToAmount(r.to_amount_minor ? minorToInput(r.to_amount_minor, cur(r.to_account_id)) : '');
      setMethod(r.payment_method);
      setFrequency(r.frequency);
      setDueDate(r.next_due_date);
      setHasEnd(!!r.end_date);
      setEndDate(r.end_date ?? r.next_due_date);
      setMode(r.mode);
      setNote(r.note);
      setActive(!!r.is_active);
      setReady(true);
    });
  }, [db, id, isNew]);

  useEffect(() => {
    if (isNew && ref && accountId === null) setAccountId(ref.accounts.find((a) => !a.is_archived)?.id ?? null);
  }, [isNew, ref, accountId]);

  const account = ref?.accounts.find((a) => a.id === accountId);
  const toAccount = ref?.accounts.find((a) => a.id === toAccountId);
  const sameCurrency = !!account && !!toAccount && account.currency === toAccount.currency;

  const categoryOptions = useMemo(() => {
    if (!ref || type === 'transfer') return [];
    const visible = ref.categories.filter((c) => c.kind === type && (!c.is_archived || c.id === categoryId));
    const out: { id: string; label: string; color: string; icon: string }[] = [];
    for (const p of visible.filter((c) => !c.parent_id)) {
      out.push({ id: p.id, label: p.name, color: p.color, icon: p.icon });
      for (const s of visible.filter((c) => c.parent_id === p.id)) {
        out.push({ id: s.id, label: `${p.name} › ${s.name}`, color: s.color, icon: s.icon });
      }
    }
    return out;
  }, [ref, type, categoryId]);

  if (!ready || !ref) return <Loading />;
  const selectable = ref.accounts.filter((a) => !a.is_archived || a.id === accountId || a.id === toAccountId);
  const schedule = scheduleFromDate(frequency, dueDate);
  const inPast = dueDate < today();

  const save = async () => {
    const amountMinor = parseAmountToMinor(amount, account?.currency);
    if (amountMinor === null) return Alert.alert('Invalid amount', 'Enter an amount like 3800.00');
    const toAmountMinor = type !== 'transfer' ? null : sameCurrency ? amountMinor : parseAmountToMinor(toAmount, toAccount?.currency);
    setSaving(true);
    try {
      const input = {
        name,
        type,
        accountId: accountId ?? '',
        amountMinor,
        categoryId: type === 'transfer' ? null : categoryId,
        toAccountId: type === 'transfer' ? toAccountId : null,
        toAmountMinor,
        paymentMethod: method,
        note,
        frequency,
        nextDueDate: dueDate,
        endDate: hasEnd ? endDate : null,
        mode,
      };
      let savedId = id;
      if (isNew) savedId = await createRecurringRule(db, input);
      else {
        await updateRecurringRule(db, id, input);
        await setRecurringActive(db, id, active);
      }
      const allowed = await ensureNotificationPermission();
      await rescheduleReminders(db).catch(() => 0);
      const finish = () => router.back();
      if (!allowed) {
        Alert.alert(
          'Reminders are off',
          'Saved. To get a notification on the due date, allow notifications for Expo Go in the iPhone Settings app.',
          [{ text: 'OK', onPress: finish }],
        );
      } else if (inPast) {
        Alert.alert(
          'Saved',
          mode === 'auto'
            ? 'Entries for the past due dates will be added the next time the app opens.'
            : 'Reminders for the past due dates will appear the next time the app opens.',
          [{ text: 'OK', onPress: finish }],
        );
      } else finish();
      void savedId;
    } catch (e) {
      Alert.alert('Check the entry', String(e instanceof Error ? e.message : e));
      setSaving(false);
    }
  };

  const remove = () =>
    Alert.alert('Delete this recurring item?', 'Transactions already created from it are kept.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteRecurringRule(db, id);
          await rescheduleReminders(db).catch(() => 0);
          router.back();
        },
      },
    ]);

  return (
    <Screen>
      <Stack.Screen options={{ title: isNew ? 'New recurring item' : 'Edit recurring item' }} />
      <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Rent, Salary, Netflix" />

      <Segmented
        value={type}
        onChange={(next) => {
          setType(next);
          setCategoryId(null);
        }}
        options={[
          { value: 'expense', label: 'Expense', color: t.expense },
          { value: 'income', label: 'Income', color: t.income },
          { value: 'transfer', label: 'Transfer', color: t.primary },
        ]}
      />

      <Field
        label={`Amount${account ? ` (${account.currency})` : ''}`}
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder={zeroText(account?.currency)}
      />

      {type !== 'transfer' ? (
        <>
          <Label>Category</Label>
          <ChipRow>
            {categoryOptions.map((c) => (
              <Chip key={c.id} label={c.label} icon={c.icon} color={c.color} selected={categoryId === c.id} onPress={() => setCategoryId(c.id)} />
            ))}
          </ChipRow>
        </>
      ) : null}

      <Label>{type === 'transfer' ? 'From account' : 'Account'}</Label>
      <ChipRow>
        {selectable.map((a) => (
          <Chip
            key={a.id}
            label={`${a.name}${a.currency !== getBaseCurrency() ? ` (${a.currency})` : ''}`}
            color={a.color}
            selected={accountId === a.id}
            onPress={() => setAccountId(a.id)}
          />
        ))}
      </ChipRow>

      {type === 'transfer' ? (
        <>
          <Label>To account</Label>
          <ChipRow>
            {selectable
              .filter((a) => a.id !== accountId)
              .map((a) => (
                <Chip
                  key={a.id}
                  label={`${a.name}${a.currency !== getBaseCurrency() ? ` (${a.currency})` : ''}`}
                  color={a.color}
                  selected={toAccountId === a.id}
                  onPress={() => setToAccountId(a.id)}
                />
              ))}
          </ChipRow>
          {toAccount && !sameCurrency ? (
            <Field
              label={`Amount received (${toAccount.currency}) each time`}
              value={toAmount}
              onChangeText={setToAmount}
              keyboardType="decimal-pad"
              placeholder={zeroText(toAccount?.currency)}
            />
          ) : null}
        </>
      ) : (
        <>
          <Label>Payment method</Label>
          <ChipRow>
            {METHODS.map((m) => (
              <Chip key={m.value} label={m.label} selected={method === m.value} onPress={() => setMethod(m.value)} />
            ))}
          </ChipRow>
        </>
      )}

      <Label>Repeats</Label>
      <ChipRow>
        <Chip label="Monthly" selected={frequency === 'monthly'} onPress={() => setFrequency('monthly')} />
        <Chip label="Weekly" selected={frequency === 'weekly'} onPress={() => setFrequency('weekly')} />
      </ChipRow>

      <Label>{isNew ? 'First due date' : 'Next due date'}</Label>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        <DateTimePicker value={toLocalDate(dueDate)} mode="date" display="compact" onChange={(_, d) => d && setDueDate(fromLocalDate(d))} />
        <Text style={{ color: t.textMuted }}>{prettyDate(dueDate)}</Text>
      </View>
      <Text style={{ color: t.textMuted, fontSize: 12, marginBottom: 14 }}>
        {describeSchedule(schedule)}.{inPast ? ' This date has passed, so past occurrences will be caught up.' : ''}
      </Text>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: hasEnd ? 6 : 14 }}>
        <Text style={{ color: t.text, fontWeight: '600', flex: 1 }}>Stop on a date</Text>
        <Switch value={hasEnd} onValueChange={setHasEnd} />
      </View>
      {hasEnd ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <DateTimePicker value={toLocalDate(endDate)} mode="date" display="compact" onChange={(_, d) => d && setEndDate(fromLocalDate(d))} />
          <Text style={{ color: t.textMuted }}>{prettyDate(endDate)}</Text>
        </View>
      ) : null}

      <Label>On the due date</Label>
      <ChipRow>
        <Chip label="Add automatically" selected={mode === 'auto'} onPress={() => setMode('auto')} />
        <Chip label="Remind me to add" selected={mode === 'remind'} onPress={() => setMode('remind')} />
      </ChipRow>
      <Text style={{ color: t.textMuted, fontSize: 12, marginTop: -6, marginBottom: 14 }}>
        {mode === 'auto'
          ? 'The entry is created the next time you open the app on or after the due date, dated on the due date. You also get a notification at 9:00 on the day.'
          : 'You get a notification at 9:00 on the due date. Open the app and tap Add now (or Skip) under More → Recurring.'}
      </Text>

      <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="Shown on each transaction" />

      {!isNew ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <Text style={{ color: t.text, fontWeight: '600', flex: 1 }}>Active</Text>
          <Switch value={active} onValueChange={setActive} />
        </View>
      ) : null}

      <Button title={isNew ? 'Save' : 'Save changes'} onPress={save} disabled={saving} />
      {!isNew ? <Button title="Delete" kind="danger" onPress={remove} /> : null}
    </Screen>
  );
}
