import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { executionRuntime } from '../helpers/fc27-execution-runtime.js';
import observation from '../fixtures/fc27-request-method-observation-2026-10-09.json';
import { readFc27Context } from '../../src/adapters/ea/fc27-local-read.js';
import { createFc27PuzzleBuyAdapter, FC27_BUY_SERVICE_METHODS } from '../../src/adapters/ea/fc27-puzzle-buy.js';
import { createGalleryPurchaseSession, galleryPurchaseKey, galleryPurchasePendingKey } from '../../src/gallery/purchase-session.js';
import { createFc27GalleryPurchase } from '../../src/adapters/browser/fc27-gallery-purchase.js';
import { traditionalJournalScope } from '../../src/fc27/traditional-journal.js';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-09T02:00:00Z')); });
afterEach(() => vi.useRealTimers());

// Real Gallery journal -> native buyer -> owned Club read -> Unassigned receipt.
// Only the EA request bodies are synthetic; their digest observations reproduce
// the public build reported by the user without touching an EA account.
function fixture({ threePlayers = false } = {}) {
  const x = executionRuntime(), { root, state, calls } = x, store = new Map();
  state.filterClubQueries = true;
  Object.assign(root.ItemPile, { PURCHASED: 6 }); root.MAX_NEW_ITEMS = 100;
  root.GameCurrency = { COINS: 'COINS' };
  root.SearchType = { PLAYER: 'player' }; root.SearchCategory = { ANY: 'any' };
  root.UTSearchCriteriaDTO = class {};
  root.UTBucketedItemSearchViewModel = class {
    defaultSearchCriteria = {};
    updateSearchCriteria(criteria) { this.searchCriteria = { ...criteria }; }
  };
  root.ItemSearchFeature = { MARKET: 1 };
  root.UTCurrencyInputControl = { getIncrementAboveVal: n => n + 50, getIncrementBelowVal: n => n - 50 };
  root.PINEventType = { PAGE_VIEW: 'view' }; root.PIN_PAGEVIEW_EVT_TYPE = 'page';
  root.services.PIN = { sendData() {} }; root.UtasErrorCode = { PERMISSION_DENIED: 461 };
  root.services.User.getUser = () => ({ getCurrency: () => ({ amount: 10000 }) });
  const item = Object.assign(root.factories.Item.createItem({ id: 801, resourceId: 901 }), {
    tradable: true, isPlayer: () => true, isDuplicate: () => false, pile: 6,
    getAuctionData: () => ({ tradeId: '9901', tradeState: 'active', buyNowPrice: 1100,
      getSecondsRemaining: () => 60, canBuy: () => true }),
  });
  const observable = reply => ({ observe(_owner, cb) { cb(this, reply); }, unobserve() {} });
  class ItemService {
    bid(card, price) {
      calls.push({ kind: 'buy', id: card.id, price }); state.unassigned = [card];
      state.afterBid?.();
      return observable({ success: true, status: 200, data: { itemIds: [card.id] } });
    }
    move(card, pile) {
      calls.push({ kind: 'move', id: card.id, pile }); card.pile = pile;
      state.players.push({ id: card.id, resourceId: card.definitionId }); state.unassigned = [];
      return observable({ success: true, status: 200, data: { itemIds: [card.id] } });
    }
    searchTransferMarket(criteria) { return observable({ success: true, status: 200,
      data: { items: criteria.defId.includes(901) ? [item] : [] } }); }
    clearTransferMarketCache() {}
    requestUnassignedItems() {
      calls.push({ kind: 'unassigned' });
      return observable({ success: true, status: 200, response: { items: state.unassigned } });
    }
  }
  root.services.Item = new ItemService(); root.repositories.Item.setDirty = () => {};
  root.repositories.Item.numItemsInCache = () => state.unassigned.length;
  root.crypto.randomUUID = () => 'receipt-test';
  root.navigator = { locks: { request: async (name, _options, task) => task({ name, mode: 'exclusive' }) } };
  const digest = root.crypto.subtle.digest, hashes = new Map(), paths = new Map();
  for (const [path, row] of Object.entries(observation.methods)) {
    const source = String(path.split('.').reduce((value, key) => value[key], root)).replace(/\r\n/g, '\n');
    hashes.set(source, row.sha256); paths.set(source, path);
  }
  for (const [name, hash] of FC27_BUY_SERVICE_METHODS) hashes.set(String(ItemService.prototype[name]).replace(/\r\n/g, '\n'), hash);
  root.crypto.subtle.digest = async (algorithm, bytes) => {
    const source = new TextDecoder().decode(bytes).replace(/\r\n/g, '\n');
    const hash = state.requestMethodHashes?.[paths.get(source)] ?? hashes.get(source);
    return hash ? Uint8Array.from(Buffer.from(hash, 'hex')).buffer : digest(algorithm, bytes);
  };
  const versions = threePlayers ? [902, 903, 901] : [901];
  const scope = traditionalJournalScope(readFc27Context(root));
  const input = { items: versions.map(eaId => ({ eaId })), binding: 'exact-version', approved: true, isCurrent: () => true };
  const create = () => createGalleryPurchaseSession({ scope, context: readFc27Context(root),
    get: key => store.get(key) ?? null, set: (key, value) => store.set(key, structuredClone(value)),
    exclusive: async (_scope, task) => task(), readDestination: async () => state.destination ?? 'unassigned', operationId: () => 'receipt-test',
    createAdapter: () => createFc27PuzzleBuyAdapter(root, { canWrite: () => true,
      preflightReceiptRead: state.preflightReceiptRead !== false,
      verifyCurrent: () => {}, verifySquad: () => {}, playerDetails: new Map(versions.map(id => [id, item])),
      referencePrice: async () => 1100, wait: async () => {} }),
  });
  const execute = async options => {
    const promise = create().execute({ ...input, ...options }); await vi.runAllTimersAsync(); return promise;
  };
  const executeComposed = async options => {
    const purchase = createFc27GalleryPurchase({ root, liveEnabled: true,
      gmGetValue: (key, fallback) => store.get(key) ?? fallback,
      gmSetValue: (key, value) => store.set(key, structuredClone(value)),
      gmRequest: options => options.onload({ status: 200, responseText: JSON.stringify({ data:
        versions.map(id => ({ resource_id: id, ID: id, Player_Resource: id, LCPrice: 1100 })) }) }),
      readSettings: async () => ({ status: 'observed', queriesNumber: 1, quoteCeiling: null }),
      tradePreferences: { read: async () => ({ destination: state.destination ?? 'unassigned' }) },
      reader: { readVersions: async ids => ({ status: 'observed', rows: ids.map(definitionId => ({
        definitionId, isCollected: false, cardData: { rating: 80, nation: 1, teamId: 2, leagueId: 3, preferredPosition: 'ST' },
      })) }) },
    });
    const promise = purchase({ ...input, ...options }); await vi.runAllTimersAsync(); return promise;
  };
  return { ...x, store, scope, execute, executeComposed, item };
}

