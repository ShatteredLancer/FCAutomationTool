import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';

const config = JSON.parse(readFileSync(new URL('../../FSU_mod/fsu-mod.config.json', import.meta.url), 'utf8'));
const source = readFileSync(new URL(`../../FSU_mod/${config.modifiedFile}`, import.meta.url), 'utf8');
const slice = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  if (from < 0 || to < 0) throw Error('missing cache section');
  return source.slice(from, to);
};
const chunk = () => Array.from({ length: 250 }, (_, id) => ({ id: id + 1, resourceId: 123456 + id,
  rating: 84, untradeable: true, rareflag: 0, stats: Array(200).fill(80),
  cosmetics: { retained: ['all', 'fields'] }, text: 'complete native payload'.repeat(20) }));
const key = 'fsu_club_entities_v2_27_fixture_slot0_0';

function harness(values = new Map()) {
  const get = vi.fn(k => values.get(k) ?? null), set = vi.fn((k, v) => values.set(k, v));
  const context = vm.createContext({ CompressionStream, DecompressionStream, TextEncoder, TextDecoder, Blob,
    btoa, atob, Uint8Array, GM_getValue: get, GM_setValue: set, GM_listValues: () => [...values.keys()],
    console: { info() {}, warn() {}, log() {} } });
  vm.runInContext(slice('    function createFsuClubCacheCodec(', '    const fsuClubCacheCodec = ')
    + '\nglobalThis.codec = createFsuClubCacheCodec();', context);
  return { codec: context.codec, values, get, set, context };
}

it('retains every native payload field through gzip and supports old JSON string chunks', async () => {
  const { codec } = harness(), value = chunk();
  const packed = await codec.encode(value);
  expect(JSON.parse(packed).format).toBe('fsu-club-gzip-v1');
  expect(packed.length).toBeLessThan(JSON.stringify(value).length / 4);
  expect(await codec.decode(packed)).toEqual(value);
  expect(await codec.decode(JSON.stringify(value))).toEqual(value);
  expect(await codec.decode(value)).toEqual(value);
});

it('rejects corrupt compressed chunks instead of promoting incomplete inventory', async () => {
  const { codec } = harness();
  await expect(codec.decode(JSON.stringify({ format: 'fsu-club-gzip-v1', data: 'invalid' }))).rejects.toThrow();
});

it('compacts both slots and old accounts only, without reading manifests, settings or locks', async () => {
  const value = chunk(), other = key.replace('fixture_slot0', 'other_slot1');
  const values = new Map([[key, JSON.stringify(value)], [other, JSON.stringify(value)],
    ['fsu_club_entities_v2_27_fixture_manifest', '{"slot":0}'], ['lock', '{"kept":true}']]);
  const { codec, get, set } = harness(values);
  expect(await codec.compact()).toMatchObject({ status: 'completed', compacted: 2, failed: 0 });
  expect(await codec.decode(values.get(key))).toEqual(value);
  expect(get.mock.calls.every(([k]) => [key, other].includes(k))).toBe(true);
  set.mockClear(); await codec.compact(); expect(set).not.toHaveBeenCalled();
});

it('reports a failed readback and never changes the active manifest', async () => {
  const values = new Map([[key, JSON.stringify(chunk())]]), h = harness(values);
  h.set.mockImplementation(() => {});
  expect(await h.codec.compact()).toMatchObject({ status: 'partial', failed: 1, compacted: 0 });
  expect(h.set.mock.calls.every(([k]) => k === key)).toBe(true);
});

it('never overwrites chunks changed during asynchronous compression', async () => {
  const original = JSON.stringify(chunk()), changed = JSON.stringify([{ id: 42 }]);
  const h = harness(new Map([[key, original]]));
  h.get.mockReturnValueOnce(original).mockReturnValue(changed);
  expect(await h.codec.compact()).toMatchObject({ status: 'partial', failed: 1 });
  expect(h.set).not.toHaveBeenCalled();
});

