import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider } from 'expo-sqlite';
import { ReactNode, Suspense } from 'react';
import { Platform, View, useColorScheme } from 'react-native';
import { AppStartup } from '@/components/AppStartup';
import { LockProvider } from '@/components/LockProvider';
import { SetupGate } from '@/components/SetupGate';
import { Loading } from '@/components/ui';
import { DB_NAME, initDatabase } from '@/db/client';
import { SyncProvider } from '@/sync/SyncProvider';

/** On a wide browser window the app stays a phone-width column in the middle instead of stretching. */
function WebFrame({ children, dark }: { children: ReactNode; dark: boolean }) {
  if (Platform.OS !== 'web') return <>{children}</>;
  return (
    <View style={{ flex: 1, alignItems: 'center', backgroundColor: dark ? '#000000' : '#DDE1E8' }}>
      <View
        style={[
          { flex: 1, width: '100%', maxWidth: 560, overflow: 'hidden', backgroundColor: dark ? '#0B1020' : '#F4F6FB' },
          { boxShadow: '0 0 40px rgba(15, 23, 42, 0.18)' } as object,
        ]}>
        {children}
      </View>
    </View>
  );
}

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <WebFrame dark={scheme === 'dark'}>
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
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
            <Stack.Screen name="lock" options={{ title: 'App lock' }} />
            <Stack.Screen name="settings" options={{ title: 'Settings' }} />
          </Stack>
          <StatusBar style="auto" />
          </SyncProvider>
          </LockProvider>
        </SQLiteProvider>
      </Suspense>
    </ThemeProvider>
    </WebFrame>
  );
}
