import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, Pressable, Text, View } from 'react-native';
import { Alert } from '@/lib/alert';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LockSettings, authenticateBiometric, biometricInfo, checkPin, secondsUntilNextTry, BiometricInfo } from '@/services/lock';
import { useTheme } from '@/theme';
import { PinPad } from './PinPad';

/** Full-screen PIN prompt (shown as a modal so it also covers any sheet that was open). */
export function LockScreen({
  visible,
  settings,
  onUnlock,
  onForgot,
}: {
  visible: boolean;
  settings: LockSettings;
  onUnlock: () => void;
  onForgot: () => Promise<void>;
}) {
  const t = useTheme();
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState('');
  const [wait, setWait] = useState(0);
  const [bio, setBio] = useState<BiometricInfo>({ available: false, label: 'Face ID' });
  const busy = useRef(false);

  const tryBiometric = useCallback(async () => {
    if (busy.current || AppState.currentState !== 'active') return;
    busy.current = true;
    const ok = await authenticateBiometric('Unlock Budget Tracker');
    busy.current = false;
    if (ok) onUnlock();
  }, [onUnlock]);

  // Each time the lock appears: clear the PIN, load the wait time, offer Face ID.
  useEffect(() => {
    if (!visible) return;
    setPin('');
    setMessage('');
    secondsUntilNextTry().then(setWait);
    biometricInfo().then((b) => {
      setBio(b);
      if (b.available && settings.biometrics) setTimeout(tryBiometric, 350);
    });
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (wait <= 0) return;
    const id = setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => clearInterval(id);
  }, [wait > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (value: string) => {
    if (busy.current) return;
    busy.current = true;
    const r = await checkPin(value);
    busy.current = false;
    if (r.ok) {
      onUnlock();
      return;
    }
    setPin('');
    setWait(r.waitSeconds);
    setMessage(r.waitSeconds > 0 ? `Too many wrong tries.` : 'Wrong PIN. Try again.');
  };

  const change = (next: string) => {
    setPin(next);
    if (next.length === settings.pinLength) submit(next);
  };

  const forgot = () =>
    Alert.alert(
      'Forgot your PIN?',
      'The PIN cannot be recovered. To get back in you must erase all data on this phone and then restore a backup file. Your data in the app will be deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Erase and start over', style: 'destructive', onPress: () => onForgot().catch((e) => Alert.alert('Failed', String(e))) },
      ],
    );

  const minutes = Math.floor(wait / 60);
  const waitText = wait >= 60 ? `${minutes} min ${wait % 60} s` : `${wait} s`;

  return (
    <Modal visible={visible} animationType="none" presentationStyle="fullScreen" onRequestClose={() => {}}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'space-between', paddingVertical: 24 }}>
        <View style={{ alignItems: 'center', marginTop: 24, gap: 8 }}>
          <Ionicons name="lock-closed" size={44} color={t.primary as string} />
          <Text style={{ color: t.text, fontSize: 22, fontWeight: '800' }}>Budget Tracker is locked</Text>
          <Text style={{ color: wait > 0 || message ? t.danger : t.textMuted, fontSize: 14, textAlign: 'center', minHeight: 20 }}>
            {wait > 0 ? `${message} Try again in ${waitText}.` : message || 'Enter your PIN'}
          </Text>
        </View>

        <PinPad value={pin} length={settings.pinLength} onChange={change} disabled={wait > 0} />

        <View style={{ alignItems: 'center', gap: 14, minHeight: 60 }}>
          {settings.biometrics && bio.available ? (
            <Pressable onPress={tryBiometric} hitSlop={10} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Ionicons name="scan" size={22} color={t.primary as string} />
              <Text style={{ color: t.primary, fontWeight: '700', fontSize: 16 }}>Use {bio.label}</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={forgot} hitSlop={10}>
            <Text style={{ color: t.textMuted, fontSize: 13 }}>Forgot PIN?</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}
