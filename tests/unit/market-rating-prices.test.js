import { it, expect } from 'vitest';
import { normalizeTradingTaskInput, defaultTradingTaskSettings } from '../../src/trading/task-model.js';
import { marketTaskPrice } from '../../src/trading/market-task-prices.js';
import { taskCandidateAllowed } from '../../src/trading/task-catalog.js';
const rows = () => ({83:{buy:800,sell:1000},84:{buy:1100,sell:1400},85:{buy:null,sell:null}});
const input = () => ({name:'Rating rules',mode:'filter',settings:{...defaultTradingTaskSettings(),ratingMin:83,ratingMax:85},players:[],owned:[],excluded:[],ratingPrices:rows()});
const priceTiers=[{min:100000,inc:1000},{min:50000,inc:500},{min:10000,inc:250},{min:1000,inc:100},{min:0,inc:50}];
it('only requires a buy price for hold-only rating rows and prohibits computing a sell action',()=>{
 const t=input();t.settings.afterBuy='hold';t.ratingPrices={84:{buy:1100,sell:null}};
 const task=normalizeTradingTaskInput(t);expect(taskCandidateAllowed({rating:84},task)).toBe(true);
 expect(marketTaskPrice({task,priceTiers,side:'buy',rating:84}).price).toBe(1100);
 expect(()=>marketTaskPrice({task,priceTiers,side:'sell',rating:84})).toThrow('MARKET_HOLD_ONLY');
 expect(()=>normalizeTradingTaskInput({...t,settings:{...t.settings,afterBuy:'list'}})).toThrow('TASKS_RATING_PRICES_INVALID');
});
it('keeps legacy shape and independent mixed rules; inactive rows persist but do not become candidates',()=>{
 const legacy=input();delete legacy.ratingPrices;expect(normalizeTradingTaskInput(legacy)).not.toHaveProperty('ratingPrices');
 const t=input();t.settings.ratingMin=84;const task=normalizeTradingTaskInput(t);
 expect(task.ratingPrices['83'].buy).toBe(800);
 expect(taskCandidateAllowed({rating:83},task)).toBe(false);
 expect(taskCandidateAllowed({rating:84},task)).toBe(true);
 expect(taskCandidateAllowed({rating:85},task)).toBe(false);
});
it.each([{}, {83:{buy:null,sell:null}}, {84:{buy:1125,sell:1400}}, {84:{buy:1100,sell:undefined}}, {100:{buy:800,sell:1000}}, {84:{buy:800,sell:1000,profit:0}}])('rejects invalid/no complete active rows %j',ratingPrices=>{
 expect(()=>normalizeTradingTaskInput({...input(),ratingPrices})).toThrow('TASKS_RATING_PRICES_INVALID');
});
it('permits partial skipped rows and never falls back to quotes or uniform prices',()=>{
 const t=input();t.ratingPrices['85']={buy:1500,sell:null};const task=normalizeTradingTaskInput(t);
 const args={task,priceTiers,now:100,quotes:null,source:'both'};
 expect(marketTaskPrice({...args,side:'buy',rating:83})).toMatchObject({price:800,reference:null});
 expect(marketTaskPrice({...args,side:'buy',rating:84}).price).toBe(1100);
 expect(marketTaskPrice({...args,side:'sell',rating:84}).price).toBe(1400);
 task.settings.hardCap=900;task.ratingPrices['84'].buy=1200;
 expect(marketTaskPrice({...args,side:'buy',rating:84}).price).toBe(900);
 expect(marketTaskPrice({...args,side:'sell',rating:84}).price).toBe(1400);
 expect(()=>marketTaskPrice({...args,side:'buy',rating:85})).toThrow('RATING_PRICE_UNAVAILABLE');
});
