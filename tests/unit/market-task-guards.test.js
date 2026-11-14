import { it, expect, vi } from 'vitest';
import { executionRuntime } from '../helpers/fc27-execution-runtime.js';
import { readFc27Context } from '../../src/adapters/ea/fc27-local-read.js';
import { traditionalJournalScope } from '../../src/fc27/traditional-journal.js';
import { puzzleReservationKey } from '../../src/fc27/puzzle-reservations.js';
import { galleryPurchasePendingKey } from '../../src/gallery/purchase-session.js';
import { streamlinedJournalKey } from '../../src/streamlined/journal.js';
import { contextKey } from '../../src/fc27/prelaunch-contract.js';
import { createFc27MarketTaskGuards } from '../../src/adapters/browser/fc27-market-task-guards.js';

function fixture() {
  const { root } = executionRuntime(), data = new Map(), nativeContext = readFc27Context(root);
  const scope = traditionalJournalScope(nativeContext), context = { scope, season: '27', platform: 'pc' };
  const get = vi.fn(async (key, fallback) => structuredClone(data.get(key) ?? fallback));
  const guards = createFc27MarketTaskGuards({ root, get, context, assertCurrent: () => {} });
  return { root, data, scope, context, nativeContext, get, guards };
}
it('does no IO at construction and checks live FSU locks and all native squad slots, ignoring SBC selection settings', async () => {
  const f = fixture(); expect(f.get).not.toHaveBeenCalled();
  expect(() => f.guards.assertProtected({ id: 888 })).toThrow('GUARDS_UNAVAILABLE');
  await f.guards.checkOtherTransactions();
  expect(f.guards.assertProtected({ id: 888 })).toBe(true);
  f.root.info.lock.push(888); expect(f.guards.assertProtected({ id: 888 })).toBe(false);
  f.root.info.lock = [];
  f.root.repositories.Squad.squads._collection[902]._collection[7]._players[22]._item.id = 888;
  expect(f.guards.assertProtected({ id: 888 })).toBe(false);
  expect(f.guards.assertProtected({ id: 889 })).toBe(true);
  expect(f.data.size).toBe(0);
});
it('quarantines exact SBC reservations without blocking unrelated cards, and invalidates the projection on failed reread', async () => {
  const f = fixture();
  f.data.set(puzzleReservationKey(f.scope), { schema: 1, targets: [{ setId: 1, challengeId: 2, itemRefs: [{ id: 888, definitionId: 100 }] }] });
  const before = structuredClone([...f.data]); await f.guards.checkOtherTransactions();
  expect(f.guards.assertProtected({ id: 888 })).toBe(false); expect(f.guards.assertProtected({ id: 889 })).toBe(true);
  expect([...f.data]).toEqual(before);
  f.data.set(puzzleReservationKey(f.scope), { schema: 1, targets: 'broken' });
  await expect(f.guards.checkOtherTransactions()).rejects.toThrow('RESERVATION_UNVERIFIED');
  expect(() => f.guards.assertProtected({ id: 889 })).toThrow('GUARDS_UNAVAILABLE');
});
it('reads every saved Puzzle target, blocks save-pending and rejects a corrupt index', async () => {
  const f = fixture(), base = `fcat-fc27-puzzle-fill:${contextKey(f.nativeContext, 'puzzle-fill')}`;
  f.data.set(`${base}:index`, [{ setId: 1, challengeId: 2 }, { setId: 1, challengeId: 3 }]);
  const row = { schema: 2, kind: 'puzzle-fill', scope: f.scope, operationId: 'synthetic', setId: 1, challengeId: 2,
    brickIndices: [1,2,3,4,5,6,7,8,9,10], phase: 'saved', updatedAt: 1, submitted: false,
    itemRefs: [{ id: 888, definitionId: 100, pile: 'club', slot: 0 }] };
  f.data.set(`${base}:1:2`, row); f.data.set(`${base}:1:3`, { ...row, challengeId: 3, itemRefs: [{ ...row.itemRefs[0], id: 889 }] });
  await f.guards.checkOtherTransactions();
  for (const id of [888, 889]) expect(f.guards.assertProtected({ id })).toBe(false);
  f.data.set(`${base}:1:2`, { ...row, phase: 'save-pending' });
  await expect(f.guards.checkOtherTransactions()).rejects.toThrow('OTHER_SBC_PENDING');
  f.data.set(`${base}:index`, {}); await expect(f.guards.checkOtherTransactions()).rejects.toThrow('JOURNAL_UNVERIFIED');
});
it.each(['gallery', 'contribution', 'traditional'])('preserves and blocks unresolved or corrupt %s evidence without writes', async kind => {
  const f = fixture();
  const key = kind === 'gallery' ? galleryPurchasePendingKey(f.scope) : kind === 'contribution' ? streamlinedJournalKey(f.nativeContext) : f.scope;
  f.data.set(key, { schema: 1, unknown: true }); const before = structuredClone([...f.data]);
  await expect(f.guards.checkOtherTransactions()).rejects.toThrow(); expect([...f.data]).toEqual(before);
});
it('rejects account switches even on the final synchronous protection check', async () => {
  const f = fixture(); await f.guards.checkOtherTransactions(); f.root.services.User.currentUserId = 999;
  expect(() => f.guards.assertProtected({ id: 888 })).toThrow();
});
