import { expect, it, vi } from 'vitest';
import { challenge, safeItem, policy, eligibility } from '../helpers/streamlined.js';
import { runStreamlinedRoutes, expandStreamlinedRoute } from '../../src/streamlined/routes.js';
import { planStreamlined } from '../../src/streamlined/planner.js';
import { createStreamlinedPlan, assertStreamlinedPlan } from '../../src/streamlined/plan.js';
import { createFc27StreamlinedSession } from '../../src/adapters/browser/fc27-streamlined-session.js';
import { normalizeStreamlinedSettings, createStreamlinedSettings } from '../../src/streamlined/settings.js';
import { contextKey } from '../../src/fc27/prelaunch-contract.js';

const stock = (id, points, pile = 'storage', extra = {}) => safeItem({ id, definitionId: id,
  points, pile, price: 3000, ...extra });
const market = (id, points, price = 150) => safeItem({ source: 'market', definitionId: id, points, price,
  quote: { source: 'futgg', definitionId: id, price, fetchedAt: 1, expiresAt: 1000 } });
const input = (inventory, extras = {}) => ({ challenge: challenge({ scoreRequirement: 1250 }),
  inventory, market: [market(901, 1250)], policy, eligibility, objective: 'inventory-first', quoteAt: 10, ...extras });
const solve = value => runStreamlinedRoutes(value, { schedule: async () => {}, now: () => 10 });

it('uses four existing Storage cards for 1250 points even with cheaper Club/market alternatives', async () => {
  const value = input([stock(1, 280), stock(2, 280), stock(3, 280), stock(4, 410), stock(5, 1250, 'club', { price: 200 })]);
  const result = await solve(value), route = result.routes[0], expanded = expandStreamlinedRoute(route, value.challenge);
  expect(route).toMatchObject({ score: 1250, purchaseCost: 0, inventoryCount: 4, marketCount: 0 });
  expect(expanded.items.map(i => i.id).sort()).toEqual([1, 2, 3, 4]);
  const plan = createStreamlinedPlan({ context: value.challenge.context, challenge: value.challenge,
    policy, objective: 'inventory-first', result: { ...expanded, route } });
  expect(assertStreamlinedPlan(plan)).toBe(plan);
  expect(planStreamlined(value).items.map(i => i.id).sort()).toEqual([1, 2, 3, 4]);
});

it('uses Storage first, then Club, without adding unnecessary lower-priority cards', async () => {
  const value = input([stock(1, 280), stock(2, 970, 'club'), stock(3, 1250, 'club', { price: 10000 }),
    stock(4, 1250, 'unassigned', { executionPile: 'club', price: 150 })]);
  const result = await solve(value), expanded = expandStreamlinedRoute(result.routes[0], value.challenge);
  expect(result.routes[0]).toMatchObject({ purchaseCost: 0, inventoryCount: 2, marketCount: 0 });
  expect(expanded.items.map(i => i.id)).toEqual([1, 2]);
});

it('buys only the remaining deficit and keeps already owned cards even when their price is unknown', async () => {
  const value = input([stock(1, 280, 'storage', { price: null }), stock(2, 560, 'club')],
    { market: [market(901, 410, 200), market(902, 1250, 150)] });
  const result = await solve(value), expanded = expandStreamlinedRoute(result.routes[0], value.challenge);
  expect(expanded.items.filter(i => i.source === 'inventory').map(i => i.id)).toEqual([1, 2]);
  expect(result.routes[0]).toMatchObject({ inventoryCount: 2, marketCount: 1, purchaseCost: 150, materialValue: null });
  expect(planStreamlined({ ...value, mode: 'inventory' })).toMatchObject({ status: 'partial', score: 840, purchaseCost: 0 });
});

it('retains lock, squad, evolution, special, tradeability, rating and eligibility filters', async () => {
  const rejected = [stock(1, 1250, 'storage', { locked: true }), stock(2, 1250, 'storage', { activeSquad: true }),
    stock(3, 1250, 'storage', { evolution: true }), stock(4, 1250, 'storage', { special: true }),
    stock(5, 1250, 'storage', { tradeable: true }), stock(6, 1250, 'storage', { rating: 91 }), stock(7, 1250)];
  const value = input([...rejected, stock(8, 1250, 'club')], { policy: { ...policy, protectFsuLockedPlayers: true, protectActiveSquad: true },
    eligibility: { known: true, matches: i => ({ status: i.id === 7 ? 'ineligible' : 'eligible' }) } });
  const result = await solve(value);
  expect(expandStreamlinedRoute(result.routes[0], value.challenge).items.map(i => i.id)).toEqual([8]);
  expect(Object.values(result.excluded).reduce((a, b) => a + b, 0)).toBe(7);
});

it('preserves explicit economic/market-only choices and rejects stale market quotes', async () => {
  const value = input([stock(1, 1250)]);
  expect((await solve({ ...value, objective: 'lowest-value' })).routes[0].purchaseCost).toBe(150);
  expect((await solve({ ...value, mode: 'market' })).routes[0].inventoryCount).toBe(0);
  const result = await solve(input([stock(1, 280)], { market: [market(901, 1000)], quoteAt: 2000 }));
  expect(result).toMatchObject({ status: 'partial', excluded: { 'market-quote': 1 } });
  expect(result.routes[0]).toMatchObject({ purchaseCost: 0, score: 280 });
});

