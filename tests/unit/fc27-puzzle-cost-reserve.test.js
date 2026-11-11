import { expect, it, vi } from 'vitest';
import { nationalCostFixture } from '../helpers/fc27-puzzle-national-cost-fixture.js';
import { createFc27PuzzleProcurementSession } from '../../src/fc27/puzzle-procurement-session.js';
import { parseFc27SbcRequirements, matchFc27SbcRequirements } from '../../src/fc27/sbc-requirements.js';

// Same native constraints and 18-owned/40-sampled scale, NOT a private inventory replay.
function fixture() {
  const f = nationalCostFixture(), { input, bronze, silver, cheap, prices } = f;
  const memory = new Map();
  const transport = { readCatalogPage: vi.fn(async query => ({ status: 'observed', source: 'ea-defid', season: '27', query,
    observedAt: input.now, pageEndObserved: Boolean(query.nation),
    entries: (query.level==='bronze' ? query.nation===18 ? cheap : bronze : query.level==='silver' ? silver : [])
      .filter(c => (!query.nation || c.nationId===query.nation) && (!query.league || c.leagueId===query.league))
      .slice(query.start, query.start+query.count) })),
    readQuotePage: vi.fn(), buy: vi.fn(), save: vi.fn(), move: vi.fn(), submit: vi.fn() };
  const options = { createTransport: async () => transport, now: () => input.now,
    get: async (k, fallback) => structuredClone(memory.get(k) ?? fallback), set: async (k, v) => memory.set(k, structuredClone(v)),
    list: async () => [], loadCachedPrices: async () => ({ hintOnly: true, prices: new Map() }),
    loadPublicPrices: async ids => ({ policy: { source: 'futbin' }, references: Object.fromEntries(ids.map(definitionId => [definitionId,
      { definitionId, season: '27', platform: 'pc', quotes: Object.fromEntries(['futbin', 'futgg'].map(source => [source,
        { schema: 2, source, definitionId, season: '27', platform: 'pc', price: source==='futbin' ? prices(definitionId) : 150,
          fetchedAt: input.now, expiresAt: input.now+300000, sourceUpdatedAt: null, error: null }])) }])) }) };
  return { ...f, options, transport };
}
const run = f => createFc27PuzzleProcurementSession(f.options).plan(f.input, { optimizeMaterialValue: true, adaptiveSearch: true });
const noWrites = f => { for (const key of ['readQuotePage', 'buy', 'save', 'move', 'submit']) expect(f.transport[key]).not.toHaveBeenCalled(); };

it('keeps work for cheaper connected candidates when the first material-value solution consumes its feasibility stage', async () => {
  const f = fixture(), before = JSON.stringify(f.input), progress = [];
  const result = await createFc27PuzzleProcurementSession(f.options).plan(f.input,
    { optimizeMaterialValue: true, adaptiveSearch: true, onProgress: value => progress.push(value) });
  expect(result.status, JSON.stringify(result)).toBe('suggested');
  const plan = result.plans[0], squad = Array(11).fill(null);
  expect(plan.materialValue).toBeLessThanOrEqual(4300);
  expect(plan.selectedOwned.some(card => card.rating===85)).toBe(false);
  expect(result.queries.some(q => q.nation===18 && q.level==='bronze')).toBe(true);
  expect(result.queries.length).toBeLessThanOrEqual(5);
  expect(result.diagnostics.nodes).toBeLessThanOrEqual(50000);
  expect(result.diagnostics.budgetNodes).toBe(result.diagnostics.nodes);
  expect(result.diagnostics.refinementPasses).toBeGreaterThan(0);
  expect(result.globalMinimumProven).toBe(false);
  for (const ref of plan.selectedOwned) squad[ref.slot] = f.input.inventory.items.find(card => card.id===ref.id);
  for (const ref of plan.purchases) squad[ref.slot] = { ...f.template, ...f.market.find(card => card.definitionId===ref.definitionId) };
  expect(squad.every(Boolean)).toBe(true);
  expect(new Set(squad.map(card => card.definitionId)).size).toBe(11);
  const facts = f.input.evaluateSquad(squad);
  expect(matchFc27SbcRequirements({ requirements: parseFc27SbcRequirements(f.input.challenge.rawRequirements, 11).rules,
    squad, chemistry: facts.chemistry, teamRating: facts.teamRating, clubLinks: f.input.clubLinks }).status).toBe('satisfied');
  expect(progress.some(value => value.refinementPasses>0)).toBe(true);
  expect(JSON.stringify(f.input)).toBe(before);
  console.info('COST_RESERVE', JSON.stringify({ value: plan.materialValue, nodes: result.diagnostics.nodes,
    passes: result.diagnostics.refinementPasses, queries: result.queries, chemistry: facts.chemistry }));
  const again = await run(f);
  expect(again.plans[0].materialValue).toBe(plan.materialValue);
  expect(again.requests).toBe(0);
  noWrites(f);
});

it('keeps the valid expensive solution when the connected lower tier is empty instead of banning 85-rated cards', async () => {
  const f = fixture(); f.cheap.length = 0;
  const result = await run(f);
  expect(result.status).toBe('suggested');
  expect(result.plans[0].selectedOwned.some(card => card.rating===85)).toBe(true);
  expect(result.plans[0].materialValue).toBe(8800);
  expect(result.diagnostics.nodes).toBeLessThanOrEqual(50000);
  noWrites(f);
});

it.each(['FC27_MARKET_HTTP_401', 'FC27_MARKET_HTTP_429'])('does not conceal %s during reserved cost discovery', async reason => {
  const f = fixture(), read = f.transport.readCatalogPage.getMockImplementation();
  f.transport.readCatalogPage.mockImplementation(async query => {
    if (query.nation) throw Error(reason);
    return read(query);
  });
  expect(await run(f)).toMatchObject({ status: 'blocked', reason, plans: [] });
  noWrites(f);
});

it('cancels cost discovery on input change even though a feasible plan is already available', async () => {
  const f = fixture(), read = f.transport.readCatalogPage.getMockImplementation(); let changed = false;
  f.transport.readCatalogPage.mockImplementation(async query => {
    const page = await read(query); if (query.nation) changed = true; return page;
  });
  expect(await createFc27PuzzleProcurementSession(f.options).plan(f.input, { optimizeMaterialValue: true, adaptiveSearch: true,
    assertCurrent: () => { if (changed) throw Error('FC27_PUZZLE_FILL_INPUTS_CHANGED'); } }))
    .toMatchObject({ status: 'blocked', reason: 'FC27_PUZZLE_FILL_INPUTS_CHANGED', plans: [] });
  noWrites(f);
});

it('does not return an expired price authority after cost discovery', async () => {
  const f = fixture(), read = f.transport.readCatalogPage.getMockImplementation(); let clock = f.input.now;
  f.options.now = () => clock;
  f.transport.readCatalogPage.mockImplementation(async query => {
    const page = await read(query); if (query.nation) clock += 300001; return { ...page, observedAt: clock };
  });
  expect(await run(f)).toMatchObject({ status: 'blocked', reason: 'FC27_BUY_REFERENCE_PRICE_EXPIRED', plans: [] });
  noWrites(f);
});