it('completes the October 9 native receipt read instead of looping after spending 1100', async () => {
  const x = fixture();
  expect(await x.execute()).toMatchObject({ status: 'purchased', purchased: 1, completed: 1, spent: 1100, destination: 'unassigned' });
  expect(x.store.get(galleryPurchaseKey(x.scope)).entries[0].state).toBe('unassigned');
  expect(x.store.get(galleryPurchasePendingKey(x.scope))).toBeNull();
  await x.execute({ resume: true, expectedOperationId: 'receipt-test' });
  expect(x.calls.filter(call => call.kind === 'buy')).toEqual([{ kind: 'buy', id: 801, price: 1100 }]);
  expect(x.calls.filter(call => call.kind === 'move')).toHaveLength(0);
});

it.each([false, true])('settles the bought row alongside two unavailable players, interrupted=%s, without rebuying', async interrupted => {
  const x = fixture({ threePlayers: true });
  if (interrupted) await seedInterruptedPurchase(x);
  expect(await x.execute(interrupted ? { resume: true, expectedOperationId: 'receipt-test' } : {}))
    .toMatchObject({ status: 'partial', total: 3, purchased: 1, completed: 1, spent: 1100,
      failures: [{ definitionId: 902 }, { definitionId: 903 }] });
  expect(x.calls.filter(call => call.kind === 'buy')).toHaveLength(1);
  expect(x.store.get(galleryPurchasePendingKey(x.scope))).toBeNull();
});

it('retains the receipt when the request binding changes after preflight and recovers without a second bid', async () => {
  const x = fixture(), original = x.root.UTHttpRequest.prototype.send;
  x.state.afterBid = () => { x.root.UTHttpRequest.prototype.send = () => {}; };
  expect(await x.execute()).toMatchObject({ status: 'recovery-required', purchased: 1, spent: 1100,
    reason: 'FC27_CLUB_RUNTIME_UNVERIFIED' });
  expect(x.calls.filter(call => call.kind === 'request')).toHaveLength(0);
  x.root.UTHttpRequest.prototype.send = original;
  expect(await x.execute({ resume: true, expectedOperationId: 'receipt-test' }))
    .toMatchObject({ status: 'purchased', completed: 1, spent: 1100 });
  expect(x.calls.filter(call => call.kind === 'buy')).toHaveLength(1);
});

