import { router } from 'expo-router';
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { BudgetBar, stateColor } from '@/components/BudgetBar';
import { DonutChart } from '@/components/charts/DonutChart';
import { MonthlyBars } from '@/components/charts/MonthlyBars';
import { TransactionRow } from '@/components/TransactionRow';
import { Card, Divider, EmptyText, IconCircle, Row, SectionTitle } from '@/components/ui';
import { groupSlices } from '@/domain/chartMath';
import { getBaseCurrency } from '@/domain/currencies';
import { convertMinor, formatMinor } from '@/domain/money';
import { formatPercent, savingsOf, savingsRatePercent } from '@/domain/summary';
import { monthLabel, prettyDate, today } from '@/lib/dates';
import { useTheme } from '@/theme';
import type { HomeData } from './useHomeData';

/** Bank items to review and recurring items waiting. */
export function AlertCards({ data }: { data: HomeData }) {
  const t = useTheme();
  const { inbox, pending } = data;
  return (
    <>
      {inbox > 0 ? (
        <Card>
          <Row
            onPress={() => router.push('/inbox')}
            left={<IconCircle icon="download" color="#F97316" />}
            title={`${inbox} bank item${inbox === 1 ? '' : 's'} to review`}
            subtitle="From statements or SMS. Approve to add them."
          />
        </Card>
      ) : null}
      {pending.length > 0 ? (
        <>
          <SectionTitle>Recurring items waiting</SectionTitle>
          <Card>
            {pending.slice(0, 3).map((p, i) => (
              <View key={p.id}>
                {i > 0 ? <Divider /> : null}
                <Row
                  onPress={() => router.push('/recurring')}
                  left={<IconCircle icon="alarm" color="#F59E0B" />}
                  title={p.name}
                  subtitle={`Due ${prettyDate(p.due_date)}`}
                  right={<Text style={{ color: t.text, fontWeight: '700' }}>{formatMinor(p.amount_minor, p.currency)}</Text>}
                />
              </View>
            ))}
            <Divider />
            <Row title={pending.length > 3 ? `Review all ${pending.length}` : 'Add or skip'} onPress={() => router.push('/recurring')} />
          </Card>
        </>
      ) : null}
    </>
  );
}

export function MonthSummary({ data }: { data: HomeData }) {
  const t = useTheme();
  const { month } = data;
  const savings = savingsOf(month.incomeMinor, month.expenseMinor);
  const rate = savingsRatePercent(month.incomeMinor, month.expenseMinor);
  return (
    <Card style={{ padding: 20 }}>
      <Text style={{ color: t.textMuted, fontWeight: '700', marginBottom: 14 }}>{monthLabel(today())}</Text>
      <View style={{ flexDirection: 'row' }}>
        <Stat label="Income" value={formatMinor(month.incomeMinor, getBaseCurrency())} color={t.income} />
        <Stat label="Expense" value={formatMinor(month.expenseMinor, getBaseCurrency())} color={t.expense} />
      </View>
      <View style={{ height: 1, backgroundColor: t.border, marginVertical: 14 }} />
      <View style={{ flexDirection: 'row' }}>
        <Stat label="Savings" value={formatMinor(savings, getBaseCurrency())} color={savings < 0 ? t.expense : t.text} />
        <Stat label="Savings rate" value={formatPercent(rate)} color={rate !== null && rate < 0 ? t.expense : t.text} />
      </View>
      <Text style={{ color: t.textMuted, fontSize: 12, marginTop: 12 }}>
        Transfers are not counted. Foreign-currency entries are in {getBaseCurrency()} at the rate used when entered.
      </Text>
    </Card>
  );
}

