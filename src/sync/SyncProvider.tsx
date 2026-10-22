import { useSQLiteContext } from 'expo-sqlite';
import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { subscribeToChanges } from '@/db/events';
import { syncConfigured } from './config';
import {
  ConnectState,
  getMeta,
  isSyncOn,
  pendingCount,
  planConnect,
  startSync,
  stopSync,
  syncOnce,
} from './engine';
import { supabase, supabaseRemote } from './supabaseRemote';

export interface SyncApi {
  /** False on the phone app or when the build has no Supabase settings. */
  available: boolean;
  /** Signed-in email, if any. */
  email: string | null;
  /** True once this device is connected and sharing changes. */
  syncOn: boolean;
  busy: boolean;
  error: string | null;
  lastSyncedAt: string | null;
  pending: number;
  /** Another device replaced the cloud copy; this device must reload from the cloud. */
  resetNeeded: boolean;
  signIn(email: string, password: string): Promise<void>;
  /** Returns true when the account is ready to use, false when an email must be confirmed first. */
  signUp(email: string, password: string): Promise<boolean>;
  signOut(): Promise<void>;
  plan(): Promise<ConnectState>;
  connect(mode: 'upload' | 'download' | 'replace-cloud'): Promise<void>;
  syncNow(): Promise<void>;
}

const noop = async () => undefined;
const OFF: SyncApi = {
  available: false,
  email: null,
  syncOn: false,
  busy: false,
  error: null,
  lastSyncedAt: null,
  pending: 0,
  resetNeeded: false,
  signIn: noop,
  signUp: async () => false,
  signOut: noop,
  plan: async () => 'upload',
  connect: noop,
  syncNow: noop,
};

const Ctx = createContext<SyncApi>(OFF);
export const useSync = () => useContext(Ctx);

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const AVAILABLE = Platform.OS === 'web' && syncConfigured();

export function SyncProvider({ children }: { children: ReactNode }) {
  return AVAILABLE ? <Live>{children}</Live> : <Ctx.Provider value={OFF}>{children}</Ctx.Provider>;
}

function Live({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [email, setEmail] = useState<string | null>(null);
  const [syncOn, setSyncOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [resetNeeded, setResetNeeded] = useState(false);
  const remote = useMemo(() => supabaseRemote(), []);

  const refresh = useCallback(async () => {
    setSyncOn(await isSyncOn(db));
    setLast(await getMeta(db, 'last_synced_at'));
    setPending(await pendingCount(db));
  }, [db]);

  const syncNow = useCallback(async () => {
    if (!(await isSyncOn(db))) return;
    setBusy(true);
    try {
      const r = await syncOnce(db, remote);
      setResetNeeded(r.status === 'reset-needed');
      setError(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
      refresh().catch(() => undefined);
    }
  }, [db, remote, refresh]);

  // Who is signed in (the browser remembers the login).
  useEffect(() => {
    refresh().catch(() => undefined);
    const auth = supabase().auth;
    auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? null)).catch(() => undefined);
    const { data } = auth.onAuthStateChange((_e, session) => setEmail(session?.user.email ?? null));
    return () => data.subscription.unsubscribe();
  }, [refresh]);

  // While signed in and connected: sync right after each change, when the cloud changes, and as a safety net.
  useEffect(() => {
    if (!email || !syncOn) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = (onlyIfPending: boolean) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        if (onlyIfPending && (await pendingCount(db)) === 0) return refresh().catch(() => undefined);
        syncNow();
      }, 600);
    };
    syncNow();
    const unsubscribe = subscribeToChanges(() => later(true));
    const channel = supabase()
      .channel('budget-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sync_rows' }, () => later(false))
      .subscribe();
    const wake = () => {
      if (document.visibilityState === 'visible') syncNow();
    };
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    const interval = setInterval(() => syncNow(), 30_000);
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
      supabase().removeChannel(channel);
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
      clearInterval(interval);
    };
  }, [email, syncOn, db, syncNow, refresh]);

  const api = useMemo<SyncApi>(
    () => ({
      available: true,
      email,
      syncOn,
      busy,
      error,
      lastSyncedAt: last,
      pending,
      resetNeeded,
      async signIn(e, p) {
        const { error: err } = await supabase().auth.signInWithPassword({ email: e.trim(), password: p });
        if (err) throw new Error(err.message);
      },
      async signUp(e, p) {
        const { data, error: err } = await supabase().auth.signUp({ email: e.trim(), password: p });
        if (err) throw new Error(err.message);
        return !!data.session;
      },
      async signOut() {
        await stopSync(db);
        setResetNeeded(false);
        await supabase().auth.signOut();
        await refresh();
      },
      plan: () => planConnect(db, remote),
      async connect(mode) {
        const { data } = await supabase().auth.getSession();
        if (!data.session) throw new Error('Please sign in first.');
        setBusy(true);
        try {
          await startSync(db, remote, data.session.user.id, mode);
          setResetNeeded(false);
          await refresh();
        } finally {
          setBusy(false);
        }
      },
      syncNow,
    }),
    [email, syncOn, busy, error, last, pending, resetNeeded, db, remote, refresh, syncNow],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
