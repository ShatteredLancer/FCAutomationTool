import { puzzleFillFixture } from './fc27-puzzle-fill-fixture.js';
import { marketRow } from './fc27-market-fixture.js';

// Screenshot requirements only; player/club identities, formation and prices
// are synthetic. Neither this fixture nor its solution is a live-market replay.
export function minimumQualityFixture(tier = 1) {
  const input = puzzleFillFixture(), template = input.inventory.items[0];
  input.inventory.items = []; input.policy.maxRating = 85;
  input.challenge.setId = 78; input.challenge.id = tier === 1 ? 118 : 120;
  const need = tier === 1 ? 1 : 2, nation = tier === 1 ? 45 : 27;
  const club = marketRow(12, 1001, need); club.pairs[0].values = [1001, 1002];
  input.challenge.rawRequirements = [club, marketRow(10, nation, need),
    ...(tier === 1 ? [marketRow(9, 2), marketRow(8, 3)] : [marketRow(5, 5, -1, 1), marketRow(4, 3)]),
    marketRow(3, tier), marketRow(35, tier === 1 ? 14 : 22)];
  const entries = Array.from({ length: 11 }, (_, i) => ({ definitionId: 5000 + i,
    rating: i < need ? 80 : tier === 1 ? 60 : 70, nationId: nation,
    teamId: i < need ? 1001 : 2000 + i, leagueId: 1 + Math.floor(i / 4), positions: [5], rarity: 0,
    groups: [], special: false, evolution: false, cosmetic: false }));
  const owned = () => entries.map((entry, index) => ({ ...template, ...entry, id: index + 1, state: 'free' }));
  return { input, entries, owned, need, nation, tier };
}
