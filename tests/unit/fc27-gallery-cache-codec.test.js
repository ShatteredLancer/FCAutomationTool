import { expect, it, vi, afterEach } from 'vitest';
import { encodeGalleryCollectionCache, decodeGalleryCollectionCache } from '../../src/adapters/browser/fc27-gallery-cache-codec.js';

afterEach(() => vi.unstubAllGlobals());

it('preserves small and legacy collection cache records', async () => {
  const value = { schema: 3, concepts: [{ definitionId: 1, isCollected: true, gradingScore: 50 }] };
  expect(await encodeGalleryCollectionCache(value)).toBe(value);
  expect(await decodeGalleryCollectionCache(value)).toBe(value);
});

it('losslessly compacts a large collection including native card data, owners and coverage', async () => {
  const value = { schema: 3, context: { season: '27' }, firstOwnerHistory: [{ definitionId: 2 }],
    concepts: Array.from({ length: 1500 }, (_, index) => ({ definitionId: index + 1,
      isCollected: index % 2 === 0, gradingScore: index, collectedOwners: 1, readAt: 1000,
      cardData: { dream: true, hyperCosmetics: { 1: 3 }, statsList: Array(30).fill(100),
        lifetimeStats: Array(30).fill(0), attributeArray: [80, 70, 65, 75, 70, 80] } })),
    coveredDefinitionIds: [1, 2], fullSyncAt: 1000, setSyncedAt: { 1: 1000 } };
  const packed = await encodeGalleryCollectionCache(value);
  expect(packed).toMatchObject({ schema: 4, format: 'fcat-gallery-gzip-v1' });
  expect(JSON.stringify(packed).length).toBeLessThan(JSON.stringify(value).length / 5);
  expect(await decodeGalleryCollectionCache(packed)).toEqual(value);
});

it('rejects damaged packed data instead of claiming valid collection evidence', async () => {
  await expect(decodeGalleryCollectionCache({ schema: 4, format: 'unknown', data: '' })).rejects.toThrow('FC27_GALLERY_CACHE_INVALID');
  await expect(decodeGalleryCollectionCache({ schema: 4, format: 'fcat-gallery-gzip-v1', data: btoa('not gzip') })).rejects.toThrow();
});

it('leaves data intact when compression is unavailable', async () => {
  vi.stubGlobal('CompressionStream', undefined);
  const value = { schema: 3, concepts: Array(10000).fill({ definitionId: 1, collectedOwners: 1 }) };
  expect(await encodeGalleryCollectionCache(value)).toBe(value);
});
