import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { Alert } from '@/lib/alert';
import { Button, EmptyText, Fab, Loading, Screen } from '@/components/ui';
import { AlertCards, BudgetPanel, ChartsPanel, MonthSummary, NetAssetsPanel, RecentPanel } from '@/components/home/panels';
import { useHomeData } from '@/components/home/useHomeData';
import type { HomeData } from '@/components/home/useHomeData';
import { loadSampleData } from '@/db/seed/sampleData';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useTheme } from '@/theme';

export default function HomeScreen() {
  const db = useSQLiteContext();
  const { isWide } = useBreakpoint();
  const { data } = useHomeData();
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
    <View style={{ flex: 1 }}>
      {isWide ? <Dashboard data={data} /> : <PhoneHome data={data} />}
      {isWide ? null : <Fab onPress={() => router.push('/transaction/new')} />}
    </View>
  );
}

/** Phone / narrow window: one column. The net balance lives in the Net assets tab. */
function PhoneHome({ data }: { data: HomeData }) {
  return (
    <Screen>
      <AlertCards data={data} />
      <MonthSummary data={data} />
      <BudgetPanel data={data} />
      <RecentPanel data={data} />
    </Screen>
  );
}

/** Wide window: three areas side by side, each scrolling on its own. */
function Dashboard({ data }: { data: HomeData }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: t.bg }}>
      <Pane weight={1} divider>
        <AlertCards data={data} />
        <MonthSummary data={data} />
        <RecentPanel data={data} />
      </Pane>
      <Pane weight={1.1} divider>
        <NetAssetsPanel data={data} />
      </Pane>
      <Pane weight={1.25}>
        <BudgetPanel data={data} />
        <ChartsPanel data={data} />
      </Pane>
    </View>
  );
}

function Pane({ children, weight, divider }: { children: ReactNode; weight: number; divider?: boolean }) {
  const t = useTheme();
  return (
    <ScrollView
      style={{ flex: weight, minWidth: 0, borderRightWidth: divider ? 1 : 0, borderRightColor: t.border }}
      contentContainerStyle={{ padding: 20, paddingBottom: 110 }}>
      {children}
    </ScrollView>
  );
}
