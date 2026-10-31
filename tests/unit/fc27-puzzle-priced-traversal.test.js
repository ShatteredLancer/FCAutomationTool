import { expect, it, vi } from 'vitest';
import { pricedChemistryFixture } from '../helpers/fc27-puzzle-priced-chemistry-fixture.js';
import { suggestFc27PuzzleJointPurchases } from '../../src/fc27/puzzle-procurement.js';
import { prepareFc27PuzzleConceptDraft, validateFc27PuzzleConceptDraft } from '../../src/fc27/puzzle-concept-draft.js';
import { createFc27PuzzleProcurementSession } from '../../src/fc27/puzzle-procurement-session.js';

it('compares a cheaper connected squad before dense expensive groups consume the same 50k budget', () => {
  const { input, entries, prices } = pricedChemistryFixture(), before = JSON.stringify(input);
  const result = suggestFc27PuzzleJointPurchases(input, entries, { prices });
  expect(result.status).toBe('suggested');
  const plan = result.plans[0];
  expect(plan.estimatedCost).toBe(2100);
  expect(plan.teamFacts.chemistry).toBeGreaterThanOrEqual(20);
  expect(plan.purchases.map(card => card.definitionId).sort()).toEqual([10000,10001,10002,10003,10004,10005,10006]);
  expect(result.nodes).toBeLessThanOrEqual(50000);
  const priced = { ...plan, purchases: plan.purchases.map(card => ({ ...card, estimatedUnitPrice: prices.get(card.definitionId) })) };
  const draft = prepareFc27PuzzleConceptDraft(input, priced);
  expect(draft.status).toBe('prepared');
  expect(validateFc27PuzzleConceptDraft(draft, input, [])).toMatchObject({ status: 'verified' });
  expect(JSON.stringify(input)).toBe(before);
});

it('also considers a cheaper multi-nation/two-league club-pair structure, not only one dense nationality', () => {
  const { input, entries, prices } = pricedChemistryFixture();
  // Structure/row-price shape observed on a public solution; synthetic IDs,
  // no provider request, and never a live price or exact account replay.
  const ratings = [78,70,81,82,82,72,68], nations = [2,2,3,4,4,2,2];
  const teams = [3,4,3,5,5,4,4], leagues = [3,4,3,3,3,4,4], costs = [850,600,650,850,750,850,850];
  for (let i=0;i<7;i++) {
    Object.assign(entries.find(card => card.definitionId === 10000+i), { rating: ratings[i], nationId: nations[i], teamId: teams[i], leagueId: leagues[i] });
    prices.set(10000+i, costs[i]);
  }
  const result = suggestFc27PuzzleJointPurchases(input, entries, { prices });
  expect(result.status).toBe('suggested');
  expect(result.estimatedCost).toBeLessThanOrEqual(5400);
  expect(result.plans[0].teamFacts.chemistry).toBeGreaterThanOrEqual(20);
  expect(result.nodes).toBeLessThanOrEqual(50000);
});

it('retains the cheap chemistry route across actual paged/priced Session orchestration without extra reads or writes', async () => {
  const { input, entries, prices } = pricedChemistryFixture(), cache = new Map();
  const write = vi.fn(() => { throw Error('No EA writes in planning'); });
  const readCatalogPage = vi.fn(async query => {
    const rows = entries.filter(card => query.level === (card.rating < 75 ? 'silver' : 'gold')
      && (!query.nation || card.nationId === query.nation) && (!query.league || card.leagueId === query.league)
      && (!query.team || card.teamId === query.team)).slice(query.start, query.start + query.count);
    return { status: 'observed', source: 'ea-defid', season: '27', query, observedAt: input.now,
      entries: rows, pageEndObserved: rows.length < query.count };
  });
  const loadPublicPrices = vi.fn(async ids => ({ policy: { source: 'futbin' }, references: Object.fromEntries(ids.map(definitionId => [definitionId,
    { definitionId, season: '27', platform: 'pc', quotes: Object.fromEntries(['futgg', 'futbin'].map(source => [source,
      { schema: 2, source, definitionId, season: '27', platform: 'pc', price: prices.get(definitionId), fetchedAt: input.now,
        sourceUpdatedAt: null, expiresAt: input.now + 300000, error: null }])) }])) }));
  const session = createFc27PuzzleProcurementSession({ now: () => input.now, loadPublicPrices,
    get: async (key, fallback) => structuredClone(cache.get(key) ?? fallback), set: async (key, value) => cache.set(key, structuredClone(value)),
    createTransport: async () => ({ readCatalogPage, buy: write, move: write, save: write, submit: write }) });
  const result = await session.plan(input, { optimizeMaterialValue: true });
  expect(result.status, JSON.stringify(result)).toBe('suggested');
  expect(result.plans[0].materialValue).toBe(2100);
  expect(result.plans[0].teamFacts.chemistry).toBeGreaterThanOrEqual(20);
  expect(readCatalogPage.mock.calls.length).toBeLessThanOrEqual(3);
  expect(result.diagnostics.nodes).toBeLessThanOrEqual(50000);
  const queries = readCatalogPage.mock.calls.length;
  expect((await session.plan(input, { optimizeMaterialValue: true })).plans[0].materialValue).toBe(2100);
  expect(readCatalogPage).toHaveBeenCalledTimes(queries);
  expect(write).not.toHaveBeenCalled();
});
