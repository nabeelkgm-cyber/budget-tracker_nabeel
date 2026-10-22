/** Which tables sync, how a record is identified, and which combinations must stay unique. */
export interface SyncTable {
  name: string;
  /** Primary key column. */
  pk: string;
  /** Columns that must be unique together (besides the primary key). */
  unique?: { cols: string[]; /** Only live (not deleted) rows count. */ live?: boolean }[];
  /** Has a deleted_at column (soft delete). */
  soft?: boolean;
}

export const SYNC_TABLES: SyncTable[] = [
  { name: 'settings', pk: 'key' },
  { name: 'currencies', pk: 'code' },
  { name: 'accounts', pk: 'id', soft: true },
  { name: 'categories', pk: 'id', soft: true },
  { name: 'account_identifiers', pk: 'id', unique: [{ cols: ['account_id', 'kind', 'value'] }] },
  { name: 'merchant_rules', pk: 'id', unique: [{ cols: ['key'] }] },
  { name: 'transactions', pk: 'id', soft: true, unique: [{ cols: ['recurring_id', 'recurring_due_date'], live: true }] },
  { name: 'budgets', pk: 'id', soft: true, unique: [{ cols: ['month', 'category_id'] }] },
  { name: 'recurring_rules', pk: 'id', soft: true },
  { name: 'recurring_due', pk: 'id', unique: [{ cols: ['rule_id', 'due_date'] }] },
  { name: 'import_batches', pk: 'id', unique: [{ cols: ['file_hash'] }] },
  { name: 'import_items', pk: 'id' },
];

export const SYNC_TABLE_BY_NAME = Object.fromEntries(SYNC_TABLES.map((t) => [t.name, t]));

/** Only these settings are shared between devices; the rest (such as last backup time) stay local. */
export const SYNCED_SETTINGS = ['base_currency', 'seeded'];
