import { expect, it } from 'vitest';
import { createGalleryTradePreferences, normalizeGalleryTradePreferences } from '../../src/gallery/trade-preferences.js';
it('defaults to the existing destination/style and rejects invalid input', () => {
  expect(normalizeGalleryTradePreferences()).toEqual({ destination: 'club', style: 'enhancer' });
  expect(() => normalizeGalleryTradePreferences({ destination: 'transfer' })).toThrow();
  expect(() => normalizeGalleryTradePreferences({ style: 'other' })).toThrow();
});
it('keeps accounts separate and checks durable writes', async () => {
  let account = 'one'; const data = new Map();
  const service = createGalleryTradePreferences({ scope: () => account, get: async (k, fallback) => data.get(k) ?? fallback,
    set: async (k, v) => data.set(k, structuredClone(v)) });
  await service.save({ destination: 'unassigned', style: 'fodder' });
  account = 'two'; expect((await service.read()).destination).toBe('club');
  account = 'one'; expect((await service.read()).style).toBe('fodder');
  const broken = createGalleryTradePreferences({ scope: () => account, get: async () => null, set: async () => {} });
  await expect(broken.save({})).rejects.toThrow('SAVE_FAILED');
});
it('rejects a late response after an account switch', async () => {
  let account = 'one';
  const service = createGalleryTradePreferences({ scope: () => account, get: async () => { account = 'two'; return null; }, set: async () => {} });
  await expect(service.read()).rejects.toThrow('CONTEXT_CHANGED');
});
