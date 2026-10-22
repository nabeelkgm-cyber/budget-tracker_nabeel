import DateTimePicker from '@/components/DatePicker';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Alert } from '@/lib/alert';
import { Button, Chip, ChipRow, Field, Label, Loading, Screen, Segmented } from '@/components/ui';
import { monthOf } from '@/domain/budget';
import { convertMinor, formatMinor, impliedRate, minorToInput, parseAmountToMinor, rateE8ToForeignPerBaseAuto, zeroText } from '@/domain/money';
import { listAccounts } from '@/db/repositories/accounts';
import { BudgetAlert, checkBudgetAlerts } from '@/db/repositories/budgets';
import { listCategories } from '@/db/repositories/categories';
import { listCurrencies } from '@/db/repositories/currencies';
import {
  createTransaction,
  deleteTransaction,
  duplicateTransaction,
  getLinkedFee,
  getTransaction,
  updateTransaction,
} from '@/db/repositories/transactions';
import { useDbQuery } from '@/hooks/useDbQuery';
import { formatBudgetAlert } from '@/lib/budgetText';
import { fromLocalDate, prettyDate, toLocalDate, today } from '@/lib/dates';
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
  const [feeText, setFeeText] = useState('');
  const [originalDate, setOriginalDate] = useState(today());
  const [saving, setSaving] = useState(false);

  // Load an existing transaction once.
  useEffect(() => {
    if (isNew) return;
    Promise.all([getTransaction(db, id), listAccounts(db, { includeArchived: true })]).then(([x, accs]) => {
      if (!x) return router.back();
      const cur = (accountId: string | null) => accs.find((a) => a.id === accountId)?.currency;
      setType(x.type);
      setAmount(minorToInput(x.amount_minor, cur(x.account_id)));
      setCategoryId(x.category_id);
      setAccountId(x.account_id);
      setToAccountId(x.to_account_id);
      setToAmount(x.to_amount_minor ? minorToInput(x.to_amount_minor, cur(x.to_account_id)) : '');
      setDate(x.date);
      setOriginalDate(x.date);
      setNote(x.note);
      setMethod(x.payment_method);
      if (x.type === 'transfer') {
        getLinkedFee(db, id).then((fee) => setFeeText(fee ? minorToInput(fee.amount_minor, cur(x.account_id)) : ''));
      }
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
  const amountMinor = parseAmountToMinor(amount, account?.currency);
  const rate = ref.currencies.find((c) => c.code === account?.currency)?.rate_to_base_e8;

  const toAmountMinor = sameCurrency ? amountMinor : parseAmountToMinor(toAmount, toAccount?.currency);
  const implied =
    type === 'transfer' && account && toAccount && !sameCurrency && amountMinor && toAmountMinor
      ? impliedRate(amountMinor, account.currency, toAmountMinor, toAccount.currency, getBaseCurrency())
      : null;
  const manualRate = implied
    ? ref.currencies.find((c) => c.code === implied.foreignCurrency)?.rate_to_base_e8
    : undefined;
  const manualRateText = manualRate ? rateE8ToForeignPerBaseAuto(manualRate) : null;
  const rateDiff =
    implied && manualRateText
      ? (() => {
          const d = ((Number(implied.value) - Number(manualRateText)) / Number(manualRateText)) * 100;
          return `${d >= 0 ? '+' : ''}${d.toFixed(2)}% vs manual`;
        })()
      : null;

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
      type !== 'transfer' ? null : sameCurrency ? (amountMinor ?? 0) : parseAmountToMinor(toAmount, toAccount?.currency),
    paymentMethod: method,
    note,
    feeMinor: type === 'transfer' && feeText.trim() !== '' ? parseAmountToMinor(feeText, account?.currency) : null,
  });

  /** Shows any newly reached budget thresholds, then runs `next`. */
  const showAlerts = (alerts: BudgetAlert[], next: () => void) => {
    if (alerts.length === 0) return next();
    Alert.alert('Budget alert', alerts.map(formatBudgetAlert).join('\n\n'), [{ text: 'OK', onPress: next }]);
  };

  const checkAlerts = async (...dates: string[]) => {
    const alerts: BudgetAlert[] = [];
    for (const m of new Set(dates.map(monthOf))) alerts.push(...(await checkBudgetAlerts(db, m)));
    return alerts;
  };

  const save = async () => {
    if (amountMinor === null) return Alert.alert('Invalid amount', 'Enter an amount like 125.50 (max 2 decimals).');
    if (type === 'transfer' && feeText.trim() !== '' && parseAmountToMinor(feeText, account?.currency) === null) {
      return Alert.alert('Invalid fee', 'Enter the fee like 25.00, or leave it empty.');
    }
    setSaving(true);
    try {
      if (isNew) await createTransaction(db, buildInput());
      else await updateTransaction(db, id, buildInput());
      const alerts = await checkAlerts(date, originalDate);
      showAlerts(alerts, () => router.back());
    } catch (e) {
      Alert.alert('Check the entry', String(e instanceof Error ? e.message : e));
      setSaving(false);
    }
  };

  const duplicate = async () => {
    try {
      const newId = await duplicateTransaction(db, id);
      const alerts = await checkAlerts(today());
      showAlerts(alerts, () => router.replace(`/transaction/${newId}`));
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
          await checkAlerts(date); // clears alert flags that no longer apply
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
        placeholder={zeroText(account?.currency)}
        autoFocus={isNew}
        style={{ fontSize: 28, fontWeight: '700' }}
      />
      {type !== 'transfer' && account && account.currency !== getBaseCurrency() && amountMinor && rate ? (
        <Text style={{ color: t.textMuted, marginTop: -8, marginBottom: 14, fontSize: 12 }}>
          ≈ {formatMinor(convertMinor(amountMinor, rate, account.currency, getBaseCurrency()), getBaseCurrency())} at today&apos;s rate
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
              label={`${a.name}${a.currency !== getBaseCurrency() ? ` (${a.currency})` : ''}`}
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
                  label={`${a.name}${a.currency !== getBaseCurrency() ? ` (${a.currency})` : ''}`}
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
              placeholder={zeroText(toAccount?.currency)}
            />
          ) : null}
          {implied ? (
            <View style={{ marginTop: -6, marginBottom: 14 }}>
              <Text style={{ color: t.text, fontWeight: '700' }}>Rate you got: {implied.label}</Text>
              {manualRateText ? (
                <Text style={{ color: t.textMuted, fontSize: 12 }}>
                  Your manual rate: 1 {getBaseCurrency()} = {manualRateText} {implied.foreignCurrency}
                  {rateDiff ? ` (${rateDiff})` : ''}
                </Text>
              ) : null}
            </View>
          ) : null}
          <Field
            label={`Transfer fee in ${account?.currency ?? ''} (optional)`}
            value={feeText}
            onChangeText={setFeeText}
            keyboardType="decimal-pad"
            placeholder={zeroText(account?.currency)}
          />
          {feeText.trim() !== '' ? (
            <Text style={{ color: t.textMuted, fontSize: 12, marginTop: -8, marginBottom: 14 }}>
              Taken from the From account and saved as a Bank Charges expense.
            </Text>
          ) : null}
          <Text style={{ color: t.textMuted, fontSize: 12, marginTop: -6, marginBottom: 14 }}>
            Transfers (including credit card bill and loan repayments) move money between accounts and are not
            counted as expense or income.
            {toAccount?.type === 'loan' ? ' Record interest or charges as a separate Expense on the loan account.' : ''}
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
