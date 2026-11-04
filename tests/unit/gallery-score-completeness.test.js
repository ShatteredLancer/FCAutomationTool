import {expect,it} from 'vitest';
import {planGalleryRoadmapSteps} from '../../src/gallery/roadmap.js';
import {planGalleryPortfoliosSteps} from '../../src/gallery/roadmap-portfolios.js';
import {filterGalleryRoadmapRoutes} from '../../src/gallery/roadmap-retain.js';
import {createGalleryRoadmapSession} from '../../src/gallery/roadmap-session.js';
import {planGalleryGradeSteps} from '../../src/gallery/planner.js';
import {selectGalleryRoadmapSteps} from '../../src/gallery/roadmap-selection.js';
import {createGalleryDemandWork} from '../../src/gallery/roadmap-demand.js';
const finish=steps=>{let next;do{next=steps.next();}while(!next.done);return next.value;};
const heroTarget=(owned=2,missing=3)=>{
  const card=(id,collected)=>({eaId:id,playerEaId:id,gradingScore:10000,galleryScore:10000,collected,
    firstOwned:false,overall:80,holographic:false,rarityEaId:1,clubEaId:1,leagueEaId:1,nationEaId:1,positions:['ST'],skillMoves:3,weakFoot:3});
  const rows=[...Array.from({length:owned},(_,i)=>card(i+1,true)),...Array.from({length:missing},(_,i)=>card(i+11,false))];
  return {status:'observed',catalog:{source:'futgg',tags:[{id:1,name:'No bonus',bonusType:'ITEM_SCORE_PERCENTAGE',thresholdType:'ITEM_COUNT',rules:[{type:'COUNT',target:'ATTRIBUTE',attribute:'RARE',values:['999']}],tiers:[{minItems:1,bonus:0}]}]},
    set:{id:'futgg:1',name:'Heroes control',requiredCards:5,grades:['D','C','B','A','S'].map((name,i)=>({name,threshold:(i+1)*100,rewards:[]}))},
    progress:{season:'27',setId:1,complete:true,poolComplete:true,rows},prices:Object.fromEntries(rows.filter(row=>!row.collected).map(row=>[row.eaId,200]))};
};
it('requires all five scoring slots even when one high-score Hero alone exceeds every grade threshold',()=>{
  for(let owned=0;owned<5;owned++){
    const result=finish(planGalleryRoadmapSteps({targets:[heroTarget(owned,5-owned)],objective:'score'}));
    expect(result.route[0].items).toHaveLength(5-owned);
    expect(result.route[0].scoringSlots).toMatchObject({status:'complete',required:5,scoringCount:5,ownedCount:owned,purchaseCount:5-owned});
  }
  const short=finish(planGalleryRoadmapSteps({targets:[heroTarget(2,1)],objective:'score'}));
  expect(short.route).toEqual([]);expect(short.addedScore).toBe(0);
});
it('independently rejects a reached flag if the score proposal only fills three of five slots',()=>{
  function* broken(){return {status:'ready',plans:[{reached:true,lineupComplete:true,score:999999,totalPrice:200,items:[{eaId:11,price:200}]}]};}
  const result=finish(planGalleryRoadmapSteps({targets:[heroTarget()],objective:'score',gradePlanner:broken}));
  expect(result.route).toEqual([]);
});
it('never credits held-but-not-collected Heroes as filled Gallery slots in a score route',()=>{
  const target=heroTarget(2,3);
  target.progress.rows[2].held=true;target.progress.rows[3].inClub=true;
  const result=finish(planGalleryRoadmapSteps({targets:[target],objective:'score'}));
  expect(result.route).toEqual([]);expect(result.addedScore).toBe(0);
  const local=finish(planGalleryGradeSteps({...target,targetGrade:50000,confirmedCollectionOnly:true}));
  expect(local.plans).toEqual([]);expect(local.pendingCollectionCount).toBe(2);
  // Keep the original grade/token planner contract; confirmed-only is opt-in.
  expect(finish(planGalleryGradeSteps({...target,targetGrade:'S'})).plans[0].items).toHaveLength(1);
});
it('resumes after native collection confirmation even when the physical-held flags did not change',async()=>{
  const target=heroTarget(2,3);target.progress.rows[2].held=true;target.progress.rows[3].held=true;
  const other=structuredClone(target);other.set.id='futgg:2';other.progress.setId=2;other.set.requiredCards=1;
  other.progress.rows=[{...other.progress.rows[2],held:false}];
  const session=createGalleryRoadmapSession(),options={objective:'score'};
  expect((await session.run({targets:[target,other],options,maxMs:1000,schedule:async()=>{}})).route).toEqual([]);
  const next=structuredClone(target);next.progress.rows[2].collected=true;next.progress.rows[3].collected=true;
  expect(session.bind([next],options)).toEqual(['futgg:1']);
  const result=await session.run({targets:[next],options,maxMs:1000,schedule:async()=>{}});
  expect(result.route[0].items).toHaveLength(1);expect(result.route[0].scoringSlots.ownedCount).toBe(4);session.clear();
});
it('keeps cross-collection purchases as pending dependencies, not as already-collected Heroes',()=>{
  const slots={status:'complete',required:1,scoringCount:1,ownedCount:0,purchaseCount:1,witnessed:true};
  const option=(score,items,scoringSlots=slots)=>({grade:'S',score,projectedTokens:0,items,scoringSlots});
  const row=(setId,score,items,scoringSlots)=>({setId,name:setId,currentScore:0,scoreBaseline:0,baselineTokens:0,options:[option(score,items,scoringSlots)]});
  const result=finish(planGalleryPortfoliosSteps({objective:'score',selectedProfile:'score-gain',rows:[
    row('club',10000,[{eaId:11,price:1000}]),row('league',10000,[{eaId:12,price:1000}]),
    row('heroes',50000,[{eaId:11,price:1000},{eaId:12,price:1000},{eaId:13,price:200}],{...slots,required:5,scoringCount:5,ownedCount:2,purchaseCount:3})]}));
  const hero=result.route.find(row=>row.setId==='heroes');
  expect(hero.items).toHaveLength(3);expect(hero.cycles).toHaveLength(1);expect(hero.reusedIds).toHaveLength(2);
  expect(hero.dependencySetIds).toEqual(['club','league']);
  expect(hero.scoringSlots.ownedCount).toBe(2);
  const kept=filterGalleryRoadmapRoutes(result,row=>row.setId!=='club').route.find(row=>row.setId==='heroes');
  expect(kept.cycles).toHaveLength(2);expect(kept.dependencySetIds).toEqual(['league']);
});
it('does not resume or select score options with missing or incomplete count evidence',()=>{
  const option={grade:'S',score:99999,projectedTokens:0,items:[{eaId:11,price:200}],scoringSlots:{status:'incomplete',required:5,scoringCount:3,ownedCount:2,purchaseCount:1}};
  const rows=[{setId:'heroes',name:'heroes',currentScore:0,scoreBaseline:0,baselineTokens:0,options:[option]}];
  expect(finish(planGalleryPortfoliosSteps({rows,objective:'score'})).route).toEqual([]);
  delete option.scoringSlots;expect(finish(planGalleryPortfoliosSteps({rows,objective:'score'})).route).toEqual([]);
  expect(finish(selectGalleryRoadmapSteps({rows,objective:'score',profile:'score-gain',resumeOnly:true,
    previousSelection:[{setId:'heroes',option}]})).route).toEqual([]);
});

