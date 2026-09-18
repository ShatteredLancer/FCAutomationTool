import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';
import { inspectFc27FsuSupport, inspectFc27FsuSettings, validateFc27FsuSample } from '../../src/adapters/ea/fc27-fsu-diagnostics.js';

const config = JSON.parse(readFileSync(new URL('../../FSU_mod/fsu-mod.config.json', import.meta.url), 'utf8'));
const source = readFileSync(new URL(`../../FSU_mod/${config.modifiedFile}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('events.validateClubPlayers = ') + 'events.validateClubPlayers = '.length;
const method = source.slice(start, source.indexOf(';\n            events.getClubCacheState', start));
const observed = JSON.parse(readFileSync(new URL('../fixtures/fc27-original-fsu-sample-observation.json', import.meta.url), 'utf8'));

function fixture() {
  const club = { sku: 'test27', year: 2027, platform: 'pc' };
  const persona = { id: 902, _sku: 'test27', clubs: { _collection: { test27: club } } };
  const user = { id: 901, selectedPersona: 902, _personas: { _collection: { 902: persona } } };
  const player = { id: 101, definitionId: 201, type: 'player', _rating: 61, _rareflag: 0,
    utasPile: 7, state: 'free', tradable: false, loans: -1, limitedUseType: 0, upgrades: null,
    concept: false, cosmetics: [], _hyperCosmeticDTOs: {}, leagueId: 10, startTime: -1, endTime: -1,
    _auction: { _tradeState: 'inactive' }, _marketAverage: 200 };
  const items = [player, { ...player, id: 102, definitionId: 202 }];
  const info = { base: { year: 27, initialized: true, state: false, clubCache: { status: 'trusted-provisional' },
    clubValidationQueue: [], clubPayloadCaptureSessions: [], clubPayloadCaptureContextHooked: true }, apiPlatform: 1 };
  const root = { APP_YEAR: 2027, APP_YEAR_SHORT: 27, crypto: webcrypto,
    ItemType: { PLAYER: 'player' }, ItemPile: { CLUB: 7, EVOLUTION: 11 }, ItemRarity: { NONE: 0, RARE: 1 },
    LimitedUseType: { NONE: 0 }, AuctionTradeStateEnum: { INACTIVE: 'inactive', ACTIVE: 'active' },
    services: { User: { currentUserId: 901, repository: { _collection: { 901: user } } } },
    repositories: { Item: { club: { items: { _collection: { 101: items[0], 102: items[1] } } } } }, info, events: {} };
  let respond = refs => ({ ok: true, missing: [], items,
    responsePayloads: new Map(refs.map(ref => [ref.id, { id: ref.id, resourceId: ref.definitionId }])) });
  const drain = vi.fn(() => {
    const task = info.base.clubValidationQueue.shift();
    Promise.resolve().then(() => respond(task.refs)).then(task.resolve, task.reject);
  });
  root.events.validateClubPlayers = vm.runInNewContext(`(${method})`, {
    info, drainClubValidationQueue: drain, clubRepoItems: () => ({ get: id => items.find(item => item.id === id) }),
  });
  return { root, items, drain, respond: fn => { respond = fn; } };
}
afterEach(() => vi.useRealTimers());

it('fingerprints effective FSU settings without exposing values or writing any key', async () => {
  const { root, drain } = fixture();
  Object.assign(root.info, { build: { untradeable: true }, set: { goldenrange: 83 }, lock: [1234567] });
  const before = structuredClone(root.info);
  const first = await inspectFc27FsuSettings(root);
  expect(first).toMatchObject({ status: 'observed', runtimeSettingsOnly: true, settingsChanged: false, liveExecutionEnabled: false });
  expect(JSON.stringify(first)).not.toMatch(/1234567|goldenrange|untradeable/);
  expect(await inspectFc27FsuSettings(root)).toEqual(first);
  expect(root.info).toEqual(before);
  root.info.set.goldenrange = 82;
  const second = await inspectFc27FsuSettings(root);
  expect(second.hashes.set).not.toBe(first.hashes.set);
  expect(second.hashes.build).toBe(first.hashes.build);
  expect(drain).not.toHaveBeenCalled();
});
it('refuses unknown or accessor settings without invoking getters', async () => {
  const { root } = fixture();
  expect((await inspectFc27FsuSettings(root)).status).toBe('blocked');
  const getter = vi.fn();
  Object.defineProperty(root.info, 'build', { get: getter });
  expect((await inspectFc27FsuSettings(root)).status).toBe('blocked');
  expect(getter).not.toHaveBeenCalled();
});

it('recognizes the reviewed FSU method without invoking it or querying legacy prices', async () => {
  const { root, drain } = fixture();
  root.events.getPriceForUrl = () => 'player-prices/26/';
  expect(await inspectFc27FsuSupport(root)).toMatchObject({ status: 'observed', inventoryComplete: false,
    validation: { reviewedMethod: true, busy: false, captureHookPresent: true },
    prices: { legacyFc26Path: true, seasonBoundPath: false, cachedEaAverageCount: 2, networkExecuted: false } });
  expect(drain).not.toHaveBeenCalled();
});
it('verifies only two exact items and their safety attributes without promoting the entire inventory', async () => {
  const { root, drain } = fixture();
  const result = await validateFc27FsuSample(root);
  expect(result).toMatchObject({ reason: 'FC27_FSU_EXACT_SAMPLE_VERIFIED', matched: 2, fresh: true,
    safetyAttributesUnchanged: true, inventoryComplete: false, liveExecutionEnabled: false });
  expect(drain).toHaveBeenCalledOnce();
  expect(JSON.stringify(result)).not.toMatch(/901|902|101|102|201|202|accountScope|definitionId|fingerprint/);
});
it('distinguishes a ready-cache match from a fresh network verification', async () => {
  const { root, drain } = fixture(); root.info.base.clubCache.status = 'ready';
  expect(await validateFc27FsuSample(root)).toMatchObject({ reason: 'FC27_FSU_CACHE_MATCH_ONLY', fresh: false });
  expect(drain).not.toHaveBeenCalled();
});
it('replays the observed original-FSU sample result with synthetic refs, not real inventory', async () => {
  const { root } = fixture();
  delete root.info.base.clubPayloadCaptureSessions;
  expect(await validateFc27FsuSample(root)).toEqual(observed.sample);
  expect(observed.provenance.syntheticInventoryUsedInBrowser).toBe(false);
  expect(observed.accountMutationsExecuted).toBe(false);
});
it('replays the lazy capture state and inactive legacy price path without claiming a price request', async () => {
  const { root, drain } = fixture();
  delete root.info.base.clubPayloadCaptureSessions;
  root.info.apiPlatform = 3;
  root.events.getPriceForUrl = () => 'player-prices/26/';
  const report = await inspectFc27FsuSupport(root);
  expect(report.validation).toEqual(observed.support.validation);
  const { cachedEaAverageCount, ...prices } = observed.support.prices;
  expect(report.prices).toMatchObject(prices);
  expect(cachedEaAverageCount).toBe(28);
  expect(report.prices.cachedEaAverageCount).toBe(2);
  expect(drain).not.toHaveBeenCalled();
});
it('accepts the observed lazy capture collection but rejects malformed or accessor collections', async () => {
  const value = fixture(); delete value.root.info.base.clubPayloadCaptureSessions;
  expect((await validateFc27FsuSample(value.root)).reason).toBe('FC27_FSU_EXACT_SAMPLE_VERIFIED');
  for (const collection of [null, {}, 'unknown']) {
    const changed = fixture(); changed.root.info.base.clubPayloadCaptureSessions = collection;
    expect((await validateFc27FsuSample(changed.root)).status).toBe('blocked');
    expect(changed.drain).not.toHaveBeenCalled();
  }
  const changed = fixture(); const getter = vi.fn();
  Object.defineProperty(changed.root.info.base, 'clubPayloadCaptureSessions', { get: getter });
  expect((await validateFc27FsuSample(changed.root)).status).toBe('blocked');
  expect(getter).not.toHaveBeenCalled();
  expect(changed.drain).not.toHaveBeenCalled();
});
it.each([
  ['busy queue', x => x.root.info.base.clubValidationQueue.push({})],
  ['background load', x => { x.root.info.base.reloadPlayersPromise = Promise.resolve(); }],
  ['active capture', x => x.root.info.base.clubPayloadCaptureSessions.push({})],
  ['unreviewed method', x => { x.root.events.validateClubPlayers = vi.fn(); }],
  ['missing capture hook', x => { x.root.info.base.clubPayloadCaptureContextHooked = false; }],
  ['wrong FSU year', x => { x.root.info.base.year = 26; }],
  ['wrong account', x => { x.root.services.User.currentUserId = 999; }],
])('does not call FSU for %s', async (_name, mutate) => {
  const value = fixture(); mutate(value);
  expect((await validateFc27FsuSample(value.root)).status).toBe('blocked');
  expect(value.drain).not.toHaveBeenCalled();
});
it.each([
  ['FC27_FSU_SAMPLE_MISSING', (_x, result) => { result.missing = [{ id: 101, definitionId: 201 }]; }],
  ['FC27_FSU_SAMPLE_CHANGED', x => { x.items[0].tradable = true; }],
  ['FC27_FSU_SAMPLE_CHANGED', x => { x.items[0].definitionId = 999; }],
  ['FC27_FSU_RESULT_UNVERIFIED', (x, result) => { result.items = [x.items[0], x.items[0]]; }],
  ['FC27_FSU_FRESH_EVIDENCE_UNAVAILABLE', (_x, result) => { delete result.responsePayloads; }],
  ['FC27_FSU_INPUTS_CHANGED', x => { x.root.services.User.currentUserId = 999; }],
])('rejects %s after the asynchronous read', async (reason, mutate) => {
  const value = fixture();
  value.respond(refs => {
    const result = { ok: true, missing: [], items: value.items,
      responsePayloads: new Map(refs.map(ref => [ref.id, { id: ref.id, resourceId: ref.definitionId }])) };
    mutate(value, result); return result;
  });
  expect((await validateFc27FsuSample(value.root)).reason).toBe(reason);
  expect(value.drain).toHaveBeenCalledOnce();
});
it('redacts errors and never retries at the diagnostic layer', async () => {
  const value = fixture(); value.respond(() => { throw new Error('secret account payload'); });
  expect(await validateFc27FsuSample(value.root)).toEqual({ status: 'blocked', reason: 'FC27_FSU_VALIDATION_FAILED', liveExecutionEnabled: false });
  expect(value.drain).toHaveBeenCalledOnce();
});
it('times out without starting another read or accepting a late result', async () => {
  vi.useFakeTimers();
  const value = fixture(); let resolve;
  value.respond(() => new Promise(done => { resolve = done; }));
  const pending = validateFc27FsuSample(value.root);
  await vi.waitUntil(() => value.drain.mock.calls.length === 1);
  await vi.advanceTimersByTimeAsync(100000);
  expect((await pending).reason).toBe('FC27_FSU_VALIDATION_TIMEOUT');
  resolve({ ok: true });
  expect(value.drain).toHaveBeenCalledOnce();
});
