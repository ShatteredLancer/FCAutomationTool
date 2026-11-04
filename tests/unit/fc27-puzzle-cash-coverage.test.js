import { expect, it, vi } from 'vitest';
import { puzzleFillFixture } from '../helpers/fc27-puzzle-fill-fixture.js';
import { marketRow } from '../helpers/fc27-market-fixture.js';
import { createFc27PuzzleProcurementSession } from '../../src/fc27/puzzle-procurement-session.js';
import { matchFc27SbcRequirements, parseFc27SbcRequirements } from '../../src/fc27/sbc-requirements.js';

// Same nine-player requirements as the report, synthetic catalogue/prices.
// The first broad bronze page is unrelated; the feasible gold incumbent is
// expensive, but a targeted bronze page supports a cheaper six-gold mix.
function fixture() {
  const input = puzzleFillFixture(), template = input.inventory.items[0], cache = new Map();
  input.inventory.items = []; input.policy.maxRating = 82;
  input.challenge.brickIndices = [0, 1];
  input.challenge.formation = { id: 1, positions: [25,25,16,14,14,12,7,5,5,3,0] };
  input.challenge.rawRequirements = [marketRow(5,4), marketRow(6,3,-1,1), marketRow(7,4,-1,1),
    marketRow(17,3,6), marketRow(19,70), marketRow(35,24)];
  const costs = [2200,1100,1200,3000,3600,950,1100,1200,2300], prices = new Map();
  const gold = input.challenge.formation.positions.slice(2).map((position, i) => ({
    definitionId: 81000 + i, rating: 78, rarity: 0, groups: [], special: false,
    evolution: false, cosmetic: false, nationId: 1, leagueId: 19, teamId: 10 + Math.floor(i/3), positions: [position],
  }));
  gold.forEach((card, i) => prices.set(card.definitionId, costs[i]));
  const bronze = [0,3,4].map(i => ({ ...gold[i], definitionId: 82000+i, rating: 64 }));
  bronze.forEach(card => prices.set(card.definitionId, 200));
  const unrelated = Array.from({ length: 20 }, (_, i) => ({ ...gold[0], definitionId: 83000+i,
    rating: 64, nationId: 20+i, leagueId: 40+i, teamId: 40+i, positions: [25] }));
  unrelated.forEach(card => prices.set(card.definitionId, 150));
  const goldDecoys = unrelated.slice(0,18).map(card => ({ ...card, definitionId: card.definitionId+1000, rating:78 }));
  goldDecoys.forEach(card => prices.set(card.definitionId, 600));
  const all = [...gold, ...bronze, ...unrelated, ...goldDecoys];
  const readCatalogPage = vi.fn(async query => {
    const rows = (query.level === 'gold' ? query.league || query.nation || query.team ? gold : [...gold.slice(1,3), ...goldDecoys]
      : query.league || query.nation || query.team ? bronze : unrelated)
      .filter(card => (!query.league || card.leagueId === query.league) && (!query.nation || card.nationId === query.nation)
        && (!query.team || card.teamId === query.team)).slice(query.start, query.start + query.count);
    return { status: 'observed', source: 'ea-defid', season: '27', query, observedAt: input.now,
      entries: rows, pageEndObserved: rows.length < query.count };
  });
  const write = vi.fn(() => { throw Error('Planning must not write to EA'); });
  const options = { createTransport: async () => ({ readCatalogPage, buy: write, move: write, save: write, submit: write }),
    now: () => input.now, get: async (key, fallback) => structuredClone(cache.get(key) ?? fallback),
    set: async (key, value) => cache.set(key, structuredClone(value)), list: async () => [],
    loadCachedPrices: vi.fn(async () => ({ hintOnly: true, prices: new Map(prices) })),
    loadPublicPrices: vi.fn(async ids => ({ policy: { source: 'futbin' }, references: Object.fromEntries(ids.map(definitionId =>
      [definitionId, { definitionId, season: '27', platform: 'pc', quotes: Object.fromEntries(['futbin','futgg'].map(source => [source, { schema: 2, source,
        definitionId, season: '27', platform: 'pc', price: prices.get(definitionId) ?? null,
        fetchedAt: input.now, expiresAt: input.now + 300000, sourceUpdatedAt: null, error: null }])) }])) })),
  };
  const verify = plan => {
    const squad = Array(11).fill(null);
    for (const ref of plan.purchases) squad[ref.slot] = { ...template, ...all.find(card => card.definitionId === ref.definitionId) };
    const facts = input.evaluateSquad(squad);
    expect(matchFc27SbcRequirements({ requirements: parseFc27SbcRequirements(input.challenge.rawRequirements,9).rules,
      squad: squad.filter(Boolean), chemistry: facts.chemistry, teamRating: facts.teamRating, clubLinks: input.clubLinks }).status,
    JSON.stringify(facts)).toBe('satisfied');
    return facts;
  };
  return { input, options, readCatalogPage, write, prices, gold, bronze, verify };
}

