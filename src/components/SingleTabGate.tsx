import { ReactNode, useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import { Button } from './ui';

const LOCK_NAME = 'budget-tracker-database';

/**
 * Web only. The browser database can be open in just one tab at a time; a second copy of the app would
 * fail with a blank page. So each tab asks for a lock first, and a tab that cannot get it explains why and
 * keeps trying until the other tab is closed.
 */
export function SingleTabGate({ children }: { children: ReactNode }) {
  const supported = Platform.OS === 'web' && typeof navigator !== 'undefined' && !!navigator.locks;
  const [state, setState] = useState<'checking' | 'ok' | 'busy'>(supported ? 'checking' : 'ok');
  const [attempt, setAttempt] = useState(0);
  const t = useTheme();

  useEffect(() => {
    if (!supported || state === 'ok') return;
    let cancelled = false;
    navigator.locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => {
      if (cancelled) return;
      if (!lock) {
        setState('busy');
        return;
      }
      // Keep the lock for as long as this tab is open; the browser frees it when the tab closes.
      setTimeout(() => !cancelled && setState('ok'), 250);
      return new Promise<void>(() => undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [supported, attempt, state === 'ok']); // eslint-disable-line react-hooks/exhaustive-deps

  // While another tab holds the database, look again every couple of seconds.
  useEffect(() => {
    if (state !== 'busy') return;
    const id = setTimeout(() => setAttempt((n) => n + 1), 2000);
    return () => clearTimeout(id);
  }, [state, attempt]);

  if (state === 'ok') return <>{children}</>;
  if (state === 'checking') return <View style={{ flex: 1, backgroundColor: t.bg }} />;
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, justifyContent: 'center', padding: 24 }}>
      <Text style={{ color: t.text, fontSize: 22, fontWeight: '800', marginBottom: 10 }}>Budget Tracker is already open</Text>
      <Text style={{ color: t.textMuted, fontSize: 15, marginBottom: 20 }}>
        The app is open in another tab or window on this device. Close the other one and this page will continue
        by itself. Your data is safe.
      </Text>
      <Button title="Try again" onPress={() => setAttempt((n) => n + 1)} />
    </View>
  );
}
