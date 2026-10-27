import {expect,it} from 'vitest';
import {createGalleryRoadmapSession} from '../../src/gallery/roadmap-session.js';
import {planGalleryPortfoliosSteps,createGalleryPortfolioWork} from '../../src/gallery/roadmap-portfolios.js';
import {reconcileGalleryRoadmapInputs,retainGalleryRoadmap} from '../../src/gallery/roadmap-retain.js';
const finish=steps=>{let next;do{next=steps.next();}while(!next.done);return next.value;};
const option=(grade,tokens,items)=>({grade,requestedGrade:grade,projectedTokens:tokens,score:100,items:items.map(([eaId,price])=>({eaId,price}))});
const row=(id,options)=>({setId:id,name:id,baselineTokens:0,options});
const pause=steps=>{let next=steps.next();if(!next.done)next=steps.next(true);while(!next.done)next=steps.next(true);return next.value;};

it('keeps verified portfolio routes when an expanded global comparison pauses',()=>{
  const work=createGalleryPortfolioWork(),input={rows:[row('a',[option('S',28,[[1,1000]])]),row('b',[option('S',28,[[2,1000]])])],capital:2000};
  expect(finish(work.run(input)).result.route).toHaveLength(2);
  const next=pause(work.run({...input,rows:[...input.rows,row('c',[option('S',28,[[3,1000]])])]}));
  expect(next.complete).toBe(false);expect(next.result.route.length).toBeGreaterThan(0);
  expect(next.result.portfolios).toHaveLength(3);
});

it('removes changed options but retains unrelated portfolios at a comparison deadline',()=>{
  const work=createGalleryPortfolioWork(),input={rows:[row('a',[option('S',28,[[1,1000]])]),row('b',[option('S',28,[[2,1000]])])],capital:2000};
  finish(work.run(input));
  const next=pause(work.run({...input,rows:[row('a',[]),input.rows[1],row('c',[option('S',28,[[3,1000]])])]}));
  expect(next.result.route.map(value=>value.setId)).toEqual(['b']);
  expect(next.result.funding.totalPurchase).toBe(1000);
});

it('publishes a newly accepted partial route before the first full portfolio comparison finishes',()=>{
  const work=createGalleryPortfolioWork(),input={rows:[row('a',[option('S',28,[[1,1000]])]),row('b',[option('S',28,[[2,1000]])])],capital:2000};
  const steps=work.run(input);let next=steps.next();
  while(!next.done && !(next.value?.completed>0))next=steps.next();
  expect(next.done).toBe(false);next=steps.next(true);while(!next.done)next=steps.next(true);
  expect(next.value.result.route.length).toBeGreaterThan(0);
  expect(next.value.result.portfolios).toHaveLength(3);
  expect(next.value.result.portfolios.every(value=>value.route.length>0)).toBe(true);
});

it('does not replace a stronger retained route with the first weaker checkpoint of a new generation',()=>{
  const work=createGalleryPortfolioWork(),input={rows:[row('a',[option('S',28,[[1,1000]])]),row('b',[option('S',28,[[2,1000]])])],capital:2000};
  finish(work.run(input));const steps=work.run({...input,rows:[...input.rows,row('c',[option('S',28,[[3,1000]])])]});
  let next=steps.next();while(!next.done && next.value?.portfolio?.route.length!==1)next=steps.next();
  expect(next.done).toBe(false);next=steps.next(true);while(!next.done)next=steps.next(true);
  expect(next.value.result.addedTokens).toBeGreaterThanOrEqual(56);
});

it('coalesces changed candidate pools while continuing an already running comparison cursor',()=>{
  const work=createGalleryPortfolioWork(),input={rows:[row('a',[option('S',28,[[1,1000]])]),row('b',[option('S',28,[[2,1000]])])],capital:3000};
  const a=work.run(input),first=a.next();expect(first.value.comparisons).toBe(1);a.next(true);
  const expanded={...input,rows:[...input.rows,row('c',[option('S',28,[[3,1000]])])]},b=work.run(expanded),next=b.next();
  expect(next.value.comparisons).toBeGreaterThan(first.value.comparisons);b.next(true);
  let result,turns=0;do{result=pause(work.run(expanded));}while(!result.complete && ++turns<100);
  expect(result.complete).toBe(true);expect(result.result.route).toHaveLength(3);
});

