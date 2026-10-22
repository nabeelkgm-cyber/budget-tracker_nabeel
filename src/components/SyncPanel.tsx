import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Alert } from '@/lib/alert';
import { useSync } from '@/sync/SyncProvider';
import type { ConnectState } from '@/sync/engine';
import { useTheme } from '@/theme';
import { Button, Card, Field } from './ui';

/** Sign in, connect this device, and see the sync status. Used on the Sync screen and on first run. */
export function SyncPanel() {
  const s = useSync();
  const t = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [plan, setPlan] = useState<ConnectState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (s.email && !s.syncOn) s.plan().then(setPlan, (e) => setProblem(String(e instanceof Error ? e.message : e)));
    else setPlan(null);
  }, [s.email, s.syncOn]); // eslint-disable-line react-hooks/exhaustive-deps

  const muted = { color: t.textMuted, fontSize: 13, marginBottom: 12 } as const;
  const run = async (fn: () => Promise<void>) => {
    setWorking(true);
    setProblem(null);
    try {
      await fn();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  };

  if (!s.available) {
    return (
      <Card style={{ padding: 16 }}>
        <Text style={muted}>
          Cloud sync works in the web app. This version has no cloud settings, so it keeps its data on this device only.
        </Text>
      </Card>
    );
  }

  const problemText = problem ? <Text style={{ color: t.danger, marginBottom: 12 }}>{problem}</Text> : null;

  if (!s.email) {
    return (
      <Card style={{ padding: 16 }}>
        <Text style={muted}>
          Sign in to keep your data on every device. New here? Choose a password and tap Create account.
        </Text>
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoCorrect={false} />
        <Field label="Password (at least 6 characters)" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
        {problemText}
        <Button title="Sign in" disabled={working || !email || password.length < 6} onPress={() => run(() => s.signIn(email, password))} />
        <View style={{ height: 8 }} />
        <Button
          title="Create account"
          kind="secondary"
          disabled={working || !email || password.length < 6}
          onPress={() =>
            run(async () => {
              const ready = await s.signUp(email, password);
              if (!ready) Alert.alert('Check your email', 'We sent a link to confirm your email. Open it, then come back and tap Sign in.');
            })
          }
        />
      </Card>
    );
  }

  if (!s.syncOn) {
    return (
      <Card style={{ padding: 16 }}>
        <Text style={{ color: t.text, fontWeight: '700', marginBottom: 8 }}>Signed in as {s.email}</Text>
        {plan === null ? <Text style={muted}>Checking your cloud copy…</Text> : null}
        {plan === 'upload' ? (
          <>
            <Text style={muted}>Nothing is in the cloud yet. The data on this device will be uploaded and shared with your other devices.</Text>
            {problemText}
            <Button title="Start syncing" disabled={working} onPress={() => run(() => s.connect('upload'))} />
          </>
        ) : null}
        {plan === 'download' ? (
          <>
            <Text style={muted}>Your data is already in the cloud. It will be loaded onto this device.</Text>
            {problemText}
            <Button title="Load my data" disabled={working} onPress={() => run(() => s.connect('download'))} />
          </>
        ) : null}
        {plan === 'choose' ? (
          <>
            <Text style={muted}>
              Both this device and the cloud already have data. They cannot be merged safely, so choose which one to keep.
            </Text>
            {problemText}
            <Button
              title="Keep the cloud data (replaces data on this device)"
              disabled={working}
              onPress={() =>
                Alert.alert('Replace data on this device?', 'Everything on this device is deleted and replaced by your cloud data.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Replace', style: 'destructive', onPress: () => run(() => s.connect('download')) },
                ])
              }
            />
            <View style={{ height: 8 }} />
            <Button
              title="Keep this device's data (replaces the cloud)"
              kind="danger"
              disabled={working}
              onPress={() =>
                Alert.alert(
                  'Replace the cloud data?',
                  'The cloud copy is deleted and replaced by the data on this device. Your other devices will be asked to reload from the cloud.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Replace', style: 'destructive', onPress: () => run(() => s.connect('replace-cloud')) },
                  ],
                )
              }
            />
          </>
        ) : null}
        <View style={{ height: 8 }} />
        <Button title="Sign out" kind="secondary" disabled={working} onPress={() => run(s.signOut)} />
      </Card>
    );
  }

  const when = s.lastSyncedAt ? new Date(s.lastSyncedAt).toLocaleString() : 'not yet';
  return (
    <Card style={{ padding: 16 }}>
      <Text style={{ color: t.text, fontWeight: '700' }}>Syncing as {s.email}</Text>
      <Text style={[muted, { marginTop: 6 }]}>
        {s.busy ? 'Syncing…' : s.error ? 'Could not sync. It will try again automatically.' : s.pending ? `${s.pending} change(s) waiting to be sent` : 'Everything is up to date.'}
        {'\n'}Last synced: {when}
      </Text>
      {s.error ? <Text style={{ color: t.danger, marginBottom: 12 }}>{s.error}</Text> : null}
      {s.resetNeeded ? (
        <>
          <Text style={{ color: t.danger, marginBottom: 12 }}>
            The cloud copy was replaced from another device. Reload this device from the cloud to keep sharing.
          </Text>
          <Button
            title="Reload from the cloud"
            kind="danger"
            disabled={working}
            onPress={() =>
              Alert.alert('Reload from the cloud?', 'Data on this device that is not in the cloud is lost.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Reload', style: 'destructive', onPress: () => run(() => s.connect('download')) },
              ])
            }
          />
          <View style={{ height: 8 }} />
        </>
      ) : null}
      <Button title="Sync now" kind="secondary" disabled={working || s.busy} onPress={() => run(s.syncNow)} />
      <View style={{ height: 8 }} />
      <Button
        title="Sign out of sync"
        kind="secondary"
        disabled={working}
        onPress={() =>
          Alert.alert('Sign out of sync?', 'The data stays on this device. Changes made here stop being shared until you sign in again.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign out', onPress: () => run(s.signOut) },
          ])
        }
      />
    </Card>
  );
}
