import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { streamlinedExecutionMessage, streamlinedRouteSummary, streamlinedMarketMessage,
  streamlinedInventoryPreview, streamlinedExecutionProgress, streamlinedExecutionClock } from '../../src/adapters/browser/fc27-streamlined-panel.js';

it('keeps the Points Solver interface copy in English for international users', () => {
  const source = readFileSync(new URL('../../src/adapters/browser/fc27-streamlined-panel.js', import.meta.url), 'utf8');
  expect(source).not.toMatch(/[\u3400-\u9fff]/);
  expect(source).toContain('FCAT Points Solver');
  expect(source).toContain("toLocaleString('en-US')");
  expect(streamlinedExecutionMessage('FC27_STREAMLINED_NO_AFFORDABLE_CARDS'))
    .toBe('Paused: no executable purchase candidate for the current plan. Confirmed purchases have been retained.');
});

it('explains which protection input failed instead of only showing the aggregate error code', () => {
  const reason = 'FC27_STREAMLINED_PROTECTION_UNVERIFIED';
  expect(streamlinedExecutionMessage(reason, null, { phase: 'protection-lock-list' })).toContain('FSU lock list');
  expect(streamlinedExecutionMessage(reason, null, { phase: 'protection-slot-list', count: 11, requiredSlots: 23 })).toContain('11 / 23');
  expect(streamlinedExecutionMessage(reason, null, { phase: 'protection-cache', cached: false })).toContain('active squad cache');
  expect(streamlinedExecutionMessage(reason, null, { phase: 'secret-payload', itemId: 123456 })).not.toContain('secret-payload');
});

it('explains an unverified native activation state without treating a zero identifier alone as proof', () => {
  expect(streamlinedExecutionMessage('FC27_STREAMLINED_PROTECTION_UNVERIFIED', null,
    { phase: 'protection-active-state', mismatch: 'inactive' })).toContain('active squad status could not be verified');
});

it('shows verified purchase/contribution counters and the current search without inventing success', () => {
  const text = streamlinedExecutionProgress({ phase: 'search', batchNumber: 2, purchased: 3, purchaseTarget: 40,
    spent: 3300, budget: 44000, contributed: 1, submittedScore: 830, targetScore: 34000,
    playerName: 'Fixture player', rating: 84, maxBuy: 1100, attempt: 1, attemptLimit: 3 });
  expect(text).toContain('Searching within the price cap');
  expect(text).toContain('Fixture player · 84 OVR · Cap 1,100 coins · Attempt 1 / 3');
  expect(text).toContain('Purchased 3 / 40 cards');
  expect(text).toContain('Confirmed 830 / 34,000 points');
  expect(text).not.toContain('Target reached');
  expect(streamlinedExecutionProgress({ phase: 'preflight' })).toContain('Unknown');
  expect(streamlinedExecutionProgress({ phase: 'checking-state' })).toContain('Checking inventory and capacity');
  expect(streamlinedExecutionProgress({ phase: 'materialize', stage: 'club-readback', completed: 1, materialTotal: 2 }))
    .toContain('Verifying Club delivery');
});

it('counts elapsed/waiting time without claiming that a timer confirms a transaction', () => {
  expect(streamlinedExecutionClock({ phase: 'partial-ready', waitMs: 12000 }, 22000, 2300))
    .toBe('Elapsed 22 s · Current step 2 s · Estimated batch wait remaining 10 s');
  expect(streamlinedExecutionClock({ phase: 'partial-ready', waitMs: 12000 }, 60000, 20000))
    .toContain('remaining 0 s');
  expect(streamlinedExecutionClock({ phase: 'search' }, 5000, 3000, false)).toBe('Elapsed 5 s');
  expect(streamlinedExecutionClock({}, NaN, -3000)).toContain('0 s');
  expect(streamlinedExecutionClock({ phase: 'waiting-supply', waitMs: 15000 }, 30000, 4000)).toContain('Supply retry wait remaining 11 s');
  expect(streamlinedExecutionProgress({ phase: 'waiting-supply', attempt: 1, attemptLimit: 2 })).toContain('Supply retry 1 / 2');
});

it('lists each physical stock copy, binds market previews to the frozen route and preserves the plan', () => {
  const stock = { source: 'inventory', id: 11, definitionId: 101, name: 'Owned fixture', pile: 'club', points: 830 };
  const second = { ...stock, id: 12, pile: 'storage' }, market = { source: 'market', definitionId: 101, id: null };
  const plan = { items: [stock, second, market], batches: [[stock], [second, market]], route: { groups: [{ source: 'market' }] } };
  const before = structuredClone(plan);
  expect(streamlinedInventoryPreview(plan, [])).toEqual([{ ...stock, consumed: false }, { ...second, consumed: false }]);
  expect(streamlinedInventoryPreview(plan, [], { consumedIds: [11] }).map(item => item.consumed)).toEqual([true, false]);
  expect(plan).toEqual(before);
});