it('does not switch manifests until every new slot write is verified', async () => {
  const save = slice('            const saveClubEntityCache = ', '            const getClubSnapshot = ');
  expect(save).toContain('await fsuClubCacheMigration');
  expect(save.indexOf('writeVerifiedChunk')).toBeLessThan(save.indexOf('GM_setValue(`${baseKey}_manifest`'));
  const h = harness(new Map([[key, JSON.stringify(chunk())]]));
  h.set.mockImplementation(() => {});
  await expect(h.codec.writeVerifiedChunk(key, chunk())).rejects.toThrow();
});

function entityCacheHarness() {
  const h = harness(), players = chunk(), baseKey = key.replace('_slot0_0', '');
  const entities = [];
  Object.assign(h.context, { fsuClubCacheCodec: h.codec, fsuClubCacheMigration: Promise.resolve(),
    getClubEntityCacheBaseKey: () => baseKey,
    readJsonValue: (k, fallback) => { const value = h.get(k); return value == null ? fallback : JSON.parse(value); },
    Map, Set, Date, delay: async () => {}, clubRepoPlayerItems: () => players,
    serializeClubPlayer: value => value, clubRepoPlayerIds: () => new Set(),
    cacheEntityMatchesPayload: (entity, payload) => entity.id === payload.id && entity.resourceId === payload.resourceId,
    UTItemEntityFactory: class { createItem(payload) { return { ...payload }; } },
    services: { Club: { clubDao: { clubRepo: { add: entity => entities.push(entity) } } } },
    info: { base: { state: false } }, CLUB_ENTITY_CACHE_SCHEMA: 2,
    CLUB_ENTITY_CACHE_CHUNK_SIZE: 250, CLUB_ENTITY_CACHE_MAX_AGE: 3 * 86400000, CLUB_FAST_CACHE_SIGNAL_SCHEMA: 1 });
  vm.runInContext(slice('            const restoreClubEntityCache = ', '            const getClubSnapshot = ')
    + '\nglobalThis.restore = restoreClubEntityCache; globalThis.save = saveClubEntityCache;', h.context);
  return { ...h, players, baseKey, entities };
}

it('saves the compressed inactive slot then restores exact entities only as provisional', async () => {
  const h = entityCacheHarness();
  await h.context.save(250, { fingerprint: 'unchanged-semantics' });
  expect(JSON.parse(h.values.get(key)).format).toBe('fsu-club-gzip-v1');
  const manifest = JSON.parse(h.values.get(`${h.baseKey}_manifest`));
  expect(manifest).toMatchObject({ schema: 2, slot: 0, serializedCount: 250, fingerprint: 'unchanged-semantics' });
  expect(await h.context.restore(250)).toMatchObject({ restored: true, count: 250 });
  expect(h.entities).toEqual(h.players);
  expect(h.context.info.base.clubCache.status).toBe('validating');
  expect(h.context.info.base.state).toBe(false);
});

it('keeps the previously active manifest when the next slot is not durably stored', async () => {
  const h = entityCacheHarness(); await h.context.save(250, { fingerprint: 'prior' });
  const prior = h.values.get(`${h.baseKey}_manifest`);
  h.set.mockImplementation((k, v) => { if (!k.includes('_slot1_')) h.values.set(k, v); });
  await expect(h.context.save(250, { fingerprint: 'new' })).rejects.toThrow('FSU_CACHE_WRITE_UNVERIFIED');
  expect(h.values.get(`${h.baseKey}_manifest`)).toBe(prior);
  expect(await h.context.restore(250)).toMatchObject({ restored: true, count: 250 });
});

it('marks corrupt compressed cache invalid without adding partial entities or becoming ready', async () => {
  const h = entityCacheHarness(); await h.context.save(250, { fingerprint: 'prior' });
  h.values.set(key, '{"format":"fsu-club-gzip-v1","data":"broken"}');
  expect(await h.context.restore(250)).toMatchObject({ restored: false, count: 0 });
  expect(h.entities).toEqual([]);
  expect(h.context.info.base.clubCache.status).toBe('invalid');
  expect(h.context.info.base.state).toBe(false);
});
