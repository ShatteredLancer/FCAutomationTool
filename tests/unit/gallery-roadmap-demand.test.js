import { expect, it, vi } from 'vitest';
import { createGalleryDemandWork, pruneGalleryDemandResult } from '../../src/gallery/roadmap-demand.js';

const target = (number = 1, count = 300) => ({ status: 'observed',
  set: { id: `futgg:${number}`, name: `Set ${number}`, requiredCards: 1,
    grades: ['D','C','B','A','S'].map((name, i) => ({ name, threshold: (i + 1) * 10,
      rewards: [{ type: 'event_token_1', count: 1, value: [0,0,5,8,15][i] }] })) },
  catalog: { source: 'futgg', tags: [{ id: 1, name: 'No-op', bonusType: 'ITEM_SCORE_PERCENTAGE', thresholdType: 'ITEM_COUNT',
    rules: [{ attribute: 'RARE', type: 'COUNT', target: 'ATTRIBUTE', values: ['999'] }], tiers: [{ minItems: 1, bonus: 1 }] }] },
  progress: { season: '27', setId: number, source: 'futgg', complete: true, poolComplete: true,
    rows: Array.from({ length: count }, (_, i) => ({ eaId: i + 1, playerEaId: i + 1, gradingScore: 100,
      collected: false, firstOwned: false, overall: 80, rarityEaId: 1 })) },
  prices: { 1: 1000 }, publicReference: { basis: 'empty-collection-public-reference', expiresAt: Date.now() + 300000,
    grades: ['D','C','B','A','S'].map(grade => ({ grade, ids: [1], cost: 1000 })) } });
const quote = (ids, expiresAt = Date.now() + 300000) => ({ source: 'public-references', policy: { source: 'futbin' }, expiresAt,
  freshPrices: Object.fromEntries(ids.map(id => [id, 500])), references: {} });
const options = { capital: 10000, lossLimit: null, resaleDiscountBps: 0 };
const run = (work, targets, extra = {}) => work.run({ targets, options, load: async ids => quote(ids), maxMs: 10000, ...extra });

it('publishes reference overview before any small bounded quote, not 300 speculative versions', async () => {
  const targets = [target()], before = structuredClone(targets), work = createGalleryDemandWork();
  let overview = false;
  const load = vi.fn(async (ids, settings) => {
    expect(overview).toBe(true); expect(ids.length).toBeLessThanOrEqual(24);
    expect(settings.purpose).toBe('roadmap'); expect(Number.isSafeInteger(settings.deadlineAt)).toBe(true);
    return quote(ids);
  });
  const value = await run(work, targets, { load, onPreview: result => { overview = true; expect(result.route).toHaveLength(1); } });
  expect(value.result).toMatchObject({ demandDriven: true, partial: true, coverage: { stopped: false } });
  expect(value.result.funding.totalPurchase).toBe(500);
  expect(new Set(load.mock.calls.flatMap(([ids]) => ids)).size).toBe(96);
  expect(targets).toEqual(before);
});

it('never quotes sold collected/held/unknown versions or collections already at the top tier', async () => {
  const achieved = target(1, 5); achieved.progress.rows[0].collected = true;
  const t = target(2, 5); t.progress.rows[0].collected = true; t.progress.rows[0].gradingScore = 0;
  t.progress.rows[1].collected = null; t.progress.rows[2].held = true; t.progress.rows[2].gradingScore = 0;
  const load = vi.fn(async ids => { expect(ids).toEqual([4,5]); return quote(ids); });
  const value = await run(createGalleryDemandWork(), [achieved, t], { load });
  expect(load).toHaveBeenCalledTimes(1); expect(value.result.deepCoverage.eligible).toBe(1);
});

it('keeps reference overview and completed prices at a quote-inclusive deadline, then resumes without sync/requotes', async () => {
  const work = createGalleryDemandWork(), targets = [target(1, 8)]; let time = Date.now();
  const load = vi.fn(async ids => { time += 10; return quote(ids, time + 10000); });
  const first = await run(work, targets, { load, now: () => time, clock: () => time, maxMs: 5 });
  expect(first.preview.route).toHaveLength(1); expect(first.result.coverage.stopped).toBe(true);
  const second = await run(work, targets, { load, now: () => time, clock: () => time, maxMs: 100 });
  expect(second.result.route).toHaveLength(1); expect(second.result.coverage.stopped).toBe(false);
  expect(load).toHaveBeenCalledTimes(1);
});

it('deduplicates a still-fresh exact version across overlapping collections and uses consistent prices', async () => {
  const load = vi.fn(async ids => quote(ids));
  const value = await run(createGalleryDemandWork(), [target(1, 1), target(2, 1)], { load });
  expect(load).toHaveBeenCalledTimes(1); expect(value.result.funding.uniqueCards).toBe(1);
  expect(value.result.route).toHaveLength(2);
});

it('propagates exact ever-owned evidence across overlapping sets without repurchasing a delayed false flag', async () => {
  const a = target(1, 1), b = target(2, 1); a.progress.rows[0].collected = true;
  const load = vi.fn(async ids => quote(ids));
  const before = structuredClone([a,b]), value = await run(createGalleryDemandWork(), [a,b], { load });
  expect(load).not.toHaveBeenCalled(); expect(value.preview.route).toEqual([]);
  expect(value.preview.freeCheck).toHaveLength(2); expect([a,b]).toEqual(before);
});

