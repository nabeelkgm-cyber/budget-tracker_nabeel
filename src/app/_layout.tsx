import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider } from 'expo-sqlite';
import { Suspense } from 'react';
import { useColorScheme } from 'react-native';
import { AppStartup } from '@/components/AppStartup';
import { LockProvider } from '@/components/LockProvider';
import { SetupGate } from '@/components/SetupGate';
import { Loading } from '@/components/ui';
import { DB_NAME, initDatabase } from '@/db/client';

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Suspense fallback={<Loading />}>
        <SQLiteProvider databaseName={DB_NAME} onInit={initDatabase} useSuspense>
          <LockProvider>
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
            <Stack.Screen name="data" options={{ title: 'Backup & data' }} />
            <Stack.Screen name="lock" options={{ title: 'App lock' }} />
            <Stack.Screen name="settings" options={{ title: 'Settings' }} />
          </Stack>
          <StatusBar style="auto" />
          </LockProvider>
        </SQLiteProvider>
      </Suspense>
    </ThemeProvider>
  );
}
