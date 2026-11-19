import { verifyFc27Methods } from './fc27-transaction-transport.js';
import { observeFc27TrafficResult } from './fc27-market-traffic-runtime.js';
import { createEaInventoryAdapter } from './inventory.js';

const fail = reason => { throw Error(`MARKET_${reason}`); };
export const MARKET_AUCTION_METHODS = [
  ['service.requestWatchedItems','2a9538031134c5ed19f20568b84f501bed00055988ec79f253f31a2b923e41bc'],
  ['dao.getWatchPile','70c3742a4e8fb1d2be233caaa7e0069d43bf7c05c1633aff2a1114913e5b6bfd'],
  ['repository.getWatchedItems','9b50e375193fb92dde08f184d127ace3c398dfd1c49324f66c08686b94bbfbb2'],
];
// Reviewed 2026-11-19: unchanged decoded request/filter/cache behavior.
export const MARKET_AUCTION_COMPATIBLE_HASHES = Object.freeze({
  'service.requestWatchedItems':'93a3bdf7cc8ce790edf3c2c7e7f1ad3bc04e682bfedd06d6b0ec441d6452048c',
  'dao.getWatchPile':'9e03fa635dc62affc26429b2a1f6cc32be34b8405b92c146aa65b8fb95517280',
});
export const marketAuctionOffer = item => {
  const a=item?.getAuctionData?.();
  return {itemId:String(item?.id),definitionId:item?.definitionId,tradeId:String(a?.tradeId),
    startingBid:a?.startingBid,currentBid:a?.currentBid,buyNow:a?.buyNowPrice,seconds:a?.getSecondsRemaining?.()};
};

// The service may return only won items when the platform split is enabled.
// Its reviewed DAO still refreshes the complete INBOX repository. Read that
// fresh repository, never interpret an omitted/missing auction as a loss.
export function createMarketAuctionReader({root,assert,pace,readable}) {
  const service=root.services.Item,repository=root.repositories.Item,entities=new Map();
  let verified=null,dao=null,captured=null;
  const methodOwner=(object,key)=>{
    for(let n=0;object&&n<8;n++,object=Object.getPrototypeOf(object))if(Object.hasOwn(object,key))return object;
    fail('BIDDING_UNAVAILABLE');
  };
  const ready=async()=>{
    if(!verified){dao=service.itemDao;verified=await verifyFc27Methods({service:methodOwner(service,'requestWatchedItems'),dao:methodOwner(dao,'getWatchPile'),
      repository:methodOwner(repository,'getWatchedItems'),crypto:root.crypto},MARKET_AUCTION_METHODS,MARKET_AUCTION_COMPATIBLE_HASHES);captured=[service.requestWatchedItems,dao.getWatchPile,repository.getWatchedItems];}
    check();
  };
  const check=()=>{
    assert();verified?.();
    if(service.itemDao!==dao||root.services.Item!==service||root.repositories.Item!==repository||!Number.isSafeInteger(root.ItemPile.INBOX))fail('BIDDING_UNAVAILABLE');
    if(!captured||[service.requestWatchedItems,dao.getWatchPile,repository.getWatchedItems].some((fn,i)=>fn!==captured[i]))fail('BIDDING_UNAVAILABLE');
  };
  const read=async rows=>{
    await ready();await pace();check();
    repository.setDirty(root.ItemPile.INBOX);
    const reply=await observeFc27TrafficResult(service.requestWatchedItems());
    check();readable({status:'completed',response:reply});
    const all=repository.getWatchedItems();
    if(!Array.isArray(all)||all.length>1000)fail('READ_UNCONFIRMED');
    const selected=all.filter(i=>rows.some(r=>Number(r.itemId)===i.id&&r.definitionId===i.definitionId&&r.tradeId===String(i.getAuctionData?.()?.tradeId)));
    if(selected.length){await pace();check();const r=await observeFc27TrafficResult(service.refreshAuctions(selected));check();readable({status:'completed',response:r});}
    entities.clear();const receipts=[],offers=[];
    for(const row of rows){
      const found=selected.filter(i=>i.id===Number(row.itemId)&&i.definitionId===row.definitionId&&String(i.getAuctionData?.()?.tradeId)===row.tradeId);
      if(found.length>1)fail('RECEIPT_CONFLICT');
      if(!found.length)continue;
      const item=found[0],a=item.getAuctionData();let state=null;
      if(a.tradeOwner!==false)continue;
      if(a.isWon?.()===true&&a.currentBid===row.coins)state='won';
      else if(a.isActiveTrade?.()===true&&a.isHighestBid?.()===true&&a.currentBid===row.coins)state='leading';
      else if(a.isActiveTrade?.()===true&&a.bidState==='outbid'&&a.currentBid>=row.coins)state='outbid';
      else if(a.isWon?.()===false&&a.isActiveTrade?.()===false&&(a.isExpired?.()===true||a.isClosedTrade?.()===true))state='lost';
      if(!state)continue;
      entities.set(row.tradeId,item);
      receipts.push({itemId:row.itemId,definitionId:row.definitionId,tradeId:row.tradeId,coins:row.coins,state});
      if(state==='outbid')offers.push(marketAuctionOffer(item));
    }
    return {receipts,offers};
  };
  const find=row=>{
    check();const item=entities.get(row.tradeId),a=item?.getAuctionData?.();
    if(item?.id!==Number(row.itemId)||item.definitionId!==row.definitionId||String(a?.tradeId)!==row.tradeId)fail('OFFER_CHANGED');
    return item;
  };
  const won=row=>{
    const item=find(row),a=item.getAuctionData();
    if(a.tradeOwner!==false||a.isWon?.()!==true||a.currentBid!==row.coins)fail('HOLDING_UNAVAILABLE');
    const s=createEaInventoryAdapter(root).snapshotItem(item,'unassigned');
    if(item.isTradeable?.()!==true||s.evolution!==false||s.limitedUse!==false||s.concept!==false||s.academyEnrolled!==false)fail('HOLDING_PROTECTED');
    // This is a distinct watch-pile origin, not a fabricated Unassigned entry.
    return {entity:item,candidate:{...s,item:{id:item.id,definitionId:item.definitionId,pile:'watch'},tradeable:true},purchasePrice:row.coins};
  };
  return {ready,read,find,won};
}
