import { expect, it, vi } from 'vitest';
import { createFc27GallerySync } from '../../src/adapters/browser/fc27-gallery-sync.js';
function fixture() {
  let scope = 'account-a', synced = false;
  const pools = new Map(), trace = [];
  const provider = { load: async () => ({ source: 'futgg', catalog: { categories: [{ sets: [{id:1},{id:2}] }] } }),
    peek: async () => ({ source: 'futgg', catalog: { categories: [{ sets: [{id:1},{id:2}] }] } }),
    peekPool: async ({setId}) => pools.get(setId) ?? null,
    loadPool: vi.fn(async ({setId}) => { trace.push(`pool:${setId}`); const result = {status:'observed',pool:{source:'futgg',setId,revision:`rev-${setId}`}}; pools.set(setId,result); return result; }) };
  const reader = { scope: () => scope, syncState: () => ({synced}), stop: vi.fn(), subscribe: () => () => {},
    project: async pool => ({status:'observed',scope,pool,progress:{setId:pool.setId,complete:true}}),
    sync: vi.fn(async pool => { trace.push(pool ? `ea:${pool.setId}` : 'ea:all'); synced = true; return {status:'observed',scope}; }) };
  const wait = vi.fn(async () => {}), make = () => createFc27GallerySync({provider,reader,wait});
  return {provider,reader,wait,trace,pools,make,switchAccount: () => {scope='account-b';}};
}
it('does one full native sync, serial public pool mapping, and no per-set EA/price reads', async () => {
  const f=fixture(), sync=f.make(), progress=[];
  expect((await sync.sync({source:'futgg',onProgress:p=>progress.push(p)})).details).toHaveLength(2);
  expect(f.trace).toEqual(['ea:all','pool:1','pool:2']); expect(f.reader.sync).toHaveBeenCalledOnce();
  expect(f.wait.mock.calls).toEqual([[0],[0]]); expect(sync.state().synced).toBe(true);
});
it('restores all cached pool mappings after refresh without HTTP or native queries', async () => {
  const f=fixture();await f.make().sync({source:'futgg'});f.trace.length=0;
  expect(await f.make().peekDetails('futgg')).toHaveLength(2);expect(f.trace).toEqual([]);
});
it('syncs the current pool only and shares the projected results', async () => {
  const f=fixture();await f.make().sync({source:'futgg',setId:2});
  expect(f.trace).toEqual(['pool:2','ea:2']);expect(f.reader.sync.mock.calls[0][0]).toMatchObject({setId:2});
});
it('stops public fanout on 429, retains progress, and permits mapping retry', async () => {
  const f=fixture(),sync=f.make();f.provider.loadPool.mockResolvedValue({status:'blocked',reason:'FC27_GALLERY_POOL_UNAVAILABLE',error:'HTTP 429'});
  expect((await sync.sync({source:'futgg'})).status).toBe('partial');expect(f.provider.loadPool).toHaveBeenCalledOnce();
  expect(sync.state().synced).toBe(false);
});
it('coalesces repeated clicks and stops before mapping after a native failure', async () => {
  const f=fixture(),sync=f.make();f.reader.sync.mockResolvedValue({status:'blocked',reason:'FC27_GALLERY_HTTP_401'});
  const a=sync.sync({source:'futgg'}),b=sync.sync({source:'futgg'});expect(a).toBe(b);
  expect((await a).reason).toBe('FC27_GALLERY_HTTP_401');expect(f.provider.loadPool).not.toHaveBeenCalled();
});
it('does not map a result to another account or silently use a fallback source', async () => {
  const f=fixture(),sync=f.make();expect((await sync.sync({source:'fodder'})).status).toBe('blocked');
  f.reader.sync.mockImplementation(async()=>{f.switchAccount();return {status:'observed',scope:'account-a'};});
  await sync.sync({source:'futgg'});expect(f.provider.loadPool).not.toHaveBeenCalled();expect(sync.state().synced).toBe(false);
});
it('lets a selected collection preempt a background full sync without stale task cleanup', async () => {
  const f = fixture(), sync = f.make();
  let release;
  f.provider.loadPool.mockImplementation(async ({setId}) => {
    f.trace.push(`pool:${setId}`);
    if (setId === 1 && !release) await new Promise(resolve => { release = resolve; });
    const result = { status: 'observed', pool: { source: 'futgg', setId, revision: `rev-${setId}` } };
    f.pools.set(setId, result); return result;
  });
  const full = sync.sync({source:'futgg'});
  for (let attempt = 0; attempt < 20 && !release; attempt++) await Promise.resolve();
  expect(typeof release).toBe('function');
  expect(sync.state()).toMatchObject({ busy: true, task: { active: true, setId: null, stopped: false } });
  const selected = sync.sync({source:'futgg', setId:2});
  release();
  expect((await selected).status).toBe('observed');
  expect((await full).status).toBe('stopped');
  expect(f.trace).toContain('pool:2');
  expect(sync.state()).toMatchObject({ busy: false, task: { active: false }, reader: { busy: false } });
});
