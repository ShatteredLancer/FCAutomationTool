import { expect, it } from 'vitest';
import { moveListingCurrencyPrice as move } from '../../src/adapters/browser/fc27-listing-currency.js';

it('moves one adjacent EA price in either direction at every tier boundary', () => {
  for (const [a,b] of [[150,200],[200,250],[950,1000],[1000,1100],[9900,10000],[10000,10250],
    [49750,50000],[50000,50500],[99500,100000],[100000,101000],[14999000,15000000]]) {
    expect(move(a,1,150)).toBe(b); expect(move(b,-1,150)).toBe(a);
  }
});
it('moves from unrounded input to the immediate legal neighbour, not two steps', () => {
  for (const [v,lo,hi] of [[275,250,300],[999,950,1000],[10249,10000,10250]]) {
    expect(move(v,1,150)).toBe(hi); expect(move(v,-1,150)).toBe(lo);
  }
});
it('never exceeds unaligned bounds or creates an illegal boundary price', () => {
  expect(move(200,1,175,275)).toBe(250);
  expect(move(250,1,175,275)).toBe(250);
  expect(move(200,-1,175,275)).toBe(200);
  expect(move(2000,1,150,2050)).toBe(2000);
  expect(move(15000000,1,150)).toBe(15000000);
  expect(move(200,-1)).toBe(200);
  expect(move(150,-1,150)).toBe(150);
});
it('handles empty, invalid and impossible ranges without a loop or purchase authorization', () => {
  expect(move('',1,150)).toBe(150); expect(move(null,-1,200)).toBe(200);
  expect(move('bad',1)).toBeNull(); expect(move(Infinity,1)).toBeNull();
  expect(move(200,0)).toBeNull(); expect(move(200,1,150,149)).toBeNull();
  expect(move(200,1,151,199)).toBeNull();
});
