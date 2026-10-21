import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Alert, Text, View } from 'react-native';
import { Button, Card, Divider, EmptyText, Fab, IconCircle, Loading, Row, Screen, SectionTitle } from '@/components/ui';
import { convertMinor, formatMinor } from '@/domain/money';
import { listAccounts } from '@/db/repositories/accounts';
import { listCurrencies } from '@/db/repositories/currencies';
import { loadSampleData } from '@/db/seed/sampleData';
import { useDbQuery } from '@/hooks/useDbQuery';
import { useTheme } from '@/theme';
import { BASE_CURRENCY } from '@/types';

export default function HomeScreen() {
  const t = useTheme();
  const db = useSQLiteContext();
  const { data } = useDbQuery(async (db) => ({
    accounts: await listAccounts(db),
    currencies: await listCurrencies(db),
  }));
  if (!data) return <Loading />;
  const { accounts, currencies } = data;

  if (accounts.length === 0) {
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

  const rate = (code: string) => currencies.find((c) => c.code === code)?.rate_to_base_e8 ?? 0;
  const netWorth = accounts.reduce((sum, a) => sum + convertMinor(a.balance_minor, rate(a.currency)), 0);
  const assets = accounts.filter((a) => a.type !== 'credit_card');
  const cards = accounts.filter((a) => a.type === 'credit_card');

  const renderAccount = (a: (typeof accounts)[number]) => (
    <View key={a.id}>
      <Row
        onPress={() => router.push(`/accounts/${a.id}`)}
        left={<IconCircle icon={a.icon} color={a.color} />}
        title={a.name}
        subtitle={a.type === 'credit_card' ? 'Credit card' : a.type === 'bank' ? 'Bank' : 'Cash'}
        right={
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: a.balance_minor < 0 ? t.expense : t.text, fontWeight: '700' }}>
              {formatMinor(a.balance_minor, a.currency)}
            </Text>
            {a.currency !== BASE_CURRENCY ? (
              <Text style={{ color: t.textMuted, fontSize: 12 }}>
                ≈ {formatMinor(convertMinor(a.balance_minor, rate(a.currency)), BASE_CURRENCY)}
              </Text>
            ) : null}
          </View>
        }
      />
      <Divider />
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
    <Screen>
      <Card style={{ padding: 20 }}>
        <Text style={{ color: t.textMuted, fontWeight: '600' }}>Net balance (all accounts)</Text>
        <Text style={{ color: netWorth < 0 ? t.expense : t.text, fontSize: 30, fontWeight: '800', marginTop: 4 }}>
          {formatMinor(netWorth, BASE_CURRENCY)}
        </Text>
        <Text style={{ color: t.textMuted, fontSize: 12, marginTop: 4 }}>
          Foreign accounts converted at your manual rate. Card balances are subtracted.
        </Text>
      </Card>
      <SectionTitle>Accounts</SectionTitle>
      <Card>{assets.map(renderAccount)}</Card>
      {cards.length > 0 ? (
        <>
          <SectionTitle>Credit cards (negative = owed)</SectionTitle>
          <Card>{cards.map(renderAccount)}</Card>
        </>
      ) : null}
    </Screen>
    <Fab onPress={() => router.push('/transaction/new')} />
    </View>
  );
}
