import { expect, it, vi } from 'vitest';
import { createFc27GalleryProgressReader, FC27_GALLERY_READ_METHODS, FC27_GALLERY_AUTH_METHODS } from '../../src/adapters/ea/fc27-gallery-progress.js';
import { normalizeGalleryPool } from '../../src/gallery/pool.js';
import { futggGalleryPool } from '../fixtures/fc27-gallery.js';

function fixture() {
  const calls = [], store = new Map();
  let time = 1000000;
  const control = { status: 200, timeout: false, raw: null, onSend: null, owner: true, statuses: [], deferAuth: false };
  class EAHttpRequest {
    setRequestBody() { throw Error('no writes'); }
    send() { throw Error('unused'); }
    abort() { control.aborted = true; }
    observe(owner, callback) { this.owner = owner; this.callback = callback; }
    unobserve(owner) { if (owner !== this.owner) throw Error('foreign owner'); }
  }
  class UTHttpRequest extends EAHttpRequest {
    _handleFail() { /* Native failure fixture. */ }
    _handleReauth() { /* Native authentication fixture. */ }
    handleTelemetry() { /* Native telemetry fixture. */ }
    setPath(path) { this.url = `https://utas.test.ea.com${path}`; }
    send() {
      calls.push(this); control.onSend?.();
      const ids = new URLSearchParams(this.urlVariables).get('defId').split(',').map(Number);
      const rows = control.raw ?? ids.map(resourceId => ({ resourceId, isCollected: resourceId % 2 === 1, gradingScore: 100 }));
      const status = control.statuses.shift() ?? control.status;
      this.deliver = () => {
        if (status === 401 && this.doReauth) {
          control.authRecoveries = (control.authRecoveries ?? 0) + 1;
          control.resumeAuth = () => this.send();
          if (!control.deferAuth) queueMicrotask(control.resumeAuth);
          return;
        }
        this.callback(control.owner ? this : {}, { success: status === 200, status, response: { itemData: rows } });
      };
      if (!control.timeout) this.deliver();
    }
  }
  class UTItemDAO { searchConceptItems() { throw Error('shared factory must not run'); } }
  class FCAuthenticationService { requestTelemetry() { /* Native auth telemetry. */ } }
  const club = { sku: 'test27', year: 2027, platform: 'pc' };
  const persona = { id: 1002, _sku: club.sku, clubs: { _collection: { [club.sku]: club } } };
  const user = { id: 1001, selectedPersona: persona.id, _personas: { _collection: { [persona.id]: persona } } };
  const root = { APP_YEAR: 2027, APP_YEAR_SHORT: 27, GAME_NAME: 'fc27', UTHttpRequest, EAHttpRequest, UTItemDAO, FCAuthenticationService,
    services: { User: { currentUserId: user.id, repository: { _collection: { [user.id]: user } } }, Item: { itemDao: { authDelegate: {} } } },
    repositories: { Item: { club: { items: { _collection: {} } } } } };
  const hashes = new Map([...FC27_GALLERY_READ_METHODS, ...FC27_GALLERY_AUTH_METHODS].map(([path, hash]) => [String(path.split('.').reduce((v,k) => v[k], root)), hash]));
  root.crypto = { subtle: { digest: async (_, bytes) => Uint8Array.from((hashes.get(new TextDecoder().decode(bytes)) ?? '0'.repeat(64)).match(/../g).map(hex => parseInt(hex, 16))).buffer } };
  const options = { gmGetValue: key => store.get(key), gmSetValue: (key,value) => store.set(key,structuredClone(value)), now: () => time };
  const reader = () => createFc27GalleryProgressReader(root, options);
  const pool = normalizeGalleryPool('futgg', futggGalleryPool(), 30);
  return { root, user, persona, club, control, calls, store, reader, options, pool, advance: ms => { time += ms; } };
}

it('reads raw Gallery flags with one exact GET, no factory/Club scan, and coalesces forced requests', async () => {
  const f = fixture(), r = f.reader();
  const [a,b] = await Promise.all([r.load(f.pool), r.load(f.pool,{force:true})]);
  expect(a).toEqual(b); expect(f.calls).toHaveLength(1);
  expect(f.calls[0]).toMatchObject({ requestType:'GET', doRetry:false, doReauth:false,
    urlVariables:'?type=player&count=3&sort=asc&start=0&defId=900001,900002,900003' });
  expect(a.progress.rows[0]).toMatchObject({ collected:true, gradingScore:100, inClub:null, firstOwned:null });
  expect((await r.load(f.pool)).cached).toBe(true); expect(f.calls).toHaveLength(1);
});

