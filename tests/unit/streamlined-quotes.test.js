import { expect, it } from 'vitest';
import { streamlinedQuoteFailure, streamlinedQuoteCoverage } from '../../src/streamlined/quotes.js';

it('prioritizes source revocation over an earlier transport timeout inside the same batch', () => {
  const refs = { 1: { quotes: { futbin: { error: 'FC27_BUY_REFERENCE_TIMEOUT' } } },
    2: { quotes: { futbin: { error: 'FC27_PUBLIC_PRICE_FUTBIN_DISABLED' } } } };
  expect(streamlinedQuoteFailure(refs, 'futbin', [1, 2], 100)).toBe('FC27_PUBLIC_PRICE_FUTBIN_DISABLED');
});

it('counts only exact positive fresh quote evidence, keeping stale, future, wrong identity/source and unknown separate', () => {
  const quote = id => ({ source: 'futbin', definitionId: id, price: 150, fetchedAt: 10, expiresAt: 1000 });
  const refs = Object.fromEntries([quote(1), { ...quote(2), expiresAt: 100 }, { ...quote(3), source: 'futgg' },
    { ...quote(4), price: 0 }, { ...quote(5), fetchedAt: 101 }, { ...quote(6), definitionId: 7 },
    { ...quote(7), error: 'FC27_BUY_REFERENCE_TIMEOUT' }].map((q, i) => [i + 1, { quotes: { futbin: q } }]));
  expect(streamlinedQuoteCoverage(refs, 'futbin', [1, 2, 3, 4, 5, 6, 7, 8], 100)).toEqual({ requested: 8, valid: 1, failed: 1, missing: 6 });
});

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
