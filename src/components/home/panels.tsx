import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { Card, Divider, IconCircle, Row, SectionTitle } from '@/components/ui';
import { getBaseCurrency } from '@/domain/currencies';
import { convertMinor, formatMinor } from '@/domain/money';
import { useTheme } from '@/theme';
import type { HomeData } from './useHomeData';

/** Net balance across all accounts, then the accounts grouped as assets, cards and loans. */
export function NetAssetsPanel({ data }: { data: HomeData }) {
  const t = useTheme();
  const { accounts, currencies } = data;
  const fxRate = (code: string) => currencies.find((c) => c.code === code)?.rate_to_base_e8 ?? 0;
  const netWorth = accounts.reduce(
    (sum, a) => sum + convertMinor(a.balance_minor, fxRate(a.currency), a.currency, getBaseCurrency()),
    0,
  );
  const assets = accounts.filter((a) => a.type === 'cash' || a.type === 'bank');
  const cards = accounts.filter((a) => a.type === 'credit_card');
  const loans = accounts.filter((a) => a.type === 'loan');

  const renderAccount = (a: (typeof accounts)[number]) => (
    <View key={a.id}>
      <Row
        onPress={() => router.push(`/accounts/${a.id}`)}
        left={<IconCircle icon={a.icon} color={a.color} />}
        title={a.name}
        subtitle={
          a.type === 'credit_card' ? 'Credit card' : a.type === 'loan' ? 'Loan / liability' : a.type === 'bank' ? 'Bank' : 'Cash'
        }
        right={
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: a.balance_minor < 0 ? t.expense : t.text, fontWeight: '700' }}>
              {formatMinor(a.balance_minor, a.currency)}
            </Text>
            {a.currency !== getBaseCurrency() ? (
              <Text style={{ color: t.textMuted, fontSize: 12 }}>
                ≈ {formatMinor(convertMinor(a.balance_minor, fxRate(a.currency), a.currency, getBaseCurrency()), getBaseCurrency())}
              </Text>
            ) : null}
          </View>
        }
      />
      <Divider />
    </View>
  );

  return (
    <>
      <Card style={{ padding: 20 }}>
        <Text style={{ color: t.textMuted, fontWeight: '600' }}>Net assets (all accounts)</Text>
        <Text style={{ color: netWorth < 0 ? t.expense : t.text, fontSize: 30, fontWeight: '800', marginTop: 4 }}>
          {formatMinor(netWorth, getBaseCurrency())}
        </Text>
        <Text style={{ color: t.textMuted, fontSize: 12, marginTop: 4 }}>
          Foreign accounts converted at your manual rate. Amounts owed on cards and loans are subtracted.
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
      {loans.length > 0 ? (
        <>
          <SectionTitle>Loans & liabilities (negative = owed)</SectionTitle>
          <Card>{loans.map(renderAccount)}</Card>
        </>
      ) : null}
    </>
  );
}
