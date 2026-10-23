import { useWindowDimensions } from 'react-native';

/** Wide enough to show the home dashboard as three areas side by side. */
export const WIDE_MIN_WIDTH = 1000;

export function useBreakpoint(): { width: number; isWide: boolean } {
  const { width } = useWindowDimensions();
  return { width, isWide: width >= WIDE_MIN_WIDTH };
}
