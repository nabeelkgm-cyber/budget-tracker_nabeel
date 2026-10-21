import DateTimePicker from '@react-native-community/datetimepicker';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Button, Chip, ChipRow, Field, Label, Loading, Screen, Segmented } from '@/components/ui';
import { convertMinor, formatMinor, minorToInput, parseAmountToMinor } from '@/domain/money';
import { listAccounts } from '@/db/repositories/accounts';
import { listCategories } from '@/db/repositories/categories';
import { listCurrencies } from '@/db/repositories/currencies';
import {
  createTransaction,
  deleteTransaction,
  duplicateTransaction,
  getTransaction,
  updateTransaction,
} from '@/db/repositories/transactions';
import { useDbQuery } from '@/hooks/useDbQuery';
import { fromLocalDate, prettyDate, toLocalDate, today } from '@/lib/dates';
import { useTheme } from '@/theme';
import { BASE_CURRENCY, PaymentMethod, TxnType } from '@/types';

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'card', label: 'Card' },
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'upi', label: 'UPI' },
  { value: 'other', label: 'Other' },
];

export default function TransactionForm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const db = useSQLiteContext();
  const t = useTheme();

  const { data: ref } = useDbQuery(async (d) => ({
    accounts: await listAccounts(d, { includeArchived: true }),
    categories: await listCategories(d, { includeArchived: true }),
    currencies: await listCurrencies(d),
  }));

  const [ready, setReady] = useState(isNew);
  const [type, setType] = useState<TxnType>('expense');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [toAccountId, setToAccountId] = useState<string | null>(null);
  const [toAmount, setToAmount] = useState('');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('card');
  const [saving, setSaving] = useState(false);

  // Load an existing transaction once.
  useEffect(() => {
    if (isNew) return;
    getTransaction(db, id).then((x) => {
      if (!x) return router.back();
      setType(x.type);
      setAmount(minorToInput(x.amount_minor));
      setCategoryId(x.category_id);
      setAccountId(x.account_id);
      setToAccountId(x.to_account_id);
      setToAmount(x.to_amount_minor ? minorToInput(x.to_amount_minor) : '');
      setDate(x.date);
      setNote(x.note);
      setMethod(x.payment_method);
      setReady(true);
    });
  }, [db, id, isNew]);

  // New entries start on the first active account.
  useEffect(() => {
    if (isNew && ref && accountId === null) {
      setAccountId(ref.accounts.find((a) => !a.is_archived)?.id ?? null);
    }
  }, [isNew, ref, accountId]);

  const account = ref?.accounts.find((a) => a.id === accountId);
  const toAccount = ref?.accounts.find((a) => a.id === toAccountId);
  const sameCurrency = !!account && !!toAccount && account.currency === toAccount.currency;

  // Category chips: main categories with their sub-categories directly after them.
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

  const selectableAccounts = ref.accounts.filter((a) => !a.is_archived || a.id === accountId || a.id === toAccountId);
  const amountMinor = parseAmountToMinor(amount);
  const rate = ref.currencies.find((c) => c.code === account?.currency)?.rate_to_base_e8;

  const changeType = (next: TxnType) => {
    setType(next);
    setCategoryId(null);
    if (next === 'income') setMethod('bank_transfer');
    if (next === 'transfer') setMethod('bank_transfer');
  };

  const buildInput = () => ({
    type,
    date,
    accountId: accountId ?? '',
    amountMinor: amountMinor ?? 0,
    categoryId: type === 'transfer' ? null : categoryId,
    toAccountId: type === 'transfer' ? toAccountId : null,
    toAmountMinor:
      type !== 'transfer' ? null : sameCurrency ? (amountMinor ?? 0) : parseAmountToMinor(toAmount),
    paymentMethod: method,
    note,
  });

  const save = async () => {
    if (amountMinor === null) return Alert.alert('Invalid amount', 'Enter an amount like 125.50 (max 2 decimals).');
    setSaving(true);
    try {
      if (isNew) await createTransaction(db, buildInput());
      else await updateTransaction(db, id, buildInput());
      router.back();
    } catch (e) {
      Alert.alert('Check the entry', String(e instanceof Error ? e.message : e));
      setSaving(false);
    }
  };

  const duplicate = async () => {
    try {
      const newId = await duplicateTransaction(db, id);
      router.replace(`/transaction/${newId}`);
    } catch (e) {
      Alert.alert('Could not duplicate', String(e instanceof Error ? e.message : e));
    }
  };

  const remove = () =>
    Alert.alert('Delete transaction?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteTransaction(db, id);
          router.back();
        },
      },
    ]);

  return (
    <Screen>
      <Stack.Screen options={{ title: isNew ? 'Add transaction' : 'Edit transaction' }} />
      <Segmented
        value={type}
        onChange={changeType}
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
        placeholder="0.00"
        autoFocus={isNew}
        style={{ fontSize: 28, fontWeight: '700' }}
      />
      {type !== 'transfer' && account && account.currency !== BASE_CURRENCY && amountMinor && rate ? (
        <Text style={{ color: t.textMuted, marginTop: -8, marginBottom: 14, fontSize: 12 }}>
          ≈ {formatMinor(convertMinor(amountMinor, rate), BASE_CURRENCY)} at today&apos;s rate
        </Text>
      ) : null}

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
      {selectableAccounts.length === 0 ? (
        <Text style={{ color: t.expense, marginBottom: 14 }}>Add an account first (More → Accounts).</Text>
      ) : (
        <ChipRow>
          {selectableAccounts.map((a) => (
            <Chip
              key={a.id}
              label={`${a.name}${a.currency !== BASE_CURRENCY ? ` (${a.currency})` : ''}`}
              color={a.color}
              selected={accountId === a.id}
              onPress={() => setAccountId(a.id)}
            />
          ))}
        </ChipRow>
      )}

      {type === 'transfer' ? (
        <>
          <Label>To account</Label>
          <ChipRow>
            {selectableAccounts
              .filter((a) => a.id !== accountId)
              .map((a) => (
                <Chip
                  key={a.id}
                  label={`${a.name}${a.currency !== BASE_CURRENCY ? ` (${a.currency})` : ''}`}
                  color={a.color}
                  selected={toAccountId === a.id}
                  onPress={() => setToAccountId(a.id)}
                />
              ))}
          </ChipRow>
          {toAccount && !sameCurrency ? (
            <Field
              label={`Amount received (${toAccount.currency})`}
              value={toAmount}
              onChangeText={setToAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
            />
          ) : null}
          <Text style={{ color: t.textMuted, fontSize: 12, marginTop: -6, marginBottom: 14 }}>
            Transfers (including credit card bill payments) move money between accounts and are not counted as
            expense or income.
          </Text>
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

      <Label>Date</Label>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <DateTimePicker
          value={toLocalDate(date)}
          mode="date"
          display="compact"
          onChange={(_, d) => d && setDate(fromLocalDate(d))}
        />
        <Text style={{ color: t.textMuted }}>{prettyDate(date)}</Text>
      </View>

      <Field label="Note" value={note} onChangeText={setNote} placeholder="Optional" />

      <Button title={isNew ? 'Save' : 'Save changes'} onPress={save} disabled={saving} />
      {!isNew ? (
        <>
          <Button title="Duplicate" kind="secondary" onPress={duplicate} />
          <Button title="Delete" kind="danger" onPress={remove} />
        </>
      ) : null}
    </Screen>
  );
}
