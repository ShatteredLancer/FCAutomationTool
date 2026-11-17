import {it,expect} from 'vitest';
import {emptyMarketCoordination,readMarketCoordination,marketOccupancy,reserveMarketWrite,marketTaskEvidence,transferMarketHoldings} from '../../src/trading/market-coordination.js';
import {isolateMarketIntent,markMarketManuallyHandled,marketRecoveryBlocks} from '../../src/trading/market-recovery.js';
const pending=(kind='list')=>({id:'r',taskId:'old',kind,itemId:'1',definitionId:901,tradeId:kind==='buy'?'99':null,coins:800,at:1000,phase:'pending',receipt:null,...kind==='list'?{listing:{startPrice:750,buyNow:800,durationSeconds:3600}}:{}});
const fixture=(kind='list')=>({...emptyMarketCoordination(),stopped:'unknown-write',intents:[pending(kind)],holdings:kind==='list'?[{taskId:'old',itemId:'1',definitionId:901,cost:600,phase:'transfer',listingTradeId:null,salePrice:null}]:[]});
it('isolates a stale listing without inventing a receipt or removing holdings and reserves it across reload',()=>{
 const s=fixture(),before=structuredClone(s);isolateMarketIntent(s,{requestId:'r',at:61000});
 expect(readMarketCoordination(s)).toEqual(s);expect(s.holdings).toEqual(before.holdings);expect(s.stopped).toBe('unknown-write');
 expect(s.intents[0]).toMatchObject({phase:'isolated',receipt:null,coins:800});expect(marketTaskEvidence(s,'old').unresolved).toBe(true);
 s.stopped=null;expect(()=>reserveMarketWrite(s,{id:'new',taskId:'old',kind:'list',itemId:'1',definitionId:901,coins:800,tradeId:null,at:62000,listing:before.intents[0].listing})).toThrow('RECOVERY_ISOLATED');
 expect(()=>transferMarketHoldings(s,{fromTaskId:'old',toTaskId:'new',itemIds:['1'],now:62000})).toThrow('RECOVERY_ISOLATED');
});
it('keeps unknown buying funds and version exclusion after isolation and a manual note',()=>{
 const s=fixture('buy');isolateMarketIntent(s,{requestId:'r',at:61000});markMarketManuallyHandled(s,{requestId:'r',at:62000});
 expect(marketOccupancy(readMarketCoordination(s))).toMatchObject({reservedCoins:800,count:1,spent:0});
 expect(marketRecoveryBlocks(s,{taskId:'other',definitionId:901})).toBe(true);expect(marketRecoveryBlocks(s,{taskId:'other',definitionId:902})).toBe(false);
 expect(s.intents[0].receipt).toBeNull();expect(s.intents[0].phase).toBe('isolated');
});
it('allows unrelated purchases only after explicit global release, while retaining isolated budgets',()=>{
 const s=fixture('buy');isolateMarketIntent(s,{requestId:'r',at:61000});
 const c={id:'new',taskId:'other',kind:'buy',itemId:'2',definitionId:902,tradeId:'100',coins:800,at:62000};
 const funds={balance:1500,reserve:null,totalCap:null,taskCap:null,spendCap:null,freeSlots:10,perVersion:null};
 expect(()=>reserveMarketWrite(s,c,funds)).toThrow('STOPPED');s.stopped=null;
 expect(()=>reserveMarketWrite(s,c,funds)).toThrow('FUNDS_OR_CAPACITY');reserveMarketWrite(s,c,{...funds,balance:5000});
 expect(s.intents.map(i=>i.phase)).toEqual(['isolated','pending']);
});
it.each([1000,60999,NaN])('rejects premature or invalid isolation at %s',at=>{const s=fixture(),before=structuredClone(s);expect(()=>isolateMarketIntent(s,{requestId:'r',at})).toThrow();expect(s).toEqual(before);});
