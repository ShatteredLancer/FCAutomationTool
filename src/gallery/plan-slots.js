import { isGalleryOwned } from './planner.js';

const positive=value=>Number.isSafeInteger(value) && value>0 && value<=100000000;
const versionId=value=>Number.isSafeInteger(value) && value>0 && value<=1000000000;

// Count exact eligible versions, not collection totals or purchase rows. This
// cheap boundary check does not replace the planner's score/bonus validation.
export function galleryPlanSlots({set,progress,items=[],scoringLineupIds=null,confirmedOnly=false}={}){
  const required=set?.requiredCards;
  const unavailable={status:'unverified',required:required ?? null,scoringCount:0,ownedCount:0,purchaseCount:0,
    purchaseRows:items?.length ?? 0,missingCount:required ?? null,ownedIds:[],witnessed:false};
  if(!Number.isSafeInteger(required) || required<1 || !Array.isArray(progress?.rows) || progress.complete===false
      || !Array.isArray(items) || progress.rows.some(row=>!versionId(row?.eaId)) || items.some(row=>!versionId(row?.eaId)))return unavailable;
  const rows=new Map(progress.rows.map(row=>[row.eaId,row]));
  if(rows.size!==progress.rows.length || new Set(items.map(row=>row.eaId)).size!==items.length)return unavailable;
  const owned=new Set(progress.rows.filter(row=>(confirmedOnly?row.collected===true:isGalleryOwned(row)) && positive(row.gradingScore)).map(row=>row.eaId));
  const purchased=new Set();
  for(const item of items){
    const row=rows.get(item.eaId);if(!row)return unavailable;
    if(isGalleryOwned(row))continue;
    if(row.collected!==false)return unavailable;
    const score=row.gradingScore ?? row.galleryScore ?? item.score;
    if(positive(score))purchased.add(row.eaId);
  }
  const available=new Set([...owned,...purchased]),witnessed=Array.isArray(scoringLineupIds);
  if(scoringLineupIds!==null && !witnessed)return unavailable;
  if(witnessed && new Set(scoringLineupIds).size!==scoringLineupIds.length)return unavailable;
  const ids=witnessed?scoringLineupIds:[...available];
  if(witnessed && ids.some(id=>!available.has(id)))return unavailable;
  const scoringCount=Math.min(required,ids.length),ownedIds=ids.filter(id=>owned.has(id));
  return {status:ids.length>=required && (!witnessed || ids.length===required)?'complete':'incomplete',required,scoringCount,
    ownedCount:ownedIds.length,purchaseCount:ids.filter(id=>purchased.has(id)).length,purchaseRows:items.length,
    missingCount:Math.max(0,required-ids.length),ownedIds,witnessed};
}
