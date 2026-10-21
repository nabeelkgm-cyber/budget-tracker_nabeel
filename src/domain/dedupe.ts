/**
 * Deciding whether a captured item (SMS or statement line) is something already recorded.
 * Pure functions: the database layer feeds them candidates.
 */
import dayjs from 'dayjs';

export interface MatchItem {
  date: string;
  amountMinor: number;
  direction: 'debit' | 'credit';
  description: string;
  /** Bank reference number, if the item has one. */
  reference: string | null;
}

export interface MatchCandidate {
  id: string;
  date: string;
  amountMinor: number;
  direction: 'debit' | 'credit';
  note: string;
  /** What the app stored last time (for example "ref:629012345678"). */
  externalRef: string | null;
}

export const referenceKey = (reference: string): string => `ref:${reference.trim().toUpperCase()}`;

const STOP = new Set(['the', 'and', 'for', 'pos', 'upi', 'purchase', 'payment', 'card', 'debit', 'credit', 'transfer', 'neft', 'imps', 'from', 'with']);

export function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !STOP.has(w)),
  );
}

/** 0 to 1: how much of the wording two descriptions share. */
export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const w of ta) {
    if (tb.has(w) || [...tb].some((x) => x.startsWith(w) || w.startsWith(x))) shared++;
  }
  return shared / Math.min(ta.size, tb.size);
}

export const dayDiff = (a: string, b: string): number => Math.abs(dayjs(a).diff(dayjs(b), 'day'));

export type MatchKind = 'exact' | 'possible' | 'none';

export interface Match {
  kind: MatchKind;
  candidate: MatchCandidate | null;
  /** Higher is a closer match. */
  score: number;
}

/** Days a bank may take to post a transaction after the date on an SMS or receipt. */
export const MAX_POSTING_DAYS = 3;

/**
 * Finds the existing transaction an item most likely refers to.
 *  - exact: same bank reference, or same day and amount with clearly the same wording;
 *  - possible: same amount and direction within a few days (the user decides);
 *  - none: nothing similar.
 * `taken` lists transactions already matched to another item, so two real purchases of the same
 * amount are not both folded into one existing entry.
 */
export function bestMatch(item: MatchItem, candidates: MatchCandidate[], taken: Set<string> = new Set()): Match {
  let best: Match = { kind: 'none', candidate: null, score: 0 };
  for (const c of candidates) {
    if (taken.has(c.id)) continue;
    if (item.reference && c.externalRef === referenceKey(item.reference)) return { kind: 'exact', candidate: c, score: 100 };
    if (c.amountMinor !== item.amountMinor || c.direction !== item.direction) continue;
    const days = dayDiff(c.date, item.date);
    if (days > MAX_POSTING_DAYS) continue;
    const sim = similarity(item.description, c.note);
    const score = (MAX_POSTING_DAYS + 1 - days) + sim * 2;
    if (score > best.score) {
      best = { kind: days === 0 && sim >= 0.6 ? 'exact' : 'possible', candidate: c, score };
    }
  }
  return best;
}

/** Stable identity of an item, used to spot the same line arriving twice (e.g. overlapping statements). */
export const itemFingerprint = (i: { date: string; accountId: string | null; direction: string; amountMinor: number; merchant: string }): string =>
  [i.date, i.accountId ?? '', i.direction, i.amountMinor, i.merchant.trim().toLowerCase()].join('|');