export function BudgetPanel({ data }: { data: HomeData }) {
  const t = useTheme();
  const { budget } = data;
  return (
    <>
      <SectionTitle>Budget this month</SectionTitle>
      <Card>
        {budget.rows.length === 0 ? (
          <Row title="No budget set for this month" subtitle="Tap to set up budgets" onPress={() => router.push('/budget')} />
        ) : (
          <View style={{ padding: 14, gap: 12 }}>
            <View>
              <Text style={{ color: t.textMuted, fontWeight: '600' }}>
                {budget.totals.remainingMinor >= 0 ? 'Remaining overall' : 'Over budget by'}
              </Text>
              <Text style={{ color: stateColor(budget.totals.state, t), fontSize: 22, fontWeight: '800', marginVertical: 2 }}>
                {formatMinor(Math.abs(budget.totals.remainingMinor), getBaseCurrency())}
              </Text>
              <BudgetBar pct={budget.totals.pct} state={budget.totals.state} height={10} />
              <Text style={{ color: t.textMuted, fontSize: 12, marginTop: 4 }}>
                {formatMinor(budget.totals.spentMinor, getBaseCurrency())} of{' '}
                {formatMinor(budget.totals.availableMinor, getBaseCurrency())} · {budget.totals.pct}% used
              </Text>
            </View>
            {[...budget.rows]
              .sort((a, b) => b.pct - a.pct)
              .slice(0, 5)
              .map((r) => (
                <View key={r.categoryId} style={{ gap: 4 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: t.text, fontWeight: '600' }}>{r.categoryName}</Text>
                    <Text style={{ color: stateColor(r.state, t), fontWeight: '700' }}>
                      {r.remainingMinor >= 0
                        ? `${formatMinor(r.remainingMinor, getBaseCurrency())} left`
                        : `Over by ${formatMinor(-r.remainingMinor, getBaseCurrency())}`}
                    </Text>
                  </View>
                  <BudgetBar pct={r.pct} state={r.state} height={6} />
                </View>
              ))}
          </View>
        )}
        {budget.rows.length > 0 ? (
          <>
            <Divider />
            <Row title="See all budgets" onPress={() => router.push('/budget')} />
          </>
        ) : null}
      </Card>
    </>
  );
}

export function RecentPanel({ data }: { data: HomeData }) {
  const { recent } = data;
  return (
    <>
      <SectionTitle>Recent transactions</SectionTitle>
      <Card>
        {recent.length === 0 ? <EmptyText>No transactions yet.</EmptyText> : null}
        {recent.map((r, i) => (
          <View key={r.id}>
            {i > 0 ? <Divider /> : null}
            <TransactionRow t={r} onPress={() => router.push(`/transaction/${r.id}`)} />
          </View>
        ))}
        {recent.length > 0 ? (
          <>
            <Divider />
            <Row title="See all transactions" onPress={() => router.push('/transactions')} />
          </>
        ) : null}
      </Card>
    </>
  );
}

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

const OTHER_GREY = '#94A3B8';

/** Where this month's money went, and the month-by-month trend. */
export function ChartsPanel({ data }: { data: HomeData }) {
  const t = useTheme();
  const { report } = data;
  const total = report.expenseBreakdown.reduce((s, b) => s + b.totalMinor, 0);
  const slices = useMemo(
    () =>
      groupSlices(
        report.expenseBreakdown.map((b) => ({ key: b.categoryId, label: b.name, value: b.totalMinor, color: b.color })),
        6,
        OTHER_GREY,
      ),
    [report],
  );
  const q = (n: number) => formatMinor(n, getBaseCurrency());
  return (
    <>
      <SectionTitle>Where the money went</SectionTitle>
      <Card style={{ padding: 16 }}>
        {total > 0 ? (
          <>
            <DonutChart slices={slices}>
              <Text style={{ color: t.textMuted, fontSize: 11, fontWeight: '600' }}>Total spent</Text>
              <Text style={{ color: t.text, fontWeight: '800', fontSize: 16 }} numberOfLines={1} adjustsFontSizeToFit>
                {q(total)}
              </Text>
            </DonutChart>
            <View style={{ marginTop: 16, gap: 8 }}>
              {slices.map((s) => (
                <View key={s.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: s.color }} />
                  <Text style={{ color: t.text, flex: 1 }} numberOfLines={1}>
                    {s.label}
                  </Text>
                  <Text style={{ color: t.textMuted, width: 48, textAlign: 'right' }}>{((s.value * 100) / total).toFixed(1)}%</Text>
                  <Text style={{ color: t.text, fontWeight: '700', minWidth: 90, textAlign: 'right' }}>{q(s.value)}</Text>
                </View>
              ))}
            </View>
          </>
        ) : (
          <EmptyText>No expenses this month yet.</EmptyText>
        )}
      </Card>
      <SectionTitle>Month by month</SectionTitle>
      <Card style={{ padding: 16 }}>
        <MonthlyBars data={report.series} selected={report.series.length - 1} onSelect={() => undefined} />
      </Card>
    </>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: t.textMuted, fontSize: 12, fontWeight: '600' }}>{label}</Text>
      <Text style={{ color, fontSize: 18, fontWeight: '800', marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}
