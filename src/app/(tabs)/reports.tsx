import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@/components/DatePicker';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { DonutChart } from '@/components/charts/DonutChart';
import { MonthlyBars } from '@/components/charts/MonthlyBars';
import { EMPTY_REPORT_FILTER, ReportFilterSheet, ReportFilterState } from '@/components/ReportFilterSheet';
import { Card, Chip, ChipRow, EmptyText, Loading, Screen, Segmented } from '@/components/ui';
import { listAccounts } from '@/db/repositories/accounts';
import { listCategories } from '@/db/repositories/categories';
import { getReport } from '@/db/repositories/reports';
import { groupSlices } from '@/domain/chartMath';
import { formatMinor } from '@/domain/money';
import { percentChange, periodLabel, previousPeriod, ReportPeriod, shiftPeriod } from '@/domain/reportPeriod';
import { formatPercent, savingsOf, savingsRatePercent } from '@/domain/summary';
import { useDbQuery } from '@/hooks/useDbQuery';
import { DATE_FMT, fromLocalDate, toLocalDate, today } from '@/lib/dates';
import { useTheme } from '@/theme';
import { getBaseCurrency } from '@/domain/currencies';

const q = (n: number) => formatMinor(n, getBaseCurrency());
const MAX_SLICES = 8;
const OTHER_GREY = '#94A3B8';

type Mode = ReportPeriod['mode'];

