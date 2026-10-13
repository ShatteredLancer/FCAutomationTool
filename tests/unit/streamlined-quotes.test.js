import { expect, it } from 'vitest';
import { streamlinedQuoteFailure } from '../../src/streamlined/quotes.js';

const ref = quote => ({ 1: { quotes: { futgg: { fetchedAt: 1, expiresAt: 100, price: 200, error: null, ...quote },
  futbin: { error: 'FC27_PUBLIC_PRICE_SOURCE_NOT_REQUESTED' } } } });

it('does not read the other source or turn normal missing prices into network failures', () => {
  expect(streamlinedQuoteFailure(ref({}), 'futgg', [1], 10)).toBeNull();
  expect(streamlinedQuoteFailure(ref({ price: null }), 'futgg', [1], 10)).toBeNull();
  expect(streamlinedQuoteFailure({}, 'futgg', [1], 10)).toBeNull();
  expect(streamlinedQuoteFailure(ref({ price: null, error: 'FC27_PUBLIC_PRICE_PLAYER_INVALID' }), 'futgg', [1], 10)).toBeNull();
  expect(streamlinedQuoteFailure(ref({ expiresAt: 10 }), 'futgg', [1], 10, { requireFresh: false })).toBeNull();
});
it('distinguishes source failures and expired prices from valid candidates', () => {
  expect(streamlinedQuoteFailure(ref({ price: null, error: 'FC27_BUY_REFERENCE_TIMEOUT' }), 'futgg', [1], 10))
    .toBe('FC27_BUY_REFERENCE_TIMEOUT');
  for (const quote of [{ expiresAt: 10 }, { fetchedAt: 11 }]) {
    expect(streamlinedQuoteFailure(ref(quote), 'futgg', [1], 10)).toBe('FC27_STREAMLINED_QUOTES_EXPIRED');
  }
});