it('does not trust complete-count metadata that claims more purchase slots than the actual shopping list',()=>{
  const option={grade:'S',score:50000,projectedTokens:0,items:[{eaId:11,price:200}],
    scoringSlots:{status:'complete',required:5,scoringCount:5,ownedCount:2,purchaseCount:3,witnessed:true}};
  const rows=[{setId:'heroes',name:'heroes',currentScore:0,scoreBaseline:0,baselineTokens:0,options:[option]}];
  expect(finish(planGalleryPortfoliosSteps({rows,objective:'score'})).route).toEqual([]);
  expect(finish(selectGalleryRoadmapSteps({rows,objective:'score',profile:'score-gain',resumeOnly:true,
    previousSelection:[{setId:'heroes',option}]})).route).toEqual([]);
});

it('shares exact native confirmations across collections, but clears that evidence with the account session',async()=>{
  const target=heroTarget(2,3),other=structuredClone(target);other.set.id='futgg:2';other.progress.setId=2;
  other.progress.rows[2].collected=true;
  const session=createGalleryRoadmapSession(),options={objective:'score'};
  let result=await session.run({targets:[target,other],options,maxMs:1000,schedule:async()=>{}});
  expect(result.rows.find(row=>row.setId===target.set.id).options[0].scoringSlots.ownedCount).toBe(3);
  session.clear();result=await session.run({targets:[target],options,maxMs:1000,schedule:async()=>{}});
  expect(result.route[0].scoringSlots.ownedCount).toBe(2);expect(result.route[0].items).toHaveLength(3);session.clear();
});

it('preserves confirmed-only slot counting through demand-driven refinement and continuation',async()=>{
  const target=heroTarget(2,3);target.progress.rows[2].held=true;target.progress.rows[3].held=true;
  const work=createGalleryDemandWork(),options={objective:'score'};
  const run=targets=>work.run({targets,options,maxMs:1000,schedule:async()=>{},load:async ids=>({source:'public-references',policy:{source:'futbin'},
    freshPrices:Object.fromEntries(ids.map(id=>[id,200])),references:{},expiresAt:Date.now()+300000})});
  const first=await run([target]);expect(first.result.route).toEqual([]);expect(first.preview.route).toEqual([]);
  const next=structuredClone(target);next.progress.rows[2].collected=true;next.progress.rows[3].collected=true;
  const {result}=await run([next]);expect(result.route[0].scoringSlots.ownedCount).toBe(4);expect(result.route[0].items).toHaveLength(1);work.clear();
});
