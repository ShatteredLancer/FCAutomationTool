import { expect, it, vi } from 'vitest';
import { createFc27GalleryListingInventory } from '../../src/adapters/ea/fc27-gallery-listing-inventory.js';

function fixture(items, transfer = [], unassigned = []) {
  let receive;
  const root = { repositories: { Item: { getTransferItems: () => transfer, getUnassignedItems: () => unassigned } } };
  const transport = { readCount: vi.fn(async () => items.length), readPage: vi.fn(async ({ start, count, definitionIds }) => {
    const rows = items.filter(item => !definitionIds.length || definitionIds.includes(item.definitionId)).slice(start, start + count);
    rows.forEach(receive); return rows.map(({ id, definitionId }) => ({ id, definitionId, pile: 'club' }));
  }) };
  const createTransport = vi.fn(async (_root, { onEntity }) => { receive = onEntity; return transport; });
  const inventory = createFc27GalleryListingInventory(root, { createTransport });
  return { inventory, transport, createTransport };
}
const target = { source: 'futgg', set: { id: 'futgg:1' }, pool: { setId: 1, complete: true, items: [{ eaId: 111 }] } };

it('includes exact Unassigned versions and excludes stale Club copies and unrelated versions', async () => {
  const item = { id: 1, definitionId: 111, type: 'player' };
  const f = fixture([item], [], [item, { ...item, id: 2, definitionId: 222 }]);
  expect(await f.inventory.scan(target)).toEqual([{ id: 1, definitionId: 111, pile: 'unassigned' }]);
});

it('reads paginated Club once and merges exact versions with Transfer, not collected history', async () => {
  const rows = Array.from({ length: 251 }, (_, index) => ({ id: index + 1, definitionId: index < 2 ? 111 : 222, type: 'player' }));
  const f = fixture(rows, [{ id: 1, definitionId: 111, type: 'player' }, { id: 999, definitionId: 333, type: 'player' }]);
  expect(await f.inventory.scan(target)).toEqual([{ id: 2, definitionId: 111, pile: 'club' }, { id: 1, definitionId: 111, pile: 'transfer' }]);
  expect(f.transport.readPage).toHaveBeenCalledTimes(2);
  expect(f.createTransport).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ nativeReauth: true }));
  await f.inventory.validate({ id: 2, definitionId: 111, pile: 'club' });
  rows.splice(1, 1);
  await expect(f.inventory.validate({ id: 2, definitionId: 111, pile: 'club' })).rejects.toThrow('FC27_GALLERY_LISTING_ITEM_CHANGED');
  expect(f.inventory.resolve({ id: 2, definitionId: 111 })).toBeNull();
});

it('rejects truncated public pools and incomplete Club responses instead of advertising all sellable cards', async () => {
  const f = fixture([]);
  await expect(f.inventory.scan({ ...target, pool: { ...target.pool, candidateOnly: true } })).rejects.toThrow('SET_POOL_INCOMPLETE');
  expect(f.transport.readCount).not.toHaveBeenCalled();
  await expect(f.inventory.scan({ ...target, set: { id: 'futgg:2' } })).rejects.toThrow('SET_UNAVAILABLE');
  f.transport.readCount.mockResolvedValue(1);
  await expect(f.inventory.scan(target)).rejects.toThrow('CLUB_INCOMPLETE');
});

it('matches Fodder conditions against all actual held cards, independent of its top-100 discovery pool', async () => {
  const rows = [{ id: 1, definitionId: 111, type: 'player', teamId: 1, leagueId: 13, rareflag: 0 },
    { id: 2, definitionId: 222, type: 'player', teamId: 2, leagueId: 13, rareflag: 0 }];
  const f = fixture(rows);
  expect(await f.inventory.scan({ source: 'fodder', set: { id: 'fodder:england/arsenal',
    conditions: { clubs: [1], leagues: [13], rareflags: [], holo: false } } }))
    .toEqual([{ id: 1, definitionId: 111, pile: 'club' }]);
});
