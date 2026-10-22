import { useCallback, useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { Alert } from '@/lib/alert';
import { PinFlow, PinFlowKind } from '@/components/PinFlow';
import { useLock } from '@/components/LockProvider';
import { Button, Card, Chip, ChipRow, Label, Screen, SectionTitle } from '@/components/ui';
import { LOCK_TIMEOUTS } from '@/domain/pin';
import {
  BiometricInfo,
  authenticateBiometric,
  biometricInfo,
  changePin,
  disableLock,
  enableLock,
  setBiometrics,
  setTimeoutSeconds,
} from '@/services/lock';
import { useTheme } from '@/theme';

export default function LockSettingsScreen() {
  const t = useTheme();
  const { settings, reload, lockNow } = useLock();
  const [flow, setFlow] = useState<PinFlowKind | null>(null);
  const [bio, setBio] = useState<BiometricInfo>({ available: false, label: 'Face ID' });

  useEffect(() => {
    biometricInfo().then(setBio);
  }, []);

  const done = useCallback(
    async (kind: PinFlowKind, pin: string) => {
      setFlow(null);
      try {
        if (kind === 'disable') {
          await disableLock();
        } else if (kind === 'change') {
          await changePin(pin);
          Alert.alert('PIN changed', 'Use your new PIN from now on.');
        } else {
          // Offer Face ID right after the PIN is set, if the phone has it.
          let useBio = false;
          if (bio.available) {
            useBio = await new Promise<boolean>((resolve) =>
              Alert.alert(`Use ${bio.label}?`, `Unlock with ${bio.label} as well as your PIN. The PIN always works too.`, [
                { text: 'PIN only', onPress: () => resolve(false) },
                {
                  text: `Use ${bio.label}`,
                  onPress: async () => resolve(await authenticateBiometric(`Turn on ${bio.label}`)),
                },
              ]),
            );
          }
          await enableLock(pin, useBio);
        }
      } catch (e) {
        Alert.alert('Could not save', String(e instanceof Error ? e.message : e));
      }
      await reload();
    },
    [bio, reload],
  );

  const toggleBio = async (on: boolean) => {
    if (on && !(await authenticateBiometric(`Turn on ${bio.label}`))) {
      Alert.alert(`${bio.label} did not work`, 'It was not turned on. In Expo Go, iOS may ask for your phone passcode instead of Face ID.');
      return;
    }
    await setBiometrics(on);
    await reload();
  };

  return (
    <Screen>
      <SectionTitle>App lock</SectionTitle>
      <Card style={{ padding: 16 }}>
        <Text style={{ color: t.text, fontWeight: '700', fontSize: 16 }}>
          {settings.enabled ? 'On' : 'Off'}
        </Text>
        <Text style={{ color: t.textMuted, fontSize: 12, marginTop: 4, marginBottom: 12 }}>
          {settings.enabled
            ? `Budget Tracker asks for your ${settings.pinLength}-digit PIN when it opens and after you have been away for a while. The PIN is stored only on this phone and is not in backups.`
            : 'Ask for a PIN (and optionally Face ID) whenever the app opens, so nobody else can look at your finances.'}
        </Text>
        {settings.enabled ? (
          <>
            <Button title="Lock now" kind="secondary" onPress={lockNow} />
            <Button title="Change PIN" kind="secondary" onPress={() => setFlow('change')} />
            <Button title="Turn off app lock" kind="danger" onPress={() => setFlow('disable')} />
          </>
        ) : (
          <Button title="Turn on app lock" onPress={() => setFlow('enable')} />
        )}
      </Card>

      {settings.enabled ? (
        <>
          <SectionTitle>Lock after</SectionTitle>
          <Card style={{ padding: 16 }}>
            <Label>How long the app can be in the background before it asks again</Label>
            <ChipRow>
              {LOCK_TIMEOUTS.map((o) => (
                <Chip
                  key={o.seconds}
                  label={o.label}
                  selected={settings.timeoutSeconds === o.seconds}
                  onPress={async () => {
                    await setTimeoutSeconds(o.seconds);
                    await reload();
                  }}
                />
              ))}
            </ChipRow>
          </Card>

          <SectionTitle>{bio.label}</SectionTitle>
          <Card style={{ padding: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontWeight: '600' }}>Unlock with {bio.label}</Text>
                <Text style={{ color: t.textMuted, fontSize: 12 }}>
                  {bio.available
                    ? 'Your PIN still works if it does not recognise you.'
                    : `${bio.label} is not set up on this phone.`}
                </Text>
              </View>
              <Switch value={settings.biometrics && bio.available} onValueChange={toggleBio} disabled={!bio.available} />
            </View>
            <Text style={{ color: t.textMuted, fontSize: 12, marginTop: 10 }}>
              Face ID itself needs the standalone app. Inside Expo Go, iOS cannot use Face ID for this app and may ask
              for your phone passcode.
            </Text>
          </Card>
        </>
      ) : null}

      <Text style={{ color: t.textMuted, fontSize: 12 }}>
        There is no way to recover a forgotten PIN. If it happens you must erase the app&apos;s data and restore a
        backup, so make a backup under More → Backup &amp; data.
      </Text>

      <PinFlow flow={flow} currentLength={settings.pinLength} onCancel={() => setFlow(null)} onDone={done} />
    </Screen>
  );
}
