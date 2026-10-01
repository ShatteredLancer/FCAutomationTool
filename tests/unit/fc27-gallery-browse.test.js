import { expect, it } from 'vitest';
import { browseGallerySets } from '../../src/gallery/browse.js';
const catalog = { categories: [
  { id: 'league', name: 'Premier League', sets: [{ id: 'futgg:30', name: 'Arsenal', requiredCards: 20 },
    { id: 'futgg:31', name: 'Chelsea', requiredCards: 10 }] },
  { id: 'club', name: 'Clubs', sets: [{ id: 'futgg:32', name: 'Real Madrid', requiredCards: 20 }] },
] };
const ids = options => browseGallerySets(catalog, options).map(row => row.set.id);

it('filters by category, unicode-insensitive search and followed ids without mutation', () => {
  const copy = structuredClone(catalog);
  expect(ids({ query: 'ＡＲＳＥＮＡＬ' })).toEqual(['futgg:30']);
  expect(ids({ query: 'premier' })).toEqual(['futgg:30', 'futgg:31']);
  expect(ids({ categoryId: 'club', query: 'madrid' })).toEqual(['futgg:32']);
  expect(ids({ followedOnly: true, targets: [{ setId: 'futgg:31' }] })).toEqual(['futgg:31']);
  expect(ids({ query: 'nothing' })).toEqual([]);
  expect(catalog).toEqual(copy);
});

it('sorts by name/card count and leaves unknown progress last, distinct from zero', () => {
  expect(ids({ order: 'cards' })).toEqual(['futgg:31', 'futgg:30', 'futgg:32']);
  expect(ids({ order: 'name' })).toEqual(['futgg:30', 'futgg:31', 'futgg:32']);
  expect(ids({ order: 'progress', summaries: new Map([['futgg:31', { collected: 0 }], ['futgg:32', { collected: 10 }]]) }))
    .toEqual(['futgg:32', 'futgg:31', 'futgg:30']);
  expect(ids({ order: 'catalog' })).toEqual(['futgg:30', 'futgg:31', 'futgg:32']);
});
