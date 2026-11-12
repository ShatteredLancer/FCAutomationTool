import { nationalMinimumFixture } from './fc27-puzzle-national-minimum-fixture.js';

// Synthetic cost-discovery control, not a captured account inventory.
export function nationalCostFixture() {
  const { input, template } = nationalMinimumFixture();
  input.policy.maxRating = 85;
  input.inventory.items = Array.from({ length: 18 }, (_, i) => ({ ...template, id: 100+i, definitionId: 5000+i,
    rating: i===0 ? 85 : 81, nationId: i<2 ? 18 : 40+i, leagueId: i<2 ? 1+i : 20+i, teamId: 20+i }));
  input.marketPolicy = { ...input.marketPolicy, maxUnitPrice: 3000, budget: 20000, availableCoins: 40000 };
  const card = (definitionId, rating, nationId, leagueId) => ({ definitionId, rating, nationId, leagueId, teamId: definitionId,
    positions: [5], rarity: 0, groups: [], special: false, evolution: false, cosmetic: false, marketable: true });
  const bronze = Array.from({ length: 20 }, (_, i) => card(6000+i, 47, 159, 9));
  const silver = Array.from({ length: 20 }, (_, i) => card(7000+i, 65, i<3 ? 18 : 60+i, i<3 ? 3+i : i<8 ? 6+i%2 : 40+i));
  const cheap = [card(8000, 55, 18, 1), card(8001, 55, 18, 2)];
  const prices = definitionId => definitionId===5000 ? 2800 : definitionId===5001 ? 2100
    : definitionId<6000 ? 2000 : definitionId<7000 || definitionId>=8000 ? 200 : 550;
  return { input, template, bronze, silver, cheap, prices, market: [...bronze, ...silver, ...cheap] };
}
