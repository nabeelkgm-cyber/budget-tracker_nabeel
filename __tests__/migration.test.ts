/** @jest-environment node */
import { LATEST_VERSION, migrate } from '@/db/migrations';
import { createAccount, getAccount, listAccounts } from '@/db/repositories/accounts';
import { listCategories } from '@/db/repositories/categories';
import { createTransaction, listTransactions } from '@/db/repositories/transactions';
import { seedDefaults } from '@/db/seed/defaults';
import { createTestDb } from './helpers/testDb';

describe('migration v1 -> v2 (loan accounts)', () => {
  it('keeps existing accounts and transactions, then allows loans', async () => {
    const db = createTestDb();
    await migrate(db, 1); // the database exactly as it is on a phone running Phase 1
    await seedDefaults(db);

    const now = '2026-10-01T00:00:00.000Z';
    await db.runAsync(
      `INSERT INTO accounts (id,name,type,currency,opening_balance_minor,icon,color,created_at,updated_at)
       VALUES ('a1','CBQ','bank','QAR',100000,'business','#000',?,?)`,
      [now, now],
    );
    const cat = (await listCategories(db)).find((c) => c.name === 'Groceries')!;
    await db.runAsync(
      `INSERT INTO transactions (id,type,date,account_id,amount_minor,fx_rate_e8,base_amount_minor,category_id,created_at,updated_at)
       VALUES ('t1','expense','2026-10-02','a1',2500,100000000,2500,?,?,?)`,
      [cat.id, now, now],
    );
    // Before the upgrade a loan is rejected.
    await expect(
      db.runAsync(
        `INSERT INTO accounts (id,name,type,currency,icon,color,created_at,updated_at)
         VALUES ('x','L','loan','QAR','i','#000',?,?)`,
        [now, now],
      ),
    ).rejects.toThrow();

    await migrate(db);
    const v = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(v?.user_version).toBe(LATEST_VERSION);

    // Old data survived and balances still add up.
    expect((await getAccount(db, 'a1'))!.balance_minor).toBe(100000 - 2500);
    expect(await listTransactions(db)).toHaveLength(1);

    // Loans now work, and foreign keys are enforced again.
    const loan = await createAccount(db, {
      name: 'Car loan', type: 'loan', currency: 'QAR', openingBalanceMinor: -3000000,
      creditLimitMinor: null, statementDay: null, dueDay: 5, icon: 'car', color: '#000',
    });
    expect((await getAccount(db, loan))!.balance_minor).toBe(-3000000);
    await expect(
      db.runAsync(
        `INSERT INTO transactions (id,type,date,account_id,amount_minor,fx_rate_e8,base_amount_minor,created_at,updated_at)
         VALUES ('t2','expense','2026-10-02','does-not-exist',1,100000000,1,?,?)`,
        [now, now],
      ),
    ).rejects.toThrow(/FOREIGN KEY/i);
    expect(await listAccounts(db)).toHaveLength(2);
  });

  it('adds Loan Interest and Bank Charges once to an existing database, and keeps the budget tables', async () => {
    const db = createTestDb();
    await migrate(db, 2);
    await seedDefaults(db); // pre-Phase-3 preset list is not what seedDefaults inserts now, so remove them
    await db.runAsync("DELETE FROM categories WHERE name IN ('Loan Interest','Bank Charges')");
    await migrate(db);
    await migrate(db);
    const names = (await listCategories(db)).map((c) => c.name);
    expect(names.filter((n) => n === 'Loan Interest')).toHaveLength(1);
    expect(names.filter((n) => n === 'Bank Charges')).toHaveLength(1);
    const tables = await db.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'");
    expect(tables.map((x) => x.name)).toEqual(expect.arrayContaining(['budgets', 'budget_alerts_sent', 'recurring_rules', 'recurring_due']));
  });

  it('a fresh install has each preset exactly once', async () => {
    const db = createTestDb();
    await migrate(db);
    await seedDefaults(db);
    const names = (await listCategories(db)).map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(['Loan Interest', 'Bank Charges']));
  });
});
