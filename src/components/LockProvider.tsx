import { useSQLiteContext } from 'expo-sqlite';
import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { eraseAllData } from '@/db/seed/sampleData';
import { shouldLockAfterAbsence } from '@/domain/pin';
import { DEFAULT_TIMEOUT_SECONDS, LockSettings, disableLock, getLockSettings } from '@/services/lock';
import { rescheduleReminders } from '@/services/notifications';
import { useTheme } from '@/theme';
import { LockScreen } from './LockScreen';

interface LockContextValue {
  /** True while the PIN screen is up. */
  locked: boolean;
  settings: LockSettings;
  /** Re-reads the lock settings after they were changed. */
  reload: () => Promise<void>;
  lockNow: () => void;
}

const OFF: LockSettings = { enabled: false, biometrics: false, timeoutSeconds: DEFAULT_TIMEOUT_SECONDS, pinLength: 4 };
const LockContext = createContext<LockContextValue>({ locked: false, settings: OFF, reload: async () => {}, lockNow: () => {} });
export const useLock = () => useContext(LockContext);

/**
 * Locks the app at start and after it has been in the background for the chosen time, and hides
 * the screen contents while the app is not active (so the app switcher shows nothing private).
 */
export function LockProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const t = useTheme();
  const [phase, setPhase] = useState<'loading' | 'locked' | 'unlocked'>('loading');
  const [settings, setSettings] = useState<LockSettings>(OFF);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const backgroundedAt = useRef<number | null>(null);

  const reload = useCallback(async () => {
    const s = await getLockSettings();
    setSettings(s);
    setPhase((p) => (!s.enabled ? 'unlocked' : p === 'loading' ? 'locked' : p));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      setAppActive(next === 'active');
      if (next === 'background') backgroundedAt.current = Date.now();
      if (next === 'active') {
        const left = backgroundedAt.current;
        backgroundedAt.current = null;
        const s = settingsRef.current;
        // Coming back from "inactive" (Face ID prompt, Control Centre) is not an absence.
        if (left !== null && s.enabled && phaseRef.current === 'unlocked' && shouldLockAfterAbsence(left, Date.now(), s.timeoutSeconds)) {
          setPhase('locked');
        }
      }
    });
    return () => sub.remove();
  }, []);

  /** "Forgot PIN": wipes the app's data and the lock, so the phone is never stuck. */
  const forgotPin = useCallback(async () => {
    await eraseAllData(db);
    await disableLock();
    await rescheduleReminders(db).catch(() => 0);
    setSettings(OFF);
    setPhase('unlocked');
  }, [db]);

  const value = useMemo(
    () => ({
      locked: phase !== 'unlocked',
      settings,
      reload,
      lockNow: () => {
        if (settingsRef.current.enabled) setPhase('locked');
      },
    }),
    [phase, settings, reload],
  );

  return (
    <LockContext.Provider value={value}>
      {children}
      {phase === 'loading' ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: t.bg }]} /> : null}
      {settings.enabled && phase === 'unlocked' && !appActive ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: t.bg }]} />
      ) : null}
      <LockScreen visible={phase === 'locked'} settings={settings} onUnlock={() => setPhase('unlocked')} onForgot={forgotPin} />
    </LockContext.Provider>
  );
}
