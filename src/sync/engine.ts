import { hasUserData, isSeeded, loadCurrencyRegistry } from '@/db/currencySetup';
import { notifyChange } from '@/db/events';
import type { Db } from '@/db/types';
import { SYNCED_SETTINGS, SYNC_TABLES, SYNC_TABLE_BY_NAME, type SyncTable } from './tables';

type Cell = string | number | null;
export type Row = Record<string, Cell>;

/** A record as stored in the cloud. */
export interface RemoteRow {
  tbl: string;
  row_id: string;
  /** Full record, or null for a record that was removed for good. */
  data: Row | null;
  deleted: boolean;
  /** Time of the change in ms (set by the device that made it). */
  updated_at: number;
  /** Order in which the cloud received it. */
  seq: number;
}

/** The cloud side. Implemented with Supabase in the app and with a fake in tests. */
export interface Remote {
  push(rows: Omit<RemoteRow, 'seq'>[]): Promise<void>;
  pull(afterSeq: number, limit: number): Promise<RemoteRow[]>;
  hasData(): Promise<boolean>;
  /** Number that changes whenever the cloud copy is replaced from scratch. */
  getEpoch(): Promise<number>;
  /** Deletes all cloud records and returns the new epoch. */
  wipe(): Promise<number>;
}

const BATCH = 200;

// ---- bookkeeping stored in the local database ----

