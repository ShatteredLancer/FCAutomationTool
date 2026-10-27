import { expect, it } from 'vitest';
import { buildGalleryAnalysisSnapshot } from '../../src/gallery/analysis-snapshot.js';
const set = { id: 'futgg:30', name: 'Club', requiredCards: 1, grades: [{ name: 'S', threshold: 100,
  rewards: [{ type: 'event_token_1', count: 1, value: 15, label: '15 Tokens' }], rewardsComplete: true }] };
const catalog = { season: '27', source: 'futgg', revision: 'rev-a', tags: [], accountScope: 'DO_NOT_EXPORT',
  categories: [{ id: 'cat', name: 'League', sets: [set] }] };
const target = extra => ({ set, status: 'observed', fetchedAt: 4000, scope: 'DO_NOT_EXPORT', pool: { revision: 'pool-a' },
  progress: { complete: true, poolComplete: true, rows: [{ eaId: 11, playerEaId: 1, name: 'Public Player',
    collected: true, inClub: false, firstOwned: null, readAt: 3000, id: 'DO_NOT_EXPORT',
    safetyFingerprint: 'DO_NOT_EXPORT', token: 'DO_NOT_EXPORT' }] },
  prices: { 11: 1000 }, priceSnapshot: { expiresAt: 6000, policy: { source: 'futbin' }, platform: 'console' },
  runtimeCards: new Map([['DO_NOT_EXPORT', {}]]), journal: { cookie: 'DO_NOT_EXPORT' }, ...extra });

it('exports historical collection separately from current holding and leaves claims unknown', () => {
  const result = buildGalleryAnalysisSnapshot({ catalog, targets: [target()], now: 5000 });
  expect(result.versions[0]).toMatchObject({ eaId: 11, collected: true, inClub: false, firstOwned: null, evidenceAt: 3000 });
  expect(result.collections[0]).toMatchObject({ claimState: 'unknown', evidenceAt: 4000, progressComplete: true });
  expect(result.interpretation.rewardClaimsVerified).toBe(false);
  expect(JSON.stringify(result)).not.toContain('DO_NOT_EXPORT');
});

it('deduplicates exact versions across sets, not base player identities, and flags contradictory evidence', () => {
  const other = { ...set, id: 'futgg:31' };
  const inputCatalog = { ...catalog, categories: [{ ...catalog.categories[0], sets: [set, other] }] };
  const a = target(), b = target({ set: other });
  b.progress = { ...b.progress, rows: [{ ...b.progress.rows[0], collected: false }, { eaId: 12, playerEaId: 1, collected: true }] };
  const result = buildGalleryAnalysisSnapshot({ catalog: inputCatalog, targets: [a, b], now: 5000 });
  expect(result.versions).toHaveLength(2);
  expect(result.versions.find(row => row.eaId === 11)).toMatchObject({ collected: null, conflictingFields: ['collected'] });
  expect(result.collections.map(row => row.versionIds)).toEqual([[11], [11, 12]]);
});

it('marks unloaded collections and stale prices explicitly without inventing zero prices or timestamps', () => {
  const incomplete = target(); incomplete.priceSnapshot.expiresAt = 4000;
  delete incomplete.progress.rows[0].readAt;
  const stale = buildGalleryAnalysisSnapshot({ catalog, targets: [incomplete], now: 5000 });
  expect(stale.collections[0].prices[0]).toMatchObject({ price: 1000, fresh: false });
  expect(stale.versions[0].evidenceAt).toBeNull();
  const unloaded = buildGalleryAnalysisSnapshot({ catalog, targets: [], now: 5000 });
  expect(unloaded.coverage).toMatchObject({ total: 1, loaded: 0, complete: 0 });
  expect(unloaded.collections[0]).toMatchObject({ status: 'unloaded', versionIds: [], prices: [], evidenceAt: null });
});

it('does not mutate data or copy plan receipts/permits into an analysis export', () => {
  const input = { catalog, targets: [target()], now: 5000, plan: { status: 'ready', scope: 'DO_NOT_EXPORT',
    route: [{ setId: set.id, name: set.name, cycles: [{ eaId: 11, itemId: 'DO_NOT_EXPORT' }], permit: 'DO_NOT_EXPORT' }],
    funding: { requiredCapital: 1000, totalPurchase: 1000, actualSaleIncome: 'DO_NOT_EXPORT' } } };
  const before = JSON.stringify(input), result = buildGalleryAnalysisSnapshot(input);
  expect(JSON.stringify(result)).not.toContain('DO_NOT_EXPORT');
  expect(result.roadmap.route[0].purchaseVersionIds).toEqual([11]);
  expect(JSON.stringify(input)).toBe(before);
});

it('exports expired read-only forecast evidence without extending time or manufacturing a fresh quote', () => {
  const reference = { source: 'fodder', forecastOnly: true, fetchedAt: 1000, capturedAt: 1500, expiresAt: 2000,
    scope: 'DO_NOT_EXPORT', grades: [] };
  const input = { catalog, now: 5000, targets: [target({ forecastPriceBasis: 'fodder-public-estimate',
    publicReference: reference, priceSnapshot: null, forecastPriceFetchedAt: 1000,
    forecastPriceExpiresAt: 2000, forecastPriceCapturedAt: 1500 })], plan: { route: [], forecastReference: reference } };
  const before = JSON.stringify(input), exported = buildGalleryAnalysisSnapshot(input);
  expect(exported.collections[0].prices[0]).toMatchObject({ forecast: true, fresh: false,
    fetchedAt: 1000, capturedAt: 1500, expiresAt: 2000, cacheExpired: true, marketObservedAt: null });
  expect(exported.roadmap.forecastReference).toMatchObject({ forecastOnly: true, cacheExpired: true, expiresAt: 2000 });
  expect(JSON.stringify(exported)).not.toContain('DO_NOT_EXPORT'); expect(JSON.stringify(input)).toBe(before);
});

it('separates demand quote evidence from reference estimates without exporting execution fields', () => {
  const input = { catalog, targets: [target()], now: 5000, plan: { demandDriven: true,
    referenceOverview: { coverage: { inspected: 1, total: 1 }, addedTokens: 15, funding: { requiredCapital: 1000 },
      route: [{ setId: set.id, targetGrade: 'S', account: 'DO_NOT_EXPORT' }] },
    deepCoverage: { quoted: 24, candidateLimit: 96, private: 'DO_NOT_EXPORT' },
    route: [{ setId: set.id, cycles: [{ eaId: 11 }], items: [{ eaId: 11, price: 500, token: 'DO_NOT_EXPORT',
      roadmapQuote: { source: 'futbin', fetchedAt: 4000, expiresAt: 6000, permit: 'DO_NOT_EXPORT' } }] }], funding: { totalPurchase: 500 } } };
  const result = buildGalleryAnalysisSnapshot(input);
  expect(result.collections[0].prices[0].price).toBe(1000);
  expect(result.roadmap.route[0].quotedItems[0]).toEqual({ eaId: 11, price: 500, source: 'futbin', fetchedAt: 4000, expiresAt: 6000, fresh: true });
  expect(result.roadmap.referenceOverview.requiredCapital).toBe(1000);
  expect(result.roadmap.deepCoverage.quoted).toBe(24);
  expect(JSON.stringify(result)).not.toContain('DO_NOT_EXPORT');
});