it('restores account cache and recomputes Club/FO from current provisional entities', async () => {
  const f = fixture(); await f.reader().load(f.pool);
  f.root.repositories.Item.club.items._collection.a={id:101,definitionId:900001,type:'player',concept:false,owners:1};
  const restored = await f.reader().load(f.pool);
  expect(restored.cached).toBe(true);
  expect(restored.progress.rows[0]).toMatchObject({collected:true,inClub:true,firstOwned:true});
  expect(f.calls).toHaveLength(1);
  expect(JSON.stringify([...f.store.values()])).not.toContain('"id":101');
});

it('restores exact-version display DTOs without a second EA request or persisting native entities', async () => {
  const f=fixture();
  f.control.raw=f.pool.items.map(row=>({resourceId:row.eaId,assetId:200000,itemType:'player',dream:true,
    rating:86,rareflag:22,guidAssetId:`version-${row.eaId}`,attributeArray:[80,70,60,50,40,30],
    hyperCosmetics:{1:0},isCollected:true,gradingScore:100,privateAccountValue:'omit'}));
  const first=await f.reader().load(f.pool), restored=await f.reader().load(f.pool);
  expect(first.runtimeCards.size).toBe(3);expect(restored.runtimeCards).toEqual(first.runtimeCards);
  expect(restored.cached).toBe(true);expect(f.calls).toHaveLength(1);
  expect(JSON.stringify([...f.store.values()])).not.toContain('privateAccountValue');
  expect(restored.progress.rows[0].cardData).toBeUndefined();
  // Old complete progress caches remain usable, with text until normal expiry.
  for(const value of f.store.values()){value.schema=1;for(const row of value.concepts)delete row.cardData;}
  const old=await f.reader().load(f.pool);expect(old.runtimeCards.size).toBe(0);
  expect(old.progress).toEqual(first.progress);expect(f.calls).toHaveLength(1);
});

it('isolates platform/persona/season and rejects late results after account switching', async () => {
  const f=fixture(), r=f.reader(); await r.load(f.pool);
  f.advance(1001); f.club.platform='psn';
  expect((await r.load(f.pool)).cached).toBe(false); expect(f.calls).toHaveLength(2);
  f.advance(300001); f.control.onSend=()=>{f.user.selectedPersona=999;};
  const pending=await r.load(f.pool);
  expect(pending).toMatchObject({status:'blocked',reason:'FC27_GALLERY_CONTEXT_CHANGED'});
  expect(pending.progress).toBeUndefined();
  f.user.selectedPersona=1002; f.root.APP_YEAR_SHORT=26;
  expect((await r.load(f.pool)).reason).toBe('FC27_CONTEXT_UNAVAILABLE');
});

it('rechecks context after asynchronous GM read before serving a cached snapshot', async () => {
  const f=fixture(); await f.reader().load(f.pool);
  const read=f.options.gmGetValue;
  f.options.gmGetValue=async key=>{f.club.platform='other';return read(key);};
  expect(await f.reader().load(f.pool)).toEqual({status:'blocked',reason:'FC27_GALLERY_CONTEXT_CHANGED'});
  expect(f.calls).toHaveLength(1);
});

it.each([401,429,500])('preserves complete cache on HTTP %i and backs off repeated clicks', async status => {
  const f=fixture(),r=f.reader(); const before=await r.load(f.pool); f.advance(300001); f.control.status=status;
  const failed=await r.load(f.pool);
  expect(failed).toMatchObject({status:'observed',stale:true,reason:`FC27_GALLERY_HTTP_${status}`});
  expect(failed.progress).toEqual(before.progress);
  expect((await r.load(f.pool,{force:true})).reason).toBe('FC27_GALLERY_PROGRESS_BACKOFF');
  expect(f.calls).toHaveLength(status===401 ? 3 : 2);
});

it.each(['outside','duplicate','owner'])('rejects %s concept evidence', async kind => {
  const f=fixture();
  if(kind==='outside')f.control.raw=[{resourceId:800001,isCollected:true}];
  if(kind==='duplicate')f.control.raw=[{resourceId:900001},{resourceId:900001}];
  if(kind==='owner')f.control.owner=false;
  expect((await f.reader().load(f.pool)).status).toBe('blocked');expect(f.store.size).toBe(0);
});

