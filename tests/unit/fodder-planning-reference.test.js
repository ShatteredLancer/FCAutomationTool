import { expect, it } from 'vitest';
import { fodderGallery, futggGallery } from '../fixtures/fc27-gallery.js';
import { normalizeGalleryCatalog } from '../../src/gallery/catalog.js';
import { normalizeFodderPlanningReference, attachFodderPlanningReferences, forecastFodderReferencePrices } from '../../src/gallery/fodder-planning-reference.js';
import { createFc27FodderReference } from '../../src/adapters/browser/fc27-fodder-reference.js';
import observed from '../fixtures/fodder-public-reference-2026-10-26.json';

function data() {
  const index = fodderGallery(); index.categories[0].sets[0].required = 2;
  const proposals = { sets: [{ category: 'league', slug: 'example-club', count: 0, required: 2, total: 0, full: false,
    grades: ['D','C','B','A','S'].map((grade, i) => ({ grade, tokens: i * 10, cost: 500, total: 3000000,
      ids: [1,2], prices: [200,300] })) }], upgrades: [], fills: [] };
  return { index, proposals };
}
it('replays the captured public San Diego empty-collection shape', () => {
  const value = normalizeFodderPlanningReference(observed.index, observed.opportunities, { platform: 'console', fetchedAt: 1000 });
  expect(value.sets).toHaveLength(1);
  expect(value.sets[0].grades.some(grade => grade.ids.length === 15)).toBe(true);
});
it('normalizes actual public shape without leaking extra fields or treating reference prices as quotes', () => {
  const { index, proposals } = data(); proposals.scope = 'PRIVATE';
  const result = normalizeFodderPlanningReference(index, proposals, { platform: 'console', fetchedAt: 1000 });
  expect(result).toMatchObject({ basis: 'empty-collection-public-reference', marketObservedAt: null, expiresAt: 301000 });
  expect(result.sets[0].grades[0]).toMatchObject({ ids: [1,2], prices: [200,300], cost: 500 });
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
});
it('rejects personalized responses, duplicate versions, inconsistent costs and unexpected grades', () => {
  for (const mutate of [p => { p.sets[0].count = 1; }, p => { p.sets[0].grades[0].ids = [1,1]; },
    p => { p.sets[0].grades[0].cost = 499; }, p => { p.sets[0].grades[0].grade = 'X'; }]) {
    const { index, proposals } = data(); mutate(proposals);
    expect(() => normalizeFodderPlanningReference(index, proposals, { platform: 'pc', fetchedAt: 1000 })).toThrow('FC27_FODDER_REFERENCE_INVALID');
  }
});
it('strictly matches definitions across sources and excludes stale or ambiguous joins', () => {
  const { index, proposals } = data(), local = futggGallery(); local.data.categories[0].sets[0].requiredCards = 2;
  const catalog = normalizeGalleryCatalog('futgg', local), targets = [{ set: catalog.categories[0].sets[0], catalog }];
  const reference = normalizeFodderPlanningReference(index, proposals, { platform: 'pc', fetchedAt: 1000 });
  expect(attachFodderPlanningReferences(targets, reference, 1001)[0].publicReference.grades).toHaveLength(5);
  expect(attachFodderPlanningReferences(targets, reference, 301001)[0].publicReference).toBeUndefined();
  expect(attachFodderPlanningReferences([...targets, ...targets], reference, 1001).every(t => !t.publicReference)).toBe(true);
  expect(attachFodderPlanningReferences([{ ...targets[0], set: { ...targets[0].set, requiredCards: 3 } }], reference, 1001)[0].publicReference).toBeUndefined();
});
it('sends only fixed anonymous empty-owned requests, merges concurrent calls and caches by platform', async () => {
  const { index, proposals } = data(), requests = []; let time = 1000, platform = 'pc';
  const reader = createFc27FodderReference({ now: () => time, readContext: () => ({ platform, scope: 'PRIVATE' }),
    gmRequest: request => { requests.push(request); queueMicrotask(() => request.onload({ status: 200,
      responseText: JSON.stringify(request.method === 'GET' ? index : proposals) })); } });
  const [a,b] = await Promise.all([reader.load(),reader.load()]);
  expect(a).toEqual(b); expect(requests).toHaveLength(2);
  expect(requests.map(r => [r.url,r.method,r.anonymous])).toEqual([
    ['https://fodder.gg/api/gallery','GET',true], ['https://fodder.gg/api/gallery/all/opportunities','POST',true] ]);
  expect(JSON.parse(requests[1].data)).toEqual({ platform: 'pc', owned: [] });
  expect(JSON.stringify(requests)).not.toContain('PRIVATE');
  await reader.load(); expect(requests).toHaveLength(2);
  platform = 'console'; await reader.load(); expect(requests).toHaveLength(4);
  time += 300001; await reader.load(); expect(requests).toHaveLength(6);
});
it('does not publish after account change, follow redirects, or retry rate limits', async () => {
  const { index, proposals } = data(); let scope = 'a', status = 200, finalUrl;
  const requests = [];
  const reader = createFc27FodderReference({ readContext: () => ({ platform: 'pc', scope }),
    gmRequest: r => requests.push(r) });
  const call = reader.load(); scope = 'b';
  for (const r of requests) r.onload({ status, finalUrl, responseText: JSON.stringify(r.method === 'GET' ? index : proposals) });
  await expect(call).rejects.toThrow('FC27_FODDER_REFERENCE_CONTEXT_CHANGED');
  for (const change of ['redirect','429']) {
    const failed = createFc27FodderReference({ readContext: () => ({ platform: 'pc', scope }), gmRequest: r => {
      status = change === '429' ? 429 : 200; finalUrl = change === 'redirect' ? 'https://example.invalid/' : r.url;
      r.onload({ status, finalUrl, responseText: '{}' });
    } });
    await expect(failed.load()).rejects.toThrow('FC27_FODDER_REFERENCE_READ_FAILED');
  }
});

