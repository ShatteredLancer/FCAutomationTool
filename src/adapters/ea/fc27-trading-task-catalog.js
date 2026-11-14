import {createEaInventoryAdapter} from './inventory.js';

// Read-only cached references for editing. They are never live ownership or
// listing approval; P3 must re-read the exact entity and all sale protections.
export function readTradingTaskInventory(root){
 const inventory=createEaInventoryAdapter(root),seen=new Set(),rows=[];
 for(const pile of ['transfer','unassigned','club'])for(const raw of inventory.readPile(pile)){
  const item=inventory.snapshotItem(raw,pile);if(seen.has(item.id))continue;seen.add(item.id);
  if(item.type!=='player'||!Number.isSafeInteger(item.id)||item.id<=0||!Number.isSafeInteger(item.definitionId)||item.definitionId<=0)continue;
  rows.push({itemId:String(item.id),definitionId:item.definitionId,name:item.name||`EA ${item.definitionId}`,rating:item.rating,pile,
   available:item.tradeable===true&&!item.activeTrade&&!item.concept&&!item.evolution&&!item.academyEnrolled&&!item.limitedUse});
 }
 return rows;
}
