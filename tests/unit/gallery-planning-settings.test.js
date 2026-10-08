import { expect, it } from 'vitest';
import { createGalleryPlanningSettings, DEFAULT_GALLERY_PLANNING_TIMEOUT_MS, MIN_GALLERY_PLANNING_TIMEOUT_MS, MAX_GALLERY_PLANNING_TIMEOUT_MS, normalizeGalleryPlanningSettings } from '../../src/gallery/planning-settings.js';

it('defaults to a 30 second planning deadline and enforces bounds', () => {
  expect(normalizeGalleryPlanningSettings()).toEqual({ timeoutMs: DEFAULT_GALLERY_PLANNING_TIMEOUT_MS });
  expect(() => normalizeGalleryPlanningSettings({ timeoutMs: MIN_GALLERY_PLANNING_TIMEOUT_MS - 1 })).toThrow();
  expect(() => normalizeGalleryPlanningSettings({ timeoutMs: MAX_GALLERY_PLANNING_TIMEOUT_MS + 1 })).toThrow();
  expect(normalizeGalleryPlanningSettings({ timeoutMs: 60000 })).toEqual({ timeoutMs: 60000 });
  for (const value of [[], null, { timeoutMs: '60000' }, { timeoutMs: NaN }, { timeoutMs: 60000.5 }]) {
    expect(() => normalizeGalleryPlanningSettings(value)).toThrow('SETTINGS_INVALID');
  }
  expect(normalizeGalleryPlanningSettings({ timeoutMs: MIN_GALLERY_PLANNING_TIMEOUT_MS }).timeoutMs).toBe(5000);
  expect(normalizeGalleryPlanningSettings({ timeoutMs: MAX_GALLERY_PLANNING_TIMEOUT_MS }).timeoutMs).toBe(300000);
});

it('persists settings per account and verifies durable writes', async () => {
  let account = 'one'; const data = new Map();
  const service = createGalleryPlanningSettings({ scope: () => account, get: async (key, fallback) => data.get(key) ?? fallback,
    set: async (key, value) => data.set(key, structuredClone(value)) });
  await service.save({ timeoutMs: 60000 });
  expect((await service.read()).timeoutMs).toBe(60000);
  account = 'two'; expect((await service.read()).timeoutMs).toBe(DEFAULT_GALLERY_PLANNING_TIMEOUT_MS);
  const broken = createGalleryPlanningSettings({ scope: () => account, get: async () => null, set: async () => {} });
  await expect(broken.save({ timeoutMs: 60000 })).rejects.toThrow('SAVE_FAILED');
});

it('rejects a late account switch', async () => {
  let account = 'one';
  const service = createGalleryPlanningSettings({ scope: () => account, get: async () => { account = 'two'; return null; }, set: async () => {} });
  await expect(service.read()).rejects.toThrow('CONTEXT_CHANGED');
});

it('rejects malformed storage, read/write failures and switched-account writes', async () => {
  const create = (get, set = async () => {}) => createGalleryPlanningSettings({ scope: () => 'a', get, set });
  for (const record of [{ schema: 2, scope: 'a', value: {} }, { schema: 1, scope: 'b', value: {} }, { schema: 1, scope: 'a' }]) {
    await expect(create(async () => record).read()).rejects.toThrow('SETTINGS_INVALID');
  }
  await expect(create(async () => { throw Error('read-failed'); }).read()).rejects.toThrow('read-failed');
  await expect(create(async () => null, async () => { throw Error('write-failed'); }).save({})).rejects.toThrow('write-failed');
  let account = 'a';
  const switched = createGalleryPlanningSettings({ scope: () => account, get: async () => null,
    set: async () => { account = 'b'; } });
  await expect(switched.save({})).rejects.toThrow('CONTEXT_CHANGED');
});
