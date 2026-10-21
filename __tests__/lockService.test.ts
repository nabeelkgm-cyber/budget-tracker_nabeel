/** @jest-environment node */
const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'x',
  getItemAsync: async (k: string) => (mockStore.has(k) ? mockStore.get(k)! : null),
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_a: string, s: string) => require('crypto').createHash('sha256').update(s).digest('hex'),
  randomUUID: () => require('crypto').randomUUID(),
}));
jest.mock('expo-local-authentication', () => ({
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2 },
  hasHardwareAsync: async () => true,
  isEnrolledAsync: async () => true,
  supportedAuthenticationTypesAsync: async () => [2],
  authenticateAsync: async () => ({ success: true }),
}));

import {
  authenticateBiometric,
  biometricInfo,
  changePin,
  checkPin,
  disableLock,
  enableLock,
  getLockSettings,
  secondsUntilNextTry,
  setBiometrics,
  setTimeoutSeconds,
} from '@/services/lock';

let now = 1_000_000_000_000;
beforeEach(() => {
  mockStore.clear();
  now = 1_000_000_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => jest.restoreAllMocks());

describe('app lock settings', () => {
  it('is off until enabled, then reports PIN length, biometrics and timeout', async () => {
    expect((await getLockSettings()).enabled).toBe(false);
    await enableLock('482913', true);
    expect(await getLockSettings()).toEqual({ enabled: true, biometrics: true, timeoutSeconds: 60, pinLength: 6 });
    await setTimeoutSeconds(300);
    await setBiometrics(false);
    expect(await getLockSettings()).toMatchObject({ biometrics: false, timeoutSeconds: 300 });
  });

  it('never stores the PIN itself', async () => {
    await enableLock('4827', false);
    expect(JSON.stringify([...mockStore.entries()])).not.toContain('4827');
  });

  it('turning it off removes everything, including the PIN', async () => {
    await enableLock('4827', true);
    await disableLock();
    expect(mockStore.size).toBe(0);
    expect((await getLockSettings()).enabled).toBe(false);
  });

  it('without a stored PIN the lock counts as off, so the user can never be locked out by a corrupt store', async () => {
    await enableLock('4827', false);
    mockStore.delete('lock.pin');
    expect((await getLockSettings()).enabled).toBe(false);
    mockStore.set('lock.pin', 'garbage{');
    expect((await getLockSettings()).enabled).toBe(false);
  });
});

describe('checking the PIN', () => {
  beforeEach(() => enableLock('4827', false));

  it('accepts the right PIN and rejects wrong ones', async () => {
    expect((await checkPin('4827')).ok).toBe(true);
    expect((await checkPin('4828')).ok).toBe(false);
    expect((await checkPin('482')).ok).toBe(false);
  });

  it('the first four wrong tries are free; the fifth makes you wait 30 seconds, then longer', async () => {
    for (let i = 1; i <= 4; i++) expect(await checkPin('0000')).toMatchObject({ ok: false, failures: i, waitSeconds: 0 });
    expect(await checkPin('0000')).toMatchObject({ failures: 5, waitSeconds: 30 });
    // During the wait even the right PIN is refused.
    now += 10_000;
    expect(await checkPin('4827')).toMatchObject({ ok: false, waitSeconds: 20 });
    expect(await secondsUntilNextTry()).toBe(20);
    // After the wait, the right PIN works and clears the count.
    now += 20_000;
    expect((await checkPin('4827')).ok).toBe(true);
    expect(await secondsUntilNextTry()).toBe(0);
    expect(await checkPin('0000')).toMatchObject({ failures: 1 });
  });

  it('waits escalate with every further wrong try', async () => {
    const waits: number[] = [];
    for (let i = 0; i < 9; i++) {
      const r = await checkPin('0000');
      waits.push(r.waitSeconds);
      now += (r.waitSeconds + 1) * 1000;
    }
    expect(waits).toEqual([0, 0, 0, 0, 30, 60, 300, 900, 3600]);
  });

  it('the wait survives restarting the app (it is stored, not in memory)', async () => {
    for (let i = 0; i < 5; i++) await checkPin('0000');
    expect(await secondsUntilNextTry()).toBe(30);
    expect((await checkPin('4827')).ok).toBe(false);
  });

  it('changing the PIN switches to the new one and clears waits', async () => {
    for (let i = 0; i < 5; i++) await checkPin('0000');
    await changePin('135790');
    expect(await secondsUntilNextTry()).toBe(0);
    expect((await checkPin('4827')).ok).toBe(false);
    expect((await checkPin('135790')).ok).toBe(true);
    expect((await getLockSettings()).pinLength).toBe(6);
  });

  it('rejects an invalid new PIN', async () => {
    await expect(changePin('12')).rejects.toThrow(/4 or 6/);
    expect((await checkPin('4827')).ok).toBe(true);
  });
});

describe('biometrics', () => {
  it('reports Face ID when the phone has it', async () => {
    expect(await biometricInfo()).toEqual({ available: true, label: 'Face ID' });
    expect(await authenticateBiometric('x')).toBe(true);
  });
});
