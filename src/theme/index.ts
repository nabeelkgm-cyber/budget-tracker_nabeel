import { useColorScheme } from 'react-native';

export interface Palette {
  bg: string;
  card: string;
  text: string;
  textMuted: string;
  border: string;
  primary: string;
  onPrimary: string;
  income: string;
  expense: string;
  danger: string;
  inputBg: string;
}

const light: Palette = {
  bg: '#F4F6FA',
  card: '#FFFFFF',
  text: '#0F172A',
  textMuted: '#64748B',
  border: '#E2E8F0',
  primary: '#4F46E5',
  onPrimary: '#FFFFFF',
  income: '#16A34A',
  expense: '#DC2626',
  danger: '#DC2626',
  inputBg: '#F1F5F9',
};

const dark: Palette = {
  bg: '#0B1120',
  card: '#151D30',
  text: '#F1F5F9',
  textMuted: '#94A3B8',
  border: '#26314A',
  primary: '#818CF8',
  onPrimary: '#0B1120',
  income: '#4ADE80',
  expense: '#F87171',
  danger: '#F87171',
  inputBg: '#1E293B',
};

export function useTheme(): Palette & { isDark: boolean } {
  const isDark = useColorScheme() === 'dark';
  return { ...(isDark ? dark : light), isDark };
}

export const COLOR_CHOICES = [
  '#4F46E5', '#6C63FF', '#0EA5E9', '#14B8A6', '#22C55E', '#84CC16',
  '#F59E0B', '#F97316', '#EF4444', '#EC4899', '#A855F7', '#64748B',
];

export const ICON_CHOICES = [
  'home', 'cart', 'speedometer', 'flash', 'restaurant', 'bus', 'send', 'bag',
  'medkit', 'school', 'film', 'wallet', 'cash', 'card', 'business', 'gift',
  'airplane', 'car', 'cafe', 'paw', 'fitness', 'shirt', 'phone-portrait', 'wifi',
  'build', 'heart', 'book', 'ellipsis-horizontal-circle',
];
