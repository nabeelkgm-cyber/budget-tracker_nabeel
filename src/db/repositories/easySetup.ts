import { validateSetupPlan, ACCOUNT_TYPE_STYLE, type SetupPlan } from '@/domain/easySetup';
import { atomic } from '../atomic';
import { notifyChange } from '../events';
import type { Db } from '../types';
import { createAccount, listAccounts } from './accounts';
import { createCategory, setCategoryArchived, updateCategory } from './categories';

/**
 * Creates the chosen accounts and tidies the categories (rename, hide, add) in one all-or-nothing step.
 * Nothing is changed if any part of the plan is invalid.
 */
export async function applyEasySetup(db: Db, plan: SetupPlan): Promise<void> {
  const existing = await listAccounts(db, { includeArchived: true });
  const problem = validateSetupPlan(
    plan,
    existing.map((a) => a.name),
  );
  if (problem) throw new Error(problem);

  await atomic(db, async () => {
    for (const a of plan.accounts) {
      const style = ACCOUNT_TYPE_STYLE[a.type];
      await createAccount(db, {
        name: a.name,
        type: a.type,
        currency: a.currency,
        openingBalanceMinor: a.openingBalanceMinor,
        creditLimitMinor: null,
        statementDay: null,
        dueDay: null,
        icon: style.icon,
        color: style.color,
      });
    }
    for (const c of plan.categories) {
      if (c.id) {
        if (!c.keep) await setCategoryArchived(db, c.id, true);
        else await updateCategory(db, c.id, { name: c.name, icon: c.icon, color: c.color });
      } else if (c.keep) {
        await createCategory(db, { name: c.name, kind: c.kind, parentId: null, icon: c.icon, color: c.color });
      }
    }
  });
  notifyChange();
}
