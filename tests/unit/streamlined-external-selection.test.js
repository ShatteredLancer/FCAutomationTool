import { expect, it } from 'vitest';
import { readStreamlinedExternalRows, planStreamlinedExternalSelection } from '../../src/streamlined/external-selection.js';
import { assertStreamlinedPlan, createStreamlinedPlan } from '../../src/streamlined/plan.js';
import { challenge, safeItem, policy, eligibility } from '../helpers/streamlined.js';

const external = (id, extra = {}) => safeItem({ id, definitionId: 100, pile: 'transfer', ...extra });
const input = inventory => ({ inventory, policy, eligibility, challenge: challenge({ scoreRequirement: 100 }) });

it('retains exact selected external copies and adds one Club predecessor in separate batches', () => {
  const club = safeItem({ id: 1, definitionId: 100 });
  const data = input([club, external(2), external(3, { pile: 'unassigned' }), external(4, { definitionId: 200 })]);
  const rows = readStreamlinedExternalRows(data);
  expect(rows.rows).toHaveLength(3);
  expect(rows.rows[0]).toMatchObject({ selectable: true, prerequisite: club });
  const result = planStreamlinedExternalSelection(rows, ['item:2', 'item:3']);
  expect(result.items.map(i => i.id)).toEqual([1, 2, 3]);
  expect(result.batches.map(b => b.map(i => i.id))).toEqual([[1], [2], [3]]);
  expect(result).toMatchObject({ status: 'partial', purchaseCost: 0, score: 60, selectedCount: 2, prerequisiteCount: 1 });
  expect(assertStreamlinedPlan(createStreamlinedPlan({ context: data.challenge.context, challenge: data.challenge,
    policy, result, objective: 'inventory-first' })).items).toEqual(result.items);
});

it.each([
  [{ locked: true }, { ...policy, protectFsuLockedPlayers: true }, 'prerequisite-locked'],
  [{ activeSquad: true }, { ...policy, protectActiveSquad: true }, 'prerequisite-active-squad'],
  [{ tradeable: true }, policy, 'prerequisite-untradeable'],
  [{ rating: 95 }, policy, 'prerequisite-rating'],
])('explains blocked Club prerequisites without weakening the policy', (change, currentPolicy, reason) => {
  const data = { ...input([safeItem({ id: 1, definitionId: 100, ...change }), external(2)]), policy: currentPolicy };
  expect(readStreamlinedExternalRows(data).rows[0]).toMatchObject({ selectable: false, reason });
});

it('keeps active, sold/unknown and reserved external cards visible but unavailable', () => {
  const data = input([external(1, { activeTrade: true }), external(2, { activeTrade: null }), external(3)]);
  const read = readStreamlinedExternalRows({ ...data, reservedIds: [3] });
  expect(read.rows.map(r => [r.selectable, r.reason])).toEqual([[false, 'trade'], [false, 'trade'], [false, 'history-reserved']]);
  expect(planStreamlinedExternalSelection(read, ['item:3']).status).toBe('blocked');
});

it('blocks unresolved duplicate hints, conflicting Club copies and reserved predecessors', () => {
  expect(readStreamlinedExternalRows(input([external(2, { duplicateId: 1 })])).rows[0].reason).toBe('duplicate-unverified');
  expect(readStreamlinedExternalRows(input([safeItem({ id: 1, definitionId: 100 }),
    safeItem({ id: 4, definitionId: 100 }), external(2)])).rows[0].reason).toBe('duplicate-unverified');
  expect(readStreamlinedExternalRows({ ...input([safeItem({ id: 1, definitionId: 100 }), external(2)]), reservedIds: [1] })
    .rows[0].reason).toBe('prerequisite-history-reserved');
});

it('rejects missing, repeated and unknown selection keys', () => {
  const read = readStreamlinedExternalRows(input([external(2)]));
  for (const keys of [[], ['item:2', 'item:2'], ['item:999'], null]) {
    expect(planStreamlinedExternalSelection(read, keys)).toMatchObject({ status: 'blocked', reason: 'FC27_STREAMLINED_EXTERNAL_SELECTION_INVALID' });
  }
});

it('trims later batches once the target is covered without promising to empty external inventory', () => {
  const data = { ...input([safeItem({ id: 1, definitionId: 100, points: 100 }), external(2), external(3)]),
    challenge: challenge({ scoreRequirement: 100 }) };
  const result = planStreamlinedExternalSelection(readStreamlinedExternalRows(data), ['item:2', 'item:3']);
  expect(result.items.map(i => i.id)).toEqual([1]);
  expect(result).toMatchObject({ status: 'ready', omittedExternalCount: 2, selectedCount: 2, score: 100 });
});

it('freezes its own snapshot without freezing caller inventory, policy or challenge', () => {
  const data = { ...input([external(2)]), policy: { ...policy, excludedLeagueIds: [] } };
  const read = readStreamlinedExternalRows(data);
  expect(Object.isFrozen(read.rows[0].item)).toBe(true);
  expect(Object.isFrozen(data.policy)).toBe(false);
  data.policy.excludedLeagueIds.push(13); data.inventory.push(external(3));
  expect(read.policy.excludedLeagueIds).toEqual([]); expect(read.rows).toHaveLength(1);
});
