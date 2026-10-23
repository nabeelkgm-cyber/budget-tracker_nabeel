import { migrate } from '@/db/migrations';
import { createAccount } from '@/db/repositories/accounts';
import { listCategories } from '@/db/repositories/categories';
import { createTransaction, deleteTransaction } from '@/db/repositories/transactions';
import { upsertBudget } from '@/db/repositories/budgets';
import type { Db } from '@/db/types';
import { newId, nowIso } from '@/lib/id';
import { Remote, RemoteRow, getMeta, isSyncOn, pendingCount, planConnect, startSync, stopSync, syncOnce } from '@/sync/engine';
import { createReadyDb, createTestDb } from './helpers/testDb';

/** Behaves like the Supabase setup: last change wins per record, every change gets a new sequence number. */
class FakeCloud {
  rows = new Map<string, RemoteRow>();
  seq = 0;
  epoch = 1;
  remote(): Remote {
    return {
      push: async (rows) => {
        for (const r of rows) {
          const key = `${r.tbl}/${r.row_id}`;
          const old = this.rows.get(key);
          if (old && old.updated_at > r.updated_at) continue;
          this.rows.set(key, { ...r, data: r.data ? { ...r.data } : null, seq: ++this.seq });
        }
      },
      pull: async (after, limit) =>
        [...this.rows.values()].filter((r) => r.seq > after).sort((a, b) => a.seq - b.seq).slice(0, limit),
      hasData: async () => this.rows.size > 0,
      getEpoch: async () => this.epoch,
      wipe: async () => {
        this.rows.clear();
        return ++this.epoch;
      },
    };
  }
}

const sleep = (ms = 4) => new Promise((r) => setTimeout(r, ms));
const q = <T>(db: Db, sql: string, p: any[] = []) => db.getAllAsync<T>(sql, p);

async function emptyDevice(): Promise<Db> {
  const d = createTestDb();
  await migrate(d);
  return d;
}

const account = (db: Db, name: string) =>
  createAccount(db, { name, type: 'bank', currency: 'QAR', openingBalanceMinor: 0, creditLimitMinor: null, statementDay: null, dueDay: null, icon: 'wallet', color: '#000' });

const expense = async (db: Db, accountId: string, note: string, extra: Record<string, unknown> = {}) => {
  const cats = await listCategories(db);
  return createTransaction(db, {
    type: 'expense', date: '2026-10-01', accountId, amountMinor: 1000, categoryId: cats.find((c) => c.kind === 'expense' && !c.parent_id)!.id,
    toAccountId: null, toAmountMinor: null, paymentMethod: 'cash', note, ...extra,
  });
};

let cloud: FakeCloud;
let A: Db;
let B: Db;

/** A has data and uploads it; B starts empty and downloads. */
async function connectBoth() {
  A = await createReadyDb();
  B = await emptyDevice();
  cloud = new FakeCloud();
  const r = cloud.remote();
  expect(await planConnect(A, r)).toBe('upload');
  await startSync(A, r, 'user-1', 'upload');
  await syncOnce(A, r);
  expect(await planConnect(B, r)).toBe('download');
  await startSync(B, r, 'user-1', 'download');
  await syncOnce(B, r);
}
const sync = async (...dbs: Db[]) => {
  for (const d of dbs) await syncOnce(d, cloud.remote());
  for (const d of dbs) await syncOnce(d, cloud.remote());
};

