import { expect, it, vi } from 'vitest';
import { executionRuntime } from '../helpers/fc27-execution-runtime.js';
import { createFc27GalleryPurchase } from '../../src/adapters/browser/fc27-gallery-purchase.js';

const stub = vi.hoisted(() => ({ adapters: [], calls: [], unknown: false, location: 'club', settings: null }));
vi.mock('../../src/adapters/ea/fc27-puzzle-buy.js', () => ({ createFc27PuzzleBuyAdapter: async (_root, options) => {
  stub.adapters.push(options);
  return { verifySquad: options.verifyCurrent, verifyCurrent: options.verifyCurrent,
    find: async (definitionId, ceiling) => {
      stub.calls.push(['find', definitionId, ceiling]);
      expect(options.canWrite()).toBe(true);
      expect(options.playerDetails.get(definitionId)).toMatchObject({ _rating: 80, nationId: 1 });
      return { definitionId, itemId: definitionId + 100, tradeId: String(definitionId + 1000), price: 200 };
    },
    buy: async entry => { stub.calls.push(['buy', entry.definitionId]); return stub.unknown ? { status: 'unknown' } : { ...entry, status: 'bought' }; },
    move: async entry => { stub.calls.push(['move', entry.definitionId]); }, locate: async () => stub.location,
    collectionState: options.collectionState, confirmCollection: options.confirmCollection, cancel() {}, afterPlayer() {},
  };
} }));
function fixture() {
  stub.adapters = []; stub.calls = []; stub.unknown = false; stub.location = 'club';
  const { root } = executionRuntime(), store = new Map(), reads = [];
  root.crypto.randomUUID = () => 'gallery-test-operation';
  root.navigator = { locks: { request: async (name, _options, task) => task({ name, mode: 'exclusive' }) } };
  const reader = { readVersions: async ids => { reads.push([...ids]); return { status: 'observed', rows: ids.map(definitionId => ({
    definitionId, isCollected: stub.calls.some(([name, id]) => name === 'move' && id === definitionId),
    cardData: { rating: 80, nation: 1, teamId: 2, leagueId: 3, preferredPosition: 'ST' },
  })) }; } };
  const purchase = createFc27GalleryPurchase({ root, gmGetValue: (key, fallback) => store.get(key) ?? fallback,
    gmSetValue: (key, value) => store.set(key, structuredClone(value)), reader, liveEnabled: true,
    readSettings: async () => ({ status: 'observed', queriesNumber: 3, quoteCeiling: 450 }) });
  const input = { items: [{ eaId: 10 }, { eaId: 11 }], binding: 'test-pool-revision', approved: true, isCurrent: () => true };
  return { purchase, store, reads, input };
}
it('composes the original FSU buyer without any SBC target and uses explicit account settings', async () => {
  const f = fixture();
  expect(await f.purchase(f.input)).toMatchObject({ status: 'purchased', spent: 400, collection: { status: 'confirmed' } });
  expect(f.reads).toEqual([[10,11],[10,11]]);
  expect(stub.adapters[0]).toMatchObject({ attempts: 3 });
  expect(stub.calls).toEqual([['find',10,450],['buy',10],['move',10],['find',11,450],['buy',11],['move',11]]);
  expect((await f.purchase.inspect()).remaining).toBe(0);
});
it('requires approval and current view before any native reads or purchase calls', async () => {
  for (const input of [{ approved: false }, { isCurrent: () => false }]) {
    const f = fixture(); expect((await f.purchase({ ...f.input, ...input })).status).toBe('blocked');
    expect(f.reads).toEqual([]); expect(stub.calls).toEqual([]);
  }
});
it('resumes unknown receipt from durable version IDs without buying it again', async () => {
  const f = fixture(); stub.unknown = true;
  expect((await f.purchase(f.input)).status).toBe('recovery-required');
  const summary = await f.purchase.inspect(); stub.unknown = false; stub.location = 'purchased';
  // The adapter returns Club after move, mirroring the exact move receipt cache.
  stub.location = 'club';
  const result = await f.purchase({ approved: true, resume: true, expectedOperationId: summary.operationId, isCurrent: () => true });
  expect(result.purchased).toBe(2); expect(stub.calls.filter(([name]) => name === 'buy')).toHaveLength(2);
});
