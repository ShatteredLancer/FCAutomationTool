import { it, expect } from 'vitest';
import { marketTaskBuyResponse } from '../../src/trading/market-task-buy-response.js';

it.each([426,461,478])('keeps a definite bid rejection %s separate from outer 403', code => {
  expect(marketTaskBuyResponse({ success:false,status:403,error:{code},data:{itemIds:[]} }))
    .toMatchObject({code,errorCode:code,httpStatus:403,category:'offer-rejected',rejected:true,stop:null});
});
it.each([undefined,403,999])('does not label an unexplained 403/%s as rate limiting', code => {
  expect(marketTaskBuyResponse({success:false,status:403,error:{code}}))
    .toMatchObject({category:'purchase-denied',stop:'manual'});
});
it.each([401,429])('does not hide HTTP %s behind a competitive business code', status => {
  expect(marketTaskBuyResponse({success:false,status,error:{code:461}}).stop).toBe(status===401?'authentication':'throttle');
});
it.each([null,{itemIds:[1]},{itemIds:'bad'}])('does not treat contradictory or missing success evidence as permission to retry: %j', data => {
  const reply={success:false,status:403,error:{code:461},data};
  if(data===null)reply.success=undefined;
  expect(marketTaskBuyResponse(reply).category).not.toBe('offer-rejected');
});
it.each([[458,'captcha'],[459,'captcha'],[512,'throttle'],[521,'throttle'],[494,'throttle']])('stops on business code %s', (code,stop) => {
  expect(marketTaskBuyResponse({success:false,status:403,error:{code}}).stop).toBe(stop);
});
it.each([[470,'insufficient-funds'],[473,'destination-full']])('identifies operational rejection %s', (code,category) => {
  expect(marketTaskBuyResponse({success:false,status:403,error:{code}})).toMatchObject({category,stop:null,rejected:true});
});