export default function ReportsScreen() {
  const t = useTheme();
  const [period, setPeriod] = useState<ReportPeriod>({ mode: 'month', month: dayjs().format('YYYY-MM') });
  const [filter, setFilter] = useState<ReportFilterState>(EMPTY_REPORT_FILTER);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pieKind, setPieKind] = useState<'expense' | 'income'>('expense');
  const [picked, setPicked] = useState<number | null>(null);

  const key = JSON.stringify([period, filter]);
  const { data } = useDbQuery(
    async (db) => ({
      report: await getReport(db, period, {
        accountId: filter.accountId ?? undefined,
        categoryId: filter.categoryId ?? undefined,
      }),
      accounts: await listAccounts(db, { includeArchived: true }),
      categories: await listCategories(db, { includeArchived: true }),
    }),
    [key],
  );

  const changeMode = (mode: Mode) => {
    setPicked(null);
    if (mode === 'month') setPeriod({ mode, month: dayjs().format('YYYY-MM') });
    else if (mode === 'year') setPeriod({ mode, year: dayjs().year() });
    else setPeriod({ mode, from: dayjs().startOf('month').format(DATE_FMT), to: today() });
  };
  const shift = (d: 1 | -1) => {
    setPicked(null);
    setPeriod(shiftPeriod(period, d));
  };

  const accountName = data?.accounts.find((a) => a.id === filter.accountId)?.name;
  const categoryName = data?.categories.find((c) => c.id === filter.categoryId)?.name;
  const activeFilters = (filter.accountId ? 1 : 0) + (filter.categoryId ? 1 : 0);

  const breakdown = data ? (pieKind === 'expense' ? data.report.expenseBreakdown : data.report.incomeBreakdown) : [];
  const total = breakdown.reduce((s, b) => s + b.totalMinor, 0);
  const slices = useMemo(
    () =>
      groupSlices(
        breakdown.map((b) => ({ key: b.categoryId, label: b.name, value: b.totalMinor, color: b.color })),
        MAX_SLICES,
        OTHER_GREY,
      ),
    [breakdown],
  );
  const shownKeys = new Set(slices.map((s) => s.key));

  if (!data) return <Loading />;
  const { report } = data;
  const savings = savingsOf(report.totals.incomeMinor, report.totals.expenseMinor);
  const rate = savingsRatePercent(report.totals.incomeMinor, report.totals.expenseMinor);
  const prevLabel = period.mode === 'range' ? 'previous period' : periodLabel(previousPeriod(period));
  const selectedIndex = picked ?? report.series.length - 1;
  const sel = report.series[Math.min(selectedIndex, report.series.length - 1)];
  const hasAny = report.totals.count > 0 || report.series.some((s) => s.incomeMinor || s.expenseMinor);

  const delta = (current: number, previous: number, goodWhenUp: boolean) => {
    const pct = percentChange(current, previous);
    if (pct === null) return null;
    const up = pct >= 0;
    const good = up === goodWhenUp;
    return (
      <Text style={{ color: pct === 0 ? t.textMuted : good ? t.income : t.expense, fontSize: 11, marginTop: 2 }}>
        {up ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}% vs {prevLabel}
      </Text>
    );
  };

  const stat = (label: string, value: string, color: string, extra?: React.ReactNode) => (
    <View style={{ flex: 1 }}>
      <Text style={{ color: t.textMuted, fontSize: 12, fontWeight: '600' }}>{label}</Text>
      <Text style={{ color, fontSize: 18, fontWeight: '800', marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {extra}
    </View>
  );

  return (
    <Screen>
      <Segmented
        value={period.mode}
        onChange={changeMode}
        options={[
          { value: 'month', label: 'Month' },
          { value: 'year', label: 'Year' },
          { value: 'range', label: 'Custom' },
        ]}
      />

      {period.mode === 'range' ? (
        <View style={{ gap: 8, marginBottom: 12 }}>
          {(['from', 'to'] as const).map((k) => (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: t.text, fontWeight: '600' }}>{k === 'from' ? 'From' : 'To'}</Text>
              <DateTimePicker
                value={toLocalDate(period[k])}
                mode="date"
                display="compact"
                onChange={(_, d) => {
                  if (!d) return;
                  setPicked(null);
                  setPeriod({ ...period, [k]: fromLocalDate(d) });
                }}
              />
            </View>
          ))}
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <Pressable onPress={() => shift(-1)} hitSlop={14} accessibilityLabel="Previous">
            <Ionicons name="chevron-back" size={26} color={t.primary as string} />
          </Pressable>
          <Text style={{ color: t.text, fontSize: 18, fontWeight: '800' }}>{periodLabel(period)}</Text>
          <Pressable onPress={() => shift(1)} hitSlop={14} accessibilityLabel="Next">
            <Ionicons name="chevron-forward" size={26} color={t.primary as string} />
          </Pressable>
        </View>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <Pressable
          onPress={() => setSheetOpen(true)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 20,
            backgroundColor: activeFilters ? t.primary : t.inputBg,
          }}>
          <Ionicons name="options" size={16} color={(activeFilters ? t.onPrimary : t.text) as string} />
          <Text style={{ color: activeFilters ? t.onPrimary : t.text, fontWeight: '600' }}>Filters{activeFilters ? ` (${activeFilters})` : ''}</Text>
        </Pressable>
        {accountName ? <Chip label={accountName} selected onPress={() => setFilter({ ...filter, accountId: null })} /> : null}
        {categoryName ? <Chip label={categoryName} selected onPress={() => setFilter({ ...filter, categoryId: null })} /> : null}
      </View>

      <Card style={{ padding: 18 }}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          {stat('Income', q(report.totals.incomeMinor), t.income, delta(report.totals.incomeMinor, report.previous.incomeMinor, true))}
          {stat('Expense', q(report.totals.expenseMinor), t.expense, delta(report.totals.expenseMinor, report.previous.expenseMinor, false))}
        </View>
        <View style={{ height: 1, backgroundColor: t.border, marginVertical: 14 }} />
        <View style={{ flexDirection: 'row', gap: 12 }}>
          {stat('Savings', q(savings), savings < 0 ? t.expense : t.text)}
          {stat('Savings rate', formatPercent(rate), rate !== null && rate < 0 ? t.expense : t.text)}
        </View>
      </Card>

      {!hasAny ? (
        <EmptyText>Nothing recorded for this period and filter.</EmptyText>
      ) : (
        <>
          <Card style={{ padding: 16 }}>
            <Text style={{ color: t.text, fontWeight: '800', fontSize: 16, marginBottom: 10 }}>
              {pieKind === 'expense' ? 'Where the money went' : 'Where the money came from'}
            </Text>
            <Segmented
              value={pieKind}
              onChange={setPieKind}
              options={[
                { value: 'expense', label: 'Expense', color: t.expense },
                { value: 'income', label: 'Income', color: t.income },
              ]}
            />
            {total > 0 ? (
              <>
                <DonutChart slices={slices}>
                  <Text style={{ color: t.textMuted, fontSize: 11, fontWeight: '600' }}>
                    {pieKind === 'expense' ? 'Total spent' : 'Total income'}
                  </Text>
                  <Text style={{ color: t.text, fontWeight: '800', fontSize: 16 }} numberOfLines={1} adjustsFontSizeToFit>
                    {q(total)}
                  </Text>
                </DonutChart>
                <View style={{ marginTop: 16, gap: 10 }}>
                  {breakdown.map((b) => (
                    <View key={b.categoryId} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: 6,
                          backgroundColor: shownKeys.has(b.categoryId) ? b.color : OTHER_GREY,
                        }}
                      />
                      <Text style={{ color: t.text, flex: 1 }} numberOfLines={1}>
                        {b.name}
                      </Text>
                      <Text style={{ color: t.textMuted, width: 50, textAlign: 'right' }}>
                        {((b.totalMinor * 100) / total).toFixed(1)}%
                      </Text>
                      <Text style={{ color: t.text, fontWeight: '700', minWidth: 96, textAlign: 'right' }}>{q(b.totalMinor)}</Text>
                    </View>
                  ))}
                </View>
              </>
            ) : (
              <EmptyText>No {pieKind} in this period.</EmptyText>
            )}
          </Card>

          <Card style={{ padding: 16 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text style={{ color: t.text, fontWeight: '800', fontSize: 16 }}>Month by month</Text>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Legend color={t.income} label="Income" />
                <Legend color={t.expense} label="Expense" />
              </View>
            </View>
            <MonthlyBars data={report.series} selected={selectedIndex} onSelect={setPicked} />
            {sel ? (
              <View style={{ marginTop: 10, gap: 2 }}>
                <Text style={{ color: t.text, fontWeight: '700' }}>{dayjs(`${sel.month}-01`).format('MMMM YYYY')}</Text>
                <Text style={{ color: t.textMuted }}>
                  Income <Text style={{ color: t.income, fontWeight: '700' }}>{q(sel.incomeMinor)}</Text> · Expense{' '}
                  <Text style={{ color: t.expense, fontWeight: '700' }}>{q(sel.expenseMinor)}</Text>
                </Text>
                <Text style={{ color: t.textMuted }}>
                  Saved{' '}
                  <Text style={{ color: sel.incomeMinor - sel.expenseMinor < 0 ? t.expense : t.text, fontWeight: '700' }}>
                    {q(sel.incomeMinor - sel.expenseMinor)}
                  </Text>{' '}
                  ({formatPercent(savingsRatePercent(sel.incomeMinor, sel.expenseMinor))})
                </Text>
              </View>
            ) : null}
          </Card>
        </>
      )}

      <Text style={{ color: t.textMuted, fontSize: 12 }}>
        All amounts are in {getBaseCurrency()}, using the rate saved on each entry. Transfers are not counted as income or
        expense.
      </Text>

      <ReportFilterSheet
        visible={sheetOpen}
        value={filter}
        onChange={setFilter}
        onClose={() => setSheetOpen(false)}
        accounts={data.accounts.filter((a) => !a.is_archived || a.id === filter.accountId)}
        categories={data.categories.filter((c) => !c.is_archived || c.id === filter.categoryId)}
      />
    </Screen>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: color }} />
      <Text style={{ color: t.textMuted, fontSize: 12 }}>{label}</Text>
    </View>
  );
}
