import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { projectFc27EaMarketSnapshot } from '../../src/fc27/ea-market-snapshot.js';
import { previewFc27PuzzleMarket } from '../../src/fc27/puzzle-market.js';
import { marketFixture, marketRow } from '../helpers/fc27-market-fixture.js';
import { FC27_QUOTE_TTL } from '../../src/fc27/market-catalog.js';
import { validatePuzzleMarketData } from '../../scripts/browser-inspection/puzzle-market.mjs';

const observed = JSON.parse(readFileSync(new URL('../fixtures/fc27-market-probe-observation.json', import.meta.url), 'utf8'));
const sample = () => structuredClone(observed.probe);
const options = { now: 1790387152536, platform: 'PSN:FFA27PS5' };

it('replays the actual projected FC27 probe without treating unquoted catalog versions as marketable', () => {
  const input = sample(); const before = structuredClone(input);
  const result = projectFc27EaMarketSnapshot(input, options);
  expect(result).toMatchObject({ status: 'ready', executable: false, liveExecutionEnabled: false,
    marketAvailabilityVerified: false, coverage: { catalogEntries: 20, quotedVersions: 3, unquotedVersions: 17 },
    data: { platform: options.platform, catalog: { schema: 1, season: '27', complete: false, seasonEvidence: 'season-route' } } });
  expect(result.data.catalog.entries.map(row => row.definitionId)).toEqual([252509, 268065, 71925]);
  expect(result.data.catalog.entries.every(row => row.marketable === true)).toBe(true);
  expect(result.data.quotes.map(row => row.price)).toEqual([500, 850, 600]);
  expect(result.data).not.toHaveProperty('marketPolicy');
  expect(validatePuzzleMarketData({ ...result.data, marketPolicy: marketFixture().marketPolicy }, options.now).status).toBe('ready');
  expect(input).toEqual(before);
});

it('uses the observed public facts in a synthetic shortage plan, not a real SBC acceptance', () => {
  const projected = projectFc27EaMarketSnapshot(sample(), options);
  const input = marketFixture(); input.inventory.items = [];
  input.context.platform = options.platform;
  input.challenge.rawRequirements = [marketRow(3, 2, -1, 2)];
  const result = previewFc27PuzzleMarket({ ...input, ...projected.data, now: options.now });
  expect(result).toMatchObject({ status: 'preview', purchaseCount: 3, estimatedCost: 1950,
    executable: false, liveExecutionEnabled: false, marketAvailabilityVerified: false,
    requiresPurchasedMaterialApproval: true });
  expect(result.purchases.every(p => !Object.hasOwn(p, 'id'))).toBe(true);
});

it.each(['platform', 'season', 'source', 'status', 'foreign-definition', 'duplicate', 'identity-count', 'price', 'empty-price', 'future', 'partial'])
('rejects malformed or mismatched observed quotes: %s', mode => {
  const input = sample(); const quote = input.quotes[0];
  if (mode === 'platform') quote.platform = 'PC:FFA27PCC';
  if (mode === 'season') quote.season = '26';
  if (mode === 'source') quote.source = 'price-limits';
  if (mode === 'status') quote.status = 'blocked';
  if (mode === 'foreign-definition') quote.definitionId = 9999999;
  if (mode === 'duplicate') input.quotes.push(quote);
  if (mode === 'identity-count') quote.eligible = quote.returned + 1;
  if (mode === 'price') quote.price = 0;
  if (mode === 'empty-price') { quote.eligible = 0; delete quote.price; }
  if (mode === 'future') quote.observedAt = options.now + 1;
  if (mode === 'partial') delete quote.eligible;
  const result = projectFc27EaMarketSnapshot(input, options);
  expect(result.status).toBe('blocked'); expect(result).not.toHaveProperty('data');
});

it('omits empty auction observations and expired prices without converting them into free players', () => {
  const input = sample(); input.quotes[0].price = null; input.quotes[0].eligible = 0;
  const partial = projectFc27EaMarketSnapshot(input, options);
  expect(partial.data.catalog.entries).toHaveLength(2);
  expect(partial.coverage).toEqual({ catalogEntries: 20, queriedVersions: 3, quotedVersions: 2,
    unquotedVersions: 17, emptyQuoteVersions: 1, expiredQuoteVersions: 0, catalogComplete: false });
  input.quotes.forEach(q => { q.price = null; q.eligible = 0; });
  expect(projectFc27EaMarketSnapshot(input, options).reason).toBe('FC27_MARKET_QUOTES_UNAVAILABLE');
  expect(projectFc27EaMarketSnapshot(sample(), { ...options, now: options.now + FC27_QUOTE_TTL + 1 }).reason)
    .toBe('FC27_MARKET_QUOTES_UNAVAILABLE');
});

