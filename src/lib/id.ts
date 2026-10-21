/** UUID v4. Uses the platform crypto when present, else expo-crypto. */
export function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('expo-crypto') as { randomUUID: () => string }).randomUUID();
}

export const nowIso = (): string => new Date().toISOString();
