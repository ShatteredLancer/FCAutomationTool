import { puzzleFillFixture } from './fc27-puzzle-fill-fixture.js';
import { marketRow } from './fc27-market-fixture.js';

// Screenshot's native rule shape; identities, formation, cards and prices are synthetic.
export function nationalMinimumFixture() {
  const input = puzzleFillFixture(), template = input.inventory.items[0];
  input.challenge.rawRequirements = [marketRow(4, 5), marketRow(5, 3, -1, 1), marketRow(8, 4),
    marketRow(17, 2, 5), marketRow(3, 1), marketRow(35, 16)];
  input.policy.maxRating = 82; input.policy.goldRange = [75, 90];
  const card = (definitionId, rating, nationId, leagueId, teamId = leagueId) => ({ definitionId, rating,
    nationId, leagueId, teamId, positions: [5], rarity: 0, groups: [], special: false, evolution: false, cosmetic: false, marketable: true });
  input.inventory.items = Array.from({ length: 10 }, (_, i) => ({ ...template, ...card(100+i, i<2 ? 70 : 78,
    i<2 ? 17+i : i<5 ? 11 : 10+i, i<2 ? 6+i : 4+i%2), id: i+1 }));
  input.marketPolicy = { budget: 6000, maxPurchases: 11, maxUnitPrice: 400, minimumRetainedCoins: 1000, availableCoins: 10000 };
  const bronze = Array.from({ length: 20 }, (_, i) => card(1000+i, 60, 159, 99));
  const silver = [card(2000, 70, 1, 1), card(2001, 70, 1, 2), ...Array.from({ length: 6 }, (_, i) => card(2100+i, 70, 159, 99)),
    ...Array.from({ length: 12 }, (_, i) => card(2200+i, 70, 30+i, 10+i))];
  const target = Array.from({ length: 6 }, (_, i) => card(3000+i, 70, 1, 1+i%3));
  const pages = [{ start: 0, count: 20, level: 'bronze' }, { start: 0, count: 20, level: 'silver' }];
  return { input, template, bronze, silver, target, pages };
}
