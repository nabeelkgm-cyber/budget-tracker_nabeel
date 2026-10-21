import * as Linking from 'expo-linking';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Text } from 'react-native';
import { Button, Card, Field, Loading, Screen, SectionTitle } from '@/components/ui';
import { foreignPerBaseToRateE8, rateE8ToForeignPerBase } from '@/domain/money';
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
import { BASE_CURRENCY } from '@/types';

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const t = useTheme();
  const { data: currencies } = useDbQuery(listCurrencies);
  const inr = currencies?.find((c) => c.code === 'INR');
  const [rate, setRate] = useState('');
  const [notifOn, setNotifOn] = useState<boolean | null>(null);
  const refreshNotif = useCallback(() => notificationsAllowed().then(setNotifOn), []);
  useEffect(() => {
    refreshNotif();
  }, [refreshNotif]);

  useEffect(() => {
    if (inr) setRate(rateE8ToForeignPerBase(inr.rate_to_base_e8));
  }, [inr?.rate_to_base_e8]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!currencies || !inr) return <Loading />;

  const saveRate = async () => {
    const e8 = foreignPerBaseToRateE8(rate);
    if (e8 === null) return Alert.alert('Invalid rate', 'Enter a number such as 24.20');
    await setCurrencyRate(db, 'INR', e8);
    Alert.alert('Saved', 'New INR entries will use this rate. Past entries keep the rate they were saved with.');
  };

  const confirm = (title: string, message: string, action: () => Promise<void>) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Continue', style: 'destructive', onPress: () => action().catch((e) => Alert.alert('Failed', String(e))) },
    ]);

  return (
    <Screen>
      <SectionTitle>Exchange rate</SectionTitle>
      <Card style={{ padding: 16 }}>
        <Field
          label={`1 ${BASE_CURRENCY} = ? INR`}
          value={rate}
          onChangeText={setRate}
          keyboardType="decimal-pad"
        />
        <Text style={{ color: t.textMuted, fontSize: 12, marginBottom: 12 }}>
          Last updated {inr.updated_at.slice(0, 10)}. Each transaction stores the rate used when it was entered, so
          changing this never alters past figures. Reports and budgets are in {BASE_CURRENCY}.
        </Text>
        <Button title="Save rate" onPress={saveRate} />
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
            confirm('Erase everything?', 'All accounts, categories and transactions will be deleted. This cannot be undone.', () =>
              eraseAllData(db),
            )
          }
        />
      </Card>
    </Screen>
  );
}
