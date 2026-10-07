import fixture from '../fixtures/streamlined-83-upgrade.json';
import { normalizeStreamlinedChallenge, normalizeStreamlinedItem } from '../../src/streamlined/contract.js';
import { createStreamlinedEligibility } from '../../src/streamlined/eligibility.js';
import { planStreamlined } from '../../src/streamlined/planner.js';
import { createStreamlinedPlan } from '../../src/streamlined/plan.js';

// Synthetic safety/price fields; these are not evidence of EA write contracts.
export const safeItem = overrides => normalizeStreamlinedItem({ id: 1, definitionId: 2, points: 20,
  scoreVerified: true, rating: 55, price: 200, pile: 'club', tradeable: false, special: false,
  concept: false, evolution: false, cosmetic: false, academyEnrolled: false, activeTrade: false,
  limitedUse: false, locked: false, activeSquad: false, protected: false, loans: -1, leagueId: 13, ...overrides });
export const challenge = overrides => normalizeStreamlinedChallenge({ ...fixture.challenge, context: fixture.context, ...overrides });
export const policy = { maxRating: 90, goldRange: [75, 99], excludedLeagueIds: [], onlyUntradeable: true,
  protectFsuLockedPlayers: false, protectActiveSquad: false, storageFirst: false };
export const eligibility = createStreamlinedEligibility({ rules: [] });
export const items = fixture.items.map(safeItem);
export function testPlan(overrides = {}) {
  const target = challenge({ scoreRequirement: 40, selectionLimit: 1 });
  const input = { challenge: target, policy, eligibility,
    inventory: [safeItem(), safeItem({ id: 3, definitionId: 4 })], ...overrides };
  return createStreamlinedPlan({ context: input.challenge.context, challenge: input.challenge, policy: input.policy,
    result: planStreamlined(input) });
}
