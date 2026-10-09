import { expect, it, vi } from 'vitest';
import { createStreamlinedSettings, normalizeStreamlinedSettings } from '../../src/streamlined/settings.js';
import { contextKey } from '../../src/fc27/prelaunch-contract.js';
import { challenge } from '../helpers/streamlined.js';

const context = challenge().context;
const key = id => contextKey(context, `streamlined-settings:${id ?? 'global'}`);

it('migrates only the legacy default objective on read without changing stored records or protection', async () => {
  const store = new Map([[key(null), { schema: 1, settings: { objective: 'lowest-coins', maxRating: 74 } }]]);
  const set = vi.fn(), settings = createStreamlinedSettings({ get: async id => store.get(id) ?? null, set });
  expect(await settings.read(context, 61)).toMatchObject({ objective: 'lowest-value', maxRating: 74 });
  expect(store.get(key(null)).settings.objective).toBe('lowest-coins');
  store.set(key(61), { schema: 1, settings: { objective: 'fewest-cards', maxRating: 64 } });
  expect(await settings.read(context, 61)).toMatchObject({ objective: 'fewest-cards', maxRating: 64 });
  expect(set).not.toHaveBeenCalled();
});

it('keeps explicit new objectives and isolates global, challenge and account settings', async () => {
  const store = new Map(), settings = createStreamlinedSettings({ get: async id => store.get(id) ?? null,
    set: async (id, value) => store.set(id, structuredClone(value)) });
  expect(normalizeStreamlinedSettings().objective).toBe('lowest-value');
  await settings.save(context, null, { objective: 'lowest-coins', maxRating: 82 });
  expect(store.get(key(null)).schema).toBe(2);
  expect((await settings.read(context, 61)).objective).toBe('lowest-coins');
  await settings.save(context, 61, { objective: 'fewest-cards' });
  expect((await settings.read(context, 61)).objective).toBe('fewest-cards');
  expect((await settings.read(context, 62)).objective).toBe('lowest-coins');
  expect((await settings.read({ ...context, accountScope: 'another-account' }, 61)).objective).toBe('lowest-value');
});

it('does not turn broken settings reads or writes into a successful migration', async () => {
  const settings = createStreamlinedSettings({ get: async () => { throw Error('read'); }, set: async () => {} });
  await expect(settings.read(context)).rejects.toThrow('SETTINGS_READ_FAILED');
  const lost = createStreamlinedSettings({ get: async () => null, set: async () => {} });
  await expect(lost.save(context, 61, { objective: 'lowest-coins' })).rejects.toThrow('SETTINGS_SAVE_FAILED');
  const invalid = createStreamlinedSettings({ get: async () => ({ schema: 3, settings: {} }), set: async () => {} });
  await expect(invalid.read(context)).rejects.toThrow('SETTINGS_INVALID');
});
