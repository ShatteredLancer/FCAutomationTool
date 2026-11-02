import { expect, it } from 'vitest';
import { comparePuzzlePlans, sortPuzzlePlans } from '../../src/fc27/puzzle-plan-ranking.js';

const plan = values => ({
  estimatedCost: values.cost, materialValue: values.material, purchaseCount: values.purchases,
  selectedOwned: values.owned ?? [], purchases: values.cards ?? [], inventoryValue: values.inventory ?? 0,
});

it('keeps the cheapest cash incumbent when a later bounded route is more expensive', () => {
  expect(comparePuzzlePlans(plan({ cost: 1300, purchases: 3 }), plan({ cost: 3350, purchases: 5 }), 'additional-coins'))
    .toBeLessThan(0);
});

it('uses total material value first, then cash spend as a tie-break', () => {
  const inventoryHeavy = plan({ cost: 500, material: 11000, purchases: 1 });
  const cheaperCash = plan({ cost: 700, material: 11000, purchases: 2 });
  expect(comparePuzzlePlans(cheaperCash, inventoryHeavy, 'material-value')).toBeGreaterThan(0);
});

it('preserves higher-tier owned material for cash-first ties but prefers lower quality for material-value ties', () => {
  const gold = plan({ cost: 1000, material: 1000, purchases: 2, cards: [{ rating: 84 }, { rating: 84 }] });
  const silver = plan({ cost: 1000, material: 1000, purchases: 2, cards: [{ rating: 74 }, { rating: 74 }] });
  expect(sortPuzzlePlans([gold, silver], 'additional-coins')[0]).toBe(gold);
  expect(sortPuzzlePlans([gold, silver], 'material-value')[0]).toBe(silver);
});

it('selects different routes when spending less cash would consume more valuable owned cards', () => {
  const ownedGold = plan({ cost: 0, material: 10000, inventory: 10000, purchases: 0,
    owned: Array.from({ length: 11 }, () => ({ rating: 84 })) });
  const silverPlusGold = plan({ cost: 200, material: 3200, inventory: 3000, purchases: 1,
    owned: [{ rating: 74 }, ...Array.from({ length: 9 }, () => ({ rating: 84 }))],
    cards: [{ rating: 80 }] });
  expect(sortPuzzlePlans([ownedGold, silverPlusGold], 'additional-coins')[0]).toBe(ownedGold);
  expect(sortPuzzlePlans([ownedGold, silverPlusGold], 'material-value')[0]).toBe(silverPlusGold);
});