it('default inventory-only success requires no quotes, catalog, settings writes or account mutations', async () => {
  const c = challenge({ scoreRequirement: 1250 }), prices = { load: vi.fn(() => { throw Error('offline'); }) },
    readMarketCandidates = vi.fn(() => { throw Error('offline'); }), set = vi.fn();
  const session = createFc27StreamlinedSession({ inspect: () => ({ context: c.context, challenge: c }),
    readInputs: () => ({ context: c.context, challenge: c, policy, eligibility, assertCurrent() {},
      inventory: [stock(1, 280), stock(2, 280), stock(3, 280), stock(4, 410)] }),
    get: async () => null, set, prices, readMarketCandidates, now: () => 10 });
  const result = await session.plan({});
  expect(result).toMatchObject({ status: 'ready', purchaseCost: 0, materialValue: null,
    quoteCoverage: { limited: false }, plan: { objective: 'inventory-first' }, liveExecutionEnabled: false });
  expect(result.items).toHaveLength(4); expect(assertStreamlinedPlan(result.plan)).toBe(result.plan);
  expect(result.marketPending).toBe(false);
  const selected = await session.selectRoute(result.routes[0].id);
  expect(selected.items).toEqual(result.items); expect(assertStreamlinedPlan(selected.plan)).toBe(selected.plan);
  expect(prices.load).not.toHaveBeenCalled(); expect(readMarketCandidates).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled();
});

it('executes a new zero-purchase preview through contribution only', async () => {
  const c = challenge({ scoreRequirement: 1250 }), transaction = { execute: vi.fn(async () => ({ status: 'completed' })) },
    purchase = vi.fn(), prepare = vi.fn(), set = vi.fn();
  const session = createFc27StreamlinedSession({ inspect: () => ({ context: c.context, challenge: c }),
    readInputs: () => ({ context: c.context, challenge: c, policy, eligibility, assertCurrent() {}, inventory: [stock(1, 1250)] }),
    get: async () => null, set, createExecution: async () => ({ prepare, transaction, purchase }), now: () => 10 });
  const result = await session.plan({});
  expect(result.liveExecutionEnabled).toBe(true); expect(transaction.execute).not.toHaveBeenCalled();
  expect(await session.contribute({ fingerprint: result.plan.fingerprint, batchIndices: [0] })).toMatchObject({ status: 'completed' });
  expect(transaction.execute).toHaveBeenCalledWith(result.plan, expect.objectContaining({ approved: true }), expect.any(Object));
  expect(purchase).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled();
});

it('does not use unapproved sources or excess cards and can stop a bounded priority search', async () => {
  const value = input([stock(1, 280), stock(2, 970, 'club')]);
  const result = await solve(value);
  expect(result.routes[0]).toMatchObject({ inventoryCount: 2, score: 1250, purchaseCost: 0 });
  const stopped = await runStreamlinedRoutes(input(Array.from({ length: 100 }, (_, i) => stock(i + 1, 20))),
    { stopped: () => true, schedule: async () => {}, now: () => 10 });
  expect(stopped.status).toBe('cancelled');
});

it('keeps unquoted stock while obtaining fresh market quotes only for a deficit', async () => {
  const c = challenge({ scoreRequirement: 1250 }), prices = { load: vi.fn() }, readMarketCandidates = vi.fn(async () => ({
    market: [market(901, 410, 200)], quoteCoverage: { requested: 2, valid: 1, missing: 1, failed: 0 } }));
  const session = createFc27StreamlinedSession({ inspect: () => ({ context: c.context, challenge: c }),
    readInputs: () => ({ context: c.context, challenge: c, policy, eligibility, assertCurrent() {},
      inventory: [stock(1, 280), stock(2, 560, 'club')] }),
    get: async () => null, set: async () => {}, prices, readMarketCandidates, now: () => 10 });
  const result = await session.plan({});
  expect(result).toMatchObject({ status: 'ready', purchaseCost: 200, materialValue: null,
    quoteCoverage: { limited: true }, plan: { execution: { quoteLimited: true } } });
  expect(result.items.filter(i => i.source === 'inventory')).toHaveLength(2);
  expect(readMarketCandidates).toHaveBeenCalledOnce(); expect(prices.load).not.toHaveBeenCalled();
});

it('migrates old defaults for new previews only and keeps explicit schema-3 economics available', async () => {
  const c = challenge(), key = contextKey(c.context, 'streamlined-settings:global');
  const saved = { schema: 2, settings: { objective: 'lowest-value', maxRating: 83 } }, store = new Map([[key, saved]]), set = vi.fn(async (k, v) => store.set(k, v));
  const settings = createStreamlinedSettings({ get: async k => store.get(k) ?? null, set });
  expect(normalizeStreamlinedSettings().objective).toBe('inventory-first');
  expect(await settings.read(c.context, c.id)).toMatchObject({ objective: 'inventory-first', maxRating: 83 });
  expect(store.get(key)).toBe(saved); expect(set).not.toHaveBeenCalled();
  await settings.save(c.context, null, { objective: 'lowest-value' });
  expect(store.get(key).schema).toBe(3); expect((await settings.read(c.context)).objective).toBe('lowest-value');
});
