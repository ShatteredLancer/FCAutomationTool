import { expect, it } from 'vitest';
import { planGalleryPortfoliosSteps } from '../../src/gallery/roadmap-portfolios.js';
import { planGalleryRoadmapSteps } from '../../src/gallery/roadmap.js';
import { filterGalleryRoadmapRoutes } from '../../src/gallery/roadmap-retain.js';
import { planGalleryGradeSteps } from '../../src/gallery/planner.js';
import { createGalleryRoadmapSession } from '../../src/gallery/roadmap-session.js';
const finish=steps=>{let next;do{next=steps.next();}while(!next.done);return next.value;};
const row=(setId,score,price,extra={})=>({setId,name:setId,currentScore:0,scoreBaseline:0,currentGrade:null,
  baselineTokens:0,options:[{grade:'C',requestedGrade:'C',score,projectedTokens:0,items:[{eaId:1,price}]}],...extra});

it('separates score efficiency from grade-first token routes',()=>{
  const rows=[row('club',10,10000,{options:[{grade:'S',score:10,projectedTokens:99,items:[{eaId:2,price:10000}]}]}),row('league',1000,1000)];
  const score=finish(planGalleryPortfoliosSteps({rows,objective:'score',capital:20000,lossLimit:500}));
  expect(score).toMatchObject({planningObjective:'score',addedScore:1000,addedTokens:0});
  expect(score.route.map(value=>value.setId)).toEqual(['league']);
  const tokens=finish(planGalleryPortfoliosSteps({rows,capital:20000,lossLimit:500}));
  expect(tokens.route.map(value=>value.setId)).toEqual(['club']);
});

it('admits same-grade score improvements without pretending tokens are XP',()=>{
  const input=row('club',1100,1000,{currentScore:1000,scoreBaseline:1000,currentGrade:'S',baselineTokens:28,
    options:[{grade:'S',requestedGrade:1001,score:1100,projectedTokens:28,items:[{eaId:1,price:1000}]}]});
  const result=finish(planGalleryPortfoliosSteps({rows:[input],objective:'score'}));
  expect(result).toMatchObject({addedScore:100,addedTokens:0,scoreBasis:'local-complete-set-score-not-gallery-xp'});
  expect(result.route[0]).toMatchObject({targetGrade:'S',scoreTarget:1100,addedScore:100});
});

it('shares one purchased version across club/league/nation scores and counts each collection once',()=>{
  const result=finish(planGalleryPortfoliosSteps({rows:[row('club',1000,1000),row('league',2000,1000),row('nation',3000,1000)],
    objective:'score',capital:1000,lossLimit:50}));
  expect(result).toMatchObject({addedScore:6000,addedTokens:0,funding:{totalPurchase:1000,expectedNetLoss:50}});
  expect(result.route).toHaveLength(3);
  const kept=filterGalleryRoadmapRoutes(result,value=>value.setId!=='league');
  expect(kept.addedScore).toBe(4000);
});

it('keeps unknown collection baselines out of the score-gain calculation',()=>{
  const result=finish(planGalleryPortfoliosSteps({rows:[row('unknown',1000,1000,{collectionUnknown:true})],objective:'score'}));
  expect(result.route).toEqual([]);expect(result.addedScore).toBe(0);
});
it('does not advertise an increase below an uncertain current-score upper bound',()=>{
  const result=finish(planGalleryPortfoliosSteps({rows:[row('club',1050,200,{currentScore:1000,scoreBaseline:1100,scoreUncertain:true})],objective:'score'}));
  expect(result.addedScore).toBe(0);expect(result.route).toEqual([]);
});

