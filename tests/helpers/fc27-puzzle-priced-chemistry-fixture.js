import { puzzleFillFixture } from './fc27-puzzle-fill-fixture.js';
import { marketRow } from './fc27-market-fixture.js';

// Screenshot-shaped seven-player challenge, synthetic cards/prices only.
// Dense nation 1 has expensive scarce positions; a complete cheap nation 2
// squad exists in the same safe pool, behind the connectivity-first starts.
export function pricedChemistryFixture() {
  const input = puzzleFillFixture(), entries = [], prices = new Map();
  input.inventory.items = []; input.policy.maxRating = 82;
  input.challenge.brickIndices = [0, 1, 2, 3];
  input.challenge.formation = { id: 1, positions: [25,25,27,23,14,14,7,5,5,3,0] };
  input.challenge.rawRequirements = [marketRow(4,4), marketRow(5,5,-1,1), marketRow(8,2),
    marketRow(17,3,4), marketRow(3,2), marketRow(35,20)];
  const positions = [14,14,7,5,5,3,0];
  const add = (id, nation, team, league, position, rating, price) => {
    entries.push({ definitionId: id, nationId: nation, teamId: team, leagueId: league, positions: [position],
      rating, rarity: 0, groups: [], special: false, evolution: false, cosmetic: false });
    prices.set(id, price);
  };
  positions.forEach((position,i) => add(9000+i,1,i<5?1:2,i<5?1:2,position,i<3?65:75,
    [700,700,1600,1000,5500,1100,3400][i]));
  for (let i=0;i<25;i++) add(9100+i,1,i<20?1:2,i<20?1:2,14,i%2?65:75,300+i*50);
  positions.forEach((position,i) => add(10000+i,2,i<5?3:4,i<5?3:4,position,i<3?65:75,300));
  for (let i=0;i<18;i++) add(10100+i,3,5,5,14,i%2?65:75,900);
  return { input, entries, prices };
}
