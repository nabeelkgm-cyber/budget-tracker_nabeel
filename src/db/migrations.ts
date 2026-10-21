import type { Db } from './types';

/**
 * Each entry upgrades the schema by one version (tracked with PRAGMA user_version).
 * Never edit a released migration: add a new one at the end.
 */
interface Migration {
  sql: string;
  /** Needed when a table is rebuilt: SQLite cannot change a CHECK constraint in place. */
  foreignKeysOff?: boolean;
}

const MIGRATIONS: Migration[] = [
  // v1: core tables (currencies, accounts, categories, transactions)
  {
    sql: `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE currencies (
    code            TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    symbol          TEXT NOT NULL,
    minor_units     INTEGER NOT NULL DEFAULT 2,
    rate_to_base_e8 INTEGER NOT NULL,
    updated_at      TEXT NOT NULL
  );

  CREATE TABLE accounts (
    id                    TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    type                  TEXT NOT NULL CHECK (type IN ('cash','bank','credit_card')),
    currency              TEXT NOT NULL REFERENCES currencies(code),
    opening_balance_minor INTEGER NOT NULL DEFAULT 0,
    credit_limit_minor    INTEGER,
    statement_day         INTEGER CHECK (statement_day BETWEEN 1 AND 31),
    due_day               INTEGER CHECK (due_day BETWEEN 1 AND 31),
    icon                  TEXT NOT NULL,
    color                 TEXT NOT NULL,
    is_archived           INTEGER NOT NULL DEFAULT 0,
    sort_order            INTEGER NOT NULL DEFAULT 0,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL,
    deleted_at            TEXT
  );

  CREATE TABLE categories (
    id          TEXT PRIMARY KEY,
    parent_id   TEXT REFERENCES categories(id),
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('expense','income')),
    icon        TEXT NOT NULL,
    color       TEXT NOT NULL,
    is_archived INTEGER NOT NULL DEFAULT 0,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT
  );

  CREATE TABLE transactions (
    id                TEXT PRIMARY KEY,
    type              TEXT NOT NULL CHECK (type IN ('expense','income','transfer')),
    date              TEXT NOT NULL,
    account_id        TEXT NOT NULL REFERENCES accounts(id),
    amount_minor      INTEGER NOT NULL CHECK (amount_minor > 0),
    fx_rate_e8        INTEGER NOT NULL,
    base_amount_minor INTEGER NOT NULL,
    category_id       TEXT REFERENCES categories(id),
    to_account_id     TEXT REFERENCES accounts(id),
    to_amount_minor   INTEGER,
    payment_method    TEXT NOT NULL DEFAULT 'other',
    note              TEXT NOT NULL DEFAULT '',
    recurring_id      TEXT,
    source            TEXT NOT NULL DEFAULT 'manual',
    external_ref      TEXT,
    fingerprint       TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    deleted_at        TEXT
  );
  CREATE INDEX idx_txn_date     ON transactions(date);
  CREATE INDEX idx_txn_account  ON transactions(account_id);
  CREATE INDEX idx_txn_to_acct  ON transactions(to_account_id);
  CREATE INDEX idx_txn_category ON transactions(category_id);
  `,
  },

  // v2: allow accounts of type 'loan' (liabilities). Existing rows are copied unchanged.
  {
    foreignKeysOff: true,
    sql: `
  CREATE TABLE accounts_new (
    id                    TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    type                  TEXT NOT NULL CHECK (type IN ('cash','bank','credit_card','loan')),
    currency              TEXT NOT NULL REFERENCES currencies(code),
    opening_balance_minor INTEGER NOT NULL DEFAULT 0,
    credit_limit_minor    INTEGER,
    statement_day         INTEGER CHECK (statement_day BETWEEN 1 AND 31),
    due_day               INTEGER CHECK (due_day BETWEEN 1 AND 31),
    icon                  TEXT NOT NULL,
    color                 TEXT NOT NULL,
    is_archived           INTEGER NOT NULL DEFAULT 0,
    sort_order            INTEGER NOT NULL DEFAULT 0,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL,
    deleted_at            TEXT
  );
  INSERT INTO accounts_new
    (id,name,type,currency,opening_balance_minor,credit_limit_minor,statement_day,due_day,
     icon,color,is_archived,sort_order,created_at,updated_at,deleted_at)
  SELECT id,name,type,currency,opening_balance_minor,credit_limit_minor,statement_day,due_day,
     icon,color,is_archived,sort_order,created_at,updated_at,deleted_at FROM accounts;
  DROP TABLE accounts;
  ALTER TABLE accounts_new RENAME TO accounts;
  `,
  },

  // v3: link a transfer fee to its transfer; add "Loan Interest" and "Bank Charges" presets
  // for databases created earlier (fresh databases get them from seedDefaults).
  {
    sql: `
  ALTER TABLE transactions ADD COLUMN linked_txn_id TEXT;
  CREATE INDEX idx_txn_linked ON transactions(linked_txn_id);

  INSERT INTO categories (id,parent_id,name,kind,icon,color,sort_order,created_at,updated_at)
  SELECT lower(hex(randomblob(16))), NULL, 'Loan Interest', 'expense', 'trending-up', '#F97316',
         (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories),
         strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE EXISTS (SELECT 1 FROM settings WHERE key = 'seeded')
    AND NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Loan Interest' AND parent_id IS NULL AND kind = 'expense');

  INSERT INTO categories (id,parent_id,name,kind,icon,color,sort_order,created_at,updated_at)
  SELECT lower(hex(randomblob(16))), NULL, 'Bank Charges', 'expense', 'receipt', '#64748B',
         (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories),
         strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE EXISTS (SELECT 1 FROM settings WHERE key = 'seeded')
    AND NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Bank Charges' AND parent_id IS NULL AND kind = 'expense');
  `,
  },

  // v4: monthly budgets (per main expense category, in base currency) and alert state
  {
    sql: `
  CREATE TABLE budgets (
    id           TEXT PRIMARY KEY,
    month        TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
    category_id  TEXT NOT NULL REFERENCES categories(id),
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    rollover     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    deleted_at   TEXT,
    UNIQUE (month, category_id)
  );

  -- A row means "this category is currently over this threshold and the user was told".
  CREATE TABLE budget_alerts_sent (
    month       TEXT NOT NULL,
    category_id TEXT NOT NULL REFERENCES categories(id),
    threshold   INTEGER NOT NULL CHECK (threshold IN (80, 100)),
    sent_at     TEXT NOT NULL,
    PRIMARY KEY (month, category_id, threshold)
  );
  `,
  },
];

export const LATEST_VERSION = MIGRATIONS.length;

/** Upgrades the database to `target` (default: latest). `target` exists so tests can stop early. */
export async function migrate(db: Db, target: number = LATEST_VERSION): Promise<void> {
  await db.execAsync('PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  for (let v = current; v < Math.min(target, MIGRATIONS.length); v++) {
    const m = MIGRATIONS[v];
    // This pragma is ignored inside a transaction, so switch it around the transaction.
    if (m.foreignKeysOff) await db.execAsync('PRAGMA foreign_keys = OFF;');
    try {
      await db.withTransactionAsync(async () => {
        await db.execAsync(m.sql);
        if (m.foreignKeysOff) {
          const broken = await db.getAllAsync<unknown>('PRAGMA foreign_key_check');
          if (broken.length) throw new Error(`Migration ${v + 1} broke ${broken.length} foreign key(s)`);
        }
        await db.execAsync(`PRAGMA user_version = ${v + 1};`);
      });
    } finally {
      if (m.foreignKeysOff) await db.execAsync('PRAGMA foreign_keys = ON;');
    }
  }
}
