import dayjs from 'dayjs';
import { useState } from 'react';
import { LayoutChangeEvent, View } from 'react-native';
import Svg, { G, Line, Rect, Text as SvgText } from 'react-native-svg';
import { barHeight, compactAmount, niceMax } from '@/domain/chartMath';
import type { MonthPoint } from '@/db/repositories/reports';
import { useTheme } from '@/theme';

const AXIS_WIDTH = 38;
const BOTTOM = 22;
const TOP = 8;

/** Income (green) and expense (red) bars for each month. Tap a month to select it. */
export function MonthlyBars({
  data,
  selected,
  onSelect,
  height = 210,
}: {
  data: MonthPoint[];
  selected: number;
  onSelect: (index: number) => void;
  height?: number;
}) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const plotW = Math.max(0, width - AXIS_WIDTH);
  const plotH = height - TOP - BOTTOM;
  const max = niceMax(Math.max(0, ...data.flatMap((d) => [d.incomeMinor, d.expenseMinor])));
  const group = data.length ? plotW / data.length : 0;
  const barW = Math.max(3, Math.min(14, group * 0.34));
  const gridValues = [0, 1, 2, 3].map((i) => (max / 3) * i);
  const labelEvery = data.length > 14 ? 3 : data.length > 8 ? 2 : 1;

  return (
    <View onLayout={onLayout} style={{ width: '100%', height }}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          {gridValues.map((v) => {
            const y = TOP + plotH - barHeight(v, max, plotH);
            return (
              <G key={v}>
                <Line x1={AXIS_WIDTH} x2={width} y1={y} y2={y} stroke={t.border} strokeWidth={1} />
                <SvgText x={AXIS_WIDTH - 6} y={y + 4} fontSize={10} fill={t.textMuted} textAnchor="end">
                  {compactAmount(v)}
                </SvgText>
              </G>
            );
          })}
          {data.map((d, i) => {
            const x0 = AXIS_WIDTH + i * group;
            const cx = x0 + group / 2;
            const ih = barHeight(d.incomeMinor, max, plotH);
            const eh = barHeight(d.expenseMinor, max, plotH);
            const isSel = i === selected;
            const m = dayjs(`${d.month}-01`);
            return (
              <G key={d.month}>
                {isSel ? (
                  <Rect x={x0 + 1} y={TOP} width={group - 2} height={plotH} rx={6} fill={t.inputBg} />
                ) : null}
                <Rect x={cx - barW - 1} y={TOP + plotH - ih} width={barW} height={ih} rx={2} fill={t.income} />
                <Rect x={cx + 1} y={TOP + plotH - eh} width={barW} height={eh} rx={2} fill={t.expense} />
                {i % labelEvery === 0 || isSel ? (
                  <SvgText
                    x={cx}
                    y={height - 6}
                    fontSize={10}
                    fontWeight={isSel ? '700' : '400'}
                    fill={isSel ? t.text : t.textMuted}
                    textAnchor="middle">
                    {m.month() === 0 ? m.format("MMM 'YY") : m.format('MMM')}
                  </SvgText>
                ) : null}
                <Rect x={x0} y={0} width={group} height={height} fill="transparent" onPress={() => onSelect(i)} />
              </G>
            );
          })}
        </Svg>
      ) : null}
    </View>
  );
}
