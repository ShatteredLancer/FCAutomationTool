import { expect, it, vi } from 'vitest';
import { summarizeGalleryScore, summarizeGalleryScoreSteps } from '../../src/gallery/scoring.js';
import { createGalleryScoreQueue } from '../../src/gallery/score-queue.js';
import { createGalleryScoreCache } from '../../src/gallery/score-cache.js';

const input = () => ({ set: {id:'futgg:1',requiredCards:11,grades:[{name:'D',threshold:10}]},
  catalog: {source:'futgg',tags:[{id:1,name:'rare',bonusType:'ITEM_SCORE_PERCENTAGE',thresholdType:'ITEM_COUNT',
    rules:[{attribute:'RARE',type:'COUNT',target:'ATTRIBUTE',values:['1']}],tiers:[{minItems:2,bonus:10}]}]},
  progress:{season:'27',setId:1,complete:true,rows:Array.from({length:65},(_,i)=>({eaId:i+1,playerEaId:i+1,
    gradingScore:100+i,overall:80,collected:true,rarityEaId:i%2,firstOwned:true}))} });
it('splits selection into small steps while retaining the synchronous scoring result', () => {
  const value=input(), steps=summarizeGalleryScoreSteps(value); let next, count=0;
  do { next=steps.next(); count++; } while(!next.done);
  expect(count).toBeGreaterThan(100); expect(next.value).toEqual(summarizeGalleryScore(value));
});
it('returns immediately, yields while scoring, and caches equal data in new projection objects', async () => {
  const schedule=vi.fn(async()=>{}), update=vi.fn(); let clock=0;
  const queue=createGalleryScoreQueue({schedule,now:()=>++clock,onUpdate:update}), value=input();
  expect(queue.read('account-a',value)).toMatchObject({status:'calculating'});
  expect(update).not.toHaveBeenCalled(); await queue.idle();
  expect(schedule.mock.calls.length).toBeGreaterThan(10);
  expect(queue.read('account-a',structuredClone(value))).toEqual(summarizeGalleryScore(value));
  expect(update).toHaveBeenCalledOnce(); queue.dispose();
});
it('discards interrupted or old-account scoring and permits a new run', async () => {
  let release; const schedule=()=>new Promise(resolve=>{release=resolve;});
  const update=vi.fn(), queue=createGalleryScoreQueue({schedule,onUpdate:update});
  queue.read('a',input()); const first=queue.idle(); queue.cancel(); release(); await first;
  expect(update).not.toHaveBeenCalled();
  expect(queue.read('b',input()).status).toBe('calculating'); queue.cancel(); release(); await queue.idle(); queue.dispose();
});
it('invalidates equal-sized projections when scoring inputs change', async () => {
  const update=vi.fn(), queue=createGalleryScoreQueue({schedule:async()=>{},onUpdate:update});
  const original=input(); queue.read('account-a',original); await queue.idle();
  const changed=structuredClone(original); changed.progress.rows[0].gradingScore += 500;
  expect(queue.read('account-a',changed).status).toBe('calculating'); await queue.idle();
  expect(queue.read('account-a',changed)).toEqual(summarizeGalleryScore(changed));
  changed.catalog.tags[0].tiers[0].bonus += 20;
  expect(queue.read('account-a',changed).status).toBe('calculating'); await queue.idle();
  expect(update).toHaveBeenCalledTimes(3); queue.dispose();
});
it('ignores transport metadata but invalidates semantic scoring fields', async () => {
  const queue = createGalleryScoreQueue({ schedule: async () => {} });
  const original = input(); queue.read('account-a', original); await queue.idle();
  const metadata = structuredClone(original);
  metadata.progress.capturedAt = 'new-capture'; metadata.progress.rows[0].displayName = 'renamed';
  expect(queue.read('account-a', metadata).status).not.toBe('calculating');
  metadata.progress.rows[0].overall += 1;
  expect(queue.read('account-a', metadata).status).toBe('calculating');
  await queue.idle(); queue.dispose();
});

it('restores exact scores across reload without repeating the selection search', async () => {
  const records = new Map(), get = async key => records.get(key), set = vi.fn(async (key, value) => records.set(key, structuredClone(value)));
  const cache = () => createGalleryScoreCache({ get, set });
  const first = createGalleryScoreQueue({ cache: cache(), schedule: async () => {} });
  const value = input(); first.read('a', value); await first.idle(); first.dispose();
  expect(set).toHaveBeenCalledOnce();
  let ticks = 0;
  const queue = createGalleryScoreQueue({ cache: cache(), now: () => ++ticks, schedule: async () => {} });
  const renamed = structuredClone(value); renamed.progress.rows.forEach(row => { row.name = 'current name'; });
  queue.read('a', renamed); await queue.idle();
  expect(ticks).toBe(0); expect(queue.read('a', renamed)).toEqual(summarizeGalleryScore(renamed));
  queue.read('b', renamed); await queue.idle(); expect(ticks).toBeGreaterThan(100); queue.dispose();
});

it.each(['firstOwned', 'gradingScore', 'collected', 'holographic'])('never restores a score after %s changes', async field => {
  const records = new Map(), cache = () => createGalleryScoreCache({ get: async key => records.get(key), set: async (key, value) => records.set(key, value) });
  const first = createGalleryScoreQueue({ cache: cache(), schedule: async () => {} });
  const value = input(); first.read('a', value); await first.idle(); first.dispose();
  value.progress.rows[0][field] = field === 'gradingScore' ? 900 : !value.progress.rows[0][field];
  let ticks = 0;
  const next = createGalleryScoreQueue({ cache: cache(), schedule: async () => {}, now: () => ++ticks });
  next.read('a', value); await next.idle(); expect(ticks).toBeGreaterThan(100);
  expect(next.read('a', value)).toEqual(summarizeGalleryScore(value)); next.dispose();
});

it('recalculates when durable storage is corrupt or unavailable', async () => {
  for (const get of [async () => { throw Error(); }, async () => ({ schema: 1, entries: 'bad' })]) {
    const cache = createGalleryScoreCache({ get, set: async () => { throw Error(); } });
    const queue = createGalleryScoreQueue({ cache, schedule: async () => {} });
    const value = input(); queue.read('a', value); await queue.idle();
    expect(queue.read('a', value)).toEqual(summarizeGalleryScore(value)); queue.dispose();
  }
});
