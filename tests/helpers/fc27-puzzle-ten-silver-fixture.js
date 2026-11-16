import { puzzleFillFixture } from './fc27-puzzle-fill-fixture.js';
import { marketRow } from './fc27-market-fixture.js';

// Incident-shaped synthetic entities; no captured account data or market prices.
export function tenSilverFixture() {
  const input = puzzleFillFixture(), base = input.inventory.items[0];
  input.challenge.rawRequirements = [marketRow(6, 3), marketRow(9, 5, -1, 1), marketRow(17, 2, 10), marketRow(3, 1), marketRow(35, 16)];
  input.policy.maxRating = 82; input.policy.goldRange = [75, 90];
  input.inventory.items = Array.from({ length: 28 }, (_, i) => ({ ...base, id: 100+i, definitionId: 5000+i, rating: 78, teamId: 200+Math.floor(i/4) }));
  input.marketPolicy = { budget: 10000, maxPurchases: 11, maxUnitPrice: 2000, minimumRetainedCoins: 1000, availableCoins: 20000 };
  const card = (definitionId, rating, teamId) => ({ definitionId, rating, teamId, leagueId: 1, nationId: 1, positions: [5], rarity: 0, groups: [], special: false, evolution: false, cosmetic: false, marketable: true });
  const silver = Array.from({ length: 20 }, (_, i) => card(1000+i, 65, i===0 ? 2 : 2+i));
  const target = [silver[0], ...Array.from({ length: 5 }, (_, i) => card(1100+i, 65, 2))];
  const second = [silver[1], ...Array.from({ length: 4 }, (_, i) => card(1200+i, 65, 3))];
  const bronze = Array.from({ length: 20 }, (_, i) => card(2000+i, 47, 100+i));
  const known = [...target.slice(0,6), ...second.slice(0,4), { ...base, ...bronze[0] }];
  return { input, base, silver, target, second, bronze, known };
}
