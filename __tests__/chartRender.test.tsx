import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { DonutChart } from '@/components/charts/DonutChart';
import { MonthlyBars } from '@/components/charts/MonthlyBars';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ default: () => 'light' }));

const months = Array.from({ length: 12 }, (_, i) => ({
  month: `2026-${String(i + 1).padStart(2, '0')}`,
  incomeMinor: i % 3 === 0 ? 0 : 1_450_000,
  expenseMinor: i * 90_000,
}));

describe('chart components render', () => {
  it('DonutChart draws slices, a single slice, and an empty ring', () => {
    for (const slices of [
      [
        { key: 'a', label: 'A', value: 300, color: '#f00' },
        { key: 'b', label: 'B', value: 100, color: '#0f0' },
      ],
      [{ key: 'a', label: 'A', value: 300, color: '#f00' }],
      [],
    ]) {
      let tree!: TestRenderer.ReactTestRenderer;
      act(() => {
        tree = TestRenderer.create(<DonutChart slices={slices}>{null}</DonutChart>);
      });
      expect(tree.toJSON()).toBeTruthy();
    }
  });

  it('MonthlyBars draws every month once it has a width, and handles empty data', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<MonthlyBars data={months} selected={11} onSelect={() => {}} />);
    });
    const root = tree.root;
    const container = root.findAll((n) => typeof n.props.onLayout === 'function')[0];
    act(() => {
      container.props.onLayout({ nativeEvent: { layout: { width: 340, height: 210, x: 0, y: 0 } } });
    });
    expect(JSON.stringify(tree.toJSON())).toContain('Dec');
    act(() => {
      tree.update(<MonthlyBars data={[]} selected={0} onSelect={() => {}} />);
    });
    expect(tree.toJSON()).toBeTruthy();
  });
});
