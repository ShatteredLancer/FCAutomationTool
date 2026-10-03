import { expect, it } from 'vitest';
import { galleryCostBundles, galleryBonusBundles } from '../../src/gallery/cost-bundles.js';

it('enumerates all small priced combinations once, by total cost, matching an exhaustive oracle', () => {
  for (let size = 1; size <= 4; size++) {
    const rows = [200, 100, 100, 450, 300, 100].map((price, i) => ({ id: i + 1, price }));
    const cost = ids => ids.reduce((sum, id) => sum + rows[id - 1].price, 0);
    const oracle = [];
    for (let mask = 0; mask < 64; mask++) {
      const ids = rows.filter((_, i) => mask & (1 << i)).map(row => row.id);
      if (ids.length === size) oracle.push(cost(ids));
    }
    const bundles = [...galleryCostBundles(rows, size, 100)];
    expect(bundles.map(cost)).toEqual(oracle.sort((a, b) => a - b));
    expect(new Set(bundles.map(ids => ids.slice().sort().join(','))).size).toBe(bundles.length);
    expect([...galleryCostBundles(rows, size, 3)]).toEqual(bundles.slice(0, 3));
  }
});

it('never treats unknown prices as free and does not mutate candidates', () => {
  const rows = [{ id: 1, price: null }, { id: 2, price: 200 }, { id: 3, price: 300 }], before = structuredClone(rows);
  expect([...galleryCostBundles(rows, 2, 100)]).toEqual([[2, 3]]);
  expect([...galleryCostBundles(rows, 3, 100)]).toEqual([]);
  expect(rows).toEqual(before);
});

it('seeds ten coordinated cheap replacements without requiring ten search depths', () => {
  const rows = Array.from({ length: 24 }, (_, i) => ({ id: i + 1, price: i < 12 ? 100 : 150,
    diversityKeys: i < 12 ? [] : ['silver'] }));
  const bundles = [...galleryBonusBundles(rows, 12, 30)];
  expect(bundles.some(ids => ids.filter(id => id > 12).length === 10)).toBe(true);
  expect(bundles.every(ids => ids.length === 12 && new Set(ids).size === 12)).toBe(true);
  expect([...galleryBonusBundles(rows, 12, 2)]).toHaveLength(2);
});
