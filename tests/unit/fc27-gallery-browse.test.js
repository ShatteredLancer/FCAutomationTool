import { expect, it } from 'vitest';
import { browseGallerySets, orderGalleryCategories } from '../../src/gallery/browse.js';
const catalog = { categories: [
  { id: 'league', name: 'Premier League', sets: [{ id: 'futgg:30', name: 'Arsenal', requiredCards: 20 },
    { id: 'futgg:31', name: 'Chelsea', requiredCards: 10 }] },
  { id: 'club', name: 'Clubs', sets: [{ id: 'futgg:32', name: 'Real Madrid', requiredCards: 20 }] },
] };
const ids = options => browseGallerySets(catalog, options).map(row => row.set.id);

it('matches the Enhancer home screenshot without changing source order or the sets inside each category', () => {
  const slugs = ['rarities', 'premier-league', 'laliga', 'bundesliga', 'ligue-1', 'serie-a', 'leagues',
    'roshn-saudi-league', 'mls', 'national-women-s-soccer-league'];
  const rows = slugs.map((slug, i) => Object.freeze({ id: `futgg:${i + 1}`, slug,
    sets: Object.freeze([{ id: 'second' }, { id: 'first' }]) }));
  Object.freeze(rows);
  const ordered = orderGalleryCategories(rows);
  expect(ordered.map(row => row.slug)).toEqual([...slugs.slice(1, 7), slugs[0], ...slugs.slice(7)]);
  expect(rows.map(row => row.slug)).toEqual(slugs);
  expect(ordered.every(row => rows.includes(row))).toBe(true);
  expect(ordered[0].sets.map(set => set.id)).toEqual(['second', 'first']);
});

it('uses category slugs across sources and keeps new categories in their original relative order', () => {
  const rows = [{ id: 'a', slug: 'future-z' }, { id: 'fodder:rarities', slug: 'rarities' },
    { id: 'b', slug: 'future-a' }, { id: 'fodder:leagues', slug: 'leagues' }];
  expect(orderGalleryCategories(rows).map(row => row.id)).toEqual(['fodder:leagues', 'fodder:rarities', 'a', 'b']);
  expect(orderGalleryCategories([])).toEqual([]);
});

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
