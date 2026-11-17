import { it,expect } from 'vitest';
import {emptyMarketCoordination,reserveMarketWrite,settleMarketWrite,marketOccupancy,readMarketCoordination,settleMarketAuction} from '../../src/trading/market-coordination.js';
const funds={balance:10000,reserve:null,totalCap:null,taskCap:null,spendCap:null,freeSlots:10,perVersion:null};
const bid={id:'b1',kind:'bid',taskId:'t',itemId:'101',definitionId:901,tradeId:'9001',coins:700,at:100};
const receipt={itemId:'101',definitionId:901,tradeId:'9001',coins:700};
const leading=()=>{const s=emptyMarketCoordination();reserveMarketWrite(s,bid,funds);settleMarketWrite(s,bid.id,{status:'confirmed',receipt});return s;};
it('confirmed bid reserves stock and budget, not a purchase or holding, and survives reload',()=>{
 const s=readMarketCoordination(leading());expect(s.holdings).toEqual([]);
 expect(marketOccupancy(s)).toMatchObject({count:1,spent:0,holdingCoins:700,reservedCoins:0});
 expect(s.auctions[0]).toMatchObject({state:'leading',coins:700});
});
it('rebids only its own outbid auction, checks the full budget once, and records actual won cost once',()=>{
 const s=leading();settleMarketAuction(s,{...receipt,state:'outbid'});
 reserveMarketWrite(s,{...bid,id:'b2',coins:800,at:200},{...funds,taskCap:800,spendCap:800,freeSlots:1,perVersion:1});
 settleMarketWrite(s,'b2',{status:'confirmed',receipt:{...receipt,coins:800}});
 expect(marketOccupancy(s)).toMatchObject({count:1,spent:0,holdingCoins:800});
 settleMarketAuction(s,{...receipt,coins:800,state:'won'});
 settleMarketAuction(s,{...receipt,coins:800,state:'won'});
 expect(marketOccupancy(s)).toMatchObject({count:1,spent:800,holdingCoins:800});
 expect(s.holdings).toHaveLength(1);expect(s.holdings[0]).toMatchObject({phase:'held',cost:800});
 expect(readMarketCoordination(s)).toEqual(s);
});
it('does not double-subtract EA frozen coins, but reserves capacity and caps across tasks',()=>{
 const s=leading(),second={...bid,id:'b2',taskId:'other',itemId:'102',tradeId:'9002'};
 reserveMarketWrite(s,second,{...funds,balance:700,totalCap:1400,freeSlots:2});
 expect(marketOccupancy(s)).toMatchObject({count:2,reservedCoins:700});
 const t=leading();expect(()=>reserveMarketWrite(t,second,{...funds,freeSlots:1})).toThrow();
 expect(()=>reserveMarketWrite(t,second,{...funds,totalCap:1300})).toThrow();
});
it('does not reissue unknown bids or cross-task rebids; a confirmed loss releases the reservation',()=>{
 const s=leading();expect(()=>reserveMarketWrite(s,{...bid,id:'b2'},funds)).toThrow();
 settleMarketAuction(s,{...receipt,state:'outbid'});
 expect(()=>reserveMarketWrite(s,{...bid,id:'b2',taskId:'other'},funds)).toThrow();
 settleMarketAuction(s,{...receipt,state:'lost'});
 expect(marketOccupancy(s)).toMatchObject({count:0,holdingCoins:0,spent:0});
 expect(readMarketCoordination(s)).toEqual(s);
});
