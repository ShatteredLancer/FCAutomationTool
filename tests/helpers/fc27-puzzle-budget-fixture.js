import { marketFixture, marketRow } from './fc27-market-fixture.js';

// Deliberately rejecting evaluator: controlled search workload, not a claim
// about native rating feasibility or a replay of any real account.
export function puzzleBudgetFixture() {
  const input = marketFixture();
  input.inventory.items = [];
  input.challenge.slotCount = 9;
  input.challenge.rawRequirements = [marketRow(19, 70)];
  input.evaluateSquad = () => ({ status: 'observed', teamRating: 69, chemistry: 0 });
  const entries = Array.from({ length: 20 }, (_, index) => ({ ...input.catalog.entries[0],
    definitionId: 1000 + index, rating: 80 }));
  input.policy.maxRating = 83;
  return { input, entries };
}