it('does not create zero-price routes from missing/expired quotations or borrow reference prices into deep results', async () => {
  const work = createGalleryDemandWork(), targets = [target(1, 1)];
  const value = await run(work, targets, { load: async () => ({ ...quote([]), freshPrices: {} }) });
  expect(value.preview.funding.totalPurchase).toBe(1000); expect(value.result.route).toEqual([]);
  const expired = await run(createGalleryDemandWork(), targets, { load: async ids => quote(ids, Date.now() - 1) });
  expect(expired.result.route).toEqual([]); expect(expired.preview.route).toHaveLength(1);
});

it('expires only independently priced results, retains the reference overview, and rechecks instead of extending TTL', async () => {
  const work = createGalleryDemandWork(), targets = [target(1, 1)]; let time = Date.now();
  const load = vi.fn(async ids => quote(ids, time + 20));
  const first = await run(work, targets, { load, now: () => time });
  expect(first.result.route).toHaveLength(1);
  time += 30; expect(work.validResult(time)).toBe(false);
  const second = await run(work, targets, { load, now: () => time });
  expect(second.result.route).toHaveLength(1); expect(load).toHaveBeenCalledTimes(2);
  expect(second.result.route[0].items[0].roadmapQuote.expiresAt).toBe(time + 20);
});

it('honors stop after an outstanding read and invalidates changed contexts without publishing its response', async () => {
  let stopped = false, current = true;
  const load = async ids => { stopped = true; return quote(ids); };
  const value = await run(createGalleryDemandWork(), [target(1, 1)], { load, stopped: () => stopped });
  expect(value.preview.route).toHaveLength(1); expect(value.result.route).toEqual([]);
  expect(value.result.coverage.stopped).toBe(true);
  await expect(run(createGalleryDemandWork(), [target(1, 1)], { current: () => current,
    load: async ids => { current = false; return quote(ids); } })).rejects.toThrow('CONTEXT_CHANGED');
});

it('retains revolving-capital semantics and can find an affordable alternative to an unaffordable reference', async () => {
  const t = target(1, 2); t.prices = { 1: 100000 }; t.publicReference.grades.forEach(grade => { grade.cost = 100000; });
  const value = await run(createGalleryDemandWork(), [t], { load: async ids => ({ ...quote(ids), freshPrices: { 1: 100000, 2: 500 } }) });
  expect(value.preview.route).toEqual([]); expect(value.result.funding.requiredCapital).toBe(500);
  expect(value.result.route[0].items.map(row => row.eaId)).toEqual([2]);
});

it('refuses a policy change across quote batches rather than mixing different selected authorities', async () => {
  const t = target(), work = createGalleryDemandWork(); let n = 0;
  await expect(run(work, [t], { load: async ids => ({ ...quote(ids), policy: { source: ++n === 1 ? 'futbin' : 'futgg' } }) }))
    .rejects.toThrow('RESPONSE_INVALID');
});

it('resumes paused nested grade work without repeating a confirmed quote or restarting the grade', async () => {
  const work = createGalleryDemandWork(), targets = [target(1, 1)], load = vi.fn(async ids => quote(ids));
  let time = 0, calls = 0, value, turns = 0;
  function* heavy() { calls++; for (let i = 0; i < 40; i++) yield;
    return { status: 'ready', plans: [{ reached: true, totalPrice: 500, score: 100, items: [{ eaId: 1, price: 500 }] }] }; }
  do {
    value = await run(work, targets, { load, clock: () => ++time, maxMs: 60, schedule: async () => {}, gradePlanner: heavy });
  } while (value.result.coverage.stopped && ++turns < 50);
  expect(turns).toBeGreaterThan(0); expect(turns).toBeLessThan(50);
  expect(value.result.route).toHaveLength(1); expect(load).toHaveBeenCalledTimes(1);
  expect(calls).toBe(3); // B/A/S only, not a repeated restart per click.
});

it('includes a rule-diverse alternative in the first quoted tier instead of rating/price-only slicing', async () => {
  const t = target(); t.catalog.tags[0].rules[0].values = ['2']; t.progress.rows[299].rarityEaId = 2;
  const load = vi.fn(async ids => quote(ids));
  await run(createGalleryDemandWork(), [t], { load });
  expect(load.mock.calls[0][0]).toContain(300);
});

it('removes only expired independent routes and recalculates totals without losing other valid collections', async () => {
  const a = target(1, 1), b = target(2, 1); b.progress.rows[0].eaId = 2; b.progress.rows[0].playerEaId = 2;
  b.prices = { 2: 1000 }; b.publicReference.grades.forEach(grade => { grade.ids = [2]; });
  const start = Date.now();
  const value = await run(createGalleryDemandWork(), [a,b], { load: async ids => quote(ids, start + (ids[0] === 1 ? 10000 : 20000)) });
  expect(value.result.route).toHaveLength(2);
  const before = structuredClone(value.result), pruned = pruneGalleryDemandResult(value.result, start + 10001);
  expect(pruned).toMatchObject({ partial: true, quotesExpired: true, addedTokens: 28, funding: { totalPurchase: 500 } });
  expect(pruned.route.map(row => row.setId)).toEqual(['futgg:2']); expect(value.result).toEqual(before);
});
