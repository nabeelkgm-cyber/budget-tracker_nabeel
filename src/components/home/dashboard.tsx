import { Ionicons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import { router } from 'expo-router';
import { ReactNode, useMemo } from 'react';
import { Platform, Pressable, StyleProp, Text, View, ViewStyle } from 'react-native';
import { BudgetBar, stateColor } from '@/components/BudgetBar';
import { DonutChart } from '@/components/charts/DonutChart';
import { MonthlyBars } from '@/components/charts/MonthlyBars';
import { TransactionRow } from '@/components/TransactionRow';
import { Divider, EmptyText, IconCircle, Row } from '@/components/ui';
import { groupSlices } from '@/domain/chartMath';
import { getBaseCurrency } from '@/domain/currencies';
import {
  SAVINGS_TARGET_PCT,
  averageMonthlySaving,
  monthProgress,
  netBreakdown,
  paceOf,
} from '@/domain/dashboard';
import type { PaceStatus } from '@/domain/dashboard';
import { convertMinor, formatMinor } from '@/domain/money';
import { percentChange, periodLabel, previousPeriod } from '@/domain/reportPeriod';
import { formatPercent, savingsOf, savingsRatePercent } from '@/domain/summary';
import { prettyDate, today } from '@/lib/dates';
import { currentMonth } from '@/domain/budget';
import { Palette, useTheme } from '@/theme';
import type { HomeData } from './useHomeData';

const GAP = 16;
const OTHER_GREY = '#94A3B8';
const q = (n: number) => formatMinor(n, getBaseCurrency());

const SHADOW =
  Platform.OS === 'web'
    ? ({ boxShadow: '0 1px 2px rgba(15,23,42,0.06), 0 6px 20px rgba(15,23,42,0.05)' } as object)
    : { shadowColor: '#0F172A', shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 };

/** A white card with a title bar. */
function Panel({
  title,
  right,
  children,
  style,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <View style={[{ backgroundColor: t.card, borderRadius: 18, borderWidth: 1, borderColor: t.border, padding: 18, flex: 1 }, SHADOW, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <Text style={{ color: t.text, fontSize: 16, fontWeight: '800' }}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

const linkText = (t: Palette) => ({ color: t.primary, fontWeight: '700' as const, fontSize: 13 });

function Delta({ pct, goodWhenUp, label }: { pct: number | null; goodWhenUp: boolean; label: string }) {
  const t = useTheme();
  if (pct === null) return <Text style={{ color: t.textMuted, fontSize: 12, marginTop: 6 }}>No earlier month to compare</Text>;
  const up = pct >= 0;
  const color = pct === 0 ? t.textMuted : up === goodWhenUp ? t.income : t.expense;
  return (
    <Text style={{ color, fontSize: 12, fontWeight: '700', marginTop: 6 }}>
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}% <Text style={{ color: t.textMuted, fontWeight: '500' }}>vs {label}</Text>
    </Text>
  );
}

function Kpi({
  label,
  value,
  icon,
  tint,
  hero,
  children,
  valueColor,
}: {
  label: string;
  value: string;
  icon: string;
  tint: string;
  hero?: boolean;
  children?: ReactNode;
  valueColor?: string;
}) {
  const t = useTheme();
  const bg = hero ? (t.isDark ? '#1E1B4B' : '#312E81') : t.card;
  const fg = hero ? '#FFFFFF' : valueColor ?? t.text;
  const muted = hero ? 'rgba(255,255,255,0.72)' : t.textMuted;
  return (
    <View
      style={[
        { flexGrow: 1, flexBasis: 150, minWidth: 150, backgroundColor: bg, borderRadius: 18, padding: 18, borderWidth: hero ? 0 : 1, borderColor: t.border },
        SHADOW,
      ]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: hero ? 'rgba(255,255,255,0.16)' : `${tint}22`, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon as never} size={18} color={hero ? '#FFFFFF' : tint} />
        </View>
        <Text style={{ color: muted, fontSize: 13, fontWeight: '700' }}>{label}</Text>
      </View>
      <Text style={{ color: fg, fontSize: 26, fontWeight: '800' }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {typeof children === 'string' ? <Text style={{ color: muted, fontSize: 12, marginTop: 6 }}>{children}</Text> : children}
    </View>
  );
}

export function MonthBar({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const t = useTheme();
  const shift = (d: number) => onChange(dayjs(`${month}-01`).add(d, 'month').format('YYYY-MM'));
  const btn = (name: string, d: number, label: string) => (
    <Pressable
      onPress={() => shift(d)}
      accessibilityLabel={label}
      hitSlop={8}
      style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.inputBg, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={name as never} size={18} color={t.text as string} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {btn('chevron-back', -1, 'Previous month')}
      <Text style={{ color: t.text, fontSize: 18, fontWeight: '800', minWidth: 150, textAlign: 'center' }}>
        {dayjs(`${month}-01`).format('MMMM YYYY')}
      </Text>
      {btn('chevron-forward', 1, 'Next month')}
      {month !== currentMonth() ? (
        <Pressable onPress={() => onChange(currentMonth())} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: t.primary }}>
          <Text style={{ color: t.onPrimary, fontWeight: '700', fontSize: 13 }}>This month</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const STATUS: Record<Exclude<PaceStatus, 'none'>, { label: string; color: (t: Palette) => string }> = {
  'on-track': { label: 'On track', color: (t) => t.income },
  tight: { label: 'Getting tight', color: () => '#F59E0B' },
  over: { label: 'Over budget', color: (t) => t.expense },
};

function BudgetPlan({ data, month }: { data: HomeData; month: string }) {
  const t = useTheme();
  const { budget } = data;
  const progress = monthProgress(month, today());
  const tot = budget.totals;
  const pace = paceOf(tot.availableMinor, tot.spentMinor, progress);
  const rows = [...budget.rows].sort((a, b) => b.pct - a.pct).slice(0, 8);

  if (budget.rows.length === 0) {
    return (
      <Panel title="Budget plan">
        <EmptyText>No budget set for this month yet.</EmptyText>
        <Pressable onPress={() => router.push('/budget')} style={{ alignSelf: 'center', marginTop: 4 }}>
          <Text style={linkText(t)}>Set up this month's budget →</Text>
        </Pressable>
      </Panel>
    );
  }
  const st = pace.status === 'none' ? null : STATUS[pace.status];
  const stat = (label: string, value: string, color?: string) => (
    <View style={{ flex: 1, minWidth: 90 }}>
      <Text style={{ color: t.textMuted, fontSize: 12, fontWeight: '600' }}>{label}</Text>
      <Text style={{ color: color ?? t.text, fontSize: 18, fontWeight: '800', marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
  return (
    <Panel
      title="Budget plan"
      right={
        <Pressable onPress={() => router.push('/budget')}>
          <Text style={linkText(t)}>All budgets →</Text>
        </Pressable>
      }>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        {stat('Budget', q(tot.availableMinor))}
        {stat('Spent', q(tot.spentMinor))}
        {stat(tot.remainingMinor >= 0 ? 'Left to spend' : 'Over by', q(Math.abs(tot.remainingMinor)), stateColor(tot.state, t))}
      </View>

      <View style={{ marginBottom: 6 }}>
        <View style={{ height: 14, borderRadius: 7, backgroundColor: t.inputBg, overflow: 'hidden' }}>
          <View
            style={{
              width: `${Math.max(0, Math.min(100, tot.pct))}%`,
              height: '100%',
              borderRadius: 7,
              backgroundColor: stateColor(tot.state, t),
            }}
          />
        </View>
        {progress.isCurrent ? (
          <View
            style={{
              position: 'absolute',
              left: `${progress.pctElapsed}%`,
              top: -4,
              width: 3,
              height: 22,
              borderRadius: 2,
              backgroundColor: t.text,
            }}
          />
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Text style={{ color: t.textMuted, fontSize: 12, flex: 1, minWidth: 160 }}>
          {progress.isCurrent
            ? `${tot.pct}% of the budget used · ${progress.pctElapsed}% of the month gone (marker)`
            : `${tot.pct}% of the budget used`}
        </Text>
        {st && progress.isCurrent ? (
          <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: `${st.color(t)}22` }}>
            <Text style={{ color: st.color(t), fontWeight: '800', fontSize: 12 }}>{st.label}</Text>
          </View>
        ) : null}
      </View>

      {progress.isCurrent ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
          <View style={{ flex: 1, minWidth: 170, backgroundColor: t.inputBg, borderRadius: 14, padding: 12 }}>
            <Text style={{ color: t.textMuted, fontSize: 12, fontWeight: '600' }}>Safe to spend per day</Text>
            <Text style={{ color: t.text, fontSize: 18, fontWeight: '800', marginTop: 2 }}>{q(pace.safePerDayMinor)}</Text>
            <Text style={{ color: t.textMuted, fontSize: 11, marginTop: 2 }}>for the next {progress.daysLeft} days</Text>
          </View>
          <View style={{ flex: 1, minWidth: 170, backgroundColor: t.inputBg, borderRadius: 14, padding: 12 }}>
            <Text style={{ color: t.textMuted, fontSize: 12, fontWeight: '600' }}>Projected month-end spend</Text>
            <Text style={{ color: pace.projectedMinor > tot.availableMinor ? t.expense : t.text, fontSize: 18, fontWeight: '800', marginTop: 2 }}>
              {q(pace.projectedMinor)}
            </Text>
            <Text style={{ color: t.textMuted, fontSize: 11, marginTop: 2 }}>if you keep this pace</Text>
          </View>
        </View>
      ) : null}

      <View style={{ gap: 12 }}>
        {rows.map((r) => (
          <View key={r.categoryId} style={{ gap: 5 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: t.text, fontWeight: '700', flex: 1 }} numberOfLines={1}>
                {r.categoryName}
              </Text>
              <Text style={{ color: t.textMuted, fontSize: 12 }}>
                {q(r.spentMinor)} / {q(r.availableMinor)}
              </Text>
              <Text style={{ color: stateColor(r.state, t), fontWeight: '800', width: 46, textAlign: 'right' }}>{r.pct}%</Text>
            </View>
            <BudgetBar pct={r.pct} state={r.state} height={7} />
          </View>
        ))}
      </View>
    </Panel>
  );
}

function SpendingBreakdown({ data }: { data: HomeData }) {
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
  return (
    <Panel title="Where the money went">
      {total > 0 ? (
        <>
          <DonutChart slices={slices} size={176} thickness={26}>
            <Text style={{ color: t.textMuted, fontSize: 11, fontWeight: '600' }}>Total spent</Text>
            <Text style={{ color: t.text, fontWeight: '800', fontSize: 16 }} numberOfLines={1} adjustsFontSizeToFit>
              {q(total)}
            </Text>
          </DonutChart>
          <View style={{ marginTop: 16, gap: 9 }}>
            {slices.map((s) => (
              <View key={s.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: s.color }} />
                <Text style={{ color: t.text, flex: 1 }} numberOfLines={1}>
                  {s.label}
                </Text>
                <Text style={{ color: t.textMuted, width: 46, textAlign: 'right', fontSize: 12 }}>{((s.value * 100) / total).toFixed(0)}%</Text>
                <Text style={{ color: t.text, fontWeight: '700', minWidth: 86, textAlign: 'right' }}>{q(s.value)}</Text>
              </View>
            ))}
          </View>
        </>
      ) : (
        <EmptyText>No expenses in this month yet.</EmptyText>
      )}
    </Panel>
  );
}

function Trend({ data }: { data: HomeData }) {
  const t = useTheme();
  const { report } = data;
  const avg = averageMonthlySaving(report.series);
  const legend = (color: string, label: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: color }} />
      <Text style={{ color: t.textMuted, fontSize: 12 }}>{label}</Text>
    </View>
  );
  return (
    <Panel
      title="Income vs expense"
      right={
        <View style={{ flexDirection: 'row', gap: 12 }}>
          {legend(t.income, 'Income')}
          {legend(t.expense, 'Expense')}
        </View>
      }>
      <MonthlyBars data={report.series} selected={report.series.length - 1} onSelect={() => undefined} />
      {avg !== null ? (
        <Text style={{ color: t.textMuted, marginTop: 12, fontSize: 13 }}>
          Average saved per month:{' '}
          <Text style={{ color: avg < 0 ? t.expense : t.income, fontWeight: '800' }}>{q(avg)}</Text>
        </Text>
      ) : null}
    </Panel>
  );
}

function AccountsSummary({ data }: { data: HomeData }) {
  const t = useTheme();
  const { accounts, currencies } = data;
  const fx = (code: string) => currencies.find((c) => c.code === code)?.rate_to_base_e8 ?? 0;
  const base = getBaseCurrency();
  const net = netBreakdown(accounts, (amt, cur) => convertMinor(amt, fx(cur), cur, base));
  const total = net.assetsMinor + net.cardsOwedMinor + net.loansOwedMinor;
  const parts: { label: string; value: number; color: string }[] = [
    { label: 'Cash & bank', value: net.assetsMinor, color: t.income },
    { label: 'Credit cards owed', value: net.cardsOwedMinor, color: '#F59E0B' },
    { label: 'Loans owed', value: net.loansOwedMinor, color: t.expense },
  ];
  return (
    <Panel
      title="Net assets"
      right={
        <Pressable onPress={() => router.push('/net-assets')}>
          <Text style={linkText(t)}>All accounts →</Text>
        </Pressable>
      }>
      <Text style={{ color: net.netMinor < 0 ? t.expense : t.text, fontSize: 28, fontWeight: '800' }} numberOfLines={1} adjustsFontSizeToFit>
        {q(net.netMinor)}
      </Text>
      <Text style={{ color: t.textMuted, fontSize: 12, marginTop: 2, marginBottom: 14 }}>What you have minus what you owe</Text>
      {total > 0 ? (
        <View style={{ flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: t.inputBg, marginBottom: 14 }}>
          {parts
            .filter((p) => p.value > 0)
            .map((p) => (
              <View key={p.label} style={{ flex: p.value, backgroundColor: p.color }} />
            ))}
        </View>
      ) : null}
      <View style={{ gap: 10 }}>
        {parts.map((p) => (
          <View key={p.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: p.color }} />
            <Text style={{ color: t.text, flex: 1 }}>{p.label}</Text>
            <Text style={{ color: t.text, fontWeight: '700' }}>{q(p.value)}</Text>
          </View>
        ))}
      </View>
    </Panel>
  );
}

function RecentList({ data }: { data: HomeData }) {
  const t = useTheme();
  const { recent } = data;
  return (
    <Panel
      title="Recent transactions"
      style={{ paddingHorizontal: 6 }}
      right={
        <Pressable onPress={() => router.push('/transactions')} style={{ paddingRight: 12 }}>
          <Text style={linkText(t)}>See all →</Text>
        </Pressable>
      }>
      {recent.length === 0 ? <EmptyText>No transactions yet.</EmptyText> : null}
      {recent.map((r, i) => (
        <View key={r.id}>
          {i > 0 ? <Divider /> : null}
          <TransactionRow t={r} onPress={() => router.push(`/transaction/${r.id}`)} />
        </View>
      ))}
    </Panel>
  );
}

function Attention({ data }: { data: HomeData }) {
  const t = useTheme();
  const { inbox, pending } = data;
  const nothing = inbox === 0 && pending.length === 0;
  return (
    <Panel title="Needs your attention" style={{ paddingHorizontal: 6 }}>
      {nothing ? (
        <View style={{ alignItems: 'center', paddingVertical: 18, gap: 8 }}>
          <Ionicons name="checkmark-circle" size={34} color={t.income as string} />
          <Text style={{ color: t.textMuted }}>You are all caught up.</Text>
        </View>
      ) : null}
      {inbox > 0 ? (
        <Row
          onPress={() => router.push('/inbox')}
          left={<IconCircle icon="download" color="#F97316" />}
          title={`${inbox} bank item${inbox === 1 ? '' : 's'} to review`}
          subtitle="From statements or SMS. Approve to add them."
        />
      ) : null}
      {inbox > 0 && pending.length > 0 ? <Divider /> : null}
      {pending.slice(0, 4).map((p, i) => (
        <View key={p.id}>
          {i > 0 ? <Divider /> : null}
          <Row
            onPress={() => router.push('/recurring')}
            left={<IconCircle icon="alarm" color="#F59E0B" />}
            title={p.name}
            subtitle={`Due ${prettyDate(p.due_date)} · tap to add or skip`}
            right={<Text style={{ color: t.text, fontWeight: '700' }}>{formatMinor(p.amount_minor, p.currency)}</Text>}
          />
        </View>
      ))}
    </Panel>
  );
}

/** The whole monthly dashboard: key figures, the budget plan, charts, accounts and what needs attention. */
export function FinanceDashboard({ data, month, wide }: { data: HomeData; month: string; wide: boolean }) {
  const t = useTheme();
  const { totals, report } = data;
  const savings = savingsOf(totals.incomeMinor, totals.expenseMinor);
  const rate = savingsRatePercent(totals.incomeMinor, totals.expenseMinor);
  const period = { mode: 'month' as const, month };
  const prevLabel = periodLabel(previousPeriod(period));
  const fx = (code: string) => data.currencies.find((c) => c.code === code)?.rate_to_base_e8 ?? 0;
  const base = getBaseCurrency();
  const net = netBreakdown(data.accounts, (amt, cur) => convertMinor(amt, fx(cur), cur, base));
  const ratePct = rate ?? 0;

  const cols = (weights: number[], nodes: ReactNode[]) =>
    wide ? (
      <View style={{ flexDirection: 'row', gap: GAP, alignItems: 'stretch' }}>
        {nodes.map((n, i) => (
          <View key={i} style={{ flex: weights[i], minWidth: 0 }}>
            {n}
          </View>
        ))}
      </View>
    ) : (
      <View style={{ gap: GAP }}>{nodes}</View>
    );

  return (
    <View style={{ gap: GAP }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
        <Kpi label="Net assets" value={q(net.netMinor)} icon="wallet" tint="#6366F1" hero>
          {`Own ${q(net.assetsMinor)} · Owe ${q(net.cardsOwedMinor + net.loansOwedMinor)}`}
        </Kpi>
        <Kpi label="Income" value={q(totals.incomeMinor)} icon="arrow-down-circle" tint={t.income} valueColor={t.income}>
          <Delta pct={percentChange(totals.incomeMinor, report.previous.incomeMinor)} goodWhenUp label={prevLabel} />
        </Kpi>
        <Kpi label="Expenses" value={q(totals.expenseMinor)} icon="arrow-up-circle" tint={t.expense} valueColor={t.expense}>
          <Delta pct={percentChange(totals.expenseMinor, report.previous.expenseMinor)} goodWhenUp={false} label={prevLabel} />
        </Kpi>
        <Kpi label="Savings" value={q(savings)} icon="trending-up" tint="#14B8A6" valueColor={savings < 0 ? t.expense : t.text}>
          <View style={{ marginTop: 8 }}>
            <BudgetBar pct={Math.min(100, Math.max(0, (ratePct * 100) / SAVINGS_TARGET_PCT))} state={ratePct >= SAVINGS_TARGET_PCT ? 'ok' : 'warn'} height={6} />
            <Text style={{ color: t.textMuted, fontSize: 12, marginTop: 6 }}>
              Savings rate {formatPercent(rate)} · target {SAVINGS_TARGET_PCT}%
            </Text>
          </View>
        </Kpi>
      </View>

      {cols([1.5, 1], [<BudgetPlan key="b" data={data} month={month} />, <SpendingBreakdown key="s" data={data} />])}
      {cols([1.5, 1], [<Trend key="t" data={data} />, <AccountsSummary key="a" data={data} />])}
      {cols([1.5, 1], [<RecentList key="r" data={data} />, <Attention key="n" data={data} />])}
    </View>
  );
}
