import { expect, it, vi } from 'vitest';
import { summarizeGalleryScore, summarizeGalleryScoreSteps } from '../../src/gallery/scoring.js';
import { createGalleryScoreQueue } from '../../src/gallery/score-queue.js';

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
