const fail=()=>{throw Error('MARKET_RECEIPT_CONFLICT');};
const id=v=>typeof v==='string'&&v.length>0&&v.length<=120;
export const activeMarketAuctions=state=>(state.auctions??[]).filter(a=>['leading','outbid'].includes(a.state));
export function validateMarketAuctions(rows){
  if(!Array.isArray(rows)||rows.length>2000||new Set(rows.map(a=>a.tradeId)).size!==rows.length)fail();
  for(const a of rows){
    if(!a||Object.keys(a).some(k=>!['taskId','itemId','definitionId','tradeId','coins','state','sellAt'].includes(k))
      ||!['taskId','itemId','tradeId'].every(k=>id(a[k]))||!Number.isSafeInteger(a.definitionId)||a.definitionId<1
      ||!Number.isSafeInteger(a.coins)||a.coins<150||a.coins>15000000||!['leading','outbid','won','lost'].includes(a.state)
      ||a.sellAt!==undefined&&(!Number.isSafeInteger(a.sellAt)||a.sellAt<0))fail();
  }
}
export function confirmMarketBid(state,entry){
  state.auctions??=[];
  const old=state.auctions.find(a=>a.tradeId===entry.tradeId);
  if(old){
    if(old.taskId!==entry.taskId||old.itemId!==entry.itemId||old.definitionId!==entry.definitionId
      ||old.state!=='outbid'||entry.coins<=old.coins)fail();
    old.coins=entry.coins;old.state='leading';
  }else state.auctions.push({taskId:entry.taskId,itemId:entry.itemId,definitionId:entry.definitionId,
    tradeId:entry.tradeId,coins:entry.coins,state:'leading',...(entry.sellAt!==undefined?{sellAt:entry.sellAt}:{})});
}
export function settleMarketAuction(state,receipt){
  if(!receipt||Object.keys(receipt).some(k=>!['itemId','definitionId','tradeId','coins','state'].includes(k)))fail();
  const a=state.auctions?.find(a=>a.tradeId===receipt.tradeId);
  if(!a||a.itemId!==receipt.itemId||a.definitionId!==receipt.definitionId||a.coins!==receipt.coins
    ||!['leading','outbid','won','lost'].includes(receipt.state))fail();
  if(a.state===receipt.state)return;
  if(['won','lost'].includes(a.state))fail();
  if(receipt.state==='won'){
    if(state.holdings.some(h=>h.itemId===a.itemId))fail();
    state.holdings.push({taskId:a.taskId,itemId:a.itemId,definitionId:a.definitionId,cost:a.coins,
      phase:'held',listingTradeId:null,salePrice:null,...(a.sellAt!==undefined?{sellAt:a.sellAt}:{})});
  }
  a.state=receipt.state;
}
