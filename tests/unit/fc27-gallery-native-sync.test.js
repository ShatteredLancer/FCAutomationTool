import { afterEach, expect, it, vi } from 'vitest';
import { createFc27GalleryProgressReader } from '../../src/adapters/ea/fc27-gallery-progress.js';
import { normalizeGalleryPool } from '../../src/gallery/pool.js';
import { futggGalleryPool, futggTruncatedGalleryPool } from '../fixtures/fc27-gallery.js';
import { summarizeGalleryScore } from '../../src/gallery/scoring.js';
import { GalleryItemEntity, galleryEntityFromDto } from '../helpers/fc27-gallery-entity.js';
import { createFc27GalleryNativeRenderer } from '../../src/adapters/ea/fc27-gallery-card.js';
import { decodeGalleryCollectionCache } from '../../src/adapters/browser/fc27-gallery-cache-codec.js';

afterEach(() => vi.useRealTimers());
function fixture() {
  const calls = [], store = new Map(), events = [];
  const control = { status: 200, raw: null, onRead: null, timeout: false, pages: [] };
  class UTSearchCriteriaDTO { constructor() { this.sort = 'native-sort'; this.count = 90; this.offset = 0; } }
  class UTItemEntityFactory {
    createItem(raw) { return galleryEntityFromDto(raw); }
  }
  const factory = new UTItemEntityFactory();
  const club = { sku: 'test27', year: 2027, platform: 'pc' };
  const persona = { id: 1002, _sku: club.sku, clubs: { _collection: { [club.sku]: club } } };
  const user = { id: 1001, selectedPersona: persona.id, _personas: { _collection: { [persona.id]: persona } } };
  const root = { APP_YEAR: 2027, APP_YEAR_SHORT: 27, GAME_NAME: 'fc27', UTSearchCriteriaDTO, UTItemEntityFactory,
    UTItemEntity: GalleryItemEntity, factories: { Item: factory },
    SearchType: { PLAYER: 'player' }, SearchCategory: { ANY: 'any' },
    UTHttpRequest: class { constructor() { throw Error('do not create requests'); } },
    services: { User: { currentUserId: user.id, repository: { _collection: { [user.id]: user } } }, Item: {
      searchConceptItems(criteria) {
        calls.push(structuredClone(criteria)); control.onRead?.();
        const page = control.pages.shift();
        const raws = page?.raw ?? control.raw ?? criteria.defId.slice(criteria.offset, criteria.offset + criteria.count)
          .map(resourceId => ({ resourceId, isCollected: resourceId % 2 === 1, gradingScore: 100 }));
        const observable = { observe(owner, callback) {
          const deliver = () => callback(observable, { status: page?.status ?? control.status,
            success: (page?.status ?? control.status) === 200,
            response: { items: control.entities ?? (control.directDto ? raws : raws.map(raw => factory.createItem(raw))), endOfList: page?.endOfList ?? raws.length < criteria.count } });
          control.deliver = deliver; if (!control.timeout) queueMicrotask(deliver);
        }, unobserve: vi.fn() };
        return observable;
      },
    } }, repositories: { Item: { club: { items: { _collection: {} } }, getStaticData: () => control.staticIds.map(id => ({ id })) } } };
  const pool = normalizeGalleryPool('futgg', futggGalleryPool(), 30);
  control.staticIds = pool.items.map(row => row.eaId);
  const options = { gmGetValue: key => store.get(key), gmSetValue: (key, value) => store.set(key, structuredClone(value)),
    now: () => Date.now(), diagnosticLog: { record: entry => events.push(entry) } };
  const reader = () => createFc27GalleryProgressReader(root, options);
  return { root, user, club, pool, calls, store, options, reader, factory, control, events };
}
async function finish(task) { await vi.runAllTimersAsync(); return task; }

