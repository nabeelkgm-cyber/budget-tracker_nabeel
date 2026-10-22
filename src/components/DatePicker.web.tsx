import { createElement } from 'react';
import { fromLocalDate } from '@/lib/dates';
import { useColorScheme } from 'react-native';
import { useTheme } from '@/theme';

interface Props {
  value: Date;
  mode?: string;
  display?: string;
  onChange: (event: unknown, date?: Date) => void;
}

/** Browser version: the browser's own date box, styled to match the app. */
export default function DatePicker({ value, onChange }: Props) {
  const t = useTheme();
  const dark = useColorScheme() === 'dark';
  return createElement('input', {
    type: 'date',
    value: fromLocalDate(value),
    onChange: (e: { target: { value: string } }) => {
      const v = e.target.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
      const [y, m, d] = v.split('-').map(Number);
      onChange(e, new Date(y, m - 1, d));
    },
    style: {
      padding: '8px 10px',
      fontSize: 15,
      fontFamily: 'inherit',
      borderRadius: 10,
      border: `1px solid ${t.border}`,
      backgroundColor: t.inputBg,
      color: t.text,
      colorScheme: dark ? 'dark' : 'light',
    },
  });
}
