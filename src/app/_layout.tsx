import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider } from 'expo-sqlite';
import { ReactNode, Suspense } from 'react';
import { useColorScheme } from 'react-native';
import { AppStartup } from '@/components/AppStartup';
import { LockProvider } from '@/components/LockProvider';
import { SetupGate } from '@/components/SetupGate';
import { Loading } from '@/components/ui';
import { DB_NAME, initDatabase } from '@/db/client';
import { SingleTabGate } from '@/components/SingleTabGate';
import { SyncProvider } from '@/sync/SyncProvider';

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <SingleTabGate>
      <Suspense fallback={<Loading />}>
        <SQLiteProvider databaseName={DB_NAME} onInit={initDatabase} useSuspense>
          <LockProvider>
          <SyncProvider>
          <AppStartup />
          <SetupGate />
          <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="transaction/[id]" options={{ presentation: 'modal', title: 'Transaction' }} />
            <Stack.Screen name="set-budget/[categoryId]" options={{ presentation: 'modal', title: 'Budget' }} />
            <Stack.Screen name="recurring/index" options={{ title: 'Recurring' }} />
            <Stack.Screen name="recurring/[id]" options={{ title: 'Recurring item' }} />
            <Stack.Screen name="accounts/index" options={{ title: 'Accounts' }} />
            <Stack.Screen name="accounts/[id]" options={{ title: 'Account' }} />
            <Stack.Screen name="categories/index" options={{ title: 'Categories' }} />
            <Stack.Screen name="categories/[id]" options={{ title: 'Category' }} />
            <Stack.Screen name="inbox/index" options={{ title: 'Review inbox' }} />
            <Stack.Screen name="inbox/[id]" options={{ title: 'Review' }} />
            <Stack.Screen name="statement" options={{ title: 'Import statement' }} />
            <Stack.Screen name="sms" options={{ title: 'Paste bank SMS' }} />
            <Stack.Screen name="data" options={{ title: 'Backup & data' }} />
            <Stack.Screen name="sync" options={{ title: 'Cloud sync' }} />
            <Stack.Screen name="setup" options={{ title: 'Easy setup' }} />
            <Stack.Screen name="lock" options={{ title: 'App lock' }} />
            <Stack.Screen name="settings" options={{ title: 'Settings' }} />
          </Stack>
          <StatusBar style="auto" />
          </SyncProvider>
          </LockProvider>
        </SQLiteProvider>
      </Suspense>
      </SingleTabGate>
    </ThemeProvider>
  );
}
