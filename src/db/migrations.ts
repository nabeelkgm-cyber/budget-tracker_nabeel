import type { Db } from './types';

/**
 * Each entry upgrades the schema by one version (tracked with PRAGMA user_version).
 * Never edit a released migration: add a new one at the end.
 */
const MIGRATIONS: string[] = [
  // v1: core tables (currencies, accounts, categories, transactions)
  `
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
];

export const LATEST_VERSION = MIGRATIONS.length;

export async function migrate(db: Db): Promise<void> {
  await db.execAsync('PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[v]);
      await db.execAsync(`PRAGMA user_version = ${v + 1};`);
    });
  }
}
