import { planGalleryRoadmapSteps } from './roadmap.js';
import { createGalleryRoadmapWork } from './roadmap-work.js';
import { runGalleryPlan } from './cooperative-plan.js';
import { createGalleryPortfolioWork } from './roadmap-portfolios.js';
import { isGalleryOwned } from './planner.js';

export function galleryRoadmapMaterialKey(progress){
  const fields=['eaId','playerEaId','gradingScore','galleryScore','firstOwned','holographic','overall','nationEaId','clubEaId','leagueEaId','rarityEaId','positions','weakFoot','skillMoves'];
  return JSON.stringify([progress?.season,progress?.setId,progress?.complete,progress?.candidateOnly,progress?.poolComplete,
    (progress?.rows ?? []).map(row=>[isGalleryOwned(row)?'owned':row.collected===false?'missing':'unknown',...fields.map(key=>row[key] ?? null)]).sort((a,b)=>a[1]-b[1])]);
}
export function galleryRoadmapTargetKey(target) {
  return JSON.stringify([target.set,target.catalog?.revision,target.catalog?.tags,target.catalog?.engine,
    target.status,!!target.stale,!!target.poolStale,target.pool?.revision,galleryRoadmapMaterialKey(target.progress),
    (target.progress?.rows ?? []).map(row=>[row.eaId,target.prices?.[row.eaId] ?? null]),target.publicReference]);
}

// Each collection has its own immutable continuation. Rebinding replaces only
// changed semantics (including shared ever-owned versions), never all work.
export function createGalleryRoadmapSession() {
  let entries=[],cursor=0,optionsKey=null,version=0,cached=null;
  const knownOwned=new Set();
  const portfolioWork=createGalleryPortfolioWork();
  const clear=()=>{for(const entry of entries)entry.work.clear();entries=[];cursor=0;optionsKey=null;version++;cached=null;portfolioWork.clear();knownOwned.clear();};
  const bind=(targets,options)=>{
    const key=JSON.stringify({...options,deep:undefined});if(optionsKey!==null && optionsKey!==key)clear();optionsKey=key;
    const previous=new Map(entries.map(entry=>[entry.target.set.id,entry]));
    for(const target of targets)for(const row of target.progress?.rows ?? [])if(isGalleryOwned(row))knownOwned.add(row.eaId);
    const owned=knownOwned;
    const changed=[];
    entries=targets.map(original=>{
      const target=!original.progress?.rows ? original : { ...original,progress:{...original.progress,
        rows:original.progress.rows.map(row=>owned.has(row.eaId) && !isGalleryOwned(row) ? {...row,held:true} : row)} };
      const fingerprint=galleryRoadmapTargetKey(target),before=previous.get(target.set.id);previous.delete(target.set.id);
      if(before?.key===fingerprint)return before;
      before?.work.clear();changed.push(target.set.id);
      return { target,key:fingerprint,input:[target],work:createGalleryRoadmapWork(),result:null,turns:0 };
    });
    for(const entry of previous.values())entry.work.clear();
    if(changed.length || previous.size){version++;cached=null;}
    cursor%=Math.max(1,entries.length);return changed;
  };
  const pending=()=>entries.filter(entry=>!entry.result || entry.result.coverage.stopped);
  const snapshotSteps=function* (options,stopped=pending().length>0){
    if(cached?.version===version && cached.stopped===stopped)return structuredClone(cached.result);
    const rows=entries.flatMap(entry=>entry.result?.rows ?? []);
    const compared=yield* portfolioWork.run({rows,...options}),result=compared.result;
    const value={...result,rows,fastReferences:true,partial:stopped || result.selectionStopped || rows.some(row=>row.reason || row.collectionUnknown || row.candidateOnly),
      coverage:{total:entries.length,inspected:rows.length,available:rows.filter(row=>row.currentScore!==null).length,
        completed:entries.filter(entry=>entry.result && !entry.result.coverage.stopped).length,
        missing:rows.filter(row=>row.reason==='progress-unavailable').length,
        gradesChecked:rows.reduce((n,row)=>n+(row.checkedGrades?.length ?? 0),0),stopped:stopped || result.selectionStopped}};
    if(!result.selectionStopped)cached={version,stopped,result:structuredClone(value)};
    return value;
  };
  const advance=async ({options,current=()=>true,checkpoint=current,stopped=()=>false,maxMs,quantumMs=40,
    progress=()=>{},clock=()=>performance.now(),schedule}={})=>{
    for(let count=0;count<entries.length;count++){
      const entry=entries[cursor++%entries.length];
      if(entry.result && !entry.result.coverage.stopped)continue;
      const generator=planGalleryRoadmapSteps({...options,targets:entry.input,fastReferences:true,work:entry.work,rowsOnly:true,
        previousRows:entry.result?.rows,previousSelection:entry.result?.selectedOptions});
      const computed=await runGalleryPlan({next:finish=>generator.next(finish || stopped()),return:()=>generator.return()},
        {current,checkpoint,maxMs:Math.min(maxMs,quantumMs),progress,now:clock,...(schedule?{schedule}:{})});
      entry.turns++;
      if(!computed)throw Error('FC27_GALLERY_ROADMAP_CONTEXT_CHANGED');
      if(JSON.stringify(computed.rows)!==JSON.stringify(entry.result?.rows)){version++;cached=null;}
      entry.result=computed;
      return entry;
    }
    return null;
  };
  return {clear,bind,pending,advance,snapshotSteps,entries:()=>entries,
    async run({targets,options,maxMs,current=()=>true,checkpoint=current,stopped=()=>false,progress=()=>{},
      onResult=()=>{},clock=()=>performance.now(),schedule,quantumMs=40}={}){
      bind(targets,options);const start=clock(),remaining=()=>Math.max(0,maxMs-(clock()-start));let result,published=-Infinity,turns=0;
      const snapshot=()=>runGalleryPlan(snapshotSteps(options),{current,checkpoint,maxMs:Math.min(Math.max(1,remaining()),quantumMs),progress,now:clock,...(schedule?{schedule}:{})});
      while((pending().length || !result || result.comparisonPending) && (remaining()>0 || turns===0) && !stopped()){
        const entry=pending().length ? await advance({options,maxMs:Math.max(1,remaining()),current,checkpoint,stopped,progress,clock,schedule,quantumMs}) : null;
        turns++;
        if(!entry && pending().length)break;
        if(!pending().length || !result || clock()-published>=250){
          const first=!result;result=await snapshot();
          if(result && (first || clock()-published>=250 || !result.comparisonPending)){onResult(result);published=clock();}
        }
      }
      result=await snapshot();if(result)onResult(result);return result;
    }};
}
