import { expect, it, vi } from 'vitest';
import { createFsuSettingsStore } from '../../FSU_mod/src/runner-support/settings.js';
import { contextKey } from '../../src/fc27/prelaunch-contract.js';
import { createRunnerSupportCore } from '../../FSU_mod/src/runner-support/core.js';

const context = { season: '27', accountScope: 'synthetic', platform: 'PSN:test' };
const policy = { onlyUntradeable: true, excludeEvolution: true, protectFsuLockedPlayers: true,
  protectActiveSquad: false, storageFirst: true, maxRating: 74, goldRange: [75, 82], excludedLeagueIds: [] };
function fixture() {
  let scope = context;
  const values = new Map([['lock_26', '[999]']]);
  const get = vi.fn((key, fallback) => values.get(key) ?? fallback);
  const set = vi.fn((key, value) => values.set(key, value));
  const store = createFsuSettingsStore({ readContext: () => scope, get, set });
  return { store, get, set, values, switchScope: () => { scope = { ...context, accountScope: 'other' }; } };
}
it('requires explicit reviewed policy and isolates writes from legacy GM settings', () => {
  const { store, values } = fixture();
  expect(() => store.savePolicy(context, policy, false)).toThrow('APPROVAL');
  store.savePolicy(context, policy, true);
  expect(JSON.parse(values.get(contextKey(context, 'fsu-policy')))).toEqual({ schema: 1, reviewed: true, policy });
  expect(values.get('lock_26')).toBe('[999]');
  expect(() => store.savePolicy(context, { ...policy, maxRating: 100 }, true)).toThrow('POLICY');
});
it('rejects stale dialogs after an account switch and never silently activates old locks', () => {
  const { store, set, switchScope } = fixture();
  switchScope();
  expect(() => store.savePolicy(context, policy, true)).toThrow('SCOPE');
  expect(() => store.setItemLock(context, 123, true)).toThrow('SCOPE');
  expect(set).not.toHaveBeenCalled();
});
it('locks exact item IDs, detects failed persistence and rejects corrupted lock data', () => {
  const { store, values, set } = fixture();
  store.setItemLock(context, 123, true);
  store.setItemLock(context, 124, true);
  store.setItemLock(context, 123, false);
  expect(JSON.parse(values.get(contextKey(context, 'fsu-locks'))).ids).toEqual([124]);
  values.set(contextKey(context, 'fsu-locks'), 'invalid');
  expect(() => store.setItemLock(context, 125, true)).toThrow('LOCKS');
  values.delete(contextKey(context, 'fsu-locks'));
  set.mockImplementation(() => {});
  expect(() => store.setItemLock(context, 125, true)).toThrow('PERSISTENCE');
});
it('cold-starts the bridge from approved policy without pretending inventory is ready', async () => {
  const { store, get } = fixture();
  store.savePolicy(context, policy, true);
  let ready = false;
  const inventory = { describe: () => ({ context, status: ready ? 'provisional' : 'not-ready' }),
    refreshClub: vi.fn(async () => { ready = true; return { context, status: 'refreshed' }; }),
    validateClubPlayers: vi.fn() };
  const core = createRunnerSupportCore({ readContext: () => context, storage: { get }, inventory });
  expect(core.describe().status).toBe('not-ready');
  expect((await core.refreshClub()).status).toBe('refreshed');
  expect(core.describe().status).toBe('ready');
  expect(core.getClubState().status).toBe('provisional');
});

it('invalidates an in-flight result when reviewed policy changes', async () => {
  const { store, get } = fixture();
  store.savePolicy(context, policy, true);
  const refs = [{ id: 1, definitionId: 2, safetyFingerprint: 'test' }];
  const inventory = { describe: () => ({ context, status: 'provisional' }), refreshClub: async () => ({}),
    validateClubPlayers: async () => {
      store.savePolicy(context, { ...policy, maxRating: 70 }, true);
      return { status: 'validated', context, items: refs };
    } };
  const core = createRunnerSupportCore({ readContext: () => context, storage: { get }, inventory });
  await expect(core.validateClubPlayers(refs)).rejects.toThrow('FSU_POLICY_CHANGED');
});
