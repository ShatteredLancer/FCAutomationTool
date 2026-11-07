import { nationalityCapFixture } from './fc27-puzzle-nationality-cap-fixture.js';

// Same pool size/quality counts and requirement shape as the report, but
// synthetic entities/positions, with an independently validated witness.
export function puzzleGroupCapacityFixture() {
  const { input, base, known, card } = nationalityCapFixture();
  const decoys = Array.from({ length: 280 }, (_, i) => ({
    ...card(10001 + i, i % 11, i < 18 ? 240 : 300 + Math.floor(i / 5),
      i < 140 ? 63 : 1003, 1 + Math.floor(i / 5) % 7),
    rating: i < 6 ? 60 : i < 47 ? 70 : 75,
  }));
  input.inventory.items = [...decoys, ...known].map((item, i) => ({ ...base, ...item, id: 1000 + i }));
  return { input, known: known.map((item, slot) => ({ ...base, ...item, slot })) };
}
