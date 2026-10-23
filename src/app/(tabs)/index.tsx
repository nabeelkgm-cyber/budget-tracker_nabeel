import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Alert } from '@/lib/alert';
import { Button, EmptyText, Fab, Loading, Screen } from '@/components/ui';
import { FinanceDashboard, MonthBar } from '@/components/home/dashboard';
import { useHomeData } from '@/components/home/useHomeData';
import { loadSampleData } from '@/db/seed/sampleData';
import { currentMonth } from '@/domain/budget';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useTheme } from '@/theme';

export default function HomeScreen() {
  const db = useSQLiteContext();
  const t = useTheme();
  const { isWide, width } = useBreakpoint();
  const [month, setMonth] = useState(currentMonth());
  const { data } = useHomeData(month);
  if (!data) return <Loading />;

  if (data.accounts.length === 0) {
    return (
      <Screen>
        <EmptyText>
          Welcome! The quickest start is Easy setup: pick from common bank, cash and card accounts and from expense and
          income categories, and change any of them to match you. Then use the + button to add expenses, income and
          transfers.
        </EmptyText>
        <Button title="Easy setup: choose your accounts and categories" onPress={() => router.push('/setup')} />
        <Button
          title="Or see an example: budget for a 5,000 QAR salary"
          kind="secondary"
          onPress={() => loadSampleData(db).catch((e) => Alert.alert('Failed', String(e)))}
        />
        <EmptyText>Already use this app on another device? Open More, then Cloud sync, and sign in to load your data.</EmptyText>
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ padding: isWide ? 28 : 16, paddingBottom: 130, alignItems: 'center' }}>
        <View style={{ width: '100%', maxWidth: 1360, gap: 16 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flexShrink: 1 }}>
              <Text style={{ color: t.text, fontSize: isWide ? 28 : 22, fontWeight: '800' }}>Monthly overview</Text>
              <Text style={{ color: t.textMuted, marginTop: 2 }}>Your income, spending, budget and savings in one place</Text>
            </View>
            <MonthBar month={month} onChange={setMonth} />
          </View>
          <FinanceDashboard data={data} month={month} wide={width >= 1000} />
        </View>
      </ScrollView>
      {isWide ? null : <Fab onPress={() => router.push('/transaction/new')} />}
    </View>
  );
}
