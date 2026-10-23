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
          Welcome! To start, add an account (cash, bank or credit card). After that, use the round + button at the
          bottom right to add expenses, income and transfers.
        </EmptyText>
        <Button title="1. Add an account" onPress={() => router.push('/accounts/new')} />
        <Button
          title="Or try it with sample data"
          kind="secondary"
          onPress={() => loadSampleData(db).catch((e) => Alert.alert('Failed', String(e)))}
        />
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