it('keeps only fresh prices at the TTL boundary and records expired coverage separately', () => {
  const result = projectFc27EaMarketSnapshot(sample(), { ...options, now: options.now + FC27_QUOTE_TTL });
  expect(result.data.quotes.map(q => q.definitionId)).toEqual([71925]);
  expect(result.coverage).toMatchObject({ quotedVersions: 1, queriedVersions: 3, unquotedVersions: 17,
    emptyQuoteVersions: 0, expiredQuoteVersions: 2 });
});

it('accepts a short catalog page without claiming complete market coverage', () => {
  const input = sample(); input.catalog.entries = input.catalog.entries.slice(0, 3);
  input.catalog.pageEndObserved = true;
  const result = projectFc27EaMarketSnapshot(input, options);
  expect(result).toMatchObject({ status: 'ready', coverage: { catalogEntries: 3, unquotedVersions: 0,
    catalogComplete: false }, data: { catalog: { complete: false } } });
});

it('reports an empty catalog or zero quote queries as unavailable, not malformed or free', () => {
  const input = sample(); input.quotes = []; input.requests = 1;
  expect(projectFc27EaMarketSnapshot(input, options).reason).toBe('FC27_MARKET_QUOTES_UNAVAILABLE');
  input.catalog.entries = []; input.catalog.pageEndObserved = true;
  expect(projectFc27EaMarketSnapshot(input, options).reason).toBe('FC27_MARKET_QUOTES_UNAVAILABLE');
});

it.each(['short-page-flag', 'full-page-flag', 'sparse-position', 'sparse-group', 'before-catalog', 'over-probe-price', 'over-probe-page'])
('rejects observations outside the probe contract: %s', mode => {
  const input = sample();
  if (mode === 'short-page-flag') input.catalog.entries = input.catalog.entries.slice(0, 3);
  if (mode === 'full-page-flag') input.catalog.pageEndObserved = true;
  if (mode === 'sparse-position') input.catalog.entries[19].positions = new Array(1);
  if (mode === 'sparse-group') input.catalog.entries[19].groups = new Array(1);
  if (mode === 'before-catalog') input.quotes[0].observedAt = input.catalog.observedAt - 1;
  if (mode === 'over-probe-price') input.quotes[0].price = 2001;
  if (mode === 'over-probe-page') input.quotes[0].returned = 21;
  expect(projectFc27EaMarketSnapshot(input, options).status).toBe('blocked');
});

it.each(['missing-fact', 'duplicate', 'season', 'source', 'too-many', 'query', 'future', 'stale'])
('rejects unverified catalog input: %s', mode => {
  const input = sample(); const catalog = input.catalog;
  if (mode === 'missing-fact') delete catalog.entries[0].positions;
  if (mode === 'duplicate') catalog.entries[1] = catalog.entries[0];
  if (mode === 'season') catalog.season = '26';
  if (mode === 'source') catalog.source = 'unknown';
  if (mode === 'too-many') catalog.entries.push(catalog.entries[0]);
  if (mode === 'query') catalog.query.count = 1000;
  if (mode === 'future') catalog.observedAt = options.now + 1;
  if (mode === 'stale') catalog.observedAt = options.now - 86400001;
  expect(projectFc27EaMarketSnapshot(input, options).status).toBe('blocked');
});

it('exports only allowed fields and preserves original quote times rather than refreshing stale evidence', () => {
  const input = sample(); input.account = 'private-value';
  input.catalog.entries.forEach(p => { p.itemId = 'private-value'; });
  input.quotes.forEach(q => { q.tradeId = 'private-value'; });
  const result = projectFc27EaMarketSnapshot(input, { ...options, now: options.now + 100 });
  expect(result.data.quotes.map(q => q.observedAt)).toEqual(input.quotes.map(q => q.observedAt));
  expect(result.data.catalog.observedAt).toBe(input.catalog.observedAt);
  expect(JSON.stringify(result)).not.toContain('private-value');
  expect(JSON.stringify(observed)).not.toMatch(/"(?:accountScope|itemId|tradeId|token|cookie)"/i);
});
