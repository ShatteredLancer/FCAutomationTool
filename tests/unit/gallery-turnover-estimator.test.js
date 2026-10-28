import { expect, it } from 'vitest';
import { forecastGalleryTurnover } from '../../src/gallery/turnover-budget.js';
import { createGalleryTurnoverEstimator } from '../../src/gallery/turnover-estimator.js';
const metrics = value => value.status === 'estimated' ? { status:value.status,requiredCapital:value.requiredCapital,
  expectedNetLoss:value.expectedNetLoss,feasible:value.feasible,capitalShortfall:value.capitalShortfall } : value;
const item = (eaId,price,resalePrice=price) => ({eaId,price,resalePrice});

it('matches full forecasts while reusing the unchanged ordered prefix and recalculating shared suffixes',()=>{
  const options={capital:2000,resaleDiscountBps:1250},work=createGalleryTurnoverEstimator(options);
  const a={setId:'a',items:[item(1,900),item(2,200)]},b={setId:'b',items:[item(2,200),item(3,800)]};
  const c={setId:'c',items:[item(4,300)]};
  for(const steps of [[a,b],[a,b,c],[a,c,b],[a],[a,b]])
    expect(work.estimate(steps)).toEqual(metrics(forecastGalleryTurnover({...options,steps,optimizeOrder:false})));
  expect(work.stats().reusedSteps).toBeGreaterThan(0);expect(work.stats().prefixCount).toBeLessThanOrEqual(8);
});

it('handles new price objects, conflicting shared versions, missing prices and individually impossible purchases',()=>{
  const options={capital:500},work=createGalleryTurnoverEstimator(options),a={setId:'a',items:[item(1,400)]};
  for(const steps of [[a],[a,{setId:'b',items:[item(1,401)]}],
    [{setId:'a',items:[item(1,600)]}],[{setId:'a',items:[item(1,null)]}],[a]])
    expect(work.estimate(steps)).toEqual(metrics(forecastGalleryTurnover({...options,steps,optimizeOrder:false})));
});

it('is differential with the original cashflow logic across varied taxes, losses, orders, shared cards and capitals',()=>{
  let seed=37;const random=n=>{seed=(seed*1664525+1013904223)>>>0;return seed%n;};
  for(let run=0;run<50;run++){
    const options={capital:run%3===0?null:2000+random(5000),taxBps:random(10001),resaleDiscountBps:random(5000)};
    const work=createGalleryTurnoverEstimator(options),cards=Array.from({length:18},(_,i)=>item(i+1,150+random(4000),random(6000)));
    const steps=Array.from({length:12},(_,i)=>({setId:`c${i}`,items:[...new Set([cards[random(18)],cards[random(18)],cards[random(18)]])]}));
    for(let n=1;n<=steps.length;n++)expect(work.estimate(steps.slice(0,n)))
      .toEqual(metrics(forecastGalleryTurnover({...options,steps:steps.slice(0,n),optimizeOrder:false})));
  }
});

it('processes only changing suffix cycles instead of the entire route for each trial',()=>{
  const work=createGalleryTurnoverEstimator({capital:5000}),prefix=Array.from({length:64},(_,i)=>({setId:`c${i}`,items:[item(i+1,200)]}));
  work.estimate(prefix);
  for(let i=0;i<30;i++)work.estimate([...prefix,{setId:'tail',items:[item(100+i,300)]}]);
  expect(work.stats().processedCycles).toBeLessThan(500);
  expect(work.stats().reusedSteps).toBeGreaterThan(1500);
  expect(work.stats().prefixCount).toBeLessThanOrEqual(8);
});
