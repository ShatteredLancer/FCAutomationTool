import {expect,it} from 'vitest';
import {galleryPlanSlots} from '../../src/gallery/plan-slots.js';
const fixture=(owned=1,purchases=14)=>{
  const rows=Array.from({length:owned+purchases},(_,i)=>({eaId:i+1,playerEaId:i+1,gradingScore:100,galleryScore:100,collected:i<owned}));
  return {set:{requiredCards:15},progress:{complete:true,rows},items:rows.slice(owned).map(row=>({...row,price:200})),scoringLineupIds:rows.map(row=>row.eaId)};
};
it('explains 14 purchases plus one already-collected scoring version as a full 15-player plan',()=>{
  expect(galleryPlanSlots(fixture())).toMatchObject({status:'complete',required:15,scoringCount:15,ownedCount:1,purchaseCount:14,ownedIds:[1]});
});
it('blocks an actual fourteen-player plan even when a high score could reach the grade threshold',()=>{
  expect(galleryPlanSlots(fixture(0,14))).toMatchObject({status:'incomplete',scoringCount:14,missingCount:1});
});
it('does not count a collected zero-score version or borrow a positive catalog score over EA zero',()=>{
  const input=fixture();input.progress.rows[0].gradingScore=0;
  expect(galleryPlanSlots(input).status).not.toBe('complete');
  input.scoringLineupIds=null;
  expect(galleryPlanSlots(input)).toMatchObject({status:'incomplete',ownedCount:0,scoringCount:14});
  input.progress.rows[1].gradingScore=0;
  expect(galleryPlanSlots(input).scoringCount).toBe(13);
});
it('does not infer ownership from totals, unknown collection status or a missing grading score',()=>{
  const input=fixture();input.progress.totals={collected:15};input.progress.rows[0].collected=null;
  expect(galleryPlanSlots(input).status).not.toBe('complete');
  input.scoringLineupIds=null;expect(galleryPlanSlots(input).ownedCount).toBe(0);
  input.progress.rows[0].collected=true;input.progress.rows[0].gradingScore=null;
  expect(galleryPlanSlots(input).status).not.toBe('complete');
});
it('rejects duplicate or foreign versions in the planned witness and shopping rows',()=>{
  const input=fixture();input.scoringLineupIds[14]=input.scoringLineupIds[0];expect(galleryPlanSlots(input).status).toBe('unverified');
  const foreign=fixture();foreign.items[0].eaId=999;expect(galleryPlanSlots(foreign).status).toBe('unverified');
  const duplicate=fixture();duplicate.items.push(duplicate.items[0]);expect(galleryPlanSlots(duplicate).status).toBe('unverified');
});
it('counts separate eligible versions of the same footballer, and keeps sold/consumed collected versions',()=>{
  const input=fixture();input.progress.rows.forEach(row=>{row.playerEaId=1;row.inClub=false;});
  expect(galleryPlanSlots(input).status).toBe('complete');
});
it('supports old cached plans without claiming an exact selected lineup, and rejects incomplete progress',()=>{
  const input=fixture();delete input.scoringLineupIds;expect(galleryPlanSlots(input)).toMatchObject({status:'complete',witnessed:false});
  input.progress.complete=false;expect(galleryPlanSlots(input).status).toBe('unverified');
});