const target=(requiredCards=1)=>{
  const card=(eaId,score,collected)=>({eaId,playerEaId:eaId,gradingScore:score,galleryScore:score,collected,firstOwned:false,
    overall:80,holographic:false,positions:['ST'],skillMoves:3,weakFoot:3,nationEaId:1,clubEaId:1,leagueEaId:1,rarityEaId:1});
  return {status:'observed',catalog:{source:'futgg',tags:[{id:1,name:'No bonus',bonusType:'ITEM_SCORE_PERCENTAGE',thresholdType:'ITEM_COUNT',
    rules:[{attribute:'RARE',type:'COUNT',target:'ATTRIBUTE',values:['999']}],tiers:[{minItems:1,bonus:1}]}]},
    set:{id:'futgg:1',name:'Club',requiredCards,grades:['D','C','B','A','S'].map((name,index)=>({name,threshold:(index+1)*10,
      rewards:[{type:'event_token_1',count:1,value:1}]}))},
    progress:{season:'27',source:'futgg',setId:1,complete:true,poolComplete:true,rows:[card(1,60,true),card(2,80,false)]},prices:{2:200}};
};
it('generates a numeric same-grade upgrade through the original scorer/planner after S is reached',()=>{
  const result=finish(planGalleryRoadmapSteps({targets:[target()],objective:'score'}));
  expect(result).toMatchObject({addedScore:20,addedTokens:0});
  expect(result.route[0]).toMatchObject({targetGrade:'S',projectedScore:80});
});
it('counts only complete collection totals, not the partial lineup score as an earned baseline',()=>{
  const result=finish(planGalleryRoadmapSteps({targets:[target(2)],objective:'score'}));
  expect(result.addedScore).toBe(140);
});

it('compares efficiency, maximum gain and minimum capital without S-first ordering',()=>{
  const rows=[row('small',100,200),row('large',1000,2000,{options:[{grade:'B',score:1000,projectedTokens:0,items:[{eaId:2,price:2000}]}]})];
  const result=finish(planGalleryPortfoliosSteps({rows,objective:'score'}));
  const find=profile=>result.portfolios.find(value=>value.profile===profile);
  expect(find('score').route.map(value=>value.setId)).toEqual(['large','small']);
  expect(find('score-gain').addedScore).toBe(1100);
  expect(find('score-capital')).toMatchObject({addedScore:100,funding:{requiredCapital:200}});
});

it('retains only a priced complete best-effort lineup when a score probe misses its numeric target',()=>{
  const input=target(),result=finish(planGalleryGradeSteps({...input,targetGrade:1000,scoreProbe:true}));
  expect(result.plans).toEqual([]);
  expect(result.bestScoringCandidate).toMatchObject({reached:false,lineupComplete:true,score:80,totalPrice:200});
  const ordinary=finish(planGalleryGradeSteps({...input,targetGrade:1000}));
  expect(ordinary).not.toHaveProperty('bestScoringCandidate');
  const unpriced=finish(planGalleryGradeSteps({...input,prices:{},targetGrade:1000,scoreProbe:true}));
  expect(unpriced.bestScoringCandidate?.items ?? []).toEqual([]);
});

it('rebinds shared ever-owned changes only, preserving unrelated score work after a purchase and sale',async()=>{
  const one=target(),two=structuredClone(one),other=structuredClone(one);
  two.set.id='futgg:2';two.progress.setId=2;
  other.set.id='futgg:3';other.progress.setId=3;other.progress.rows[1].eaId=3;other.prices={3:200};
  const work=createGalleryRoadmapSession(),targets=[one,two,other],options={objective:'score',selectedProfile:'score-gain'};
  const first=await work.run({targets,options,maxMs:1000,schedule:async()=>{}});
  expect(first.addedScore).toBe(60);
  const oldEntry=work.entries()[2],next=structuredClone(targets);
  next[0].progress.rows[1].collected=true;
  next[0].progress.rows[1].inClub=false; // sold, still ever collected
  expect(work.bind(next,options)).toEqual(['futgg:1','futgg:2']);
  expect(work.entries()[2]).toBe(oldEntry);
  const last=await work.run({targets:next,options,maxMs:1000,schedule:async()=>{}});
  expect(last.route.map(value=>value.setId)).toEqual(['futgg:3']);
  expect(last.addedScore).toBe(20);
  work.clear();
});

it('isolates the token and score comparison caches',async()=>{
  const work=createGalleryRoadmapSession(),targets=[target()];
  expect((await work.run({targets,options:{objective:'score'},maxMs:1000,schedule:async()=>{}})).addedScore).toBe(20);
  const tokens=await work.run({targets,options:{objective:'tokens'},maxMs:1000,schedule:async()=>{}});
  expect(tokens.addedTokens).toBe(0);expect(tokens.route).toEqual([]);expect(tokens).not.toHaveProperty('addedScore');
  work.clear();
});
