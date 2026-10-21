/** Pure geometry and number helpers for the charts, kept separate so they can be tested. */

export interface DonutSegment {
  /** Visible arc length along the ring. */
  length: number;
  /** Distance from the start of the ring to the start of this arc. */
  offset: number;
}

/**
 * Lays slices round a ring of the given radius. Each slice gets `gap` of space after it so
 * neighbouring slices do not touch. A single slice fills the whole ring.
 */
export function donutSegments(values: number[], radius: number, gap = 1.5): DonutSegment[] {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  const circumference = 2 * Math.PI * radius;
  if (total <= 0) return values.map(() => ({ length: 0, offset: 0 }));
  const useGap = values.filter((v) => v > 0).length > 1 ? gap : 0;
  let start = 0;
  return values.map((v) => {
    const share = (Math.max(0, v) / total) * circumference;
    const seg = { length: Math.max(0, share - useGap), offset: start };
    start += share;
    return seg;
  });
}

/** A rounded-up axis maximum with a tidy step, e.g. 7,300 -> 8,000; 120,000 -> 150,000. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  const f = value / exp;
  const nice = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((step) => f <= step) ?? 10;
  return nice * exp;
}

/** Minor units -> short label: 950 -> "9", 125000 -> "1.3k", 250000000 -> "2.5M". */
export function compactAmount(minor: number): string {
  const major = Math.abs(minor) / 100;
  const sign = minor < 0 ? '-' : '';
  const trim = (n: number) => n.toFixed(1).replace(/\.0$/, '');
  if (major >= 1_000_000) return `${sign}${trim(major / 1_000_000)}M`;
  if (major >= 1_000) return `${sign}${trim(major / 1_000)}k`;
  return `${sign}${Math.round(major)}`;
}

/** Bar height in pixels for a value on an axis that runs 0..max. */
export const barHeight = (value: number, max: number, plotHeight: number): number =>
  max <= 0 ? 0 : Math.max(0, Math.min(plotHeight, (value / max) * plotHeight));

export interface Slice {
  key: string;
  label: string;
  value: number;
  color: string;
}

/**
 * Keeps the biggest `maxSlices - 1` slices and merges the rest into one "Other" slice,
 * so a pie never has a dozen slivers. Slices with no value are dropped.
 */
export function groupSlices(slices: Slice[], maxSlices: number, otherColor: string): Slice[] {
  const sorted = slices.filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length <= maxSlices) return sorted;
  const head = sorted.slice(0, maxSlices - 1);
  const rest = sorted.slice(maxSlices - 1);
  return [
    ...head,
    { key: '__other', label: `Other (${rest.length})`, value: rest.reduce((s, r) => s + r.value, 0), color: otherColor },
  ];
}
