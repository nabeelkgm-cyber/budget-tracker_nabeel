import * as Linking from 'expo-linking';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Button, Card, Field, Loading, Screen, SectionTitle } from '@/components/ui';
import { foreignPerBaseToRateE8, rateE8ToForeignPerBaseAuto } from '@/domain/money';
import { listAccounts } from '@/db/repositories/accounts';
import { listCurrencies, setCurrencyRate } from '@/db/repositories/currencies';
import { eraseAllData, loadSampleData } from '@/db/seed/sampleData';
import { useDbQuery } from '@/hooks/useDbQuery';
import {
  ensureNotificationPermission,
  notificationsAllowed,
  rescheduleReminders,
  sendTestNotification,
} from '@/services/notifications';
import { useTheme } from '@/theme';
import { catalogEntry, getBaseCurrency } from '@/domain/currencies';

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const t = useTheme();
  const base = getBaseCurrency();
  const { data } = useDbQuery(async (d) => ({
    currencies: await listCurrencies(d),
    accounts: await listAccounts(d, { includeArchived: true }),
  }));
  const [rates, setRates] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);
  const [notifOn, setNotifOn] = useState<boolean | null>(null);
  const refreshNotif = useCallback(() => notificationsAllowed().then(setNotifOn), []);
  useEffect(() => {
    refreshNotif();
  }, [refreshNotif]);

  useEffect(() => {
    if (data) {
      setRates(Object.fromEntries(data.currencies.map((c) => [c.code, rateE8ToForeignPerBaseAuto(c.rate_to_base_e8)])));
    }
  }, [data?.currencies]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <Loading />;
  const { currencies, accounts } = data;
  const baseInfo = catalogEntry(base);
  const inUse = new Set(accounts.map((a) => a.currency));
  const foreign = currencies
    .filter((c) => c.code !== base)
    .sort((a, b) => (a.code === 'INR' ? -1 : b.code === 'INR' ? 1 : a.code.localeCompare(b.code)));
  const shown = foreign.filter((c) => showAll || c.code === 'INR' || inUse.has(c.code));

  const saveRate = async (code: string) => {
    const e8 = foreignPerBaseToRateE8(rates[code] ?? '');
    if (e8 === null) return Alert.alert('Invalid rate', 'Enter a number such as 24.20');
    await setCurrencyRate(db, code, e8);
    Alert.alert('Saved', `New ${code} entries will use this rate. Past entries keep the rate they were saved with.`);
  };

  const confirm = (title: string, message: string, action: () => Promise<void>) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Continue', style: 'destructive', onPress: () => action().catch((e) => Alert.alert('Failed', String(e))) },
    ]);

  return (
    <Screen>
      <SectionTitle>Your currency</SectionTitle>
      <Card style={{ padding: 16 }}>
        <Text style={{ color: t.text, fontWeight: '700', fontSize: 16 }}>
          {baseInfo ? `${baseInfo.name} (${base})` : base}
        </Text>
        <Text style={{ color: t.textMuted, fontSize: 12, marginTop: 4, marginBottom: 12 }}>
          Budgets, reports and totals are in {base}. It was chosen when you first opened the app. To switch to another
          Gulf currency (SAR, AED, OMR, KWD, BHD or QAR) you need to erase all data and set up again.
        </Text>
        <Button
          title="Change currency (erases all data)"
          kind="danger"
          onPress={() =>
            confirm(
              'Change currency?',
              'This deletes all accounts, categories, transactions and budgets, then asks you to choose a currency again. It cannot be undone.',
              () => eraseAllData(db),
            )
          }
        />
      </Card>

      <SectionTitle>Exchange rates</SectionTitle>
      <Card style={{ padding: 16 }}>
        <Text style={{ color: t.textMuted, fontSize: 12, marginBottom: 12 }}>
          How many units of each currency equal 1 {base}. Each transaction keeps the rate used when it was entered, so
          changing a rate never alters past figures.
        </Text>
        {shown.map((c) => (
          <View key={c.code} style={{ marginBottom: 4 }}>
            <Field
              label={`1 ${base} = ? ${c.code}   (updated ${c.updated_at.slice(0, 10)})`}
              value={rates[c.code] ?? ''}
              onChangeText={(v) => setRates({ ...rates, [c.code]: v })}
              keyboardType="decimal-pad"
            />
            <Button title={`Save ${c.code} rate`} kind="secondary" onPress={() => saveRate(c.code)} />
          </View>
        ))}
        {foreign.length > shown.length ? (
          <Button title="Show other currencies" kind="secondary" onPress={() => setShowAll(true)} />
        ) : null}
        <Text style={{ color: t.textMuted, fontSize: 12 }}>
          Starting rates are only estimates. Please enter the real ones before recording foreign-currency entries.
        </Text>
      </Card>

      <SectionTitle>Reminders</SectionTitle>
      <Card style={{ padding: 16 }}>
        <Text style={{ color: t.textMuted, fontSize: 12, marginBottom: 12 }}>
          {notifOn === null
            ? 'Checking…'
            : notifOn
              ? 'Notifications are on. Due-date reminders for recurring items arrive at 9:00.'
              : 'Notifications are off, so you will not be reminded on due dates.'}
        </Text>
        {notifOn === false ? (
          <>
            <Button
              title="Turn on reminders"
              onPress={async () => {
                const ok = await ensureNotificationPermission();
                setNotifOn(ok);
                if (ok) await rescheduleReminders(db).catch(() => 0);
                else Alert.alert('Allow notifications', 'Open the iPhone Settings app, find Expo Go, and allow notifications.', [
                  { text: 'Not now', style: 'cancel' },
                  { text: 'Open Settings', onPress: () => Linking.openSettings() },
                ]);
              }}
            />
          </>
        ) : null}
        {notifOn ? (
          <Button
            title="Send a test notification"
            kind="secondary"
            onPress={() =>
              sendTestNotification().then(
                () => Alert.alert('Sent', 'A test notification will arrive in about 5 seconds. Leave the app open or lock the phone.'),
                (e) => Alert.alert('Failed', String(e)),
              )
            }
          />
        ) : null}
      </Card>

      <SectionTitle>Test data</SectionTitle>
      <Card style={{ padding: 16 }}>
        <Button
          title="Load sample data"
          kind="secondary"
          onPress={() =>
            confirm('Replace all data?', 'This erases everything in the app and loads sample accounts and 3 months of transactions.', () =>
              loadSampleData(db),
            )
          }
        />
        <Button
          title="Erase all data"
          kind="danger"
          onPress={() =>
            confirm('Erase everything?', 'All accounts, categories, transactions and budgets will be deleted, and you will choose your currency again. This cannot be undone.', () =>
              eraseAllData(db),
            )
          }
        />
      </Card>
    </Screen>
  );
}