it('uses explicitly forecast-only prices without manufacturing fresh quotes or mutating stored quotes', () => {
  const { index, proposals } = data();
  const snapshot = normalizeFodderPlanningReference(index, proposals, { platform: 'console', fetchedAt: 1000 });
  const targets = attachFodderPlanningReferences([{ set: snapshot.sets[0].set, priceSnapshot: { freshPrices: { 1: 999 } } }], snapshot, 1001);
  const before = JSON.stringify(targets), [forecast] = forecastFodderReferencePrices(targets, 1001);
  expect(forecast).toMatchObject({ forecastPriceBasis: 'fodder-public-estimate', priceSnapshot: null,
    prices: { 1: 200, 2: 300 }, forecastPriceFetchedAt: 1000, forecastPriceExpiresAt: 301000 });
  expect(JSON.stringify(targets)).toBe(before); expect(forecast.freshPrices).toBeUndefined();
});
it('unifies conflicting public observations conservatively for the same exact version across sets', () => {
  const { index, proposals } = data();
  const snapshot = normalizeFodderPlanningReference(index, proposals, { platform: 'pc', fetchedAt: 1000 });
  const ref = { ...snapshot, grades: snapshot.sets[0].grades };
  const changed = structuredClone(ref); changed.grades[0].prices[0] = 500;
  const result = forecastFodderReferencePrices([{ publicReference: ref }, { publicReference: changed }], 1001);
  expect(result.map(row => row.prices[1])).toEqual([500,500]);
  expect(result[0].forecastPriceConflictCount).toBe(1);
});
it('does not use expired/missing estimates or mix platforms in one capital forecast', () => {
  const { index, proposals } = data();
  const snapshot = normalizeFodderPlanningReference(index, proposals, { platform: 'pc', fetchedAt: 1000 });
  const ref = { ...snapshot, grades: snapshot.sets[0].grades };
  expect(forecastFodderReferencePrices([{ publicReference: ref }], 301001)[0].prices).toEqual({});
  expect(forecastFodderReferencePrices([{}], 1001)[0].prices).toEqual({});
  expect(() => forecastFodderReferencePrices([{ publicReference: ref }, { publicReference: { ...ref, platform: 'console' } }], 1001)).toThrow('FC27_FODDER_REFERENCE_INVALID');
});
