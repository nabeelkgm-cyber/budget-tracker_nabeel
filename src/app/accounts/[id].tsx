import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Button, Chip, ChipRow, ColorPicker, Field, IconPicker, Label, Loading, Screen } from '@/components/ui';
import { minorToInput, parseAmountToMinor, zeroText } from '@/domain/money';
import { createAccount, getAccount, setAccountArchived, updateAccount } from '@/db/repositories/accounts';
import { listCurrencies } from '@/db/repositories/currencies';
import { getAccountIdentifiers, setAccountIdentifiers } from '@/db/repositories/inbox';
import { useDbQuery } from '@/hooks/useDbQuery';
import { COLOR_CHOICES, useTheme } from '@/theme';
import type { AccountType } from '@/types';
import { getBaseCurrency } from '@/domain/currencies';

const TYPES: { value: AccountType; label: string; icon: string }[] = [
  { value: 'cash', label: 'Cash', icon: 'cash' },
  { value: 'bank', label: 'Bank', icon: 'business' },
  { value: 'credit_card', label: 'Credit card', icon: 'card' },
  { value: 'loan', label: 'Loan / liability', icon: 'trending-down' },
];

const toDay = (s: string): number | null => {
  const n = parseInt(s, 10);
  return n >= 1 && n <= 31 ? n : null;
};

