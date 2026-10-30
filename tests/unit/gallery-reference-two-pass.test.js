import { expect, it } from 'vitest';
import { verifyGalleryReferenceSteps } from '../../src/gallery/verify-reference-plan.js';
import { createGalleryRoadmapSession } from '../../src/gallery/roadmap-session.js';
import { createGalleryRoadmapWork } from '../../src/gallery/roadmap-work.js';
const finish = steps => { let next; do { next=steps.next(); } while(!next.done); return next.value; };
const target = (id=1) => ({ status:'observed',
  set:{ id:`futgg:${id}`,name:`Club ${id}`,requiredCards:2,grades:['B','A','S'].map((name,i)=>({name,threshold:150,
    rewards:[{type:'event_token_1',count:1,value:5+i*5}]})) },
  catalog:{source:'futgg',revision:'r',tags:[{id:1,name:'No bonus',bonusType:'ITEM_SCORE_PERCENTAGE',thresholdType:'ITEM_COUNT',
    rules:[{attribute:'RARE',type:'COUNT',target:'ATTRIBUTE',values:['999']}],tiers:[{minItems:1,bonus:0}]}]},
  progress:{season:'27',setId:id,complete:true,poolComplete:true,rows:[1,2,3].map((n)=>({eaId:id*10+n,playerEaId:id*10+n,
    gradingScore:100,collected:n===3,firstOwned:false,rarityEaId:1,overall:80}))},
  prices:{[id*10+1]:1000,[id*10+2]:2000},
  publicReference:{basis:'empty-collection-public-reference',expiresAt:Date.now()+300000,grades:['B','A','S'].map(grade=>({grade,ids:[id*10+1,id*10+2],cost:3000}))} });

it('first verifies a complete public witness, then separately removes redundant purchases',()=>{
  const t=target(),proposal=t.publicReference.grades[0];
  expect(finish(verifyGalleryReferenceSteps({target:t,proposal,refine:false}))).toMatchObject({reached:true,totalPrice:3000});
  expect(finish(verifyGalleryReferenceSteps({target:t,proposal}))).toMatchObject({reached:true,totalPrice:1000});
});

it('visits all reference baselines before starting the expensive removal pass and resumes cheaper results',async()=>{
  const targets=[target(1),target(2)],session=createGalleryRoadmapSession(); session.bind(targets,{});
  await session.advance({options:{},maxMs:10000});
  expect(session.entries()[0].result.rows[0].options[0].items.reduce((sum,row)=>sum+row.price,0)).toBe(3000);
  await session.advance({options:{},maxMs:10000});
  expect(session.entries().every(entry=>entry.result?.rows[0].options.length>0)).toBe(true);
  const baseline=finish(session.snapshotSteps({}));
  expect(baseline.coverage.verified).toBe(2); expect(baseline.coverage.optimizationPending).toBe(2);
  let turns=0;const progress=[];
  while(session.pending().length && ++turns<20) await session.advance({options:{},maxMs:10000,progress:value=>progress.push(value)});
  expect(progress[0]).toMatchObject({taskPhase:'refine',completed:0,total:2});
  expect(progress.every(value=>value.total===2)).toBe(true);
  expect(session.pending()).toHaveLength(0);
  const result=finish(session.snapshotSteps({}));
  expect(result.coverage.completed).toBe(2);expect(result.coverage.optimizationPending).toBe(0);
  expect(result.route.every(row=>row.items.reduce((sum,item)=>sum+item.price,0)===1000)).toBe(true);
});

it('keeps both verification passes under the same identity, ownership, quote and capital guards',()=>{
  for(const refine of [false,true])for(const change of [
    t=>{t.publicReference.expiresAt=0;},t=>{t.progress.rows[0].collected=undefined;},
    t=>{t.publicReference.grades[0].ids=[999,12];},t=>{t.publicReference.grades[0].ids=[11,11];},
    t=>{t.prices[11]=null;},t=>{t.prices[11]=0;},
  ]){
    const t=target();change(t);
    expect(finish(verifyGalleryReferenceSteps({target:t,proposal:t.publicReference.grades[0],refine}))).toBeNull();
  }
  for(const refine of [false,true]){
    const t=target();expect(finish(verifyGalleryReferenceSteps({target:t,proposal:t.publicReference.grades[0],refine,capital:1500}))).toBeNull();
  }
});

it('covers 196 references before refinement and retains pending phase/timing metadata',async()=>{
  // This locks phase coverage/metadata, not 196-collection portfolio search.
  // Zero loss allowance still verifies all references but rejects every paid
  // route in one comparison pass. Full cashflow/routing has separate tests.
  const options={lossLimit:0},session=createGalleryRoadmapSession();session.bind(Array.from({length:196},(_,i)=>target(i+1)),options);
  for(let i=0;i<196;i++)await session.advance({options,maxMs:10000});
  expect(session.entries().every(entry=>entry.verified && entry.phase==='refine')).toBe(true);
  const baseline=finish(session.snapshotSteps(options));
  expect(baseline.coverage).toMatchObject({verified:196,completed:0,optimizationPending:196});
  expect(baseline.pendingTasks).toHaveLength(13);
  expect(baseline.pendingTasks[0]).toMatchObject({setId:'futgg:1',phase:'refine',turns:1});
  expect(baseline.microSteps).toBeGreaterThan(196);
  session.clear();expect(session.pending()).toHaveLength(0);
});

it('releases transient scoring memos between passes without replaying the completed baseline',()=>{
  const work=createGalleryRoadmapWork(),t=target();let created=0;
  expect(work.memo(t,'scorer',()=>++created)).toBe(1);
  expect(finish(work.run(t,'baseline',function*(){return 100;}))).toEqual({complete:true,value:100});
  work.releaseMemos(t);
  expect(work.memo(t,'scorer',()=>++created)).toBe(2);
  expect(finish(work.run(t,'baseline',function*(){throw Error('must not recompute');}))).toEqual({complete:true,value:100});
});
