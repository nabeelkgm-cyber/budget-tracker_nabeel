import dayjs from 'dayjs';
import { barHeight, compactAmount, donutSegments, groupSlices, niceMax } from '@/domain/chartMath';
import { percentChange, periodBounds, periodLabel, previousPeriod, seriesMonths, shiftPeriod } from '@/domain/reportPeriod';

describe('donutSegments', () => {
  const C = 2 * Math.PI * 50;
  it('shares the ring in proportion, with offsets that follow on from each other', () => {
    const s = donutSegments([50, 30, 20], 50, 0);
    expect(s[0]).toEqual({ length: C * 0.5, offset: 0 });
    expect(s[1].offset).toBeCloseTo(C * 0.5);
    expect(s[2].offset).toBeCloseTo(C * 0.8);
    expect(s.reduce((a, x) => a + x.length, 0)).toBeCloseTo(C);
  });
  it('leaves a small gap between slices but none for a single slice', () => {
    const two = donutSegments([1, 1], 50, 2);
    expect(two[0].length).toBeCloseTo(C / 2 - 2);
    expect(donutSegments([5], 50, 2)[0].length).toBeCloseTo(C);
  });
  it('handles empty and zero values', () => {
    expect(donutSegments([], 50)).toEqual([]);
    expect(donutSegments([0, 0], 50)).toEqual([{ length: 0, offset: 0 }, { length: 0, offset: 0 }]);
    expect(donutSegments([0, 10], 50)[0].length).toBe(0);
  });
});

describe('niceMax', () => {
  it.each([
    [7300, 8000],
    [120000, 150000],
    [1, 1],
    [0.4, 0.4],
    [9100, 10000],
    [2300, 2500],
    [3100, 4000],
  ])('%p -> %p', (v, expected) => expect(niceMax(v)).toBe(expected));
  it('is never below the value and handles zero', () => {
    for (const v of [1, 99, 101, 4999, 5001, 123456, 98765432]) expect(niceMax(v)).toBeGreaterThanOrEqual(v);
    expect(niceMax(0)).toBe(1);
  });
});

describe('compactAmount', () => {
  it.each([
    [950, '10'],
    [12000, '120'],
    [125000, '1.3k'],
    [100000, '1k'],
    [250000000, '2.5M'],
    [-125000, '-1.3k'],
    [0, '0'],
  ])('%p minor -> %p', (v, expected) => expect(compactAmount(v)).toBe(expected));
});

describe('barHeight', () => {
  it('scales within the plot and clamps', () => {
    expect(barHeight(50, 100, 200)).toBe(100);
    expect(barHeight(150, 100, 200)).toBe(200);
    expect(barHeight(-5, 100, 200)).toBe(0);
    expect(barHeight(5, 0, 200)).toBe(0);
  });
});

describe('groupSlices', () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, label: `L${i}`, value: (i + 1) * 10, color: '#000' }));
  it('sorts biggest first and keeps all when few', () => {
    const g = groupSlices(mk(3), 5, '#999');
    expect(g.map((s) => s.value)).toEqual([30, 20, 10]);
  });
  it('merges the tail into Other without losing any value', () => {
    const g = groupSlices(mk(10), 6, '#999');
    expect(g).toHaveLength(6);
    expect(g[5]).toMatchObject({ key: '__other', label: 'Other (5)', value: 10 + 20 + 30 + 40 + 50 });
    expect(g.reduce((s, x) => s + x.value, 0)).toBe(550);
  });
  it('drops zero-value slices', () => {
    expect(groupSlices([{ key: 'a', label: 'a', value: 0, color: '#000' }], 5, '#999')).toEqual([]);
  });
});

describe('report periods', () => {
  it('bounds', () => {
    expect(periodBounds({ mode: 'month', month: '2026-02' })).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodBounds({ mode: 'year', year: 2026 })).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(periodBounds({ mode: 'range', from: '2026-03-10', to: '2026-03-01' })).toEqual({ from: '2026-03-01', to: '2026-03-10' });
  });
  it('previous period of the same length', () => {
    expect(previousPeriod({ mode: 'month', month: '2026-01' })).toEqual({ mode: 'month', month: '2025-12' });
    expect(previousPeriod({ mode: 'year', year: 2026 })).toEqual({ mode: 'year', year: 2025 });
    expect(previousPeriod({ mode: 'range', from: '2026-03-01', to: '2026-03-10' })).toEqual({ mode: 'range', from: '2026-02-19', to: '2026-02-28' });
  });
  it('shifts months and years but not ranges', () => {
    expect(shiftPeriod({ mode: 'month', month: '2026-12' }, 1)).toEqual({ mode: 'month', month: '2027-01' });
    expect(shiftPeriod({ mode: 'year', year: 2026 }, -1)).toEqual({ mode: 'year', year: 2025 });
    const r = { mode: 'range' as const, from: '2026-01-01', to: '2026-02-01' };
    expect(shiftPeriod(r, 1)).toBe(r);
  });
  it('labels', () => {
    expect(periodLabel({ mode: 'month', month: '2026-10' })).toBe('October 2026');
    expect(periodLabel({ mode: 'year', year: 2026 })).toBe('2026');
    expect(periodLabel({ mode: 'range', from: '2026-03-01', to: '2026-03-15' })).toBe('1 Mar 2026 - 15 Mar 2026');
  });
  it('bar chart months', () => {
    const m = seriesMonths({ mode: 'month', month: '2026-10' });
    expect(m).toHaveLength(12);
    expect([m[0], m[11]]).toEqual(['2025-11', '2026-10']);
    expect(seriesMonths({ mode: 'year', year: 2026 })).toHaveLength(12);
    expect(seriesMonths({ mode: 'year', year: 2026 })[0]).toBe('2026-01');
    expect(seriesMonths({ mode: 'range', from: '2026-03-15', to: '2026-05-02' })).toEqual(['2026-03', '2026-04', '2026-05']);
  });
  it('caps a long range at the latest 24 months', () => {
    const m = seriesMonths({ mode: 'range', from: '2020-01-01', to: '2026-10-31' });
    expect(m).toHaveLength(24);
    expect(m[23]).toBe('2026-10');
  });
});

describe('percentChange', () => {
  it('is relative to the previous value, one decimal', () => {
    expect(percentChange(120, 100)).toBe(20);
    expect(percentChange(80, 100)).toBe(-20);
    expect(percentChange(101, 300)).toBe(-66.3);
  });
  it('is null when there is no previous value', () => {
    expect(percentChange(50, 0)).toBeNull();
  });
});

void dayjs;
