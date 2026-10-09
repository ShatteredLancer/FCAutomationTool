import { expect, it, vi } from 'vitest';
import { executionRuntime } from '../helpers/fc27-execution-runtime.js';
import { createFc27GalleryPurchase } from '../../src/adapters/browser/fc27-gallery-purchase.js';
import { readFc27Context } from '../../src/adapters/ea/fc27-local-read.js';
import { traditionalJournalScope } from '../../src/fc27/traditional-journal.js';
import { createFcatDiagnosticLog } from '../../src/diagnostics/fcat-diagnostic-log.js';

const stub = vi.hoisted(() => ({ adapters: [], calls: [], unknown: false, location: 'club', settings: null, adapterError: null }));
vi.mock('../../src/adapters/ea/fc27-puzzle-buy.js', () => ({ createFc27PuzzleBuyAdapter: async (_root, options) => {
  stub.adapters.push(options);
  if (stub.adapterError) throw stub.adapterError;
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
function fixture(options = {}) {
  stub.adapters = []; stub.calls = []; stub.unknown = false; stub.location = 'club'; stub.adapterError = null;
  const { root } = executionRuntime(), store = new Map(), reads = [], storageReads = [];
  root.crypto.randomUUID = () => 'gallery-test-operation';
  root.navigator = { locks: { request: async (name, _options, task) => task({ name, mode: 'exclusive' }) } };
  const reader = { readVersions: async ids => { reads.push([...ids]); return { status: 'observed', rows: ids.map(definitionId => ({
    definitionId, isCollected: stub.calls.some(([name, id]) => name === 'move' && id === definitionId),
    cardData: { rating: 80, nation: 1, teamId: 2, leagueId: 3, preferredPosition: 'ST' },
  })) }; } };
  const purchase = createFc27GalleryPurchase({ root, gmGetValue: (key, fallback) => { storageReads.push(key); return store.get(key) ?? fallback; },
    gmSetValue: (key, value) => store.set(key, structuredClone(value)), reader, liveEnabled: true,
    readSettings: async () => ({ status: 'observed', queriesNumber: 3, quoteCeiling: 450 }), ...options });
  const input = { items: [{ eaId: 10 }, { eaId: 11 }], binding: 'test-pool-revision', approved: true, isCurrent: () => true };
  const context = readFc27Context(root);
  return { purchase, store, reads, storageReads, input, context, scope: traditionalJournalScope(context), root };
}
it('composes the original FSU buyer without any SBC target and uses explicit account settings', async () => {
  const f = fixture();
  expect(await f.purchase(f.input)).toMatchObject({ status: 'purchased', spent: 400, collection: { status: 'confirmed' } });
  expect(f.reads).toEqual([[10,11],[10,11]]);
  expect(stub.adapters[0]).toMatchObject({ attempts: 3, preflightReceiptRead: true });
  expect(stub.calls).toEqual([['find',10,450],['buy',10],['move',10],['find',11,450],['buy',11],['move',11]]);
  expect((await f.purchase.inspect()).remaining).toBe(0);
});
it('passes a stricter per-batch ceiling through the Gallery adapter instead of overwriting it', async () => {
  const f = fixture();
  expect(await f.purchase({ ...f.input, quoteCeiling: 200 })).toMatchObject({ status: 'purchased', spent: 400 });
  expect(stub.calls.filter(([name]) => name === 'find')).toEqual([['find',10,200],['find',11,200]]);
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

it('exposes exact listing receipts without any new EA reads, adapter construction, or storage changes', async () => {
  const f = fixture(); await f.purchase(f.input);
  const calls = structuredClone(stub.calls), reads = structuredClone(f.reads), adapters = stub.adapters.length;
  const storage = structuredClone([...f.store]);
  const input = { expectedOperationId: 'gallery-test-operation', expectedBinding: f.input.binding };
  expect(await f.purchase.listingSource(input)).toMatchObject({ status: 'observed', executionEnabled: false,
    entries: [{ itemId: 110, definitionId: 10, tradeId: '1010', purchasePrice: 200 },
      { itemId: 111, definitionId: 11, tradeId: '1011', purchasePrice: 200 }] });
  expect(await f.purchase.listingSource({ ...input, isCurrent: () => false })).toMatchObject({ status: 'blocked' });
  expect(await f.purchase.listingSource({ ...input, expectedOperationId: 'old' })).toMatchObject({ status: 'blocked' });
  expect(stub.calls).toEqual(calls); expect(f.reads).toEqual(reads); expect(stub.adapters).toHaveLength(adapters);
  expect([...f.store]).toEqual(storage);
});

it('ignores an unrelated old listing journal during a new purchase', async () => {
  const f = fixture();
  f.store.set('fcat-fc27-gallery-bulk-list-v1:unrelated-old-run', { schema: 0, status: 'recovery-required' });
  expect(await f.purchase(f.input)).toMatchObject({ status: 'purchased', purchased: 2 });
  expect(stub.calls.filter(([name]) => name === 'buy')).toHaveLength(2);
});

it('does not read or block on the current account listing journal', async () => {
  const f = fixture();
  const listingKey = `fcat-fc27-gallery-bulk-list-v1:${f.scope}`;
  f.store.set(listingKey, { schema: 0, status: 'recovery-required' });
  expect(await f.purchase(f.input)).toMatchObject({ status: 'purchased', purchased: 2 });
  expect(stub.calls.filter(([name]) => name === 'buy')).toHaveLength(2);
  expect(f.storageReads).not.toContain(listingKey);
  expect(f.store.get(listingKey)).toEqual({ schema: 0, status: 'recovery-required' });
});

it.each([{ schema: 0 }, { schema: 1, entries: {} }, { schema: 1, entries: [null] }])('blocks malformed purchase journal with a clear recovery reason: %j', async malformed => {
  const f = fixture();
  f.store.set(`fcat-fc27-gallery-purchase:${f.scope}`, malformed);
  expect(await f.purchase(f.input)).toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_PURCHASE_JOURNAL_UNCONFIRMED' });
  expect(stub.calls).toEqual([]);
});

it('reports failed reads of old purchase records without starting buyer calls', async () => {
  const f = fixture({ gmGetValue: (key, fallback) => {
    if (key.startsWith('fcat-fc27-gallery-purchase:')) throw Error('storage offline');
    return fallback;
  } });
  expect(await f.purchase(f.input)).toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_PURCHASE_JOURNAL_READ_FAILED' });
  expect(await f.purchase.inspect()).toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_PURCHASE_JOURNAL_READ_FAILED' });
  expect(stub.calls).toEqual([]);
});

it.each(['plan', 'entries'])('reports a corrupted %s row as an invalid purchase record without rebuying', async field => {
  const f = fixture(); await f.purchase(f.input);
  const key = `fcat-fc27-gallery-purchase:${f.scope}`;
  f.store.get(key)[field][0] = null; stub.calls = [];
  expect(await f.purchase(f.input)).toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_PURCHASE_JOURNAL_UNCONFIRMED' });
  expect(stub.calls).toEqual([]);
});

it('keeps an unresolved purchase receipt from triggering another buy', async () => {
  const f = fixture(); stub.unknown = true;
  await f.purchase(f.input); const state = await f.purchase.inspect();
  stub.calls = []; stub.location = 'unknown';
  expect(await f.purchase({ approved: true, resume: true, expectedOperationId: state.operationId, isCurrent: () => true }))
    .toMatchObject({ status: 'recovery-required', reason: 'FC27_GALLERY_PURCHASE_RECEIPT_UNCONFIRMED' });
  expect(stub.calls).toEqual([]);
});

it('does not buy if its own journal write cannot be confirmed', async () => {
  const f = fixture({ gmSetValue: () => {} });
  expect(await f.purchase(f.input)).toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_PURCHASE_JOURNAL_UNCONFIRMED' });
  expect(stub.calls).toEqual([]);
});

it('reports a thrown storage write failure before any purchase', async () => {
  const f = fixture({ gmSetValue: () => { throw Error('storage full'); } });
  expect(await f.purchase(f.input)).toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_PURCHASE_JOURNAL_WRITE_FAILED' });
  expect(stub.calls).toEqual([]);
});

it('isolates diagnostic failures from completed purchases', async () => {
  const f = fixture({ diagnosticLog: { record: () => { throw Error('log offline'); } } });
  expect(await f.purchase(f.input)).toMatchObject({ status: 'purchased', purchased: 2 });
});

it.each(['bid', 'move'])('exports the blocked Gallery %s method and resumes the untouched batch after an update', async name => {
  const store = new Map();
  const diagnosticLog = createFcatDiagnosticLog({ gmGetValue: (key, fallback) => store.get(key) ?? fallback,
    gmSetValue: (key, value) => store.set(key, structuredClone(value)) });
  const f = fixture({ diagnosticLog });
  stub.adapterError = Object.assign(Error('FC27_TRANSACTION_METHOD_UNREVIEWED'), {
    methodPath: `service.${name}`, observedHash: '0'.repeat(64), sourceCode: 'private-source', account: 'private-account',
  });
  expect(await f.purchase(f.input)).toMatchObject({ status: 'blocked', reason: 'FC27_TRANSACTION_METHOD_UNREVIEWED', purchased: 0, spent: 0 });
  expect(stub.calls).toEqual([]);
  const payload = await diagnosticLog.exportPayload();
  expect(payload.entries).toContainEqual(expect.objectContaining({ area: 'gallery', event: 'purchase-method-check', phase: 'prepare',
    method: `service.${name}`, observedHash: '0'.repeat(64), status: 'blocked', reason: 'FC27_TRANSACTION_METHOD_UNREVIEWED' }));
  expect(payload.criticalEntries).toContainEqual(expect.objectContaining({ event: 'purchase-method-check', method: `service.${name}` }));
  expect(payload.entries).toContainEqual(expect.objectContaining({ event: 'purchase-outcome', count: 0, spent: 0 }));
  expect(JSON.stringify(payload)).not.toMatch(/private-|sourceCode|accountScope|operationId/);
  const batch = await f.purchase.inspect();
  expect(batch.remaining).toBe(2);
  stub.adapterError = null;
  expect(await f.purchase({ approved: true, resume: true, expectedOperationId: batch.operationId, isCurrent: () => true }))
    .toMatchObject({ status: 'purchased', purchased: 2, spent: 400 });
  expect(stub.calls.filter(([method]) => method === 'buy')).toHaveLength(2);
});

it.each(['throws', 'rejects'])('retains the original method rejection when Gallery diagnostics %s', async mode => {
  const f = fixture({ diagnosticLog: { record: () => {
    if (mode === 'throws') throw Error('diagnostics offline');
    return Promise.reject(Error('diagnostics offline'));
  } } });
  stub.adapterError = Object.assign(Error('FC27_TRANSACTION_METHOD_UNREVIEWED'), {
    methodPath: 'service.bid', observedHash: '0'.repeat(64),
  });
  expect(await f.purchase(f.input)).toMatchObject({ status: 'blocked', reason: 'FC27_TRANSACTION_METHOD_UNREVIEWED', spent: 0 });
  expect(stub.calls).toEqual([]);
});

it.each(['UTHttpRequest', 'EAHttpRequest.prototype.abort'])('exports %s preflight evidence before purchasing', async method => {
  const store = new Map();
  const diagnosticLog = createFcatDiagnosticLog({ gmGetValue: (key, fallback) => store.get(key) ?? fallback,
    gmSetValue: (key, value) => store.set(key, structuredClone(value)) });
  const f = fixture({ diagnosticLog });
  stub.adapterError = Object.assign(Error('FC27_CLUB_RUNTIME_UNVERIFIED_METHOD_0_CHANGED'), {
    methodPath: method, observedHash: '0'.repeat(64), sourceCode: 'private-source', account: 'private-account',
  });
  expect(await f.purchase(f.input)).toMatchObject({ status: 'blocked', purchased: 0, spent: 0,
    reason: 'FC27_CLUB_RUNTIME_UNVERIFIED_METHOD_0_CHANGED' });
  expect(stub.calls).toEqual([]);
  const payload = await diagnosticLog.exportPayload();
  expect(payload.criticalEntries).toContainEqual(expect.objectContaining({ event: 'purchase-method-check',
    method, observedHash: '0'.repeat(64) }));
  expect(JSON.stringify(payload)).not.toMatch(/private-|sourceCode|accountScope|operationId/);
});
