/**
 * The small slice of expo-sqlite's SQLiteDatabase that the app uses.
 * expo-sqlite satisfies it directly; tests satisfy it with Node's built-in sqlite.
 */
export interface Db {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string): Promise<{ changes: number }>;
  runAsync(sql: string, params: any[]): Promise<{ changes: number }>;
  getAllAsync<T>(sql: string): Promise<T[]>;
  getAllAsync<T>(sql: string, params: any[]): Promise<T[]>;
  getFirstAsync<T>(sql: string): Promise<T | null>;
  getFirstAsync<T>(sql: string, params: any[]): Promise<T | null>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}