export async function getMeta(db: Db, key: string): Promise<string | null> {
  return (await db.getFirstAsync<{ value: string }>('SELECT value FROM sync_meta WHERE key = ?', [key]))?.value ?? null;
}
export async function setMeta(db: Db, key: string, value: string): Promise<void> {
  await db.runAsync('INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [key, value]);
}
async function delMeta(db: Db, key: string): Promise<void> {
  await db.runAsync('DELETE FROM sync_meta WHERE key = ?', [key]);
}

export async function syncUserId(db: Db): Promise<string | null> {
  return getMeta(db, 'user_id');
}
export async function pendingCount(db: Db): Promise<number> {
  return (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM sync_outbox'))?.n ?? 0;
}

// ---- connecting a device ----

export type ConnectState = 'upload' | 'download' | 'choose';

/** Decides what happens when this device connects to the cloud. 'choose' means both sides have data. */
export async function planConnect(db: Db, remote: Remote): Promise<ConnectState> {
  // A device that only holds the default categories counts as empty.
  const [cloud, local] = await Promise.all([remote.hasData(), hasUserData(db)]);
  if (cloud && local) return 'choose';
  return cloud ? 'download' : 'upload';
}

async function queueEverything(db: Db): Promise<void> {
  await db.runAsync('DELETE FROM sync_outbox');
  const now = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";
  for (const t of SYNC_TABLES) {
    const only = t.name === 'settings' ? ` WHERE key IN (${SYNCED_SETTINGS.map((k) => `'${k}'`).join(',')})` : '';
    await db.execAsync(`INSERT INTO sync_outbox (tbl, row_id, ts) SELECT '${t.name}', ${t.pk}, ${now} FROM ${t.name}${only}`);
  }
}

async function wipeLocal(db: Db): Promise<void> {
  await db.execAsync('PRAGMA foreign_keys = OFF;');
  try {
    await db.withTransactionAsync(async () => {
      for (const t of [...SYNC_TABLES].reverse()) await db.execAsync(`DELETE FROM ${t.name}`);
      await db.execAsync('DELETE FROM budget_alerts_sent');
    });
  } finally {
    await db.execAsync('PRAGMA foreign_keys = ON;');
  }
}

/**
 * Turns sync on for this device.
 *  - 'upload': the cloud is empty; this device's data becomes the cloud copy.
 *  - 'download': this device's data (if any) is replaced by the cloud copy.
 *  - 'replace-cloud': the cloud copy is replaced by this device's data (other devices must reload).
 */
export async function startSync(db: Db, remote: Remote, userId: string, mode: 'upload' | 'download' | 'replace-cloud'): Promise<void> {
  await setMeta(db, 'capture', '0');
  await setMeta(db, 'user_id', userId);
  if (mode === 'download') {
    await wipeLocal(db);
    await db.runAsync('DELETE FROM sync_outbox');
    await setMeta(db, 'cursor', '0');
    await setMeta(db, 'epoch', String(await remote.getEpoch()));
  } else {
    if (mode === 'replace-cloud') await setMeta(db, 'epoch', String(await remote.wipe()));
    else await setMeta(db, 'epoch', String(await remote.getEpoch()));
    await setMeta(db, 'cursor', '0');
    await queueEverything(db);
  }
  await setMeta(db, 'capture', '1');
}

/** Turns sync off for this device. The data stays here; nothing is deleted anywhere. */
export async function stopSync(db: Db): Promise<void> {
  await db.runAsync('DELETE FROM sync_outbox');
  for (const k of ['capture', 'user_id', 'cursor', 'epoch', 'last_synced_at']) await delMeta(db, k);
}

export async function isSyncOn(db: Db): Promise<boolean> {
  return (await getMeta(db, 'capture')) === '1';
}

// ---- pushing ----

async function pushPending(db: Db, remote: Remote): Promise<number> {
  let total = 0;
  for (;;) {
    const pending = await db.getAllAsync<{ tbl: string; row_id: string; ts: number }>(
      'SELECT tbl, row_id, ts FROM sync_outbox ORDER BY ts, tbl, row_id LIMIT ?',
      [BATCH],
    );
    if (!pending.length) return total;
    const rows: Omit<RemoteRow, 'seq'>[] = [];
    const sent: { tbl: string; row_id: string; ts: number }[] = [];
    for (const p of pending) {
      const t = SYNC_TABLE_BY_NAME[p.tbl];
      if (!t) {
        await db.runAsync('DELETE FROM sync_outbox WHERE tbl = ? AND row_id = ?', [p.tbl, p.row_id]);
        continue;
      }
      const row = await db.getFirstAsync<Row>(`SELECT * FROM ${t.name} WHERE ${t.pk} = ?`, [p.row_id]);
      rows.push({ tbl: p.tbl, row_id: p.row_id, data: row, deleted: row === null, updated_at: p.ts });
      sent.push(p);
    }
    if (rows.length) await remote.push(rows);
    // Keep an entry if the record changed again while it was being sent.
    for (const p of sent) await db.runAsync('DELETE FROM sync_outbox WHERE tbl = ? AND row_id = ? AND ts <= ?', [p.tbl, p.row_id, p.ts]);
    total += sent.length;
  }
}

// ---- pulling ----

const columnCache = new WeakMap<Db, Map<string, string[]>>();
async function columnsOf(db: Db, table: string): Promise<string[]> {
  let m = columnCache.get(db);
  if (!m) columnCache.set(db, (m = new Map()));
  let cols = m.get(table);
  if (!cols) {
    cols = (await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`)).map((c) => c.name);
    m.set(table, cols);
  }
  return cols;
}

/** Which of two records for the same thing is newer; ties are broken by id so every device agrees. */
const versionOf = (row: Row, pk: string): string =>
  `${String(row.updated_at ?? row.created_at ?? '')}|${String(row[pk] ?? '')}`;

/** Returns false when the incoming record lost to a local one and must not replace it. */
async function resolveUniqueClashes(db: Db, t: SyncTable, row: Row, now: string): Promise<boolean> {
  let incomingWins = true;
  for (const u of t.unique ?? []) {
    if (u.cols.some((c) => row[c] === null || row[c] === undefined)) continue;
    if (u.live && row.deleted_at) continue;
    const where = u.cols.map((c) => `${c} = ?`).join(' AND ');
    const clashes = await db.getAllAsync<Row>(
      `SELECT * FROM ${t.name} WHERE ${where} AND ${t.pk} <> ?${u.live ? ' AND deleted_at IS NULL' : ''}`,
      [...u.cols.map((c) => row[c]), row[t.pk]],
    );
    for (const local of clashes) {
      if (versionOf(row, t.pk) > versionOf(local, t.pk)) {
        if (u.live && t.soft) await db.runAsync(`UPDATE ${t.name} SET deleted_at = ?, updated_at = ? WHERE ${t.pk} = ?`, [now, now, local[t.pk]]);
        else await db.runAsync(`DELETE FROM ${t.name} WHERE ${t.pk} = ?`, [local[t.pk]]);
      } else incomingWins = false;
    }
  }
  return incomingWins;
}

async function applyRow(db: Db, r: RemoteRow, now: string): Promise<boolean> {
  const t = SYNC_TABLE_BY_NAME[r.tbl];
  if (!t) return false; // a table this app version does not know about
  const pending = await db.getFirstAsync<{ ts: number }>('SELECT ts FROM sync_outbox WHERE tbl = ? AND row_id = ?', [r.tbl, r.row_id]);
  if (pending && pending.ts > r.updated_at) return false; // this device changed it more recently

  if (r.deleted || !r.data) {
    await db.runAsync(`DELETE FROM ${t.name} WHERE ${t.pk} = ?`, [r.row_id]);
    return true;
  }
  const cols = await columnsOf(db, t.name);
  const data: Row = {};
  for (const c of cols) if (c in r.data) data[c] = r.data[c];
  data[t.pk] = r.row_id;
  if (t.name === 'settings' && !SYNCED_SETTINGS.includes(String(data.key))) return false;

  if (!(await resolveUniqueClashes(db, t, data, now))) {
    if (!(t.soft && t.unique?.some((u) => u.live))) return false;
    data.deleted_at = data.deleted_at ?? now; // keep the loser, but out of sight
  }
  const names = Object.keys(data);
  const updates = names.filter((c) => c !== t.pk).map((c) => `${c} = excluded.${c}`).join(', ');
  await db.runAsync(
    `INSERT INTO ${t.name} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})
     ON CONFLICT (${t.pk}) DO ${updates ? `UPDATE SET ${updates}` : 'NOTHING'}`,
    names.map((c) => data[c]),
  );
  return true;
}

async function pullAll(db: Db, remote: Remote): Promise<number> {
  let applied = 0;
  let cursor = Number((await getMeta(db, 'cursor')) ?? 0);
  for (;;) {
    const rows = await remote.pull(cursor, 500);
    if (!rows.length) return applied;
    await db.execAsync('PRAGMA foreign_keys = OFF;'); // parents and children can arrive in any order
    try {
      await db.withTransactionAsync(async () => {
        await setMeta(db, 'capture', '0');
        const now = new Date().toISOString();
        for (const r of rows) if (await applyRow(db, r, now)) applied++;
        cursor = rows[rows.length - 1].seq;
        await setMeta(db, 'cursor', String(cursor));
        await setMeta(db, 'capture', '1');
      });
    } finally {
      await db.execAsync('PRAGMA foreign_keys = ON;');
    }
  }
}

// ---- one full round ----

export interface SyncResult {
  status: 'ok' | 'reset-needed' | 'off';
  pushed: number;
  pulled: number;
}

let running: Promise<unknown> = Promise.resolve();

/** Sends local changes, then fetches everyone else's. Rounds never overlap. */
export function syncOnce(db: Db, remote: Remote): Promise<SyncResult> {
  const run = running.then(() => doSync(db, remote));
  running = run.catch(() => undefined);
  return run;
}

async function doSync(db: Db, remote: Remote): Promise<SyncResult> {
  if (!(await isSyncOn(db))) return { status: 'off', pushed: 0, pulled: 0 };
  if (String(await remote.getEpoch()) !== (await getMeta(db, 'epoch'))) return { status: 'reset-needed', pushed: 0, pulled: 0 };
  const pushed = await pushPending(db, remote);
  const pulled = await pullAll(db, remote);
  await setMeta(db, 'last_synced_at', new Date().toISOString());
  if (pulled > 0) {
    if (await isSeeded(db)) await loadCurrencyRegistry(db);
    notifyChange();
  }
  return { status: 'ok', pushed, pulled };
}
