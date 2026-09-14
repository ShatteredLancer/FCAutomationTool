import { describe, expect, it, vi } from 'vitest';
import { createPreferenceStore, planPreferenceImport } from '../../src/fc27/preferences.js';

const context = { season: '27', accountScope: 'a', platform: 'pc' };
const text = JSON.stringify({ format: 'fcat-preferences', schema: 1,
  preferences: { language: 'zh-CN' }, protection: { onlyUntradeable: true, maxRating: 85 } });

describe('FC27 preference migration', () => {
  it('keeps imported protection in review, never carries executable permissions', () => {
    expect(planPreferenceImport(text)).toMatchObject({ liveExecutionEnabled: false, tradeArmed: false,
      protectionReview: { onlyUntradeable: true, maxRating: 85 } });
  });
  it.each(['token', 'journal', 'armed', 'itemIds', '__proto__'])('rejects field %s', key => {
    expect(() => planPreferenceImport(text.slice(0, -1) + `,"${key}":true}`)).toThrow();
  });
  it('requires approval, imports idempotently and retains the previous good state atomically', async () => {
    const values = new Map();
    const storage = { get: vi.fn(key => values.get(key)), set: vi.fn((key, value) => values.set(key, value)) };
    const store = createPreferenceStore({ context, storage });
    await expect(store.import(text)).rejects.toThrow('approval');
    expect(storage.set).not.toHaveBeenCalled();
    await store.import(text, { approved: true });
    expect((await store.import(text, { approved: true })).status).toBe('unchanged');
    expect(storage.set).toHaveBeenCalledTimes(1);
    await store.import(text.replace('zh-CN', 'en'), { approved: true });
    expect(JSON.parse(values.get(store.key)).lastKnownGood).toContain('zh-CN');
    storage.set.mockImplementationOnce(() => { throw new Error('disk failure'); });
    await expect(store.import(text, { approved: true })).rejects.toThrow('disk failure');
    expect(JSON.parse(values.get(store.key)).current).toContain('en');
  });
  it('prevents overlapping import writes', async () => {
    let resolve;
    const storage = { get: () => new Promise(done => { resolve = done; }), set: vi.fn() };
    const store = createPreferenceStore({ context, storage });
    const pending = store.import(text, { approved: true });
    await expect(store.import(text, { approved: true })).rejects.toThrow('busy');
    resolve(null);
    await pending;
    expect(storage.set).toHaveBeenCalledTimes(1);
  });
});
