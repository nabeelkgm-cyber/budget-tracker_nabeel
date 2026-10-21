import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { StoredPin, createStoredPin, lockoutSeconds, verifyPin } from '@/domain/pin';

/**
 * App-lock settings live in the iPhone Keychain (expo-secure-store), not in the database, so a
 * backup file never contains the PIN and the PIN stays on this phone only.
 */
const KEY = {
  pin: 'lock.pin',
  enabled: 'lock.enabled',
  biometrics: 'lock.biometrics',
  timeout: 'lock.timeout',
  fails: 'lock.fails',
  until: 'lock.until',
} as const;

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const hash = (text: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text);
const get = (key: string) => SecureStore.getItemAsync(key, OPTIONS);
const set = (key: string, value: string) => SecureStore.setItemAsync(key, value, OPTIONS);
const del = (key: string) => SecureStore.deleteItemAsync(key, OPTIONS);

export const DEFAULT_TIMEOUT_SECONDS = 60;

export interface LockSettings {
  enabled: boolean;
  biometrics: boolean;
  timeoutSeconds: number;
  /** 4 or 6 */
  pinLength: number;
}

export async function getLockSettings(): Promise<LockSettings> {
  try {
    const [enabled, biometrics, timeout, stored] = await Promise.all([get(KEY.enabled), get(KEY.biometrics), get(KEY.timeout), readPin()]);
    const pin = stored;
    // Without a stored PIN the lock cannot work, so treat it as off rather than locking the user out.
    return {
      enabled: enabled === '1' && !!pin,
      biometrics: biometrics === '1',
      timeoutSeconds: timeout !== null && !Number.isNaN(Number(timeout)) ? Number(timeout) : DEFAULT_TIMEOUT_SECONDS,
      pinLength: pin?.length ?? 4,
    };
  } catch {
    return { enabled: false, biometrics: false, timeoutSeconds: DEFAULT_TIMEOUT_SECONDS, pinLength: 4 };
  }
}

async function readPin(): Promise<StoredPin | null> {
  const raw = await get(KEY.pin);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredPin;
  } catch {
    return null;
  }
}

export async function enableLock(pin: string, biometrics: boolean): Promise<void> {
  const stored = await createStoredPin(pin, hash, () => Crypto.randomUUID());
  await set(KEY.pin, JSON.stringify(stored));
  await set(KEY.biometrics, biometrics ? '1' : '0');
  if ((await get(KEY.timeout)) === null) await set(KEY.timeout, String(DEFAULT_TIMEOUT_SECONDS));
  await set(KEY.enabled, '1');
  await resetFailures();
}

export async function changePin(newPin: string): Promise<void> {
  const stored = await createStoredPin(newPin, hash, () => Crypto.randomUUID());
  await set(KEY.pin, JSON.stringify(stored));
  await resetFailures();
}

export async function disableLock(): Promise<void> {
  for (const k of Object.values(KEY)) await del(k).catch(() => undefined);
}

export const setBiometrics = (on: boolean) => set(KEY.biometrics, on ? '1' : '0');
export const setTimeoutSeconds = (s: number) => set(KEY.timeout, String(s));

async function resetFailures(): Promise<void> {
  await set(KEY.fails, '0');
  await del(KEY.until).catch(() => undefined);
}

/** Seconds still to wait before another PIN try is allowed (0 = go ahead). */
export async function secondsUntilNextTry(): Promise<number> {
  const until = Number((await get(KEY.until)) ?? 0);
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

export interface PinCheck {
  ok: boolean;
  /** Wrong tries in a row so far. */
  failures: number;
  /** Seconds the user must wait before trying again. */
  waitSeconds: number;
}

/** Checks a PIN, counting wrong tries and imposing waits that grow with each one. */
export async function checkPin(pin: string): Promise<PinCheck> {
  const wait = await secondsUntilNextTry();
  if (wait > 0) return { ok: false, failures: Number((await get(KEY.fails)) ?? 0), waitSeconds: wait };
  const stored = await readPin();
  if (stored && (await verifyPin(stored, pin, hash))) {
    await resetFailures();
    return { ok: true, failures: 0, waitSeconds: 0 };
  }
  const failures = Number((await get(KEY.fails)) ?? 0) + 1;
  const waitSeconds = lockoutSeconds(failures);
  await set(KEY.fails, String(failures));
  if (waitSeconds > 0) await set(KEY.until, String(Date.now() + waitSeconds * 1000));
  return { ok: false, failures, waitSeconds };
}

export interface BiometricInfo {
  available: boolean;
  /** "Face ID", "Touch ID" or "biometrics" */
  label: string;
}

export async function biometricInfo(): Promise<BiometricInfo> {
  try {
    const [hardware, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    const label = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)
      ? 'Face ID'
      : types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)
        ? 'Touch ID'
        : 'biometrics';
    return { available: hardware && enrolled, label };
  } catch {
    return { available: false, label: 'biometrics' };
  }
}

/** Shows the Face ID / Touch ID prompt. In Expo Go iOS may ask for the phone passcode instead. */
export async function authenticateBiometric(reason: string): Promise<boolean> {
  try {
    const r = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      cancelLabel: 'Use PIN',
      disableDeviceFallback: true,
    });
    return r.success;
  } catch {
    return false;
  }
}