it('updates inventory-only previews with selected batches and shows confirmed consumption separately', () => {
  const first = { source: 'inventory', id: 1, definitionId: 101 }, second = { ...first, id: 2, definitionId: 102 };
  const plan = { items: [first, second], batches: [[first], [second]] };
  expect(streamlinedInventoryPreview(plan, [1])).toEqual([{ ...second, consumed: false }]);
  expect(streamlinedInventoryPreview(plan, [])).toEqual([]);
  expect(streamlinedInventoryPreview(plan, [1], { batches: [{ state: 'confirmed' }, { state: 'waiting' }] }))
    .toEqual([{ ...first, consumed: true }, { ...second, consumed: false }]);
});

it('distinguishes FUTBIN quote expiration from a FUT.GG candidate catalog connection failure', () => {
  const message = streamlinedMarketMessage({ quoteSource: 'futbin', marketError: 'FC27_STREAMLINED_QUOTES_EXPIRED' });
  expect(message).toContain('FUTBIN');
  expect(message).toContain('expired');
  expect(message).toContain('Generate a new plan');
  expect(message).not.toContain('FUT.GG');
  expect(streamlinedMarketMessage({ quoteSource: 'futbin', marketError: 'FC27_BUY_REFERENCE_TIMEOUT' })).toContain('FUTBIN');
  expect(streamlinedMarketMessage({ quoteSource: 'futbin', marketError: 'FC27_STREAMLINED_CATALOG_HTTP_403' })).toContain('FUT.GG catalog connection');
});

it('explains old material moves and read-only recovery without requiring the old SBC page', () => {
  const text = streamlinedExecutionMessage('FC27_STREAMLINED_MATERIALIZE_RECOVERY_REQUIRED', {
    kind: 'streamlined-materialization', setId: 99, challengeId: 199, pendingCount: 2 });
  expect(text).toContain('Set 99 / Challenge 199');
  expect(text).toContain('2 cards');
  expect(text).toContain('Check & recover');
  expect(text).toContain('does not repeat moves, purchases or contributions');
});

it('summarizes a route without expanding its per-card groups', () => {
  const text = streamlinedRouteSummary({
    purchaseCost: 1500, materialValue: 800, score: 100, count: 10, inventoryCount: 4, marketCount: 6, minBatches: 1,
    groups: [
      { source: 'inventory', quantity: 4, items: [{ points: 10, rating: 82, name: 'Owned' }] },
      { source: 'market', quantity: 6, items: [{ points: 15, rating: 83, price: 250, purchaseMaxBuy: 300 }] },
    ],
  });
  expect(text).toContain('1,500');
  expect(text).toContain('Total value 2,300');
  expect(text).toContain('Cap 1,800');
  expect(text).toContain('100 points');
  expect(text).toContain('10 cards');
  expect(text).toContain('Inventory 4 / To buy 6');
  expect(text).not.toContain('Owned');
  expect(text).not.toContain('82');
  expect(text).not.toContain('83');
});

it('reports no purchase cap for an inventory-only route', () => {
  expect(streamlinedRouteSummary({
    purchaseCost: 0, score: 40, count: 2, inventoryCount: 2, marketCount: 0, minBatches: 1,
    groups: [{ source: 'inventory', quantity: 2, items: [{ points: 20, rating: 75 }] }],
  })).toContain('Cap 0');
});

it('shows unknown inventory value explicitly instead of calling the purchase estimate total value', () => {
  const text = streamlinedRouteSummary({ purchaseCost: 200, materialValue: null, score: 100, count: 2,
    inventoryCount: 1, marketCount: 1, minBatches: 1, groups: [] });
  expect(text).toContain('Total value Unknown');
  expect(text).toContain('To buy 200');
});

it('distinguishes unresolved purchases from missing contribution capability', () => {
  const message = streamlinedExecutionMessage('FC27_BUY_RECOVERY_REQUIRED', {
    kind: 'puzzle-purchase', setId: 19, challengeId: 43, phase: 'save-pending' });
  expect(message).toContain('Set 19 / Challenge 43');
  expect(message).toContain('Squad replacement has not been reconciled');
  expect(message).toContain('that SBC');
  expect(message).not.toContain('interface');
  expect(streamlinedExecutionMessage('FC27_STREAMLINED_WRITE_CONTRACT_UNVERIFIED')).toContain('not enabled in this build');
  expect(streamlinedExecutionMessage('FC27_STREAMLINED_RECONCILIATION_REQUIRED')).toContain('do not submit it again');
  expect(streamlinedExecutionMessage(null)).not.toContain('interface');
});

it('shows bounded purchase-state counts without claiming local counts prove settlement', () => {
  const message = streamlinedExecutionMessage('FC27_BUY_RECOVERY_REQUIRED', {
    kind: 'puzzle-purchase', setId: 21, challengeId: 48, phase: 'ready',
    states: { waiting: 2, club: 3, 'buy-pending': 1 }, applied: 2 });
  expect(message).toContain('Not purchased 2');
  expect(message).toContain('Purchase unconfirmed 1');
  expect(message).toContain('In Club 3');
  expect(message).toContain('Confirmed replacements 2');
  expect(message).toContain('Open that SBC');
});
