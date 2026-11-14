// The editor queries an injected local catalog only. No quote/network methods.
import { yieldStreamlinedTask } from '../streamlined/scheduling.js';
export const yieldTaskCatalog=()=>yieldStreamlinedTask(typeof globalThis.MessageChannel==='function'?{MessageChannel:globalThis.MessageChannel}:globalThis);
export function taskMatches(card,settings){return Number.isSafeInteger(card.rating)&&card.rating>=settings.ratingMin&&card.rating<=settings.ratingMax
 &&(settings.quality==='all'||card.quality===settings.quality)
 &&[['league','leagueId'],['nation','nationId'],['club','teamId'],['position','preferredPosition']].every(([key,field])=>settings[key]===null||card[field]===settings[key]);}
export const taskExclusion=(card,excluded)=>excluded.find(e=>e.type==='version'?e.id===card.definitionId:card.playerId!=null&&e.id===card.playerId);
export const taskCandidateAllowed=(card,task)=>taskMatches(card,task.settings)&&!taskExclusion(card,task.excluded)
 &&(!task.excluded.some(e=>e.type==='player')||Number.isSafeInteger(card.playerId)&&card.playerId>0);
export async function readTaskCatalogPage({rows,settings=null,query='',cursor=0,isCurrent=()=>true,yieldControl=yieldTaskCatalog}){
 const search=query.trim().toLocaleLowerCase(),page=[];let next=cursor,scanned=0;
 for(let i=cursor;i<rows.length;i++){
  if(!isCurrent())throw Error('TASKS_CONTEXT_CHANGED');const card=rows[i];scanned++;
  if(Number.isSafeInteger(card.definitionId)&&card.definitionId>0&&Number.isSafeInteger(card.rating)&&card.rating>0&&card.rating<=99&&typeof card.name==='string'
   &&(!settings||taskMatches(card,settings))&&card.name.toLocaleLowerCase().includes(search)){
   page.push(card);if(page.length===5)next=i+1;if(page.length===6)return {rows:page.slice(0,5),next,more:true,scanned};
  }
  if(scanned%256===0)await yieldControl();
 }
 if(!isCurrent())throw Error('TASKS_CONTEXT_CHANGED');return {rows:page,next,more:false,scanned};
}