export default function AccountForm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const db = useSQLiteContext();
  const t = useTheme();
  const { data: currencies } = useDbQuery(listCurrencies);

  const [loaded, setLoaded] = useState(isNew);
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('bank');
  const [currency, setCurrency] = useState(getBaseCurrency());
  const [opening, setOpening] = useState('');
  const [limit, setLimit] = useState('');
  const [stmtDay, setStmtDay] = useState('');
  const [dueDay, setDueDay] = useState('');
  const [icon, setIcon] = useState('business');
  const [color, setColor] = useState(COLOR_CHOICES[2]);
  const [archived, setArchived] = useState(false);
  const [last4Text, setLast4Text] = useState('');
  const [senderText, setSenderText] = useState('');

  useEffect(() => {
    if (isNew) return;
    getAccount(db, id).then((a) => {
      if (!a) return router.back();
      setName(a.name);
      setType(a.type);
      setCurrency(a.currency);
      // Cards store "owed" as a negative opening balance; show it as a positive number.
      setOpening(minorToInput(a.type === 'credit_card' || a.type === 'loan' ? -a.opening_balance_minor : a.opening_balance_minor, a.currency));
      setLimit(a.credit_limit_minor ? minorToInput(a.credit_limit_minor, a.currency) : '');
      setStmtDay(a.statement_day ? String(a.statement_day) : '');
      setDueDay(a.due_day ? String(a.due_day) : '');
      setIcon(a.icon);
      setColor(a.color);
      setArchived(!!a.is_archived);
      getAccountIdentifiers(db, id).then((ids) => {
        setLast4Text(ids.last4.join(', '));
        setSenderText(ids.senders.join(', '));
        setLoaded(true);
      });
    });
  }, [db, id, isNew]);

  if (!loaded || !currencies) return <Loading />;
  const isCard = type === 'credit_card';
  const isLoan = type === 'loan';
  const owes = isCard || isLoan; // balances for these are stored negative (money owed)

  const save = async () => {
    if (!name.trim()) return Alert.alert('Name needed', 'Give the account a name.');
    const openingAbs = opening.trim() === '' ? 0 : parseAmountToMinor(opening, currency);
    if (openingAbs === null) return Alert.alert('Invalid amount', 'Opening balance must be a number like 1500.00');
    const limitMinor = isCard && limit.trim() !== '' ? parseAmountToMinor(limit, currency) : null;
    if (isCard && limit.trim() !== '' && limitMinor === null) return Alert.alert('Invalid credit limit');
    const input = {
      name,
      type,
      openingBalanceMinor: owes ? -openingAbs : openingAbs,
      creditLimitMinor: limitMinor,
      statementDay: isCard ? toDay(stmtDay) : null,
      dueDay: owes ? toDay(dueDay) : null,
      icon,
      color,
    };
    try {
      const ids = { last4: last4Text.split(/[,\s]+/).filter(Boolean), senders: senderText.split(',').filter((x) => x.trim()) };
      if (isNew) {
        const newId = await createAccount(db, { ...input, currency });
        await setAccountIdentifiers(db, newId, ids);
      } else {
        await updateAccount(db, id, input);
        await setAccountIdentifiers(db, id, ids);
      }
      router.back();
    } catch (e) {
      Alert.alert('Could not save', String(e instanceof Error ? e.message : e));
    }
  };

  const toggleArchive = async () => {
    await setAccountArchived(db, id, !archived);
    router.back();
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: isNew ? 'New account' : 'Edit account' }} />
      <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. CBQ Salary Account" />

      <Label>Type</Label>
      <ChipRow>
        {TYPES.map((x) => (
          <Chip
            key={x.value}
            label={x.label}
            icon={x.icon}
            selected={type === x.value}
            onPress={() => {
              setType(x.value);
              if (isNew) setIcon(x.icon);
            }}
          />
        ))}
      </ChipRow>

      <Label>Currency {isNew ? '' : '(cannot be changed)'}</Label>
      <ChipRow>
        {currencies.map((c) => (
          <Chip
            key={c.code}
            label={c.code}
            selected={currency === c.code}
            onPress={() => isNew && setCurrency(c.code)}
          />
        ))}
      </ChipRow>

      <Field
        label={isCard ? 'Amount currently owed on card' : isLoan ? 'Outstanding amount owed' : 'Opening balance'}
        value={opening}
        onChangeText={setOpening}
        keyboardType="decimal-pad"
        placeholder={zeroText(currency)}
      />
      {isCard ? (
        <>
          <Field label="Credit limit (optional)" value={limit} onChangeText={setLimit} keyboardType="decimal-pad" placeholder={zeroText(currency)} />
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Field label="Statement day (1-31)" value={stmtDay} onChangeText={setStmtDay} keyboardType="number-pad" maxLength={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Payment due day (1-31)" value={dueDay} onChangeText={setDueDay} keyboardType="number-pad" maxLength={2} />
            </View>
          </View>
        </>
      ) : null}
      {isLoan ? (
        <>
          <Field label="EMI / payment due day (optional, 1-31)" value={dueDay} onChangeText={setDueDay} keyboardType="number-pad" maxLength={2} />
          <Text style={{ color: t.textMuted, fontSize: 12, marginBottom: 14 }}>
            Enter what you still owe today. Repay with a Transfer from your bank to this loan. To record interest or
            charges, add an Expense on this loan account (it increases what you owe).
          </Text>
        </>
      ) : null}

      <Field
        label="Card / account last 4 digits (optional)"
        value={last4Text}
        onChangeText={setLast4Text}
        placeholder="e.g. 1234, 5678"
        autoCapitalize="none"
      />
      <Field
        label="SMS sender names (optional)"
        value={senderText}
        onChangeText={setSenderText}
        placeholder="e.g. CBQ, HDFCBK"
      />
      <Text style={{ color: t.textMuted, fontSize: 12, marginTop: -6, marginBottom: 14 }}>
        Used to recognise which account a pasted bank SMS belongs to.
      </Text>

      <Label>Icon</Label>
      <IconPicker value={icon} color={color} onChange={setIcon} />
      <Label>Colour</Label>
      <ColorPicker value={color} onChange={setColor} />

      <Button title={isNew ? 'Add account' : 'Save changes'} onPress={save} />
      {!isNew ? (
        <Button title={archived ? 'Restore account' : 'Archive account'} kind="secondary" onPress={toggleArchive} />
      ) : null}
      {!isNew ? (
        <Text style={{ color: t.textMuted, fontSize: 12 }}>
          Archiving hides the account from lists and the add screen. Its history and balance are kept.
        </Text>
      ) : null}
    </Screen>
  );
}
