import { expect, it } from 'vitest';
import { normalizeGalleryCatalog, diffGalleryCatalog, galleryCachePayload } from '../../src/gallery/catalog.js';
import { futggGallery, fodderGallery } from '../fixtures/fc27-gallery.js';

it('normalizes both observed shapes without inventing non-token rewards or account state', () => {
  const gg = normalizeGalleryCatalog('futgg', futggGallery());
  const ff = normalizeGalleryCatalog('fodder', fodderGallery());
  expect(gg.categories[0].sets[0].grades[0].rewards[0].label).toBe('Club Badge');
  expect(ff.categories[0].sets[0].grades[0]).toMatchObject({ rewards: [], rewardsComplete: false });
  expect(gg.tags[0].rules).toEqual([{ newOperator: true }]);
  expect(JSON.stringify(ff)).not.toMatch(/price|reach|collected|owned|progress/);
  expect(Object.isFrozen(gg.categories[0].sets[0])).toBe(true);
});

it.each(['futgg', 'fodder'])('roundtrips %s public-only cache without changing identity', source => {
  const input = source === 'futgg' ? futggGallery() : fodderGallery();
  const catalog = normalizeGalleryCatalog(source, input);
  expect(normalizeGalleryCatalog(source, galleryCachePayload(catalog))).toEqual(catalog);
});

it.each([
  data => { data.categories.push(data.categories[0]); },
  data => { data.categories[0].sets.push(data.categories[0].sets[0]); },
  data => { data.categories[0].sets[0].categoryId = 2; },
  data => { data.categories[0].sets[0].grades[1].name = 'D'; },
  data => { data.categories[0].sets[0].grades[2].threshold = 0; },
  data => { data.categories = []; },
  data => { data.schemaVersion = 2; },
  data => { data.game = 'fc26'; },
  data => { data.isTruncated = true; },
])('rejects ambiguous/incomplete/unknown catalogue definitions', mutate => {
  const input = futggGallery(); mutate(input.data);
  expect(() => normalizeGalleryCatalog('futgg', input)).toThrow('FC27_GALLERY_CATALOG_INVALID');
});

it('detects new Starter Set, removals, stable-ID rename, changed thresholds and rewards independently', () => {
  const input = futggGallery(); const previous = normalizeGalleryCatalog('futgg', input);
  const original = input.data.categories[0].sets[0];
  original.name = 'Renamed Club'; original.grades[4].threshold++;
  original.grades[1].rewards[0].value++;
  input.data.categories[0].sets.push({ ...structuredClone(original), id: 116, name: 'Starter Set', slug: 'starter-set' });
  const current = normalizeGalleryCatalog('futgg', input);
  expect(diffGalleryCatalog(previous, current)).toMatchObject({ added: ['futgg:116'], renamed: ['futgg:30'],
    requirements: ['futgg:30'], rewards: ['futgg:30'], removed: [] });
  expect(diffGalleryCatalog(current, previous).removed).toEqual(['futgg:116']);
});

it('does not invalidate definitions for delivery time, object order or Fodder reach/price updates', () => {
  const input = fodderGallery(); const before = normalizeGalleryCatalog('fodder', input);
  input.categories[0].sets[0].reach = { price: 99999 };
  expect(normalizeGalleryCatalog('fodder', input).revision).toBe(before.revision);
  const gg = futggGallery(); const first = normalizeGalleryCatalog('futgg', gg);
  gg.data.capturedAt = '2026-09-29T10:00:00Z';
  expect(normalizeGalleryCatalog('futgg', gg).revision).toBe(first.revision);
  expect(diffGalleryCatalog(before, first).comparable).toBe(false);
});
