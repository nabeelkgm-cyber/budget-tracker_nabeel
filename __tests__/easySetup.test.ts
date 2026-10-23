import { listAccounts } from '@/db/repositories/accounts';
import { listCategories } from '@/db/repositories/categories';
import { applyEasySetup } from '@/db/repositories/easySetup';
import { popularBanks, suggestedAccounts, validateSetupPlan } from '@/domain/easySetup';
import type { SetupCategoryPlan, SetupPlan } from '@/domain/easySetup';
import type { Db } from '@/db/types';
import { createReadyDb } from './helpers/testDb';

let db: Db;
beforeEach(async () => {
  db = await createReadyDb();
});

const keepAll = async (): Promise<SetupCategoryPlan[]> =>
  (await listCategories(db)).map((c) => ({ id: c.id, name: c.name, kind: c.kind, keep: true, icon: c.icon, color: c.color }));

describe('easy setup suggestions', () => {
  it('offers cash, bank and card ticked, and the rest unticked', () => {
    const s = suggestedAccounts('SAR');
    expect(s.filter((a) => a.include).map((a) => a.type)).toEqual(['cash', 'bank', 'credit_card']);
    expect(s.every((a) => a.currency === 'SAR' || a.currency === 'INR')).toBe(true);
  });
  it('suggests banks of the chosen country first, then India', () => {
    expect(popularBanks('QAR')[0]).toEqual({ name: 'QNB', currency: 'QAR' });
    expect(popularBanks('SAR').some((b) => b.name === 'Al Rajhi Bank')).toBe(true);
    expect(popularBanks('QAR').some((b) => b.currency === 'INR' && b.name === 'HDFC Bank')).toBe(true);
  });
});

describe('validateSetupPlan', () => {
  const acc = (name: string) => ({ name, type: 'bank' as const, currency: 'QAR', openingBalanceMinor: 0 });
  it('needs at least one account', () => {
    expect(validateSetupPlan({ accounts: [], categories: [] }, [])).toMatch(/at least one/);
  });
  it('rejects empty and duplicate account names, also against existing ones', () => {
    expect(validateSetupPlan({ accounts: [acc(' ')], categories: [] }, [])).toMatch(/needs a name/);
    expect(validateSetupPlan({ accounts: [acc('A'), acc('a')], categories: [] }, [])).toMatch(/already an account/);
    expect(validateSetupPlan({ accounts: [acc('Cash')], categories: [] }, ['cash'])).toMatch(/already an account/);
  });
  it('rejects duplicate kept category names but ignores hidden ones', () => {
    const cat = (name: string, keep: boolean): SetupCategoryPlan => ({ id: null, name, kind: 'expense', keep, icon: 'x', color: '#000' });
    expect(validateSetupPlan({ accounts: [acc('A')], categories: [cat('Gym', true), cat('gym', true)] }, [])).toMatch(/twice/);
    expect(validateSetupPlan({ accounts: [acc('A')], categories: [cat('Gym', true), cat('gym', false)] }, [])).toBeNull();
  });
});

describe('applyEasySetup', () => {
  it('creates accounts with signed opening balances, renames, hides and adds categories', async () => {
    const cats = await keepAll();
    const dining = cats.find((c) => c.name === 'Dining')!;
    const shopping = cats.find((c) => c.name === 'Shopping')!;
    const plan: SetupPlan = {
      accounts: [
        { name: 'My Bank', type: 'bank', currency: 'QAR', openingBalanceMinor: 150000 },
        { name: 'Visa', type: 'credit_card', currency: 'QAR', openingBalanceMinor: -25000 },
      ],
      categories: [
        ...cats.map((c) => (c.id === dining.id ? { ...c, name: 'Eating out' } : c.id === shopping.id ? { ...c, keep: false } : c)),
        { id: null, name: 'Pets', kind: 'expense', keep: true, icon: 'paw', color: '#EF4444' },
        { id: null, name: 'Side income', kind: 'income', keep: true, icon: 'cash', color: '#22C55E' },
        { id: null, name: 'Not wanted', kind: 'expense', keep: false, icon: 'x', color: '#000' },
      ],
    };
    await applyEasySetup(db, plan);

    const accounts = await listAccounts(db);
    expect(accounts.map((a) => [a.name, a.balance_minor])).toEqual(expect.arrayContaining([['My Bank', 150000], ['Visa', -25000]]));
    const names = (await listCategories(db)).map((c) => c.name);
    expect(names).toContain('Eating out');
    expect(names).not.toContain('Dining');
    expect(names).not.toContain('Shopping'); // hidden, not deleted
    expect(names).toContain('Pets');
    expect(names).toContain('Side income');
    expect(names).not.toContain('Not wanted');
    expect((await listCategories(db, { includeArchived: true })).map((c) => c.name)).toContain('Shopping');
  });

  it('changes nothing when the plan is invalid', async () => {
    const before = (await listAccounts(db)).length;
    await expect(
      applyEasySetup(db, {
        accounts: [
          { name: 'Same', type: 'cash', currency: 'QAR', openingBalanceMinor: 0 },
          { name: 'same', type: 'bank', currency: 'QAR', openingBalanceMinor: 0 },
        ],
        categories: await keepAll(),
      }),
    ).rejects.toThrow(/already an account/);
    expect((await listAccounts(db)).length).toBe(before);
  });
});
