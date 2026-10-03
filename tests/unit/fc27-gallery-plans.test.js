import { describe, expect, it } from 'vitest';
import { createGalleryPlanStore, galleryPlanKey } from '../../src/gallery/plans.js';

describe('Gallery plan persistence', () => {
  it('isolates plans by account, provider and set', async () => {
    const store = new Map();
    const plans = createGalleryPlanStore({ get: (key, fallback) => store.has(key) ? store.get(key) : fallback,
      set: (key, value) => store.set(key, structuredClone(value)), now: () => 100 });
    const value = { binding: 'state-a', plan: { status: 'ready', plans: [{ totalPrice: 500 }] }, overview: { grades: [] } };
    expect(await plans.save('account-a', 'futgg', 'futgg:1', value)).toMatchObject({ status: 'observed' });
    expect((await plans.load('account-a', 'futgg', 'futgg:1')).record).toMatchObject(value);
    expect((await plans.load('account-b', 'futgg', 'futgg:1')).status).toBe('absent');
    expect((await plans.load('account-a', 'fodder', 'fodder:one/set')).status).toBe('absent');
    expect(galleryPlanKey('account-a', 'futgg', 'futgg:1')).not.toBe(galleryPlanKey('account-a', 'futgg', 'futgg:2'));
  });

  it('rejects malformed or future records instead of restoring stale output', async () => {
    const store = new Map([[galleryPlanKey('account-a', 'futgg', 'futgg:1'), { schema: 99 }]]);
    const plans = createGalleryPlanStore({ get: (key, fallback) => store.has(key) ? store.get(key) : fallback,
      set: (key, value) => store.set(key, value) });
    expect((await plans.load('account-a', 'futgg', 'futgg:1')).status).toBe('blocked');
    expect((await plans.save('account-a', 'futgg', 'futgg:1', { binding: '', plan: {} })).status).toBe('blocked');
  });
  it('persists costs even before a single-grade plan exists and preserves separate input bindings', async () => {
    const data = new Map();
    const plans = createGalleryPlanStore({ get: key => data.get(key), set: (key, value) => data.set(key, value) });
    const overview = { status: 'observed', grades: [{ grade: 'S', candidate: { totalPrice: 700 } }] };
    expect((await plans.save('a', 'futgg', 'futgg:1', { binding: 'old', overviewBinding: 'new', plan: null, overview })).status).toBe('observed');
    expect((await plans.load('a', 'futgg', 'futgg:1')).record).toMatchObject({ binding: 'old', overviewBinding: 'new', plan: null, overview });
  });
});
