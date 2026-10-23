import { Ionicons } from '@expo/vector-icons';
import { Stack, router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, Card, Chip, ChipRow, Field, Label, Loading, Screen, SectionTitle } from '@/components/ui';
import { listCategories } from '@/db/repositories/categories';
import { applyEasySetup } from '@/db/repositories/easySetup';
import { getBaseCurrency } from '@/domain/currencies';
import { ACCOUNT_TYPE_STYLE, popularBanks, suggestedAccounts } from '@/domain/easySetup';
import type { SetupPlan } from '@/domain/easySetup';
import { parseAmountToMinor } from '@/domain/money';
import { useDbQuery } from '@/hooks/useDbQuery';
import { Alert } from '@/lib/alert';
import { useTheme } from '@/theme';
import type { AccountType, CategoryKind } from '@/types';

interface AccountRow {
  key: string;
  name: string;
  type: AccountType;
  currency: string;
  opening: string;
  include: boolean;
}

interface CategoryRow {
  key: string;
  id: string | null;
  name: string;
  kind: CategoryKind;
  keep: boolean;
  icon: string;
  color: string;
}

const TYPES: AccountType[] = ['cash', 'bank', 'credit_card', 'loan'];

export default function EasySetupScreen() {
  const db = useSQLiteContext();
  const t = useTheme();
  const base = getBaseCurrency();
  const { data } = useDbQuery((d) => listCategories(d));
  const [accounts, setAccounts] = useState<AccountRow[]>(() => suggestedAccounts(base).map((a) => ({ ...a, opening: '' })));
  const [cats, setCats] = useState<CategoryRow[] | null>(null);
  const [saving, setSaving] = useState(false);
  const counter = useRef(0);
  const nextKey = () => `n${++counter.current}`;

  // Start from the categories the app already has (only main categories; sub-categories are left as they are).
  useEffect(() => {
    if (data && cats === null) {
      setCats(
        data
          .filter((c) => c.parent_id === null)
          .map((c) => ({ key: c.id, id: c.id, name: c.name, kind: c.kind, keep: true, icon: c.icon, color: c.color })),
      );
    }
  }, [data, cats]);

  if (!cats) return <Loading />;

  const patchAccount = (key: string, patch: Partial<AccountRow>) =>
    setAccounts((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const patchCat = (key: string, patch: Partial<CategoryRow>) =>
    setCats((rows) => (rows ?? []).map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const addAccount = (name = '', type: AccountType = 'bank', currency = base) =>
    setAccounts((rows) =>
      rows.some((r) => r.name.trim().toLowerCase() === name.trim().toLowerCase() && name)
        ? rows
        : [...rows, { key: nextKey(), name, type, currency, opening: '', include: true }],
    );
  const addCategory = (kind: CategoryKind) =>
    setCats((rows) => [
      ...(rows ?? []),
      { key: nextKey(), id: null, name: '', kind, keep: true, icon: 'ellipsis-horizontal-circle', color: '#64748B' },
    ]);

  const save = async () => {
    const plan: SetupPlan = { accounts: [], categories: [] };
    for (const r of accounts.filter((x) => x.include)) {
      const abs = r.opening.trim() === '' ? 0 : parseAmountToMinor(r.opening, r.currency);
      if (abs === null) return Alert.alert('Invalid amount', `The opening balance for "${r.name || 'an account'}" must be a number like 1500.00`);
      const owes = r.type === 'credit_card' || r.type === 'loan';
      plan.accounts.push({ name: r.name, type: r.type, currency: r.currency, openingBalanceMinor: owes ? -abs : abs });
    }
    plan.categories = cats.map((c) => ({ id: c.id, name: c.name, kind: c.kind, keep: c.keep, icon: c.icon, color: c.color }));
    setSaving(true);
    try {
      await applyEasySetup(db, plan);
      router.replace('/');
    } catch (e) {
      Alert.alert('Could not finish', String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  };

  const checkbox = (on: boolean, onPress: () => void) => (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
      <Ionicons name={on ? 'checkbox' : 'square-outline'} size={26} color={(on ? t.primary : t.textMuted) as string} />
    </Pressable>
  );

  const categorySection = (kind: CategoryKind, title: string) => (
    <>
      <SectionTitle>{title}</SectionTitle>
      <Card style={{ padding: 14 }}>
        {cats
          .filter((c) => c.kind === kind)
          .map((c) => (
            <View key={c.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {checkbox(c.keep, () => patchCat(c.key, { keep: !c.keep }))}
              <View style={{ flex: 1, opacity: c.keep ? 1 : 0.45 }}>
                <Field value={c.name} onChangeText={(v) => patchCat(c.key, { name: v })} placeholder="Category name" editable={c.keep} />
              </View>
            </View>
          ))}
        <Button title={`+ Add ${kind} category`} kind="secondary" onPress={() => addCategory(kind)} />
      </Card>
    </>
  );

  const banks = popularBanks(base);

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Easy setup' }} />
      <Text style={{ color: t.textMuted, marginBottom: 14 }}>
        Here are common accounts and categories to start from. Tick the ones you use, change any name, or add your own.
        Anything you leave out can be added later, and everything can be edited afterwards.
      </Text>

      <SectionTitle>1. Your accounts</SectionTitle>
      <Label>Tap your bank to add it</Label>
      <ChipRow>
        {banks.map((b) => (
          <Chip key={`${b.currency}-${b.name}`} label={b.currency === base ? b.name : `${b.name} (${b.currency})`} selected={false} onPress={() => addAccount(b.name, 'bank', b.currency)} />
        ))}
      </ChipRow>
      {accounts.map((r) => {
        const owes = r.type === 'credit_card' || r.type === 'loan';
        const currencies = Array.from(new Set([base, 'INR', r.currency]));
        return (
          <Card key={r.key} style={{ padding: 14, opacity: r.include ? 1 : 0.6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {checkbox(r.include, () => patchAccount(r.key, { include: !r.include }))}
              <View style={{ flex: 1 }}>
                <Field value={r.name} onChangeText={(v) => patchAccount(r.key, { name: v })} placeholder="Account name" />
              </View>
            </View>
            {r.include ? (
              <>
                <ChipRow>
                  {TYPES.map((tp) => (
                    <Chip key={tp} label={ACCOUNT_TYPE_STYLE[tp].label} selected={r.type === tp} onPress={() => patchAccount(r.key, { type: tp })} />
                  ))}
                </ChipRow>
                <ChipRow>
                  {currencies.map((c) => (
                    <Chip key={c} label={c} selected={r.currency === c} onPress={() => patchAccount(r.key, { currency: c })} />
                  ))}
                </ChipRow>
                <Field
                  label={owes ? 'Amount you owe now (optional)' : 'Opening balance (optional)'}
                  value={r.opening}
                  onChangeText={(v) => patchAccount(r.key, { opening: v })}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                />
              </>
            ) : null}
          </Card>
        );
      })}
      <Button title="+ Add another account" kind="secondary" onPress={() => addAccount()} />

      {categorySection('expense', '2. Expense categories')}
      {categorySection('income', '3. Income categories')}

      <Button title={saving ? 'Creating…' : 'Create my setup'} onPress={save} disabled={saving} />
      <Text style={{ color: t.textMuted, fontSize: 12, marginTop: 8 }}>
        Unticked categories are hidden, not deleted, so you can bring them back later in More → Categories.
      </Text>
    </Screen>
  );
}
