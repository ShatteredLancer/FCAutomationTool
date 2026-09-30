import { expect, it } from 'vitest';
import { normalizeGalleryPool } from '../../src/gallery/pool.js';
import { mergeGalleryAccountProgress } from '../../src/gallery/progress.js';
import { futggGalleryPool } from '../fixtures/fc27-gallery.js';

const pool = () => normalizeGalleryPool('futgg', futggGalleryPool(), 30);

it('keeps collected, Club, First Owner and unknown facts independent', () => {
  const value = mergeGalleryAccountProgress(pool(), {
    conceptItems: [
      { definitionId: 900001, isCollected: true, firstOwned: true, gradingScore: 91 },
      { definitionId: 900002, isCollected: false, firstOwned: false },
      { definitionId: 900003, gradingScore: 88 },
    ],
    clubItems: [{ definitionId: 900001, owners: 1 }, { definitionId: 900002, owners: 2 }], clubKnown: false,
  });
  expect(value.rows).toEqual(expect.arrayContaining([
    expect.objectContaining({ eaId: 900001, collected: true, inClub: true, firstOwned: true, gradingScore: 91,
      cardImageUrl: 'https://game-assets.fut.gg/fc27/player-1.webp' }),
    expect.objectContaining({ eaId: 900002, collected: false, inClub: true, firstOwned: false }),
    expect.objectContaining({ eaId: 900003, collected: null, inClub: null, firstOwned: null }),
  ]));
  expect(value.totals).toMatchObject({ total: 3, collected: 1, inClub: 2, firstOwned: 1, missing: 1, unknown: 1 });
});

it('uses exact eaId versions and never substitutes a base player id', () => {
  const value = mergeGalleryAccountProgress(pool(), {
    conceptItems: [],
    clubItems: [{ definitionId: 800001 }], clubKnown: true,
  });
  expect(value.rows[0]).toMatchObject({ collected: null, inClub: false });
  expect(() => mergeGalleryAccountProgress(pool(), {conceptItems:[{definitionId:800001}]})).toThrow('FC27_GALLERY_CONCEPT_ID_UNVERIFIED');
});

it('rejects duplicate concept identities', () => {
  expect(() => mergeGalleryAccountProgress(pool(), {
    conceptItems: [{ definitionId: 900001 }, { definitionId: 900001 }],
  })).toThrow('FC27_GALLERY_PROGRESS_DUPLICATE_CONCEPT');
});

it('never treats concept owners or a sold card as known First Owner ownership', () => {
  const result=mergeGalleryAccountProgress(pool(),{conceptItems:[{definitionId:900001,isCollected:true,owners:1,firstOwned:true}]});
  expect(result.rows[0]).toMatchObject({collected:true,inClub:null,firstOwned:null});
  expect(result.totals.firstOwnedUnknown).toBe(3);
});