async function seedInterruptedPurchase(x) {
  // Reproduce the previous version's lazy check after a successful bid.
  x.state.preflightReceiptRead = false;
  x.state.requestMethodHashes = { UTHttpRequest: '0'.repeat(64) };
  expect(await x.execute()).toMatchObject({ status: 'recovery-required', purchased: 1, completed: 0, spent: 1100,
    reason: 'FC27_CLUB_RUNTIME_UNVERIFIED_METHOD_0_CHANGED' });
  expect(x.store.get(galleryPurchasePendingKey(x.scope))).not.toBeNull();
  x.state.requestMethodHashes = {}; x.state.preflightReceiptRead = true;
}

it.each(['unassigned', 'club'])('resumes the old bought receipt found in %s without another bid or move', async location => {
  const x = fixture(); await seedInterruptedPurchase(x);
  x.state.destination = 'club'; // Changing settings must not rewrite the frozen batch destination.
  if (location === 'club') {
    x.state.players.push({ id: 801, resourceId: 901 }); x.state.unassigned = [];
  }
  expect(await x.execute({ resume: true, expectedOperationId: 'receipt-test' }))
    .toMatchObject({ status: 'purchased', purchased: 1, completed: 1, spent: 1100, destination: 'unassigned' });
  expect(x.calls.filter(call => call.kind === 'buy')).toHaveLength(1);
  expect(x.calls.filter(call => call.kind === 'move')).toHaveLength(0);
  expect(x.store.get(galleryPurchasePendingKey(x.scope))).toBeNull();
});

it.each(['unassigned', 'club'])('recovers through the production Gallery composition with the receipt in %s', async location => {
  const x = fixture({ threePlayers: true }); await seedInterruptedPurchase(x);
  if (location === 'club') {
    x.state.players.push({ id: 801, resourceId: 901 }); x.state.unassigned = [];
  }
  expect(await x.executeComposed({ resume: true, expectedOperationId: 'receipt-test' }))
    .toMatchObject({ status: 'partial', purchased: 1, completed: 1, spent: 1100, destination: 'unassigned' });
  expect(x.calls.filter(call => call.kind === 'buy')).toHaveLength(1);
  expect(x.calls.filter(call => call.kind === 'move')).toHaveLength(0);
});

it('runs a fresh production Gallery purchase through the preflight and exact Unassigned receipt', async () => {
  const x = fixture();
  expect(await x.executeComposed()).toMatchObject({ status: 'purchased', completed: 1, spent: 1100, destination: 'unassigned' });
  expect(x.calls.filter(call => call.kind === 'buy')).toHaveLength(1);
  expect(x.store.get(galleryPurchasePendingKey(x.scope))).toBeNull();
});

it.each(Object.keys(observation.methods))('preflights unknown %s before any purchase, including later request methods', async path => {
  const x = fixture(); x.state.requestMethodHashes = { [path]: '0'.repeat(64) };
  const result = await x.execute();
  expect(result).toMatchObject({ status: 'blocked', purchased: 0, spent: 0 });
  expect(result.reason).toMatch(/^FC27_CLUB_RUNTIME_UNVERIFIED_METHOD_\d_CHANGED$/);
  expect(x.calls).toHaveLength(0);
});

it.each(['absent', 'other-copy', 'ambiguous'])('keeps a %s receipt unresolved across repeated checks, without rebuying', async mode => {
  const x = fixture(); await seedInterruptedPurchase(x);
  x.state.unassigned = mode === 'absent' ? [] : mode === 'other-copy' ? [{ ...x.item, id: 802 }] : [x.item, x.item];
  for (let attempt = 0; attempt < 3; attempt++) {
    expect(await x.execute({ resume: true, expectedOperationId: 'receipt-test' }))
      .toMatchObject({ status: 'recovery-required', purchased: 1, completed: 0, spent: 1100,
        reason: 'FC27_GALLERY_PURCHASE_RECEIPT_UNCONFIRMED' });
  }
  expect(x.calls.filter(call => call.kind === 'buy')).toHaveLength(1);
  expect(x.calls.filter(call => call.kind === 'move')).toHaveLength(0);
  expect(x.store.get(galleryPurchaseKey(x.scope)).entries[0].state).toBe('bought');
  expect(x.store.get(galleryPurchasePendingKey(x.scope))).not.toBeNull();
});
