import { expect, it, vi } from 'vitest';
import { normalizeGalleryPool, galleryPoolCachePayload } from '../../src/gallery/pool.js';
import { futggGallery, futggGalleryPool, futggTruncatedGalleryPool } from '../fixtures/fc27-gallery.js';
import { createFc27GalleryCatalogProvider, createFc27GalleryTransport, normalizeFc27GalleryProxy } from '../../src/adapters/browser/fc27-gallery-catalog.js';

it('normalizes a complete FUT.GG pool and keeps exact version identities', () => {
  const pool = normalizeGalleryPool('futgg', futggGalleryPool(), 30);
  expect(pool).toMatchObject({ source: 'futgg', season: '27', setId: 30, requiredCards: 2, poolSize: 3, complete: true });
  expect(pool.items.map(item => item.eaId)).toEqual([900001, 900002, 900003]);
  expect(pool.items[0].playerEaId).toBe(800001);
});

it('keeps only 100 score-descending candidates and preserves incomplete scope through cache', () => {
  const input = futggTruncatedGalleryPool(), original = structuredClone(input);
  const pool = normalizeGalleryPool('futgg', input, 116);
  expect(pool).toMatchObject({ poolSize: 19489, requiredCards: 5, complete: false, candidateOnly: true, candidateLimit: 100 });
  expect(pool.items.map(row => row.eaId)).toEqual(input.data.items.slice(0, 100).map(row => row.eaId));
  expect(normalizeGalleryPool('futgg', galleryPoolCachePayload(pool), 116)).toEqual(pool);
  expect(input).toEqual(original);
});

it('validates the entire returned prefix before limiting candidates', () => {
  const duplicate = futggTruncatedGalleryPool(); duplicate.data.items[999].eaId = duplicate.data.items[0].eaId;
  expect(() => normalizeGalleryPool('futgg', duplicate, 116)).toThrow('FC27_GALLERY_POOL_INVALID');
  const unordered = futggTruncatedGalleryPool(); unordered.data.items[999].score = 20000;
  expect(() => normalizeGalleryPool('futgg', unordered, 116)).toThrow('FC27_GALLERY_POOL_INVALID');
  const short = futggTruncatedGalleryPool(); short.data.items = short.data.items.slice(0, 4);
  expect(() => normalizeGalleryPool('futgg', short, 116)).toThrow('FC27_GALLERY_POOL_INVALID');
  const empty = futggGalleryPool(); empty.data.items = []; empty.data.poolSize = 0;
  expect(normalizeGalleryPool('futgg', empty, 30).items).toEqual([]);
});

it('persists and restores bounded candidates without a second public pool request', async () => {
  const store = new Map();
  const getPool = vi.fn(async () => ({ status: 200, text: JSON.stringify(futggTruncatedGalleryPool()), headers: {} }));
  const make = () => createFc27GalleryCatalogProvider({ http: { get: vi.fn(), getPool }, now: () => 1000,
    gmGetValue: key => store.get(key), gmSetValue: (key, value) => store.set(key, structuredClone(value)) });
  const first = await make().loadPool({ setId: 116 });
  expect(first.pool.items).toHaveLength(100);
  expect(await make().loadPool({ setId: 116 })).toMatchObject({ cached: true, pool: first.pool });
  expect(getPool).toHaveBeenCalledTimes(1);
});

it('rejects truncated, duplicate, and mismatched pools', () => {
  const truncated = futggGalleryPool(); truncated.data.isTruncated = true;
  expect(() => normalizeGalleryPool('futgg', truncated, 30)).toThrow('FC27_GALLERY_POOL_INVALID');
  const duplicate = futggGalleryPool(); duplicate.data.items[1].eaId = duplicate.data.items[0].eaId;
  expect(() => normalizeGalleryPool('futgg', duplicate, 30)).toThrow('FC27_GALLERY_POOL_INVALID');
  const wrongSet = futggGalleryPool(31);
  expect(() => normalizeGalleryPool('futgg', wrongSet, 30)).toThrow('FC27_GALLERY_POOL_INVALID');
});

