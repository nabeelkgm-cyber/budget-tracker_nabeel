/** @jest-environment node */
import { listAccounts } from '@/db/repositories/accounts';
import { loadFullDemoData as loadSampleData } from '@/db/seed/sampleData';
import { createReadyDb } from './helpers/testDb';

it('sample data leaves cash non-negative and cards owing money, never overpaid', async () => {
  const db = await createReadyDb();
  await loadSampleData(db);
  const accounts = await listAccounts(db);
  const by = (n: string) => accounts.find((a) => a.name === n)!;
  expect(by('Cash').balance_minor).toBeGreaterThanOrEqual(0);
  expect(by('CBQ Credit Card').balance_minor).toBeLessThanOrEqual(0);
  expect(by('Doha Bank Credit Card').balance_minor).toBeLessThanOrEqual(0);
});