describe('cloud sync', () => {
  it('records nothing until sync is switched on', async () => {
    const d = await createReadyDb();
    await account(d, 'Cash');
    expect(await pendingCount(d)).toBe(0);
    expect(await isSyncOn(d)).toBe(false);
  });

  it('a new device receives everything, including the currency', async () => {
    await connectBoth();
    const a = await q(A, 'SELECT id, name FROM categories ORDER BY id');
    expect(await q(B, 'SELECT id, name FROM categories ORDER BY id')).toEqual(a);
    expect((await q<any>(B, "SELECT value FROM settings WHERE key='base_currency'"))[0].value).toBe('QAR');
    expect((await q(B, 'SELECT code FROM currencies')).length).toBe((await q(A, 'SELECT code FROM currencies')).length);
  });

  it('shares changes both ways, immediately after each sync', async () => {
    await connectBoth();
    const acc = await account(A, 'HSBC');
    const t = await expense(A, acc, 'coffee');
    await sync(A, B);
    expect((await q<any>(B, 'SELECT note, amount_minor FROM transactions WHERE id=?', [t]))[0]).toEqual({ note: 'coffee', amount_minor: 1000 });
    const t2 = await expense(B, acc, 'lunch');
    await sync(B, A);
    expect((await q<any>(A, 'SELECT note FROM transactions WHERE id=?', [t2]))[0].note).toBe('lunch');
    expect(await pendingCount(A)).toBe(0);
  });

  it('the most recent edit wins and both devices agree', async () => {
    await connectBoth();
    const acc = await account(A, 'HSBC');
    const t = await expense(A, acc, 'first');
    await sync(A, B);
    await B.runAsync("UPDATE transactions SET note='from B', updated_at=? WHERE id=?", [nowIso(), t]);
    await sleep();
    await A.runAsync("UPDATE transactions SET note='from A', updated_at=? WHERE id=?", [nowIso(), t]);
    await sync(B, A);
    for (const d of [A, B]) expect((await q<any>(d, 'SELECT note FROM transactions WHERE id=?', [t]))[0].note).toBe('from A');
  });

  it('a change made while offline is not overwritten by an older cloud copy', async () => {
    await connectBoth();
    const acc = await account(A, 'HSBC');
    const t = await expense(A, acc, 'v1');
    await sync(A, B);
    await A.runAsync("UPDATE transactions SET note='v2' WHERE id=?", [t]);
    await sync(A);
    await sleep();
    await B.runAsync("UPDATE transactions SET note='offline edit' WHERE id=?", [t]);
    await syncOnce(B, cloud.remote()); // pulls v2 first? the local edit is newer and must survive
    await sync(A, B);
    for (const d of [A, B]) expect((await q<any>(d, 'SELECT note FROM transactions WHERE id=?', [t]))[0].note).toBe('offline edit');
  });

  it('deleting a transaction removes it on the other device', async () => {
    await connectBoth();
    const acc = await account(A, 'HSBC');
    const t = await expense(A, acc, 'oops');
    await sync(A, B);
    await deleteTransaction(B, t);
    await sync(B, A);
    expect((await q<any>(A, 'SELECT deleted_at FROM transactions WHERE id=?', [t]))[0].deleted_at).not.toBeNull();
  });

  it('a record removed for good is removed on the other device too', async () => {
    await connectBoth();
    const cats = await listCategories(A);
    const id = newId();
    await A.runAsync("INSERT INTO merchant_rules (id,key,category_id,type,hits,created_at,updated_at) VALUES (?,?,?,?,?,?,?)", [id, 'lulu', cats[0].id, 'expense', 1, nowIso(), nowIso()]);
    await sync(A, B);
    expect((await q(B, 'SELECT id FROM merchant_rules')).length).toBe(1);
    await B.runAsync('DELETE FROM merchant_rules');
    await sync(B, A);
    expect((await q(A, 'SELECT id FROM merchant_rules')).length).toBe(0);
  });

  it('two budgets for the same month and category made on two devices become one', async () => {
    await connectBoth();
    const cat = (await listCategories(A)).find((c) => c.kind === 'expense' && !c.parent_id)!.id;
    await upsertBudget(A, { month: '2026-10', categoryId: cat, amountMinor: 50000, rollover: false });
    await sleep();
    await upsertBudget(B, { month: '2026-10', categoryId: cat, amountMinor: 70000, rollover: false });
    await sync(A, B);
    const a = await q<any>(A, 'SELECT id, amount_minor FROM budgets WHERE month=? AND category_id=?', ['2026-10', cat]);
    const b = await q<any>(B, 'SELECT id, amount_minor FROM budgets WHERE month=? AND category_id=?', ['2026-10', cat]);
    expect(a).toHaveLength(1);
    expect(b).toEqual(a);
    expect(a[0].amount_minor).toBe(70000);
  });

  it('the same recurring item created on two devices is counted once', async () => {
    await connectBoth();
    const acc = await account(A, 'HSBC');
    await sync(A, B);
    const rule = newId();
    await A.runAsync(
      `INSERT INTO recurring_rules (id,name,type,account_id,amount_minor,category_id,frequency,day_of_month,next_due_date,mode,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [rule, 'Rent', 'expense', acc, 1000, (await listCategories(A))[0].id, 'monthly', 1, '2026-12-01', 'auto', nowIso(), nowIso()],
    );
    await sync(A, B);
    const t1 = await expense(A, acc, 'Rent', { recurringId: rule, recurringDueDate: '2026-11-01' });
    await sleep();
    const t2 = await expense(B, acc, 'Rent', { recurringId: rule, recurringDueDate: '2026-11-01' });
    expect(t1).not.toBe(t2);
    await sync(A, B);
    await sync(A, B);
    for (const d of [A, B]) {
      expect(await q(d, 'SELECT id FROM transactions WHERE recurring_id=? AND deleted_at IS NULL', [rule])).toHaveLength(1);
    }
    const liveA = await q<any>(A, 'SELECT id FROM transactions WHERE recurring_id=? AND deleted_at IS NULL', [rule]);
    const liveB = await q<any>(B, 'SELECT id FROM transactions WHERE recurring_id=? AND deleted_at IS NULL', [rule]);
    expect(liveA).toEqual(liveB);
  });

  it('device-only settings are not shared', async () => {
    await connectBoth();
    await A.runAsync("INSERT OR REPLACE INTO settings (key,value) VALUES ('last_backup_at','x')");
    await sync(A, B);
    expect(await q(B, "SELECT 1 FROM settings WHERE key='last_backup_at'")).toHaveLength(0);
  });

  it('asks the user when both sides already hold data', async () => {
    const x = await createReadyDb();
    const y = await createReadyDb();
    await account(x, 'Mine');
    await account(y, 'Theirs');
    cloud = new FakeCloud();
    await startSync(x, cloud.remote(), 'u', 'upload');
    await syncOnce(x, cloud.remote());
    expect(await planConnect(y, cloud.remote())).toBe('choose');
  });

  it('a device holding only the default categories simply loads the cloud copy', async () => {
    const x = await createReadyDb();
    await account(x, 'Mine');
    const y = await createReadyDb(); // set up automatically at first run, nothing entered yet
    cloud = new FakeCloud();
    await startSync(x, cloud.remote(), 'u', 'upload');
    await syncOnce(x, cloud.remote());
    expect(await planConnect(y, cloud.remote())).toBe('download');
    await startSync(y, cloud.remote(), 'u', 'download');
    await syncOnce(y, cloud.remote());
    expect(await q(y, 'SELECT name FROM accounts')).toEqual([{ name: 'Mine' }]);
  });

  it('replacing the cloud from one device tells the other to reload', async () => {
    await connectBoth();
    const C = await createReadyDb();
    await startSync(C, cloud.remote(), 'user-1', 'replace-cloud');
    await syncOnce(C, cloud.remote());
    expect((await syncOnce(B, cloud.remote())).status).toBe('reset-needed');
    await startSync(B, cloud.remote(), 'user-1', 'download');
    await syncOnce(B, cloud.remote());
    expect(await q(B, 'SELECT id FROM categories ORDER BY id')).toEqual(await q(C, 'SELECT id FROM categories ORDER BY id'));
  });

  it('signing out keeps the data and stops recording changes', async () => {
    await connectBoth();
    await stopSync(A);
    expect(await isSyncOn(A)).toBe(false);
    expect(await getMeta(A, 'user_id')).toBeNull();
    await account(A, 'Later');
    expect(await pendingCount(A)).toBe(0);
    expect((await q(A, 'SELECT id FROM categories')).length).toBeGreaterThan(0);
  });
});
