import { describe, it, expect } from 'vitest';
import { marketTaskReference, marketTaskPrice } from '../../src/trading/market-task-prices.js';
import { defaultTradingTaskSettings } from '../../src/trading/task-model.js';

const context = { scope: 'test', season: '27', platform: 'console' }, now = 1000000;
const priceTiers = [{ min: 100000, inc: 1000 }, { min: 50000, inc: 500 }, { min: 10000, inc: 250 }, { min: 1000, inc: 100 }, { min: 0, inc: 50 }];
const quote = (source, price) => ({ source, price, definitionId: 1, platform: 'console', season: '27', fetchedAt: now - 1000, expiresAt: now + 10000 });
const args = () => ({ task: { settings: { ...defaultTradingTaskSettings(), buyRule: 'percent', buyValue: 90, sellRule: 'reference', sellValue: 110 } },
  quotes: { futbin: quote('futbin', 1100), futgg: quote('futgg', 800) }, source: 'both', definitionId: 1, context, now, priceTiers });

describe('independent task pricing', () => {
  it('uses valid FUTBIN first in Both even when GG is lower; missing FB falls back', () => {
    const a = args(); expect(marketTaskReference(a).price).toBe(1100);
    a.quotes.futbin.expiresAt = now; expect(marketTaskReference(a).price).toBe(800);
    a.source = 'futbin'; expect(() => marketTaskReference(a)).toThrow('MARKET_REFERENCE_UNAVAILABLE');
  });
  it.each(['definitionId', 'platform', 'season', 'fetchedAt', 'sourceUpdatedAt', 'futbinPlatform', 'price'])(
    'rejects wrong/old FB %s rather than using another platform or fake price', key => {
      const a = args(); a.source = 'futbin';
      a.quotes.futbin[key] = { definitionId: 2, platform: 'pc', season: '26', fetchedAt: now + 1,
        sourceUpdatedAt: now + 1, futbinPlatform: 'pc', price: 0 }[key];
      expect(() => marketTaskReference(a)).toThrow('MARKET_REFERENCE_UNAVAILABLE');
    });
  it('floors buying and uses native nearest steps for selling without a profit coupling', () => {
    const a = args(); expect(marketTaskPrice({ ...a, side: 'buy' }).price).toBe(950);
    expect(marketTaskPrice({ ...a, side: 'sell' }).price).toBe(1200);
    a.task.settings.buyValue = 200;
    expect(marketTaskPrice({ ...a, side: 'sell' }).price).toBe(1200);
  });
  it('fixed loss-making rules work with no quotes, including a per-card override', () => {
    const a = args(); a.quotes = {}; Object.assign(a.task.settings, { buyRule: 'fixed', buyValue: 800, sellRule: 'fixed', sellValue: 700 });
    expect(marketTaskPrice({ ...a, side: 'buy' })).toMatchObject({ price: 800, reference: null });
    expect(marketTaskPrice({ ...a, side: 'sell' }).price).toBe(700);
    a.task.settings.hardCap = 900;
    expect(marketTaskPrice({ ...a, side: 'buy', player: { cap: 1100 } }).price).toBe(900);
  });
  it('never raises a low buy cap to EA minimum or silently changes a fixed sell rule', () => {
    const a = args(); a.task.settings.hardCap = 500;
    expect(() => marketTaskPrice({ ...a, side: 'buy', limits: { minimum: 600, maximum: 10000 } })).toThrow('MARKET_PRICE_LIMIT');
    Object.assign(a.task.settings, { sellRule: 'fixed', sellValue: 1234 });
    expect(() => marketTaskPrice({ ...a, side: 'sell' })).toThrow('MARKET_PRICE_LIMIT');
    expect(() => marketTaskPrice({ ...a, side: 'buy', priceTiers: [] })).toThrow('MARKET_PRICE_LIMIT');
  });
});
