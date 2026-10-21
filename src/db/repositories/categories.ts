import { newId, nowIso } from '@/lib/id';
import type { Category, CategoryKind } from '@/types';
import { notifyChange } from '../events';
import type { Db } from '../types';

export function listCategories(db: Db, opts: { includeArchived?: boolean } = {}) {
  const where = opts.includeArchived ? '' : 'AND is_archived = 0';
  return db.getAllAsync<Category>(
    `SELECT * FROM categories WHERE deleted_at IS NULL ${where}
     ORDER BY kind DESC, sort_order, name`,
  );
}

export const getCategory = (db: Db, id: string) =>
  db.getFirstAsync<Category>('SELECT * FROM categories WHERE id = ?', [id]);

export interface CategoryInput {
  name: string;
  kind: CategoryKind;
  parentId: string | null;
  icon: string;
  color: string;
}

export async function createCategory(db: Db, input: CategoryInput): Promise<string> {
  const id = newId();
  const now = nowIso();
  const next = await db.getFirstAsync<{ n: number }>(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM categories',
  );
  await db.runAsync(
    `INSERT INTO categories (id,parent_id,name,kind,icon,color,sort_order,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      id,
      input.parentId,
      input.name.trim(),
      input.kind,
      input.icon,
      input.color,
      next?.n ?? 0,
      now,
      now,
    ],
  );
  notifyChange();
  return id;
}

export async function updateCategory(
  db: Db,
  id: string,
  input: Pick<CategoryInput, 'name' | 'icon' | 'color'>,
): Promise<void> {
  await db.runAsync(
    'UPDATE categories SET name=?, icon=?, color=?, updated_at=? WHERE id=?',
    [input.name.trim(), input.icon, input.color, nowIso(), id],
  );
  notifyChange();
}

/** Archiving a parent also archives its sub-categories. Past transactions are untouched. */
export async function setCategoryArchived(db: Db, id: string, archived: boolean): Promise<void> {
  const flag = archived ? 1 : 0;
  const now = nowIso();
  await db.runAsync(
    'UPDATE categories SET is_archived=?, updated_at=? WHERE id=? OR parent_id=?',
    [flag, now, id, id],
  );
  notifyChange();
}