it('discovers Fodder compound pools using club queries, overlap and native collection evidence', async () => {
  vi.useFakeTimers(); const f = fixture(), r = f.reader();
  const raw = (resourceId, teamId, leagueId = 8) => ({ resourceId, teamId, leagueId, nation: 1,
    rating: 80, rareflag: 4, isCollected: true, gradingScore: 100, hyperCosmetics: { 1: 1 } });
  f.control.pages = [
    { raw: [raw(11, 1), raw(12, 1, 9)], endOfList: false },
    { raw: [raw(11, 1), raw(13, 1)], endOfList: true },
    { raw: [raw(14, 2)], endOfList: true },
  ];
  const result = await finish(r.discoverPool({ id: 'fodder:test/new-set', requiredCards: 2,
    conditions: { clubs: [1, 2], leagues: [8], rareflags: [4], holo: true } }));
  expect(result).toMatchObject({ status: 'observed', pool: { source: 'fodder', complete: true } });
  expect(result.pool.items.map(row => row.eaId)).toEqual([11, 13, 14]);
  expect(f.calls.map(({ club, count, offset, rarities }) => ({ club, count, offset, rarities })))
    .toEqual([{ club: 1, count: 200, offset: 0, rarities: [4] }, { club: 1, count: 200, offset: 1, rarities: [4] }, { club: 2, count: 200, offset: 0, rarities: [4] }]);
  expect((await r.load(result.pool)).progress.totals.collected).toBe(3);
  expect(f.calls).toHaveLength(3); r.dispose();
});

it('stops Fodder discovery on an account switch or EA failure without publishing a partial pool', async () => {
  vi.useFakeTimers(); const f = fixture(), r = f.reader();
  f.control.raw = []; f.control.status = 429;
  const set = { id: 'fodder:test/rare', requiredCards: 1, conditions: { clubs: [], leagues: [], rareflags: [4], holo: false } };
  expect(await finish(r.discoverPool(set))).toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_HTTP_429' });
  expect(await finish(r.discoverPool(set))).toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_PROGRESS_BACKOFF' });
  expect(f.calls).toHaveLength(1); r.dispose();
});

