import { it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { marketSessionRoute, observeMarketSessionEvidence } from '../../scripts/browser-inspection/market-session-evidence.mjs';

it('classifies only reviewed EA paths without preserving sensitive URL components', () => {
  expect(marketSessionRoute('https://utas.test.ea.com/ut/game/fc27/user/credits?private=value')).toBe('credits');
  expect(marketSessionRoute('https://accounts.ea.com/connect/auth?access_token=private')).toBe('identity-auth');
  expect(marketSessionRoute('https://utas.test.ea.com/ut/game/fc27/trade/123456/bid')).toBe('bid-or-buy');
  expect(marketSessionRoute('https://ea.com.attacker.test/ut/auth')).toBeNull();
  expect(marketSessionRoute('http://utas.test.ea.com/ut/auth')).toBeNull();
  expect(marketSessionRoute('https://utas.test.ea.com/private/account')).toBeNull();
});
it('retains elapsed time and bounded browser network failures without URL or arbitrary error text', () => {
  vi.useFakeTimers();
  try {
    const page = new EventEmitter(), observer = observeMarketSessionEvidence(page, 'Z:/nonexistent-fcat-inspection');
    const request = { url: () => 'https://utas.test.ea.com/ut/game/fc27/user/credits?secret=value', method: () => 'GET',
      failure: () => ({ errorText: 'net::ERR_TIMED_OUT' }) };
    page.emit('request', request); vi.advanceTimersByTime(15000); page.emit('requestfailed', request);
    expect(observer.snapshot().rows[0]).toMatchObject({ route: 'credits', status: null, durationMs: 15000, networkError: 'net::ERR_TIMED_OUT' });
    page.emit('requestfailed', { ...request, failure: () => ({ errorText: 'private-account-credentials' }) });
    expect(observer.snapshot().rows[1].networkError).toBe('NETWORK_FAILED');
    expect(JSON.stringify(observer.snapshot())).not.toMatch(/secret|private-account|https/);
    observer.stop(); expect(page.listenerCount('requestfailed')).toBe(0); expect(page.listenerCount('request')).toBe(0);
  } finally { vi.useRealTimers(); }
});
it('observes original raw status transitions, bounds history and never reads headers/bodies or starts requests', () => {
  const page = new EventEmitter(); const observer = observeMarketSessionEvidence(page, 'Z:/nonexistent-fcat-inspection');
  expect(observeMarketSessionEvidence(page, 'unused')).toBe(observer);
  const send = (url, status) => page.emit('response', { url: () => url, status: () => status, request: () => ({ method: () => 'GET' }),
    body() { throw Error('must not read'); }, headers() { throw Error('must not read'); } });
  send('https://utas.test.ea.com/ut/game/fc27/user/credits',401);
  send('https://utas.test.ea.com/ut/auth',200);
  send('https://utas.test.ea.com/ut/game/fc27/user/credits',200);
  expect(observer.snapshot().rows.map(row => row.status)).toEqual([401,200,200]);
  for (let i = 0; i < 110; i++) send('https://accounts.ea.com/connect/auth?access_token=private',200);
  expect(observer.snapshot().rows).toHaveLength(100);
  expect(JSON.stringify(observer.snapshot())).not.toMatch(/private|token|https|123456/);
  page.emit('close'); expect(page.listenerCount('response')).toBe(0);
});