it('retains the costly feasible incumbent, then compares a targeted lower-quality mix in additional-coins mode', async () => {
  const x = fixture(), before = JSON.stringify(x.input);
  // A fully native-valid cheaper witness exists before running procurement.
  x.verify({ purchases: x.gold.map((card,i) => ({ ...([0,3,4].includes(i) ? x.bronze.find(b => b.positions[0] === card.positions[0]) : card), slot:i+2 })) });
  const baseline = await createFc27PuzzleProcurementSession({ ...x.options, list: null }).plan(x.input);
  expect(baseline.status, JSON.stringify(baseline)).toBe('suggested');
  expect(baseline.plans[0].estimatedCost).toBe(13200);
  const result = await createFc27PuzzleProcurementSession(x.options).plan(x.input);
  expect(result.status, JSON.stringify({reason:result.reason, diagnostics:result.diagnostics})).toBe('suggested');
  expect(result.diagnostics.objective).toBe('additional-coins');
  expect(result.plans[0].estimatedCost).toBeLessThanOrEqual(8450);
  expect(result.plans[0].purchases.filter(card => card.rating >= 75)).toHaveLength(6);
  expect(result.plans[0].selectedOwned).toEqual([]);
  expect(result.plans[0].materialValue).toBeUndefined();
  expect(x.verify(result.plans[0]).chemistry).toBeGreaterThanOrEqual(24);
  expect(result.queries.length).toBeLessThanOrEqual(5);
  expect(result.diagnostics.nodes).toBeLessThanOrEqual(70000);
  expect(result.diagnostics.coveragePages).toBeGreaterThan(0);
  expect(result.globalMinimumProven).toBe(false);
  expect(x.write).not.toHaveBeenCalled(); expect(JSON.stringify(x.input)).toBe(before);
});

it.each(['missing', 'over-cap', 'other-source-only'])('retains the original route when cheaper coverage has %s current prices', async mode => {
  const x = fixture();
  for (const card of x.bronze) x.prices.set(card.definitionId, mode === 'missing' ? null : 20000);
  if (mode === 'other-source-only') {
    const load = x.options.loadPublicPrices.getMockImplementation();
    x.options.loadPublicPrices.mockImplementation(async (...args) => {
      const snapshot = await load(...args);
      for (const card of x.bronze) {
        const quote = snapshot.references[card.definitionId]?.quotes.futgg;
        if (quote) quote.price = 200;
      }
      return snapshot;
    });
  }
  const result = await createFc27PuzzleProcurementSession(x.options).plan(x.input, { quoteCeiling: 4000 });
  expect(result.status).toBe('suggested');
  expect(result.plans[0].estimatedCost).toBe(13200);
  expect(result.plans[0].purchases.every(card => card.priceSource === 'futbin' && card.estimatedUnitPrice <= 4000)).toBe(true);
  x.verify(result.plans[0]); expect(x.write).not.toHaveBeenCalled();
});

it.each(['FC27_MARKET_HTTP_401','FC27_MARKET_HTTP_403','FC27_MARKET_HTTP_429'])('does not turn %s in cash coverage into a stale-price fallback', async reason => {
  const x = fixture(), read = x.readCatalogPage.getMockImplementation();
  x.readCatalogPage.mockImplementation(query => {
    if (query.level === 'bronze' && query.league) throw Error(reason);
    return read(query);
  });
  const result = await createFc27PuzzleProcurementSession(x.options).plan(x.input);
  expect(result).toMatchObject({ status: 'blocked', reason, plans: [] });
  expect(x.readCatalogPage.mock.calls.filter(([query]) => query.level === 'bronze' && query.league)).toHaveLength(1);
  expect(x.write).not.toHaveBeenCalled();
});

it('still rejects expired incumbent quotes after reading cheaper cash coverage', async () => {
  const x = fixture(), read = x.readCatalogPage.getMockImplementation(); let time = x.input.now;
  x.options.now = () => time;
  x.readCatalogPage.mockImplementation(async query => {
    const page = await read(query);
    if (query.level === 'bronze' && query.league) time += 300001;
    return { ...page, observedAt: time };
  });
  expect(await createFc27PuzzleProcurementSession(x.options).plan(x.input))
    .toMatchObject({ status: 'blocked', reason: 'FC27_BUY_REFERENCE_PRICE_EXPIRED', plans: [] });
  expect(x.write).not.toHaveBeenCalled();
});