it('keeps missing fields unknown and does not replace a complete snapshot with a partial response', async () => {
  const f=fixture(),r=f.reader(); f.control.raw=[{resourceId:900001}];
  const partial=await r.load(f.pool);
  expect(partial.progress).toMatchObject({complete:false,totals:{unknown:3}});
  f.advance(300001); f.control.raw=null; const full=await r.load(f.pool);
  f.advance(300001); f.control.raw=[];
  expect(await r.load(f.pool)).toMatchObject({stale:true,reason:'FC27_GALLERY_CONCEPT_INCOMPLETE',progress:full.progress});
});

it('invalidates same-length pool revisions and ignores damaged persistent data', async () => {
  const f=fixture(),r=f.reader(); await r.load(f.pool);f.advance(1001);
  const input=futggGalleryPool();input.data.items[0].score=999;
  const changed=normalizeGalleryPool('futgg',input,30);
  expect(changed.revision).not.toBe(f.pool.revision);
  expect((await r.load(changed)).cached).toBe(false);
  const key=[...f.store.keys()][0];f.store.get(key).concepts=[{definitionId:123}];f.advance(1001);
  expect((await f.reader().load(changed)).cached).toBe(false);expect(f.calls).toHaveLength(3);
});

it('batches large sets by exact 250 IDs with serialized requests and no repeated IDs', async () => {
  vi.useFakeTimers();
  try {
    const f=fixture();f.options.now=()=>Date.now();const input=futggGalleryPool();
    input.data.items=Array.from({length:251},(_,i)=>({...input.data.items[0],eaId:900000+i}));input.data.poolSize=251;
    const pending=f.reader().load(normalizeGalleryPool('futgg',input,30));await vi.runAllTimersAsync();
    expect((await pending).progress.complete).toBe(true);expect(f.calls).toHaveLength(2);
    const ids=f.calls.flatMap(call=>new URLSearchParams(call.urlVariables).get('defId').split(','));
    expect(new Set(ids).size).toBe(251);
  }finally{vi.useRealTimers();}
});

it('times out once without replaying the request', async () => {
  vi.useFakeTimers();try {
    const f=fixture();f.control.timeout=true;
    const pending=f.reader().load(f.pool);await vi.runAllTimersAsync();
    expect((await pending).reason).toBe('FC27_GALLERY_CONCEPT_TIMEOUT');expect(f.control.aborted).toBe(true);expect(f.calls).toHaveLength(1);
  }finally{vi.useRealTimers();}
});

it('recovers a first 401 through native authentication once for the identical read', async () => {
  const f=fixture(); f.control.statuses=[401,200];
  const result=await f.reader().load(f.pool);
  expect(result.status).toBe('observed'); expect(f.calls).toHaveLength(2);
  expect(f.control.authRecoveries).toBe(1);
  expect(f.calls[0]).toBe(f.calls[1]);
});

it('stops after a second 401 without another native authentication cycle', async () => {
  const f=fixture(); f.control.status=401;
  expect(await f.reader().load(f.pool)).toMatchObject({status:'blocked',reason:'FC27_GALLERY_HTTP_401'});
  expect(f.calls).toHaveLength(2);expect(f.control.authRecoveries).toBe(1);
});

it.each([429,500])('does not repeat a non-authentication HTTP %i failure', async status => {
  const f=fixture();f.control.status=status;
  expect((await f.reader().load(f.pool)).reason).toBe(`FC27_GALLERY_HTTP_${status}`);
  expect(f.calls).toHaveLength(1);expect(f.control.authRecoveries).toBeUndefined();
});

it('ignores late authentication completion after timeout', async () => {
  vi.useFakeTimers();try {
    const f=fixture();f.control.statuses=[401,200];f.control.deferAuth=true;
    const task=f.reader().load(f.pool);await vi.runAllTimersAsync();
    expect((await task).reason).toBe('FC27_GALLERY_CONCEPT_TIMEOUT');
    f.control.resumeAuth();expect(f.calls).toHaveLength(1);expect(f.store.size).toBe(0);
  }finally{vi.useRealTimers();}
});

it('rejects account changes before the recovered request is dispatched', async () => {
  const f=fixture();f.control.statuses=[401,200];f.control.deferAuth=true;
  const task=f.reader().load(f.pool);
  await vi.waitFor(()=>expect(f.control.resumeAuth).toBeTypeOf('function'));
  f.club.platform='other';f.control.resumeAuth();
  expect((await task).reason).toBe('FC27_GALLERY_CONTEXT_CHANGED');expect(f.calls).toHaveLength(1);
});
