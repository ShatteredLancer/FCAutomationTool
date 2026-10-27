import { forecastGalleryTurnover } from './turnover-budget.js';
import { galleryRoadmapMaterialKey } from './roadmap-session.js';
import { isGalleryOwned } from './planner.js';

const filterRoute=(plan,keep)=>{
  const selected=plan.route.filter(keep),byId=new Map(selected.map(row=>[row.setId,row]));
  const steps=selected.map(row=>{
    const byVersion=new Map(row.items.map(item=>[item.eaId,item]));
    const solo=forecastGalleryTurnover({steps:[{setId:row.setId,items:row.items}],resaleDiscountBps:plan.funding.resaleDiscountBps});
    return {setId:row.setId,items:solo.steps?.[0]?.cycles.map(cycle=>byVersion.get(cycle.eaId)) ?? row.items};
  });
  const funding=forecastGalleryTurnover({steps,
    capital:plan.funding.capital,resaleDiscountBps:plan.funding.resaleDiscountBps,optimizeOrder:false});
  return {...plan,status:selected.length?'ready':'no-route',funding,route:funding.steps.map((step,index)=>({...byId.get(step.setId),...step,order:index+1})),
    addedTokens:selected.reduce((n,row)=>n+row.addedTokens,0),selectedOptions:(plan.selectedOptions ?? []).filter(row=>byId.has(row.setId))};
};
export function filterGalleryRoadmapRoutes(result,keep){
  return {...filterRoute(result,keep),portfolios:result.portfolios?.map(plan=>filterRoute(plan,keep))};
}

export function retainGalleryRoadmap(result,affected){
  if(!result)return result;const ids=new Set(affected);
  const kept=filterGalleryRoadmapRoutes(result,row=>!ids.has(row.setId));
  const ready=result.rows.filter(row=>!ids.has(row.setId));
  return {...kept,status:kept.route.length?'ready':'pending-update',partial:true,retainedChanges:ids.size,
    baselineTokens:ready.reduce((n,row)=>n+(row.baselineTokens ?? 0),0),freeCheck:(result.freeCheck ?? []).filter(row=>!ids.has(row.setId)),
    unavailable:[...(result.unavailable ?? []).filter(row=>!ids.has(row.setId)),...result.rows.filter(row=>ids.has(row.setId)).map(row=>({setId:row.setId,name:row.name,reason:'collection-updated'}))],
    skipped:(result.skipped ?? []).filter(row=>!ids.has(row.setId)),
    coverage:{...result.coverage,available:ready.filter(row=>row.currentScore!==null).length,completed:ready.filter(row=>row.analysisComplete).length,stopped:true},
    rows:result.rows.map(row=>ids.has(row.setId)?{...row,currentScore:null,currentGrade:null,options:[],reason:'collection-updated',analysisComplete:false,checkedGrades:[]}:row),
    referenceOverview:result.referenceOverview?retainGalleryRoadmap(result.referenceOverview,affected):undefined};
}

// Same account/catalogue only. Prices stay in their original forecast basis;
// newly read Club quotes never silently replace or renew that estimate.
export function reconcileGalleryRoadmapInputs(previous,current){
  const live=new Map(current.map(target=>[target.set.id,target])),affected=new Set(),versions=new Set();
  const materialKey=target=>JSON.stringify([galleryRoadmapMaterialKey(target.progress),target.pool?.revision,target.status,!!target.stale,!!target.poolStale]);
  const targets=previous.map(old=>{
    const next=live.get(old.set.id);if(!next){affected.add(old.set.id);return {...old,status:'unloaded',progress:null};}
    if(typeof old.progressKey==='string' && old.progressKey===next.progressKey && old.pool?.revision===next.pool?.revision && old.status===next.status
        && !!old.stale===!!next.stale && !!old.poolStale===!!next.poolStale)return old;
    if(materialKey(old)===materialKey(next))return old;
    affected.add(old.set.id);
    const before=new Map((old.progress?.rows ?? []).map(row=>[row.eaId,row]));
    for(const row of next.progress?.rows ?? []){
      const prior=before.get(row.eaId);
      if(!prior || isGalleryOwned(prior)!==isGalleryOwned(row)
          || ['firstOwned','gradingScore','galleryScore'].some(key=>prior[key]!==row[key]))versions.add(row.eaId);
      before.delete(row.eaId);
    }
    for(const id of before.keys())versions.add(id);
    return {...old,progress:next.progress,progressKey:next.progressKey,status:next.status,pool:next.pool,
      stale:next.stale,poolStale:next.poolStale,fetchedAt:next.fetchedAt};
  });
  for(const target of targets)if(target.progress?.rows?.some(row=>versions.has(row.eaId)))affected.add(target.set.id);
  return {targets,affected:[...affected]};
}
