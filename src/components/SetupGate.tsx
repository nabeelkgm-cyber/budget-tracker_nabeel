import { Ionicons } from '@expo/vector-icons';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Alert } from '@/lib/alert';
import { SafeAreaView } from 'react-native-safe-area-context';
import { completeSetup, isSeeded } from '@/db/currencySetup';
import { subscribeToChanges } from '@/db/events';
import { GCC_CURRENCIES } from '@/domain/currencies';
import { useTheme } from '@/theme';
import { Button } from './ui';

/**
 * First-run screen: the user picks their currency. It covers the app until a choice is made,
 * and appears again after "Erase all data".
 */
export function SetupGate() {
  const db = useSQLiteContext();
  const t = useTheme();
  const [seeded, setSeeded] = useState<boolean | null>(null);
  const [choice, setChoice] = useState('QAR');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => {
      isSeeded(db).then((v) => alive && setSeeded(v), () => undefined);
    };
    load();
    const unsubscribe = subscribeToChanges(load);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [db]);

  if (seeded !== false) return null;

  const start = async () => {
    setBusy(true);
    try {
      await completeSetup(db, choice);
    } catch (e) {
      Alert.alert('Could not set up', String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen">
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          <Text style={{ color: t.text, fontSize: 28, fontWeight: '800', marginTop: 12 }}>Welcome</Text>
          <Text style={{ color: t.textMuted, fontSize: 15, marginTop: 8, marginBottom: 20 }}>
            Choose your currency. Budgets, reports and totals will be shown in it. Money in other currencies (such as
            INR) is converted at a rate you set.
          </Text>

          {GCC_CURRENCIES.map((c) => {
            const on = c.code === choice;
            return (
              <Pressable
                key={c.code}
                onPress={() => setChoice(c.code)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  padding: 14,
                  marginBottom: 10,
                  borderRadius: 14,
                  borderWidth: 2,
                  borderColor: on ? t.primary : t.border,
                  backgroundColor: t.card,
                }}>
                <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={(on ? t.primary : t.textMuted) as string} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontWeight: '700', fontSize: 16 }}>
                    {c.name} ({c.code})
                  </Text>
                  <Text style={{ color: t.textMuted, fontSize: 12 }}>
                    {c.country} · {c.minorUnits} decimal places
                  </Text>
                </View>
              </Pressable>
            );
          })}

          <Text style={{ color: t.textMuted, fontSize: 12, marginVertical: 12 }}>
            This is set once. To change it later you need to erase all data in Settings and start again.
          </Text>
          <Button title={busy ? 'Setting up…' : 'Continue'} onPress={start} disabled={busy} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
