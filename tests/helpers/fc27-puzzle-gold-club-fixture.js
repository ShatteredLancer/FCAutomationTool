import { puzzleFillFixture } from './fc27-puzzle-fill-fixture.js';
import { marketRow } from './fc27-market-fixture.js';

// Set76/116 screenshot-shaped control. All player identities, inventory,
// formation and prices are synthetic; the diagnostic exports counts only.
export function goldClubFixture() {
  const input = puzzleFillFixture();
  input.policy.maxRating = 82;
  input.challenge.setId = 76; input.challenge.id = 116;
  input.challenge.brickIndices = [8,9,10];
  input.challenge.formation.positions = [5,7,9,11,12,13,14,15,16,17,18];
  input.challenge.rawRequirements = [marketRow(5,4,-1,1), marketRow(6,3), marketRow(9,4,-1,1),
    marketRow(17,3,7), marketRow(19,70), marketRow(35,22)];
  const base = input.inventory.items[0];
  input.inventory.items = Array.from({ length: 27 }, (_, index) => ({ ...base,
    id: index + 1, definitionId: 1001 + index, rating: index < 3 ? 78 : 70,
    teamId: index < 3 ? 240 : 70, leagueId: index < 3 ? 1 : 2,
    nationId: 1, positions: [input.challenge.formation.positions[index < 3 ? index : 3 + (index % 5)]] }));
  const card = (definitionId, position, teamId, leagueId, rating = 78) => ({ definitionId,
    rating, teamId, leagueId, nationId: 1, positions: [position], rarity: 0, groups: [],
    special: false, evolution: false, cosmetic: false });
  const pages = [
    { query: { start: 0, count: 20, level: 'gold', team: 240 },
      entries: Array.from({ length: 18 }, (_, index) => card(2001 + index, input.challenge.formation.positions[index % 8],240,1)) },
    { query: { start: 0, count: 20, level: 'gold', team: 70 },
      entries: Array.from({ length: 8 }, (_, index) => card(3001 + index, input.challenge.formation.positions[index],70,2)) },
  ];
  const known = [...input.inventory.items.slice(0,3), pages[0].entries[3],
    ...pages[1].entries.slice(4,7), input.inventory.items.find(item => item.positions[0] === 15)];
  return { input, pages, known };
}