it('clears comparisons and retained routes on changed budget assumptions',()=>{
  const work=createGalleryPortfolioWork(),input={rows:[row('a',[option('S',28,[[1,1000]])])],capital:2000};
  finish(work.run(input));const result=pause(work.run({...input,capital:500}));
  expect(result.result.route).toEqual([]);expect(finish(work.run({...input,capital:500})).result.route).toEqual([]);
});
const target=(id=1)=>({set:{id:`futgg:${id}`,name:`Set ${id}`,requiredCards:1,grades:['D','C','B','A','S'].map((name,i)=>({name,threshold:10*(i+1),rewards:[{type:'event_token_1',count:1,value:[0,0,5,8,15][i]}]}))},
  status:'observed',catalog:{source:'futgg',revision:'r',tags:[{id:1,name:'No-op',bonusType:'ITEM_SCORE_PERCENTAGE',thresholdType:'ITEM_COUNT',rules:[{attribute:'RARE',type:'COUNT',target:'ATTRIBUTE',values:['999']}],tiers:[{minItems:1,bonus:1}]}]},
  progress:{season:'27',setId:id,complete:true,poolComplete:true,rows:[{eaId:id,playerEaId:id,gradingScore:100,collected:false,firstOwned:false,rarityEaId:1}]},prices:{[id]:1000},
  publicReference:{basis:'empty-collection-public-reference',expiresAt:Date.now()+300000,grades:['B','A','S'].map(grade=>({grade,ids:[id],cost:1000}))}});

it('compares global shared combinations and returns selectable portfolios with S before cheaper B',()=>{
  const rows=[row('s1',[option('S',28,[[1,800]])]),row('s2',[option('S',28,[[1,800]])]),row('b',[option('B',5,[[2,150]])])];
  const result=finish(planGalleryPortfoliosSteps({rows,capital:2000}));
  expect(result.portfolios.map(value=>value.profile)).toEqual(['tokens','loss','capital']);
  expect(result.route.map(value=>value.targetGrade)).toEqual(['S','S','B']);
  expect(result.funding.totalPurchase).toBe(950);expect(result.addedTokens).toBe(61);
  for(const value of result.portfolios){expect(value.route[0].targetGrade).toBe('S');expect(value.searchComplete).toBe(false);}
  expect(finish(planGalleryPortfoliosSteps({rows:[...rows].reverse(),capital:2000})).portfolios).toEqual(result.portfolios);
});

it('falls back to A/B only when S cannot fit the actual revolving capital or loss limit',()=>{
  const rows=[row('s',[option('S',28,[[1,5000]])]),row('a',[option('A',13,[[2,500]])])];
  const result=finish(planGalleryPortfoliosSteps({rows,capital:1000,lossLimit:100}));
  expect(result.route.map(value=>value.targetGrade)).toEqual(['A']);
});

it('preserves unrelated collection work and invalidates only changed and shared ownership inputs',async()=>{
  const a=target(1),b=target(2),session=createGalleryRoadmapSession(),targets=[a,b];
  session.bind(targets,{});
  while(session.pending().length)await session.advance({options:{},maxMs:10000});
  const old=session.entries().map(entry=>({entry,turns:entry.turns}));
  const changed=structuredClone(targets);changed[0].progress.rows[0].collected=true;
  expect(session.bind(changed,{})).toEqual(['futgg:1']);
  expect(session.entries()[1]).toBe(old[1].entry);expect(session.entries()[1].turns).toBe(old[1].turns);
  await session.advance({options:{},maxMs:10000});
  const result=finish(session.snapshotSteps({}));
  expect(result.freeCheck.map(value=>value.setId)).toContain('futgg:1');
  expect(result.route.map(value=>value.setId)).toEqual(['futgg:2']);
  const shared=structuredClone(changed);shared[1].progress.rows.push({...shared[0].progress.rows[0],collected:false});
  expect(session.bind(shared,{})).toEqual(['futgg:2']);
  expect(session.entries()[1].target.progress.rows.find(value=>value.eaId===1).held).toBe(true);
});

it('does not treat a sale of an ever-collected card or a new quote as a scoring/material change',()=>{
  const a=target();a.progress.rows[0].collected=true;a.progress.rows[0].inClub=true;
  const sold=structuredClone(a);sold.progress.rows[0].inClub=false;sold.prices[1]=5000;sold.priceSnapshot={expiresAt:Date.now()+1000};
  const value=reconcileGalleryRoadmapInputs([a],[sold]);expect(value.affected).toEqual([]);
  expect(value.targets[0].prices[1]).toBe(1000);
});

it('withdraws only a collection whose progress or pool becomes stale on return',()=>{
  const a={...target(1),progressKey:'same'},b={...target(2),progressKey:'same'};
  for(const flag of ['stale','poolStale']){
    const current=structuredClone([a,b]);current[0][flag]=true;
    const value=reconcileGalleryRoadmapInputs([a,b],current);
    expect(value.affected).toEqual(['futgg:1']);
    expect(value.targets[0][flag]).toBe(true);
    expect(value.targets[1]).toBe(b);
  }
});