it('queries a top-100 pool once, selects five, and never claims full-pool or library synchronization', async () => {
  vi.useFakeTimers(); const f = fixture(), r = f.reader();
  const pool = normalizeGalleryPool('futgg', futggTruncatedGalleryPool(), 116);
  f.control.raw = pool.items.map(row => ({ resourceId: row.eaId, isCollected: true, gradingScore: row.score }));
  const result = await finish(r.load(pool));
  expect(result).toMatchObject({ status: 'observed', progress: { complete: true, poolComplete: false,
    candidateOnly: true, poolSize: 19489, totals: { total: 100, collected: 100 } } });
  expect(f.calls).toHaveLength(1); expect(f.calls[0].defId).toHaveLength(100);
  expect(f.calls[0].defId).toEqual(pool.items.map(row => row.eaId));
  const catalog = { source: 'futgg', tags: [{ id: 1, name: 'No-op', bonusType: 'ITEM_SCORE_PERCENTAGE',
    thresholdType: 'ITEM_COUNT', rules: [{ attribute: 'RARE', type: 'COUNT', target: 'ATTRIBUTE', values: ['999'] }],
    tiers: [{ minItems: 1, bonus: 0 }] }] };
  const set = { id: 'futgg:116', requiredCards: 5, grades: [] };
  const summary = summarizeGalleryScore({ set, catalog, progress: result.progress });
  expect(summary.lineup).toHaveLength(5);
  expect(summary.lineup.map(row => row.eaId)).toEqual(pool.items.slice(0, 5).map(row => row.eaId));
  expect((await r.load(pool)).cached).toBe(true); expect(f.calls).toHaveLength(1);
  expect(r.syncState().synced).toBe(false);
  r.dispose(); expect((await f.reader().load(pool)).cached).toBe(true); expect(f.calls).toHaveLength(1);
});
it('reads only selected exact versions, coalesces requests and never marks the library synchronized', async () => {
  vi.useFakeTimers(); const f = fixture(), r = f.reader();
  f.control.raw = [{ resourceId: 900002, isCollected: false, gradingScore: 50 }];
  const first = r.readVersions([900002]), duplicate = r.readVersions([900002]);
  expect(await finish(first)).toMatchObject({ status: 'observed', rows: [{ definitionId: 900002, isCollected: false }] });
  expect(await duplicate).toEqual(await first); expect(f.calls.map(c => c.defId)).toEqual([[900002]]);
  expect(r.syncState().synced).toBe(false);
  await finish(r.readVersions([900002])); expect(f.calls).toHaveLength(2);
});
it.each(['missing','foreign','duplicate'])('rejects %s selected-version replies instead of using historical cache', async kind => {
  vi.useFakeTimers(); const f = fixture(), r = f.reader(); await finish(r.load(f.pool));
  f.control.raw = kind === 'missing' ? [] : kind === 'foreign' ? [{ resourceId: 900001 }] : [{ resourceId: 900002 }, { resourceId: 900002 }];
  const result = await finish(r.readVersions([900002]));
  expect(result.status).toBe('blocked'); expect(result.rows).toBeUndefined(); expect(r.syncState().synced).toBe(false);
});
it('uses native DTO/service, default sort, 250 count and one second after each page; coalesces clicks', async () => {
  vi.useFakeTimers(); const f = fixture(), r = f.reader();
  const task = r.load(f.pool), duplicate = r.load(f.pool, { force: true });
  const result = await finish(task); expect(await duplicate).toEqual(result);
  expect(f.calls).toEqual([{ type: 'player', category: 'any', defId: [900001,900002,900003], sort: 'native-sort', count: 250, offset: 0 }]);
  expect(result.progress.rows[0]).toMatchObject({ collected: true, gradingScore: 100, firstOwned: null });
  expect((await r.load(f.pool)).cached).toBe(true); expect(f.calls).toHaveLength(1);
});
it('accepts database-family expansion for a set but stores only its exact pool versions', async () => {
  vi.useFakeTimers(); const f = fixture(), r = f.reader();
  f.control.raw = [{ resourceId: 900001, isCollected: true },
    ...Array.from({ length: 4 }, (_, index) => ({ resourceId: 900001 + 16777216 * (index + 1), isCollected: true }))];
  const result = await finish(r.load(f.pool));
  expect(result.status).toBe('observed');
  expect(result.progress.rows[0]).toMatchObject({ collected: true });
  expect(result.progress.rows).toHaveLength(3);
});
it('keeps an exact version unknown when EA returns only its database-family expansions', async () => {
  vi.useFakeTimers(); const f = fixture(), r = f.reader();
  f.control.raw = Array.from({ length: 3 }, (_, index) => ({
    resourceId: 900001 + 16777216 * (index + 1), isCollected: index === 0,
  }));
  const pool = { ...f.pool, items: [f.pool.items[0]], requiredCards: 1 };
  const first = await finish(r.load(pool));
  expect(first.status).toBe('observed');
  expect(first.progress.rows).toHaveLength(1);
  expect(first.progress.rows[0]).toMatchObject({ eaId: 900001, collected: null });
  expect(f.calls).toHaveLength(1);
  const cached = await finish(r.load(pool));
  expect(cached.cached).toBe(true);
  expect(f.calls).toHaveLength(1);
});
it('ignores one unrelated EA expansion when requested pool versions are present', async () => {
  vi.useFakeTimers(); const f = fixture(), r = f.reader();
  f.control.raw = [{ resourceId: 900001, isCollected: true }, { resourceId: 900002, isCollected: false },
    { resourceId: 900003, isCollected: false }, { resourceId: 800001, isCollected: true }];
  const result = await finish(r.load(f.pool));
  expect(result.status).toBe('observed');
  expect(result.progress.rows.map(row => row.eaId)).toEqual([900001, 900002, 900003]);
});
it('forwards foreground load progress and advances confirmed pages without changing requests', async () => {
  vi.useFakeTimers(); const f = fixture(), r = f.reader(), progress = [];
  f.control.staticIds = Array.from({ length: 300 }, (_, i) => 900000 + i);
  await finish(r.sync(null, { onProgress: value => progress.push(value) }));
  expect(progress).toEqual(expect.arrayContaining([
    expect.objectContaining({ phase: 'ea', completed: 0, pages: 0, count: 0 }),
    expect.objectContaining({ phase: 'ea', completed: 0, pages: 1, count: 250 }),
    expect.objectContaining({ phase: 'ea', completed: 1, pages: 2, count: 300 }),
  ]));
  const selected = [];
  await finish(r.load(f.pool, { force: true, onProgress: value => selected.push(value) }));
  expect(selected).toEqual(expect.arrayContaining([expect.objectContaining({ phase: 'ea', completed: 1, pages: 1, count: 3 })]));
  expect(f.calls.map(row => row.offset)).toEqual([0, 250, 0]);
});
it('reports the active native phase and clears it after the request settles', async () => {
  vi.useFakeTimers(); const f = fixture(), r = f.reader(); f.control.timeout = true;
  const task = r.load(f.pool);
  for (let attempt = 0; attempt < 12 && !f.control.deliver; attempt++) await Promise.resolve();
  expect(typeof f.control.deliver).toBe('function');
  expect(r.syncState()).toMatchObject({ busy: true, running: { kind: 'sync', progress: { phase: 'ea' } } });
  f.control.deliver();
  await finish(task);
  expect(r.syncState()).toMatchObject({ busy: false, running: null });
});
it('preserves Gallery flags dropped by the factory and exact display DTOs', async () => {
  vi.useFakeTimers(); const f = fixture();
  f.control.raw = f.pool.items.map(row => ({ resourceId: row.eaId, assetId: 200000, itemType: 'player', dream: true,
    rating: 86, rareflag: 22, attributeArray: [80,70,60,50,40,30], isCollected: true, gradingScore: 100, secret: 'omit' }));
  const r = f.reader(), result = await finish(r.load(f.pool));
  expect(result.runtimeCards.size).toBe(3); expect(JSON.stringify([...f.store.values()])).not.toContain('secret');
  expect((await r.load(f.pool)).runtimeCards).toEqual(result.runtimeCards);
});
it.each([
  ['Hero', 22, {}], ['Holographics', 200, { 1: 3, 2: 1 }],
])('keeps an uncollected %s display DTO when the reply bypasses the factory hook', async (_name, rareflag, hyperCosmetics) => {
  vi.useFakeTimers(); const f = fixture(); f.control.directDto = true;
  f.control.raw = f.pool.items.map(row => ({ definitionId: row.eaId, resourceId: row.eaId,
    itemType: 'player', dream: true, rareflag, rating: 89, guidAssetId: `version-${row.eaId}`,
    attributeArray: [88,86,90,80,45,78], hyperCosmetics, isCollected: false, gradingScore: 20625,
    secret: 'omit' }));
  const r = f.reader(), result = await finish(r.load(f.pool));
  expect(result.runtimeCards.size).toBe(3);
  expect(result.runtimeCards.get(900001)).toMatchObject({ resourceId: 900001,
    guidAssetId: 'version-900001', rareflag, attributeArray: [88,86,90,80,45,78], hyperCosmetics });
  expect(result.progress.totals).toMatchObject({ collected: 0, missing: 3 });
  expect(result.runtimeCards.get(900001)).not.toHaveProperty('secret');
  expect((await r.load(f.pool)).runtimeCards).toEqual(result.runtimeCards);
  r.dispose();
  const restored = f.reader();
  expect((await restored.load(f.pool)).runtimeCards).toEqual(result.runtimeCards);
  expect(f.calls).toHaveLength(1); restored.dispose();
});
it.each([['Hero',22,{}],['Holographics',200,{1:3,2:1}]])('renders cached native %s entities without requiring the factory observation DTO', async (_name, rareflag, hyperCosmetics) => {
  vi.useFakeTimers(); const f=fixture();
  f.control.entities=f.pool.items.map(row=>Object.assign(galleryEntityFromDto({resourceId:row.eaId,
    itemType:'player',dream:true,rating:89,rareflag,attributeArray:[88,86,90,80,45,78],
    guidAssetId:`version-${row.eaId}`,hyperCosmetics,iconTraits:[1]}),{isCollected:false,gradingScore:20625}));
  const reader=f.reader(), result=await finish(reader.load(f.pool));
  const source=f.control.entities[0];
  expect(result.runtimeCards.get(900001)).toBe(source);
  const element=()=>({nodeType:1,style:{},setAttribute(){},append(){},remove(){}});
  const render=vi.fn(function(){this.renderComplete();});
  f.root.UTItemViewFactory={createLargeItem:()=>({init(){},render,renderComplete(){},getRootElement:element,dealloc(){}})};
  const wrapper=createFc27GalleryNativeRenderer(f.root,{document:{createElement:element}})
    .render({parent:element(),raw:result.runtimeCards.get(900001)});
  expect(wrapper).toBeTruthy();
  const display=render.mock.calls[0][0];
  expect(display).not.toBe(source); expect(display.isValid()).toBe(true);
  expect(display.concept).toBe(false); expect(source.concept).toBe(true);
  expect(display.getPlayStyles()[0].isPlus()).toBe(true);
  expect(display._hyperCosmeticDTOs).toBe(source._hyperCosmeticDTOs);
  expect((await reader.load(f.pool)).runtimeCards.get(900001)).toBe(source);
  expect(f.calls).toHaveLength(1);
  expect(JSON.stringify([...f.store.values()])).not.toMatch(/_staticData|_hyperCosmeticDTOs|_playStyles/);
  f.club.platform='other'; expect((await reader.project(f.pool)).runtimeCards.size).toBe(0);
  wrapper.__fcatDealloc(); reader.dispose();
});
it('persists the observed DTO alongside native rendering and reopens without another EA request', async () => {
  vi.useFakeTimers(); const f=fixture();
  f.control.raw=f.pool.items.map(row=>({resourceId:row.eaId,itemType:'player',dream:true,rating:89,rareflag:22,
    attributeArray:[88,86,90,80,45,78],guidAssetId:`version-${row.eaId}`,hyperCosmetics:{1:3},
    isCollected:false,gradingScore:20625}));
  const reader=f.reader(), result=await finish(reader.load(f.pool));
  expect(result.runtimeCards.get(900001)).toBeInstanceOf(GalleryItemEntity);
  reader.dispose(); const next=f.reader(), restored=await next.load(f.pool);
  expect(restored.runtimeCards.get(900001)).toMatchObject({resourceId:900001,dream:true,hyperCosmetics:{1:3}});
  expect(restored.runtimeCards.get(900001)).not.toBeInstanceOf(GalleryItemEntity);
  expect(f.calls).toHaveLength(1); next.dispose();
});
it('migrates a large legacy collection losslessly and restores it without an EA query', async () => {
  vi.useFakeTimers(); const f = fixture(), original = f.reader();
  await finish(original.load(f.pool)); original.dispose();
  const key = [...f.store.keys()].find(key => key.includes('gallery-collection'));
  const saved = f.store.get(key);
  saved.concepts.push(...Array.from({ length: 1500 }, (_, index) => ({ definitionId: 1000001 + index,
    isCollected: true, gradingScore: 90, collectedOwners: 1, readAt: Date.now(),
    cardData: { resourceId: 1000001 + index, itemType: 'player', dream: true, rating: 80,
      rareflag: 200, hyperCosmetics: { 1: 3 }, attributeArray: [80, 80, 80, 80, 80, 80],
      lifetimeStats: Array(30).fill(100), statsList: Array(30).fill(100) } })));
  const reader = f.reader(), projected = await reader.project(f.pool);
  expect(projected.status).toBe('observed'); expect(f.calls).toHaveLength(1);
  const packed = f.store.get(key);
  expect(packed.schema).toBe(4);
  expect(await decodeGalleryCollectionCache(packed)).toEqual(saved);
  reader.dispose(); const restored = f.reader();
  expect((await restored.project(f.pool)).progress).toEqual(projected.progress);
  expect(f.calls).toHaveLength(1); restored.dispose();
});
it('shares exact version evidence across sets without another EA request', async () => {
  vi.useFakeTimers(); const f = fixture(), r = f.reader(); await finish(r.load(f.pool));
  expect((await r.load({ ...f.pool, setId: 31 })).progress.complete).toBe(true); expect(f.calls).toHaveLength(1);
});
it('waits for startup cache migration before reading or writing collection storage', async () => {
  const f = fixture(); let release;
  const cacheMigration = new Promise(resolve => { release = resolve; });
  const get = vi.fn(f.options.gmGetValue), set = vi.fn(f.options.gmSetValue);
  const reader = createFc27GalleryProgressReader(f.root, { ...f.options, gmGetValue: get, gmSetValue: set, cacheMigration });
  const task = reader.project(f.pool);
  await Promise.resolve(); await Promise.resolve();
  expect(get).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled(); expect(f.calls).toHaveLength(0);
  release(); await task; expect(get).toHaveBeenCalled(); reader.dispose();
});
it('leaves versions absent from a completed full sync unknown, including newly added pool cards', async () => {
  vi.useFakeTimers(); const f = fixture(), r = f.reader();
  f.control.staticIds = [900001]; await finish(r.sync());
  const projected = await r.project(f.pool);
  expect(projected.progress.totals).toMatchObject({ collected: 1, missing: 0, unknown: 2 });
  expect(projected.progress.complete).toBe(false);
  const input = futggGalleryPool(); input.data.items[1].eaId = 990002;
  const changed = normalizeGalleryPool('futgg', input, 30);
  expect((await r.project(changed)).progress.rows[1].collected).toBeNull();
  expect(f.calls).toHaveLength(1);
});
it('restores shared evidence after reload and derives Club presence locally', async () => {
  vi.useFakeTimers(); const f = fixture(), r = f.reader(); await finish(r.load(f.pool)); r.dispose();
  f.root.repositories.Item.club.items._collection.a = { id: 101, definitionId: 900001, type: 'player', concept: false, owners: 1 };
  const restored = await f.reader().load({ ...f.pool, setId: 31 });
  expect(restored.cached).toBe(true); expect(restored.progress.rows[0]).toMatchObject({ collected: true, inClub: true, firstOwned: true });
  expect(f.calls).toHaveLength(1);
});
it('pages actual returned count within 1000-ID groups and syncs all only once per session', async () => {
  vi.useFakeTimers(); const f = fixture(), r = f.reader(); f.control.staticIds = Array.from({ length: 1001 }, (_, i) => 900000 + i);
  expect((await finish(r.sync())).status).toBe('observed');
  expect(f.calls.map(c => [c.defId.length, c.count, c.offset])).toEqual([[1000,250,0],[1000,250,250],[1000,250,500],[1000,250,750],[1000,250,1000],[1,250,0]]);
  expect(r.syncState().synced).toBe(true); expect((await r.sync()).cached).toBe(true); expect(f.calls).toHaveLength(6);
});
it('persists baseline coverage and only queries newly added static IDs after reload', async () => {
  vi.useFakeTimers(); const f = fixture(), r = f.reader(); await finish(r.sync()); r.dispose();
  const next = f.reader(); expect((await finish(next.sync())).cached).toBe(true); expect(f.calls).toHaveLength(1);
  f.control.staticIds.push(990001); await finish(next.sync());
  expect(f.calls.map(c => c.defId)).toEqual([[900001,900002,900003],[990001]]);
  expect((await next.project(f.pool)).progress.totals.collected).toBe(2);
});
it('allows an explicit full refresh to discover offline collection of existing versions', async () => {
  vi.useFakeTimers(); const f = fixture(), r = f.reader(); await finish(r.sync());
  f.control.raw = f.pool.items.map(row => ({ resourceId: row.eaId, isCollected: true, gradingScore: 100 }));
  await finish(r.sync(null, { force: true }));
  expect(f.calls).toHaveLength(2); expect((await r.project(f.pool)).progress.totals.collected).toBe(3);
});
it('retains completed static batches when interrupted and resumes the remaining batch', async () => {
  vi.useFakeTimers(); const f = fixture(), r = f.reader(); f.control.staticIds = Array.from({length:1001},(_,i)=>900000+i);
  expect((await finish(r.sync(null,{onProgress:value=>{if(value.completed===1) r.stop();}}))).status).toBe('stopped'); r.dispose();
  const next = f.reader(); await finish(next.sync());
  expect(f.calls.at(-1).defId).toEqual([901000]); expect(f.calls).toHaveLength(6);
});
it('refreshes stale uncollected versions on opening a set without requerying collected history', async () => {
  vi.useFakeTimers(); const f = fixture(), r = f.reader(); await finish(r.load(f.pool));
  await vi.advanceTimersByTimeAsync(300001);
  await finish(r.load(f.pool)); expect(f.calls.at(-1).defId).toEqual([900002]);
});
it('accepts EA database-family expansion during bounded recheck but retains only requested versions', async () => {
  vi.useFakeTimers(); const f = fixture(), r = f.reader(); await finish(r.sync());
  await vi.advanceTimersByTimeAsync(300001);
  const expanded = 900002 + 16777216;
  f.control.raw = [{ resourceId: 900002, isCollected: false }, { resourceId: expanded, isCollected: true }];
  const result = await finish(r.sync());
  expect(result.status).toBe('observed');
  expect(f.calls.at(-1).defId).toEqual([900002]);
  expect((await r.project(f.pool)).progress.rows[1]).toMatchObject({ collected: false });
  await vi.advanceTimersByTimeAsync(300001);
  f.control.raw = [{ resourceId: 800002, isCollected: true }];
  const rejected = await finish(r.sync());
  expect(rejected.status).toBe('blocked');
  expect(rejected.reason).toBe('FC27_GALLERY_CONCEPT_ID_UNVERIFIED');
});
it('retains historical collection and minimum known owner count after Club cards leave', async () => {
  vi.useFakeTimers(); const f = fixture(), r = f.reader();
  f.factory.createItem({ resourceId: 900001, isCollected: true, gradingScore: 100, dream: false, owners: 2 });
  f.factory.createItem({ resourceId: 900001, isCollected: true, gradingScore: 100, dream: false, owners: 1 });
  await vi.runAllTimersAsync(); f.control.raw = f.pool.items.map(row => ({ resourceId: row.eaId, isCollected: false, gradingScore: 100 }));
  expect((await finish(r.load(f.pool, { force: true }))).progress.rows[0]).toMatchObject({ collected: true, firstOwned: true, inClub: null });
});
it('does not use concept or foreign auction owner counts as history', async () => {
  vi.useFakeTimers(); const f = fixture(), r = f.reader();
  f.factory.createItem({ resourceId: 900001, isCollected: true, gradingScore: 100, dream: true, owners: 1 });
  f.factory.createItem({ resourceId: 900002, isCollected: true, gradingScore: 100, dream: false, owners: 1, auctionValid: true, tradeOwner: false });
  await vi.runAllTimersAsync(); const result = await finish(r.load(f.pool));
  expect(result.progress.rows.slice(0,2).every(row => row.firstOwned === null)).toBe(true);
});
it('stops sync between pages and leaves it available to retry', async () => {
  vi.useFakeTimers(); const f = fixture(), r = f.reader(); f.control.staticIds = Array.from({ length: 300 }, (_, i) => 900000 + i);
  const task = r.sync(); await vi.advanceTimersByTimeAsync(0); r.stop();
  expect((await finish(task)).status).toBe('stopped'); expect(f.calls).toHaveLength(1); expect(r.syncState().synced).toBe(false);
});
it.each([401,429,500])('preserves evidence on final %i without FCAT retry and with shared backoff', async status => {
  vi.useFakeTimers(); const f = fixture(), r = f.reader(); const before = await finish(r.load(f.pool));
  f.control.status = status; const result = await finish(r.load(f.pool, { force: true }));
  expect(result).toMatchObject({ status: 'observed', stale: true, reason: `FC27_GALLERY_HTTP_${status}` });
  expect(result.progress).toEqual(before.progress); expect(f.calls).toHaveLength(2);
  expect((await r.load({ ...f.pool, setId: 31 }, { force: true })).reason).toBe('FC27_GALLERY_PROGRESS_BACKOFF');
});
it('does not require auth hashes or override native auth, and logs no identities', async () => {
  vi.useFakeTimers(); const f = fixture(); f.root.crypto = null;
  expect((await finish(f.reader().load(f.pool))).status).toBe('observed');
  expect(f.events).toEqual(expect.arrayContaining([expect.objectContaining({ event: 'concept-request', phase: 'native-service' })]));
  expect(JSON.stringify(f.events)).not.toMatch(/900001|1001|1002|defId|token/);
});
it('rejects late results after switching account and keeps accounts separate', async () => {
  vi.useFakeTimers(); const f = fixture(), r = f.reader(); f.control.onRead = () => { f.club.platform = 'other'; };
  expect((await finish(r.load(f.pool))).reason).toBe('FC27_GALLERY_CONTEXT_CHANGED');
  f.control.onRead = null; expect((await finish(r.load(f.pool))).cached).toBe(false);
});
it.each(['outside','duplicate'])('rejects %s evidence without replacing complete pool evidence', async kind => {
  vi.useFakeTimers(); const f = fixture(), r = f.reader(); const before = await finish(r.load(f.pool));
  f.control.raw = kind === 'outside' ? [{ resourceId: 800001 }] : [{ resourceId: 900001 },{ resourceId: 900001 }];
  const result = await finish(r.load(f.pool, { force: true })); expect(result.stale).toBe(true); expect(result.progress).toEqual(before.progress);
});
it('keeps missing fields unknown and preserves complete evidence on an incomplete update', async () => {
  vi.useFakeTimers(); const f = fixture(), r = f.reader(); f.control.raw = [{ resourceId: 900001 }];
  expect((await finish(r.load(f.pool))).progress.totals.unknown).toBe(3);
  f.control.raw = null; await finish(r.load(f.pool, { force: true })); f.control.raw = [];
  expect((await finish(r.load(f.pool, { force: true }))).reason).toBe('FC27_GALLERY_CONCEPT_INCOMPLETE');
});
it('times out only its native observer and ignores late delivery', async () => {
  vi.useFakeTimers(); const f = fixture(), r = f.reader(); f.control.timeout = true;
  expect((await finish(r.load(f.pool))).reason).toBe('FC27_GALLERY_CONCEPT_TIMEOUT');
  f.control.deliver(); await vi.runAllTimersAsync(); expect(f.calls).toHaveLength(1);
});
it('coexists with factory wrappers and restores only its own wrapper', () => {
  const f = fixture(), previous = f.root.UTItemEntityFactory.prototype.createItem;
  const wrapper = vi.fn(function(raw) { return previous.call(this, raw); }); f.root.UTItemEntityFactory.prototype.createItem = wrapper;
  const r = f.reader(); f.factory.createItem({ resourceId: 900001, isCollected: true });
  expect(wrapper).toHaveBeenCalledOnce(); r.dispose(); expect(f.root.UTItemEntityFactory.prototype.createItem).toBe(wrapper);
});
it.each(['throw','reject'])('isolates %s storage/log failures from the native read', async kind => {
  vi.useFakeTimers(); const f = fixture();
  const failure = () => { if (kind === 'throw') throw Error('unavailable'); return Promise.reject(Error('unavailable')); };
  f.options.gmSetValue = failure; f.options.diagnosticLog.record = failure;
  expect((await finish(f.reader().load(f.pool))).status).toBe('observed');
});
