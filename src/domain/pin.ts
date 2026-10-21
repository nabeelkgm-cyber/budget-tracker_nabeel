export type HashFn = (text: string) => Promise<string>;

export interface StoredPin {
  salt: string;
  hash: string;
  length: number;
}

export const isValidPin = (pin: string): boolean => /^(\d{4}|\d{6})$/.test(pin);

/** Obvious PINs that are easy to guess: 0000, 1234, 4321, 121212 ... */
export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true; // 0000, 111111
  const d = pin.split('').map(Number);
  const step = d[1] - d[0];
  if ((step === 1 || step === -1) && d.every((x, i) => i === 0 || x - d[i - 1] === step)) return true; // 1234, 4321
  return /^(\d\d)\1+$/.test(pin); // 1212, 121212
}

export async function createStoredPin(pin: string, hash: HashFn, makeSalt: () => string): Promise<StoredPin> {
  if (!isValidPin(pin)) throw new Error('The PIN must be 4 or 6 digits.');
  const salt = makeSalt();
  return { salt, hash: await hash(`${salt}:${pin}`), length: pin.length };
}

export async function verifyPin(stored: StoredPin, pin: string, hash: HashFn): Promise<boolean> {
  if (!isValidPin(pin) || pin.length !== stored.length) return false;
  const candidate = await hash(`${stored.salt}:${pin}`);
  // Compare every character so the time does not reveal where the first difference is.
  let diff = candidate.length ^ stored.hash.length;
  for (let i = 0; i < Math.max(candidate.length, stored.hash.length); i++) {
    diff |= (candidate.charCodeAt(i) || 0) ^ (stored.hash.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** Seconds to wait after this many wrong PINs in a row. The first four are free. */
export function lockoutSeconds(failedAttempts: number): number {
  if (failedAttempts < 5) return 0;
  if (failedAttempts === 5) return 30;
  if (failedAttempts === 6) return 60;
  if (failedAttempts === 7) return 300;
  if (failedAttempts === 8) return 900;
  return 3600;
}

export const LOCK_TIMEOUTS: { seconds: number; label: string }[] = [
  { seconds: 0, label: 'Immediately' },
  { seconds: 60, label: '1 minute' },
  { seconds: 300, label: '5 minutes' },
  { seconds: 900, label: '15 minutes' },
];

/** Should the app lock when it returns to the foreground? */
export function shouldLockAfterAbsence(backgroundedAtMs: number | null, nowMs: number, timeoutSeconds: number): boolean {
  if (backgroundedAtMs === null) return true; // unknown: be safe
  return nowMs - backgroundedAtMs >= timeoutSeconds * 1000;
}
