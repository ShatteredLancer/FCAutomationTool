import { expect, it, vi } from 'vitest';
import { createClubInspectionInventory } from '../../FSU_mod/src/runner-support/club-inventory.js';
import observation from '../fixtures/fc27-fresh-club-observation.json';

const context = { schema: 1, season: '27', accountScope: 'synthetic', platform: 'test' };
const player = id => Object.freeze({ id, definitionId: id + 100, type: 'player',
  pile: 'club', rating: 70, safetyFingerprint: `safe-${id}` });
function setup(items = [player(1), player(2)]) {
  let scope = context;
  const readCount = vi.fn(async () => items.length);
  const readPage = vi.fn(async ({ start, count, definitionIds }) =>
    items.filter(item => !definitionIds.length || definitionIds.includes(item.definitionId)).slice(start, start + count));
  const inventory = createClubInspectionInventory({ readContext: () => scope, readCount, readPage });
  return { inventory, items, readCount, readPage, switchScope: () => { scope = { ...context, platform: 'other' }; } };
}

it('requires fresh counts and an exact terminal page, never imports repository entries', async () => {
  const { inventory, readCount, readPage } = setup();
  expect(inventory.describe().status).toBe('not-ready');
  expect((await inventory.refreshClub()).status).toBe('refreshed');
  expect(readCount).toHaveBeenCalledTimes(2);
  expect(readPage.mock.calls.map(([query]) => query.start)).toEqual([0, 2]);
  expect(inventory.getSnapshot()).toMatchObject({ kind: 'fresh-club-inspection', complete: true,
    status: 'provisional', liveExecutionEnabled: false, items: [player(1), player(2)] });
});

it('validates item and definition and fingerprint, not another copy of the same definition', async () => {
  const { inventory, readPage } = setup();
  await inventory.refreshClub();
  const refs = inventory.getSnapshot().items;
  expect(await inventory.validateClubPlayers(refs)).toMatchObject({ status: 'validated', items: refs });
  readPage.mockResolvedValueOnce([{ ...refs[0], id: 99 }, refs[1]]).mockResolvedValueOnce([]);
  await expect(inventory.validateClubPlayers(refs)).rejects.toThrow('ITEM_CHANGED_OR_MISSING');
  expect(inventory.getSnapshot()).toBeNull();
});

it.each(['definition', 'fingerprint', 'missing'])('fails closed on changed %s', async field => {
  const { inventory, readPage } = setup();
  await inventory.refreshClub();
  const refs = inventory.getSnapshot().items;
  const changed = field === 'missing' ? [] : [{ ...refs[0],
    ...(field === 'definition' ? { definitionId: 999 } : { safetyFingerprint: 'changed' }) }];
  readPage.mockResolvedValueOnce(changed).mockResolvedValueOnce([]);
  await expect(inventory.validateClubPlayers([refs[0]])).rejects.toThrow(/ITEM_CHANGED_OR_MISSING|UNEXPECTED_DEFINITION/);
});

it.each(['duplicate', 'truncated', 'count-drift', 'overflow'])('rejects incomplete scans: %s', async fault => {
  const { inventory, readCount, readPage } = setup();
  if (fault === 'duplicate') readPage.mockResolvedValueOnce([player(1)]).mockResolvedValueOnce([player(1)]);
  if (fault === 'truncated') readPage.mockResolvedValueOnce([player(1)]).mockResolvedValueOnce([]);
  if (fault === 'count-drift') readCount.mockResolvedValueOnce(2).mockResolvedValueOnce(3);
  if (fault === 'overflow') readCount.mockResolvedValueOnce(20001);
  await expect(inventory.refreshClub()).rejects.toThrow(/FC27_CLUB_/);
  expect(inventory.describe().status).toBe('not-ready');
  expect(inventory.getSnapshot()).toBeNull();
});

it('handles empty Clubs with affirmative count and terminal-page evidence', async () => {
  const { inventory, readPage } = setup([]);
  await inventory.refreshClub();
  expect(readPage).toHaveBeenCalledOnce();
  expect(inventory.getSnapshot()).toMatchObject({ complete: true, items: [] });
});

it('rejects account switches, overlapping reads and stale snapshots', async () => {
  const { inventory, readCount, switchScope } = setup();
  let resolve;
  readCount.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const pending = inventory.refreshClub();
  await expect(inventory.refreshClub()).rejects.toThrow('BUSY');
  switchScope();
  resolve(2);
  await expect(pending).rejects.toThrow('SCOPE_CHANGED');
  expect(inventory.getSnapshot()).toBeNull();
});

it('rejects invalid refs before sending any request', async () => {
  const { inventory, readPage } = setup();
  await inventory.refreshClub();
  readPage.mockClear();
  for (const refs of [[], [player(1), player(1)], [{ id: 1, definitionId: 2 }], Array(51).fill(player(1))]) {
    await expect(inventory.validateClubPlayers(refs)).rejects.toThrow('INVALID_REFS');
  }
  expect(readPage).not.toHaveBeenCalled();
});

it('replays the observed 41-player scan and two-item validation independently of partial cache', async () => {
  const { inventory, readCount, readPage } = setup(Array.from({ length: observation.fresh.players }, (_, i) => player(i + 1)));
  await inventory.refreshClub();
  const snapshot = inventory.getSnapshot();
  expect(snapshot.items).toHaveLength(41);
  expect(snapshot.kind).not.toBe('normalized-inventory');
  await inventory.validateClubPlayers(snapshot.items.slice(0, observation.fresh.targetedCount));
  expect(readCount.mock.calls.length + readPage.mock.calls.length).toBe(observation.fresh.requests);
});

it('accepts the exact requested copy even when another same-definition instance precedes it', async () => {
  const { inventory, readPage } = setup();
  await inventory.refreshClub();
  const [ref] = inventory.getSnapshot().items;
  readPage.mockResolvedValueOnce([{ ...ref, id: 99 }, ref]);
  expect((await inventory.validateClubPlayers([ref])).items).toEqual([ref]);
});

it('invalidates snapshots immediately on account change without another network request', async () => {
  const { inventory, switchScope, readPage } = setup();
  await inventory.refreshClub();
  readPage.mockClear();
  switchScope();
  expect(inventory.getSnapshot()).toBeNull();
  expect(inventory.describe().status).toBe('not-ready');
  expect(readPage).not.toHaveBeenCalled();
});

it.each([500, 501])('reads %s players with bounded, non-overlapping pages', async count => {
  const { inventory, readPage } = setup(Array.from({ length: count }, (_, index) => player(index + 1)));
  await inventory.refreshClub();
  expect(inventory.getSnapshot().items).toHaveLength(count);
  expect(readPage.mock.calls.map(([query]) => [query.start, query.count])).toEqual([[0, 250], [250, 250], [500, 250]]);
});

it('stops before further requests if the account switches while a page is pending', async () => {
  const { inventory, readPage, readCount, switchScope } = setup();
  readPage.mockImplementationOnce(async () => { switchScope(); return [player(1), player(2)]; });
  await expect(inventory.refreshClub()).rejects.toThrow('SCOPE_CHANGED');
  expect(readPage).toHaveBeenCalledOnce();
  expect(readCount).toHaveBeenCalledOnce();
});
