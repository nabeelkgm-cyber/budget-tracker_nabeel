import type { Db } from './types';

let depth = 0;

/**
 * Runs `fn` as one all-or-nothing unit. Nested calls join the outer unit,
 * because SQLite cannot start a transaction inside another.
 */
export async function atomic<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  if (depth > 0) return fn();
  let result!: T;
  depth++;
  try {
    await db.withTransactionAsync(async () => {
      result = await fn();
    });
  } finally {
    depth--;
  }
  return result;
}
