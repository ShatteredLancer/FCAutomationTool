import { it, expect } from 'vitest';
import { defaultTradingTaskSettings, normalizeTradingTaskInput } from '../../src/trading/task-model.js';
import { chooseMarketOffer } from '../../src/trading/market-bidding.js';
import { completeMarketRatingRow } from '../../src/trading/market-rating-prices.js';
const tiers=[{min:10000,inc:250},{min:1000,inc:100},{min:0,inc:50}];
const task=(settings={})=>({name:'Ratings',mode:'filter',settings:{...defaultTradingTaskSettings(),...settings},players:[],owned:[],excluded:[]});
it('migrates existing tasks to BIN and validates separate bid settings',()=>{
  expect(normalizeTradingTaskInput(task()).settings.buyMode).toBe('bin');
  expect(()=>normalizeTradingTaskInput(task({buyMode:'anything'}))).toThrow();
});
it.each(['bin','bid','both'])('requires only visible rating prices for %s, preserving inactive inputs',buyMode=>{
  const t=task({buyMode,afterBuy:'hold'}),row={buy:buyMode==='bid'?null:1100,sell:null,bid:buyMode==='bin'?null:900};
  expect(completeMarketRatingRow(row,t)).toBe(true);
  expect(normalizeTradingTaskInput({...t,ratingPrices:{84:row}}).ratingPrices[84]).toEqual(row);
  expect(completeMarketRatingRow({...row,[buyMode==='bid'?'bid':'buy']:null},t)).toBe(false);
});
it('prefers BIN within its own cap, otherwise bids even when BIN is expensive',()=>{
  const offer={startingBid:700,currentBid:900,buyNow:1800,seconds:120};
  expect(chooseMarketOffer({offer,buyMode:'both',buyCap:1900,bidCap:1000,priceTiers:tiers})).toEqual({kind:'buy',coins:1800});
  expect(chooseMarketOffer({offer,buyMode:'both',buyCap:1100,bidCap:1000,priceTiers:tiers})).toEqual({kind:'bid',coins:950});
  expect(chooseMarketOffer({offer,buyMode:'bid',bidCap:900,priceTiers:tiers})).toBeNull();
});
it('uses starting price or the EA next tier and never silently crosses into BIN for bid-only',()=>{
  const args={buyMode:'bid',bidCap:1400,priceTiers:tiers,offer:{startingBid:700,currentBid:1000,buyNow:2000,seconds:10}};
  expect(chooseMarketOffer(args)).toEqual({kind:'bid',coins:1100});
  expect(chooseMarketOffer({...args,bidExact:'cap'})).toEqual({kind:'bid',coins:1400});
  expect(chooseMarketOffer({...args,offer:{...args.offer,currentBid:0}})).toEqual({kind:'bid',coins:700});
  expect(chooseMarketOffer({...args,offer:{...args.offer,buyNow:1100}})).toBeNull();
  expect(chooseMarketOffer({...args,bidExpires:5})).toBeNull();
});