it('retains unaffected portfolios and recalculates only their actual remaining cash requirement',()=>{
  const result=finish(planGalleryPortfoliosSteps({rows:[row('a',[option('S',28,[[1,1000]])]),row('b',[option('S',28,[[2,1000]])])],capital:1500}));
  const all={...result,rows:[row('a',[]),row('b',[])],coverage:{total:2,inspected:2,stopped:false}};
  const kept=retainGalleryRoadmap(all,['a']);expect(kept.route.map(row=>row.setId)).toEqual(['b']);
  expect(kept.funding.totalPurchase).toBe(1000);expect(kept.retainedChanges).toBe(1);
  expect(kept.rows[0].reason).toBe('collection-updated');
  expect(result.route).toHaveLength(2);
});

it('preserves within-collection turnover ordering when withdrawing an affected route',()=>{
  const result=finish(planGalleryPortfoliosSteps({rows:[row('a',[option('S',28,[[1,150]])]),row('b',[option('S',28,[[2,150],[3,1000]])])],capital:1100}));
  const all={...result,rows:[row('a',[]),row('b',[])],coverage:{total:2,inspected:2,stopped:false}};
  const kept=retainGalleryRoadmap(all,['a']);
  expect(kept.route[0].cycles.map(value=>value.eaId)).toEqual([3,2]);
  expect(kept.funding.requiredCapital).toBe(1000);
  expect(kept.funding.expectedNetLoss).toBe(58);
});

it('resumes global portfolio comparisons rather than restarting a tiny deadline at the first option',()=>{
  const work=createGalleryPortfolioWork(),input={rows:[row('a',[option('S',28,[[1,1000]])]),row('b',[option('S',28,[[2,1000]])])],capital:1500};
  let result,turns=0;
  do{const steps=work.run(input);let next=steps.next();if(!next.done)next=steps.next(true);while(!next.done)next=steps.next(true);result=next.value;}while(!result.complete && ++turns<40);
  expect(turns).toBeGreaterThan(0);expect(turns).toBeLessThan(40);expect(result.result.portfolios).toHaveLength(3);
  expect(result.result.route).toHaveLength(2);
});

it('keeps S-before-A funding order instead of treating a cheaper B as an earlier cash-generating step',()=>{
  const result=finish(planGalleryPortfoliosSteps({rows:[row('b',[option('B',5,[[1,1000]])]),row('s',[option('S',28,[[2,500]])])],capital:1000}));
  expect(result.route[0].targetGrade).toBe('S');
  expect(result.funding.feasible).toBe(true);
  expect(result.route).toHaveLength(1); // Tax after S leaves too little for the 1,000 B card.
});

it('offers genuinely different loss, capital and token routes over the same global candidates',()=>{
  const result=finish(planGalleryPortfoliosSteps({rows:[row('one',[option('S',28,[[1,250]])]),row('two',[option('S',28,[[2,150],[3,150]])])],capital:1000}));
  const by=new Map(result.portfolios.map(value=>[value.profile,value]));
  expect(by.get('loss').route.map(value=>value.setId)).toEqual(['one']);
  expect(by.get('capital').route.map(value=>value.setId)).toEqual(['two']);
  expect(by.get('tokens').route).toHaveLength(2);
  expect(by.get('loss').funding.expectedNetLoss).toBe(13);
  expect(by.get('capital').funding.requiredCapital).toBe(158);
  expect(by.get('tokens').addedTokens).toBe(56);
});

it('does not lose same-session ever-owned evidence after a provisional held version is sold',async()=>{
  const session=createGalleryRoadmapSession(),a=target();a.progress.rows[0].inClub=true;
  session.bind([a],{});while(session.pending().length)await session.advance({options:{},maxMs:10000});
  const later=structuredClone(a);later.progress.rows[0].inClub=false;
  expect(session.bind([later],{})).toEqual([]);
  expect(finish(session.snapshotSteps({})).route).toEqual([]);
  expect(finish(session.snapshotSteps({})).freeCheck[0].grade).toBe('S');
  session.clear();expect(session.bind([later],{})).toEqual(['futgg:1']);
});

it('distinguishes lower absolute loss from a shared package with better loss per token',()=>{
  const result=finish(planGalleryPortfoliosSteps({rows:[row('a',[option('S',28,[[1,600]])]),row('b',[option('S',28,[[1,600]])]),row('c',[option('S',28,[[2,500]])])],capital:2000}));
  const low=result.portfolios.find(value=>value.profile==='loss');
  expect(low.route.map(value=>value.setId)).toEqual(['c']);expect(low.funding.expectedNetLoss).toBe(25);
  expect(result.portfolios.find(value=>value.profile==='tokens').addedTokens).toBe(84);
});
