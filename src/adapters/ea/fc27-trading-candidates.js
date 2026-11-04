import {createEaInventoryAdapter} from './inventory.js';

// Cached public card facts only: no inventory refresh, item IDs, balances or
// trade actions. The picker is not proof that any version is owned/marketable.
export function readFc27TradingCandidates(root){
  try{
    const adapter=createEaInventoryAdapter(root),seen=new Map();
    const names=new Map(Object.values(adapter.snapshot().piles).flat().map(row=>[row.id,row.name]));
    for(const pile of ['club','transfer','unassigned'])for(const item of adapter.readPile(pile)){
      if(!Number.isSafeInteger(Number(item.definitionId))||Number(item.definitionId)<1||Number(item.rating)<1)continue;
      const definitionId=Number(item.definitionId);if(seen.has(definitionId))continue;
      seen.set(definitionId,{definitionId,name:String(names.get(Number(item.id))??item.name??definitionId).slice(0,100),rating:Number(item.rating),
        nationId:Number(item.nationId),leagueId:Number(item.leagueId),teamId:Number(item.teamId),preferredPosition:item.preferredPosition});
      if(seen.size>=1000)return [...seen.values()];
    }
    return [...seen.values()];
  }catch{return [];}
}
