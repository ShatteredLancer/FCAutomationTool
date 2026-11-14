import {createEaInventoryAdapter} from './inventory.js';
import {readPlayerDatabaseId,readExplicitPlayerRareFlag,isPlayerEvolutionCard,hasPlayerCosmetics} from '../../domain/player-rarity.js';
import {normalizeTaskCatalogCard} from '../../trading/market-task-catalog.js';
import {yieldTaskCatalog} from '../../trading/task-catalog.js';

export function readTradingTaskCard(raw,name=''){
 if(!raw||typeof raw!=='object')return null;
 return normalizeTaskCatalogCard({definitionId:raw.definitionId,name:name||raw.name,rating:raw.rating??raw._rating,
  playerId:readPlayerDatabaseId(raw),rarity:readExplicitPlayerRareFlag(raw),nationId:raw.nationId,leagueId:raw.leagueId,
  teamId:raw.teamId,preferredPosition:raw.preferredPosition,evolution:isPlayerEvolutionCard(raw),cosmetic:hasPlayerCosmetics(raw)});
}

// All locally known public definitions, without ownership IDs or a network
// refresh. This is deliberately separate from the legacy 1000-row desk picker.
export async function readTradingTaskCatalog(root,{isCurrent=()=>true,yieldControl=yieldTaskCatalog}={}){
 const inventory=createEaInventoryAdapter(root),rows=[];let scanned=0;
 for(const pile of ['club','storage','transfer','unassigned'])for(const raw of inventory.readPile(pile)){
  if(!isCurrent())throw Error('TASKS_CONTEXT_CHANGED');const item=inventory.snapshotItem(raw,pile);
  if(item.type==='player'){const card=readTradingTaskCard(raw,item.name);if(card)rows.push(card);}
  if(++scanned%256===0)await yieldControl();
 }
 if(!isCurrent())throw Error('TASKS_CONTEXT_CHANGED');return rows;
}

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
