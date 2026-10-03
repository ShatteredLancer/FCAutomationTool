import { describe, expect, it } from 'vitest';
import { applyGalleryFirstOwnerHistory, normalizeGalleryFirstOwnerHistory, removeGalleryFirstOwnerHistory, toggleGalleryFirstOwnerHistory } from '../../src/gallery/first-owner-history.js';

describe('Gallery local First Owner history', () => {
  it('normalizes invalid and duplicate records deterministically', () => {
    expect(normalizeGalleryFirstOwnerHistory([
      { definitionId: 20, firstOwned: true, updatedAt: 4 },
      { definitionId: 10, firstOwned: false, updatedAt: 3 },
      { definitionId: 20, firstOwned: false, updatedAt: 5 },
      { definitionId: 0, firstOwned: true },
    ])).toEqual([{ definitionId: 10, firstOwned: false, updatedAt: 3 }, { definitionId: 20, firstOwned: false, updatedAt: 5 }]);
  });

  it('overrides only the exact version and leaves EA facts untouched', () => {
    const rows = applyGalleryFirstOwnerHistory([
      { definitionId: 10, firstOwned: null, collected: false },
      { definitionId: 11, firstOwned: true, collected: true },
    ], [{ definitionId: 10, firstOwned: true, updatedAt: 1 }]);
    expect(rows).toEqual([
      { definitionId: 10, firstOwned: true, firstOwnedSource: 'local-history', collected: false },
      { definitionId: 11, firstOwned: true, collected: true },
    ]);
  });

  it('toggles and clears a local declaration without affecting other versions', () => {
    const marked = toggleGalleryFirstOwnerHistory([], 10, true, 9);
    expect(toggleGalleryFirstOwnerHistory(marked, 11, true, 10)).toHaveLength(2);
    expect(removeGalleryFirstOwnerHistory(marked, 10)).toEqual([]);
  });
});
