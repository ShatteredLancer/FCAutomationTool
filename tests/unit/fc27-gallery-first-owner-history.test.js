import { describe, expect, it } from 'vitest';
import { applyGalleryFirstOwnerHistory, galleryFirstOwnerHistoryAction, normalizeGalleryFirstOwnerHistory, removeGalleryFirstOwnerHistory, toggleGalleryFirstOwnerHistory } from '../../src/gallery/first-owner-history.js';

describe('Gallery local First Owner history', () => {
  it.each([
    ['uncollected', { collected: false, firstOwned: null }, null],
    ['collection unknown', { collected: null, firstOwned: null }, null],
    ['current first owner', { collected: true, firstOwned: true, inClub: true }, null],
    ['recorded first owner no longer held', { collected: true, firstOwned: true, inClub: false }, null],
    ['collected with unknown history', { collected: true, firstOwned: null, inClub: false }, 'mark'],
    ['collected with unknown current ownership', { collected: true, firstOwned: null, inClub: null }, 'mark'],
    ['market copy does not disprove historical FO', { collected: true, firstOwned: false, inClub: true }, 'mark'],
    ['historical market copy', { collected: true, firstOwned: false, inClub: false }, 'mark'],
    ['manual declaration', { collected: true, firstOwned: true, firstOwnedSource: 'local-history' }, 'clear'],
    ['legacy declaration on missing card', { collected: false, firstOwned: true, firstOwnedSource: 'local-history' }, 'clear'],
    ['legacy negative declaration', { collected: true, firstOwned: false, firstOwnedSource: 'local-history' }, 'clear'],
  ])('offers the appropriate history action: %s', (_name, row, action) => {
    expect(galleryFirstOwnerHistoryAction(row)).toBe(action);
  });

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
