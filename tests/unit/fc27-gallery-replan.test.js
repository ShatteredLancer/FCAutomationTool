import { expect, it } from 'vitest';
import { planGalleryRemainderSteps } from '../../src/gallery/replan.js';

const row = (eaId, collected = false) => ({ eaId, playerEaId: eaId, collected, gradingScore: 100, galleryScore: 100,
  firstOwned: false, holographic: false, rarityEaId: 1, overall: 80 });
const target = (id = 'futgg:1') => ({ set: { id, requiredCards: 3, grades: [{ name: 'S', threshold: 300 }] }, targetGrade: 'S',
  catalog: { source: 'futgg', tags: [{ id: 1, name: 'No-op', bonusType: 'ITEM_SCORE_PERCENTAGE', thresholdType: 'ITEM_COUNT',
    rules: [{ attribute: 'RARE', type: 'COUNT', target: 'ATTRIBUTE', values: ['999'] }], tiers: [{ minItems: 1, bonus: 0 }] }] },
  progress: { season: '27', setId: Number(id.slice(6)), complete: true, rows: [row(1, true), row(2), row(3), row(4), row(5)] },
  prices: { 2: 200, 3: 200, 4: 250, 5: 300 } });
const outcome = () => ({ status: 'partial', reason: 'FC27_GALLERY_NO_LISTING', spent: 200, collection: { status: 'confirmed' },
  results: [{ definitionId: 2, state: 'club', price: 200 }, { definitionId: 3, state: 'waiting' }],
  failures: [{ definitionId: 3, reason: 'FC27_GALLERY_NO_LISTING' }] });
function run(input) { const steps = planGalleryRemainderSteps(input); let next; do { next = steps.next(); } while (!next.done); return next.value; }

it('keeps bought versions and costs, excludes missing versions and buys only the remaining slot', () => {
  const input = { targets: [target()], outcome: outcome(), budget: 600 }, before = structuredClone(input);
  const result = run(input);
  expect(result).toMatchObject({ status: 'ready', spent: 200, remainingBudget: 400 });
  expect(result.plans[0].items.map(item => item.eaId)).toEqual([4]);
  expect(result.plans[0].totalPrice).toBe(250);
  expect(result.targets[0].progress.rows.find(item => item.eaId === 2)).toMatchObject({ firstOwned: false, purchaseProjected: true });
  expect(input).toEqual(before);
});
it('replans all-failed attempts without requiring an acquisition', () => {
  const result = run({ targets: [target()], outcome: { ...outcome(), spent: 0,
    results: [{ definitionId: 3, state: 'waiting' }] } });
  expect(result.status).toBe('ready');
  expect(result.plans[0].items.map(item => item.eaId)).toEqual([2, 4]);
});
it.each(['buy-pending', 'bought', 'move-pending', 'move-rejected'])('blocks unresolved %s instead of generating a new purchase', state => {
  expect(run({ targets: [target()], outcome: { ...outcome(), results: [{ definitionId: 2, state, price: 200 }] } }))
    .toMatchObject({ status: 'blocked', reason: 'purchase-recovery-required' });
});
it.each(['pending', undefined])('blocks unconfirmed collection (%s)', status => {
  expect(run({ targets: [target()], outcome: { ...outcome(), collection: { status } } }).status).toBe('blocked');
});
it('keeps public estimates after an expensive EA offer and deducts only confirmed spend', () => {
  const value = outcome(); value.reason = 'FC27_GALLERY_BUDGET_EXCEEDED';
  value.failures = [{ definitionId: 3, reason: value.reason, observedPrice: 1500 }];
  const result = run({ targets: [target()], outcome: value, budget: 600 });
  expect(result.plans[0].items[0].eaId).toBe(3);
  expect(result.targets[0].prices[3]).toBe(200);
  expect(result.ledger.quotes).toBeUndefined();
  expect(result.ledger.excludedIds).toEqual([]);
  expect(run({ targets: [target()], outcome: value, budget: 400 })).toMatchObject({ status: 'ready', remainingBudget: 200 });
  expect(run({ targets: [target()], outcome: value, budget: 399 })).toMatchObject({ status: 'partial', reason: 'budget-unreachable', plans: [] });
});
it('ignores old EA-price overrides in a restored remainder ledger without losing receipts', () => {
  const result = run({ targets: [target()], outcome: outcome(), budget: 600,
    ledger: { receipts: [{ definitionId: 2, price: 200 }], quotes: { 4: 90000 } } });
  expect(result.plans[0].items[0].eaId).toBe(4);
  expect(result.plans[0].totalPrice).toBe(250);
  expect(result.spent).toBe(200);
});
it('retains cumulative receipts across rounds, deduplicates a repeated result and stops at the target', () => {
  const first = run({ targets: [target()], outcome: outcome(), budget: 800 });
  const second = run({ targets: first.targets, ledger: first.ledger, budget: 800, outcome: { ...outcome(), spent: 250,
    results: [{ definitionId: 4, state: 'club', price: 250 }, { definitionId: 5, state: 'waiting' }],
    failures: [{ definitionId: 5, reason: 'FC27_GALLERY_NO_LISTING' }] } });
  expect(second).toMatchObject({ status: 'achieved', spent: 450, remainingBudget: 350, plans: [] });
  expect(run({ targets: first.targets, ledger: first.ledger, outcome: outcome(), budget: 800 }).spent).toBe(200);
});
it('shares a confirmed acquired version between joint targets without double charging', () => {
  const result = run({ mode: 'joint', targets: [target(), target('futgg:2')], outcome: outcome(), budget: 600 });
  expect(result).toMatchObject({ status: 'ready', spent: 200, remainingBudget: 400 });
  expect(result.plans[0].items.map(item => item.eaId)).toEqual([4]);
  expect(result.plans[0].items[0].targetIds).toHaveLength(2);
});
it('rejects foreign versions, mismatching cost, unknown failures and invalid ledgers', () => {
  for (const patch of [{ spent: 999 }, { reason: 'FC27_GALLERY_CONTEXT_CHANGED' },
    { results: [{ definitionId: 99, state: 'club', price: 200 }] }]) {
    expect(run({ targets: [target()], outcome: { ...outcome(), ...patch } }).status).toBe('blocked');
  }
  expect(run({ targets: [target()], outcome: outcome(), ledger: { receipts: [{ definitionId: 2, price: 900 }] } }).status).toBe('blocked');
});