it('loads one exact set pool, coalesces requests, and preserves a verified snapshot on failure', async () => {
  let time = 1000; const store = new Map(); const calls = [];
  const get = vi.fn(async (source, headers) => { calls.push({ source, headers }); return { status: 200, text: JSON.stringify(futggGallery()), headers: {} }; });
  const poolGet = vi.fn(async (setId, headers) => { calls.push({ setId, headers }); return { status: 200, text: JSON.stringify(futggGalleryPool(setId)), headers: { etag: '"p1"' } }; });
  const provider = createFc27GalleryCatalogProvider({ http: { get, getPool: poolGet }, now: () => time,
    gmGetValue: key => store.get(key), gmSetValue: (key, value) => store.set(key, value) });
  const [a, b] = await Promise.all([provider.loadPool({ setId: 'futgg:30' }), provider.loadPool({ setId: 30 })]);
  expect(a).toEqual(b); expect(poolGet).toHaveBeenCalledTimes(1); expect(a.pool.items).toHaveLength(3);
  expect((await provider.loadPool({ setId: 30 })).cached).toBe(true);
  time += 300001; poolGet.mockResolvedValueOnce({ status: 503, headers: {} });
  const stale = await provider.loadPool({ setId: 30 });
  expect(stale).toMatchObject({ status: 'observed', stale: true, reason: 'FC27_GALLERY_POOL_REFRESH_FAILED' });
  expect(poolGet.mock.calls.at(-1)).toEqual([30, { 'If-None-Match': '"p1"' }]);
  expect((await provider.peekPool({ setId: 30 })).pool.revision).toBe(a.pool.revision);
});

it('transport only permits numeric FUT.GG pool paths', async () => {
  let request; const transport = createFc27GalleryTransport(value => { request = value; });
  const pending = transport.getPool(30, { 'If-None-Match': '"p1"', Authorization: 'private' });
  expect(request).toMatchObject({ method: 'GET', anonymous: true,
    url: 'https://www.fut.gg/api/fut/gallery/fc27/sets/30/pool/', headers: { 'If-None-Match': '"p1"' } });
  expect(request.headers.Authorization).toBeUndefined();
  request.onload({ status: 200, responseText: '{}', responseHeaders: '', finalUrl: request.url });
  await expect(pending).resolves.toMatchObject({ status: 200 });
  await expect(transport.getPool('30')).rejects.toThrow('FC27_GALLERY_POOL_ID_INVALID');
});

it('routes FUT.GG Gallery requests through the configured HTTPS forwarding proxy', async () => {
  let request; const transport = createFc27GalleryTransport(value => { request = value; }, { proxy: 'https://proxy.example/futgg/' });
  const pending = transport.getPool(30);
  expect(request).toMatchObject({ method: 'GET', anonymous: true,
    url: 'https://proxy.example/futgg?futggapi=gallery/fc27/sets/30/pool/' });
  request.onload({ status: 200, responseText: '{}', responseHeaders: '', finalUrl: request.url });
  await expect(pending).resolves.toMatchObject({ status: 200 });
  expect(() => normalizeFc27GalleryProxy('http://127.0.0.1:1080')).toThrow('FC27_GALLERY_PROXY_INVALID');
  expect(() => normalizeFc27GalleryProxy('socks5://127.0.0.1:1080')).toThrow('FC27_GALLERY_PROXY_INVALID');
});

it('restores pool cache with 304 and rejects unknown sources and invalid persisted seasons', async () => {
  const store=new Map();let time=1000;
  const getPool=vi.fn(async()=>({status:200,text:JSON.stringify(futggGalleryPool()),headers:{etag:'"pool"'}}));
  const make=()=>createFc27GalleryCatalogProvider({http:{get:vi.fn(),getPool},now:()=>time,
    gmGetValue:k=>store.get(k),gmSetValue:(k,v)=>store.set(k,v)});
  const p=make();await p.loadPool({setId:30});time+=300001;
  getPool.mockResolvedValueOnce({status:304,headers:{}});
  expect((await make().loadPool({setId:30})).status).toBe('observed');
  expect(getPool.mock.calls.at(-1)).toEqual([30,{'If-None-Match':'"pool"'}]);
  expect((await p.loadPool({source:'fodder',setId:30})).status).toBe('blocked');
  expect((await p.loadPool({setId:'futgg:99999999999999999999'})).status).toBe('blocked');
  store.get(p.poolCacheKey).season='26';
  expect(await make().peekPool({setId:30})).toBeNull();
});

it('honors pool backoff including forced clicks and does not lose concurrent set writes', async () => {
  const store=new Map();let time=1000;
  const getPool=vi.fn(async setId=>({status:200,text:JSON.stringify(futggGalleryPool(setId)),headers:{}}));
  let release;let writes=0;
  const p=createFc27GalleryCatalogProvider({http:{get:vi.fn(),getPool},now:()=>time,
    gmSetValue:async(k,v)=>{if(++writes===1)await new Promise(resolve=>{release=resolve;});store.set(k,v);}});
  const a=p.loadPool({setId:30});await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
  const b=p.loadPool({setId:31});release();await Promise.all([a,b]);
  expect(store.get(p.poolCacheKey).entries.map(e=>e.setId).sort()).toEqual([30,31]);
  time+=300001;getPool.mockResolvedValueOnce({status:429,headers:{'retry-after':'600'}});
  expect((await p.loadPool({setId:30})).stale).toBe(true);
  const count=getPool.mock.calls.length;
  expect((await p.loadPool({setId:30,force:true})).error).toBe('FC27_GALLERY_BACKOFF');
  expect(getPool).toHaveBeenCalledTimes(count);
});
