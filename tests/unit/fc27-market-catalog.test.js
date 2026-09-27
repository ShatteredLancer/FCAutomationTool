import { expect, it } from 'vitest';
import { normalizeFc27PlayerCatalog, indexFc27MarketQuotes, createFc27CatalogIndex } from '../../src/fc27/market-catalog.js';
import { prepareFc27MarketCandidates } from '../../src/fc27/puzzle-market.js';
import { marketFixture } from '../helpers/fc27-market-fixture.js';

it.each(['season', 'seasonEvidence', 'revision', 'complete', 'observedAt'])('requires catalog provenance field %s', key => {
  const { catalog, now } = marketFixture(); delete catalog[key];
  expect(normalizeFc27PlayerCatalog(catalog, now).status).toBe('blocked');
});
it('rejects stale/future snapshots and unversioned ID lanes', () => {
  const { catalog, now } = marketFixture();
  expect(normalizeFc27PlayerCatalog({ ids: [1], total: 1 }, now).status).toBe('blocked');
  for (const observedAt of [now + 1, now - 86400001]) expect(normalizeFc27PlayerCatalog({ ...catalog, observedAt }, now).status).toBe('blocked');
});
it.each(['nationId', 'positions', 'groups', 'marketable', 'special'])('rejects missing card facts: %s', key => {
  const { catalog, now } = marketFixture(); delete catalog.entries[0][key];
  expect(normalizeFc27PlayerCatalog(catalog, now).reason).toBe('FC27_CATALOG_ENTRY_INVALID');
});
it('rejects duplicate versions, sparse positions and duplicate groups', () => {
  for (const mutate of [c => c.entries.push(c.entries[0]), c => { c.entries[0].positions = Array(2); }, c => { c.entries[0].groups = [1, 1]; }]) {
    const { catalog, now } = marketFixture(); mutate(catalog);
    expect(normalizeFc27PlayerCatalog(catalog, now).status).toBe('blocked');
  }
});
it('projects public fields, freezes snapshots and detaches query results', () => {
  const { catalog, now } = marketFixture(); catalog.entries[0].privateToken = 'not-a-public-field';
  const normalized = normalizeFc27PlayerCatalog(catalog, now).catalog;
  expect(JSON.stringify(normalized)).not.toContain('not-a-public-field');
  expect(Object.isFrozen(normalized.entries[0].positions)).toBe(true);
  const index = createFc27CatalogIndex(normalized);
  const first = index.query({ filters: { nationId: 2 }, limit: 1 });
  expect(first).toMatchObject({ total: 4, truncated: true }); first.entries[0].positions.push(1);
  expect(index.query().entries[0].positions).toEqual([5]);
  for (const filters of [{ constructor: 1 }, { unknown: 1 }, { nationId: '2' }]) expect(index.query({ filters }).status).toBe('blocked');
  expect(index.query({ limit: 65 }).status).toBe('blocked');
  expect(createFc27CatalogIndex(null).status).toBe('blocked');
});
it('keeps the newest quote and does not resurrect a cheaper old quote above the unit cap', () => {
  const { quotes, now } = marketFixture(); const old = quotes[0];
  const options = { now, platform: 'pc', maxUnitPrice: 500 };
  expect(indexFc27MarketQuotes([{ ...old, observedAt: now - 1 }, { ...old, price: 600 }], options).size).toBe(0);
  expect(indexFc27MarketQuotes([old, { ...old, price: 400 }], options).get(old.definitionId).price).toBe(400);
  for (const patch of [{ season: '26' }, { price: 0 }, { observedAt: now + 1 }, { platform: 'console' }]) {
    expect(indexFc27MarketQuotes([{ ...old, ...patch }], options).size).toBe(0);
  }
  expect(indexFc27MarketQuotes(quotes, { ...options, now: null })).toBeNull();
});
it('indexes 50,000 versions and bounds queries and the diverse solver pool', () => {
  const input = marketFixture(); const template = input.catalog.entries[0];
  input.catalog.entries = Array.from({ length: 50000 }, (_, i) => ({ ...template, definitionId: 10000 + i, nationId: i % 150 + 1, teamId: i % 500 + 1 }));
  input.quotes = input.catalog.entries.map(entry => ({ ...input.quotes[0], definitionId: entry.definitionId }));
  const index = createFc27CatalogIndex(input.catalog);
  expect(index.query({ filters: { nationId: 42 } }).entries).toHaveLength(32);
  expect(index.query().total).toBe(50000);
  expect(prepareFc27MarketCandidates(input)).toMatchObject({ status: 'ready', coverage: { catalogEntries: 50000, selectedCandidates: 96, truncated: true } });
});
