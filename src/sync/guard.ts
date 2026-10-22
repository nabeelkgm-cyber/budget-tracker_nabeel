import type { Db } from '@/db/types';

/**
 * Erasing, restoring or replacing everything would be copied to every device, or fight with the cloud
 * copy. So these actions need sync switched off first.
 */
export async function assertSyncOff(db: Db): Promise<void> {
  const on = await db.getFirstAsync<{ value: string }>("SELECT value FROM sync_meta WHERE key = 'capture'");
  if (on?.value === '1') {
    throw new Error('Cloud sync is on. Open More → Cloud sync and sign out of sync first, then try again.');
  }
}
