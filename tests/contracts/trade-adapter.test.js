import { describe, expect, it, vi } from 'vitest';
import { createEaInventoryAdapter } from '../../src/adapters/ea/inventory.js';
import { createEaTradeAdapter } from '../../src/adapters/ea/trade.js';
import { createFc27GallerySaleReader } from '../../src/adapters/ea/fc27-gallery-sales.js';
import { createFakeTradeAdapter } from '../../src/adapters/fake/trade.js';
import { createRuntimeAdapters } from '../../src/adapters/index.js';

function eaRuntime(item) {
  class UTSearchCriteriaDTO {
    constructor() {
      this.type = null;
      this.category = null;
      this.defId = [];
      this.maxBuy = 0;
      this.accessToken = 'must-not-leak';
    }
  }
  const transfer = [item];
  return {
    UTSearchCriteriaDTO,
    TradeAccessLevel: { ALLOWED: 1 },
    ItemPile: { TRANSFER: 'transfer' },
    GameCurrency: { COINS: 'coins' },
    services: {
      User: { getUser: () => ({ tradeAccess: 1, coins: 123456, personaId: 'private' }) },
      Item: {
        searchTransferMarket() {},
        clearTransferMarketCache() {},
        bid() {},
        move() {},
        list() {},
        relistExpiredAuctions() {},
        requestTransferItems() {},
        requestMarketData(target) {
          return {
            observe(context, callback) {
              target._itemPriceLimits = { minimum: 300, maximum: 10000 };
              callback({ unobserve() {} }, { success: true });
            },
          };
        },
      },
    },
    repositories: {
      Item: {
        transfer: { _collection: transfer },
        getTransferItems: () => transfer,
        getPileSize: () => 100,
        numItemsInCache: () => 25,
      },
    },
  };
}

describe('Trade Adapter contracts', () => {
  it('reads sales with the Enhancer transfer/auction refresh sequence without buying or clearing sold items', async () => {
    const auction = { tradeId: 9001, currentBid: 500, buyNowPrice: 500,
      isSold: () => true, isExpired: () => true, isClosedTrade: () => true };
    const item = { id: 11, definitionId: 111, getAuctionData: () => auction }, root = eaRuntime(item), calls = [];
    root.services.Item.requestTransferItems = () => { calls.push('transfer'); return Promise.resolve({ success: true }); };
    root.services.Item.refreshAuctions = items => { calls.push('auctions'); expect(items).toEqual([item]); return Promise.resolve({ success: true }); };
    expect(await createFc27GallerySaleReader(root).refreshGallerySaleReceipts()).toMatchObject({ status: 'observed',
      receipts: [{ itemId: 11, definitionId: 111, listingTradeId: '9001', sold: true, soldPrice: 500 }] });
    expect(calls).toEqual(['transfer', 'auctions']);
  });
  it('preserves exact auction IDs and leaves unknown native sold predicates unknown', async () => {
    const item = { id: 11, definitionId: 111, getAuctionData: () => ({ tradeId: '90071992547409933',
      currentBid: 500, buyNowPrice: 500, isActiveTrade: () => true }) }, root = eaRuntime(item);
    root.services.Item.requestTransferItems = async () => ({ success: true });
    root.services.Item.refreshAuctions = async () => ({ success: true });
    expect(await createFc27GallerySaleReader(root).refreshGallerySaleReceipts()).toMatchObject({ status: 'observed',
      receipts: [{ listingTradeId: '90071992547409933', sold: null, expired: null, state: 'active' }] });
  });
  it('bounds a hung auction refresh and does not accept partial sale facts after failure', async () => {
    vi.useFakeTimers();
    try {
      const root = eaRuntime({ id: 11, definitionId: 111 });
      root.services.Item.requestTransferItems = async () => ({ success: true });
      root.services.Item.refreshAuctions = () => new Promise(() => {});
      const result = createFc27GallerySaleReader(root).refreshGallerySaleReceipts();
      await vi.advanceTimersByTimeAsync(20000);
      expect(await result).toMatchObject({ status: 'error', receipts: [] });
      delete root.repositories.Item.getTransferItems;
      expect(await createFc27GallerySaleReader(root).refreshGallerySaleReceipts()).toMatchObject({ status: 'unsupported', receipts: [] });
    } finally { vi.useRealTimers(); }
  });
  it('EA capability diagnostics are serializable, allowlisted and read-only', () => {
    const adapter = createEaTradeAdapter(eaRuntime({ id: 10, definitionId: 20 }));
    const result = adapter.inspectCapabilities();
    expect(result).toMatchObject({
      runtimeReady: true,
      canTrade: true,
      tradeAccess: { available: true, allowed: true, level: 1 },
      coins: 123456,
      transferCapacity: { used: 25, max: 100, free: 75 },
      criteria: { constructorAvailable: true, fields: ['category', 'defId', 'maxBuy', 'type'] },
    });
    expect(JSON.stringify(result)).not.toContain('accessToken');
    expect(JSON.stringify(result)).not.toContain('persona');
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('reads the live EA currency object without exposing the user object', () => {
    const runtime = eaRuntime({ id: 10, definitionId: 20 });
    runtime.services.User.getUser = () => ({
      tradeAccess: 1,
      getCurrency: () => ({ amount: 654321, privateCurrencyId: 'must-not-leak' }),
      personaId: 'must-not-leak',
    });
    const result = createEaTradeAdapter(runtime).inspectCapabilities();
    expect(result.coins).toBe(654321);
    expect(JSON.stringify(result)).not.toContain('privateCurrencyId');
    expect(JSON.stringify(result)).not.toContain('personaId');
  });

  it('indexes destination ownership with one read per inventory pile', () => {
    const runtime = eaRuntime({ id: 2, definitionId: 8402 });
    const reads = { unassigned: 0, storage: 0, transfer: 0 };
    const unassigned = [{ id: 3, definitionId: 8403 }];
    const storage = [{ id: 4, definitionId: 8404 }];
    const transfer = [{ id: 5, definitionId: 8405 }];
    const club = Array.from({ length: 20_000 }, (_, index) => ({
      id: 10_000 + index,
      definitionId: 8400 + (index % 50),
    }));
    runtime.repositories.Item.getUnassignedItems = () => { reads.unassigned += 1; return unassigned; };
    runtime.repositories.Item.getStorageItems = () => { reads.storage += 1; return storage; };
    runtime.repositories.Item.getTransferItems = () => { reads.transfer += 1; return transfer; };
    runtime.repositories.Item.club = { items: { _collection: club } };

    const definitionIds = Array.from({ length: 50 }, (_, index) => 8400 + index);
    const ownerships = createEaTradeAdapter(runtime).inspectDefinitionOwnerships(definitionIds);

    expect(reads).toEqual({ unassigned: 1, storage: 1, transfer: 1 });
    expect(Object.keys(ownerships)).toHaveLength(50);
    expect(ownerships[8403]).toMatchObject({ club: 400, unassigned: 1 });
    expect(ownerships[8404]).toMatchObject({ club: 400, storage: 1 });
    expect(ownerships[8405]).toMatchObject({ club: 400, transfer: 1 });
  });

  it('EA price-limit diagnostics resolve an exact item and only make the requested read call', async () => {
    const item = { id: 10, definitionId: 20 };
    const adapter = createEaTradeAdapter(eaRuntime(item));
    const result = await adapter.inspectPriceLimits({ id: 10, pile: 'transfer' }, { refresh: true });
    expect(result).toEqual({
      status: 'loaded',
      refreshStatus: 'completed',
      limitsSource: 'refreshed',
      before: {
        found: true,
        item: { id: 10, definitionId: 20, pile: 'transfer' },
        hasPriceLimits: false,
        minimum: null,
        maximum: null,
      },
      after: {
        found: true,
        item: { id: 10, definitionId: 20, pile: 'transfer' },
        hasPriceLimits: true,
        minimum: 300,
        maximum: 10000,
      },
      response: { success: true, status: null, code: null },
      error: null,
    });
  });

  it('distinguishes rejected price-limit refreshes from usable existing limits', async () => {
    const item = { id: 10, definitionId: 20, _itemPriceLimits: { minimum: 300, maximum: 10000 } };
    const runtime = eaRuntime(item);
    runtime.services.Item.requestMarketData = () => ({
      observe(context, callback) {
        callback({ unobserve() {} }, { success: false, status: 403, code: 403 });
      },
    });
    const result = await createEaTradeAdapter(runtime).inspectPriceLimits(
      { id: 10, pile: 'transfer' },
      { refresh: true },
    );
    expect(result).toMatchObject({
      status: 'loaded',
      refreshStatus: 'rejected',
      limitsSource: 'existing-cache',
      response: { success: false, status: 403, code: 403 },
      after: { hasPriceLimits: true, minimum: 300, maximum: 10000 },
    });
  });

  it('exports allowlisted listing candidate snapshots without retaining EA items', () => {
    const item = {
      id: 10,
      definitionId: 20,
      type: 'player',
      rating: 84,
      rareflag: 1,
      untradeableCount: 0,
      loans: -1,
      privateToken: 'must-not-leak',
      _staticData: { getFullName: () => 'Test Player' },
      _auction: {
        tradeId: 30,
        buyNowPrice: 900,
        isActiveTrade: () => false,
        isClosedTrade: () => false,
        isInactive: () => true,
        privateAuctionData: 'must-not-leak',
      },
    };
    const result = createEaTradeAdapter(eaRuntime(item)).inspectListingCandidates({ sources: ['transfer'], limit: 10 });
    expect(result).toMatchObject({
      sources: ['transfer'],
      counts: { transfer: 1 },
      total: 1,
      returned: 1,
      truncated: false,
      candidates: [{
        item: { id: 10, definitionId: 20, pile: 'transfer' },
        name: 'Test Player',
        type: 'player',
        rating: 84,
        tier: 'gold',
        rare: true,
        special: false,
        tradeable: true,
        limitedUse: false,
        auction: {
          present: true,
          state: 'inactive',
          stateSource: 'isInactive',
          signals: { active: false, closed: false, inactive: true },
          tradeId: 30,
          buyNowPrice: 900,
        },
      }],
      error: null,
    });
    expect(JSON.stringify(result)).not.toContain('privateToken');
    expect(JSON.stringify(result)).not.toContain('privateAuctionData');
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('maps the observed EA expired trade state to an inactive Transfer candidate', () => {
    const item = {
      id: 11,
      definitionId: 21,
      type: 'player',
      rating: 84,
      rareflag: 1,
      untradeableCount: 0,
      loans: -1,
      _auction: {
        tradeState: 'expired',
        tradeId: 31,
        expires: -1,
        isActiveTrade: () => false,
        isClosedTrade: () => false,
        isInactive: () => false,
      },
    };

    const result = createEaTradeAdapter(eaRuntime(item))
      .inspectListingCandidates({ sources: ['transfer'], limit: 10 });

    expect(result.candidates[0].auction).toMatchObject({
      present: true,
      state: 'inactive',
      stateSource: 'primitive-state',
      rawState: 'expired',
      signals: { active: false, closed: false, inactive: false },
      tradeId: 31,
      expires: -1,
    });
  });

  it('excludes inactive Transfer Available Items from the bulk Re-list All snapshot', () => {
    const available = {
      id: 12,
      definitionId: 22,
      type: 'player',
      rating: 88,
      rareflag: 1,
      untradeableCount: 0,
      loans: -1,
      _auction: {
        isActiveTrade: () => false,
        isClosedTrade: () => false,
        isInactive: () => true,
      },
    };

    expect(createEaTradeAdapter(eaRuntime(available)).inspectBulkRelistSnapshot()).toMatchObject({
      total: 1,
      unsoldCount: 0,
      byState: { inactive: 1 },
      items: [],
    });
  });

  it('keeps listing-only tradeability fallbacks out of the shared inventory contract', () => {
    const sharedItem = {
      id: 11,
      definitionId: 21,
      type: 'player',
      rating: 80,
      rareflag: 0,
      untradeableCount: 0,
      loans: -1,
    };
    const runtime = eaRuntime(sharedItem);
    const result = createEaTradeAdapter(runtime)
      .inspectListingCandidates({ sources: ['transfer'], limit: 10 });
    expect(result.candidates[0]).toMatchObject({ tradeable: true });
    expect(createEaInventoryAdapter(runtime).snapshot().piles.transfer[0]).toMatchObject({ tradeable: false });
  });

  it('uses the verified EA tradeability method before compatibility aliases', () => {
    const item = {
      id: 19,
      definitionId: 29,
      type: 'player',
      rating: 80,
      rareflag: 0,
      isTradeable: () => true,
      isUntradeable: () => true,
      loans: -1,
    };
    const result = createEaTradeAdapter(eaRuntime(item))
      .inspectListingCandidates({ sources: ['transfer'], limit: 10 });

    expect(result.candidates[0]).toMatchObject({
      item: { id: 19 },
      tradeable: true,
    });
  });

  it('excludes a stale Club entity when the same item ID is present in another pile', () => {
    const transferItem = {
      id: 12, definitionId: 22, type: 'player', rating: 80, rareflag: 0,
      untradeableCount: 0, loans: -1,
    };
    const staleClubItem = { ...transferItem };
    const runtime = eaRuntime(transferItem);
    runtime.repositories.Item.club = { items: { _collection: [staleClubItem] } };
    runtime.services.Item.itemDao = { itemRepo: { club: { items: { _collection: [staleClubItem] } } } };

    expect(createEaTradeAdapter(runtime).inspectListingCandidates({ sources: ['club'], limit: 0 }))
      .toMatchObject({ counts: { club: 0 }, total: 0, returned: 0, candidates: [] });
  });

  it('classifies a rejected Transfer refresh instead of reporting it completed', async () => {
    const runtime = eaRuntime({ id: 13, definitionId: 23 });
    runtime.services.Item.requestTransferItems = () => ({ success: false, status: 403, code: 403 });
    await expect(createEaTradeAdapter(runtime).refreshTransferItems()).resolves.toMatchObject({
      status: 'rejected',
      response: { success: false, status: 403, code: 403 },
      error: { code: 403 },
    });
  });

  it('Fake and EA adapters expose the same TS1 methods and serializable result shapes', async () => {
    const fake = createFakeTradeAdapter({
      items: [{ id: 10, definitionId: 20, pile: 'transfer' }],
      refreshedLimits: { 10: { minimum: 300, maximum: 10000 } },
      capturedAt: 1,
    });
    const capability = fake.inspectCapabilities();
    const limits = await fake.inspectPriceLimits({ id: 10 }, { refresh: true });
    expect(Object.keys(fake).sort()).toEqual([
      'acquireRequestPermit', 'buyNowItem', 'calls', 'inspectBulkRelistSnapshot', 'inspectCapabilities', 'inspectDefinitionOwnership', 'inspectDefinitionOwnerships',
      'inspectListingCandidates', 'inspectListingItem', 'inspectPriceLimits', 'inspectPurchase',
      'inspectUnassignedReadiness', 'listItem', 'refreshPurchaseState', 'refreshTransferItems', 'relistExpiredAuctions',
      'routePurchasedItem', 'searchMarket',
    ]);
    expect(capability).toMatchObject({ runtimeReady: true, canTrade: true });
    expect(limits).toMatchObject({ status: 'loaded', after: { minimum: 300, maximum: 10000 } });
    expect(JSON.parse(JSON.stringify({ capability, limits }))).toEqual({ capability, limits });
  });

  it('keeps Fake market search, Buy Now and routing serializable', async () => {
    const fake = createFakeTradeAdapter({
      coins: 5000,
      transferCapacity: { used: 10, max: 100 },
      marketItems: [{
        id: 70, definitionId: 8401, type: 'player', rating: 84, tier: 'gold', rare: true,
        auction: { present: true, state: 'active', tradeId: 700, buyNowPrice: 900, expires: 120 },
      }],
    });
    const search = await fake.searchMarket({ definitionId: 8401, maxBuyNow: 1000, page: 1 });
    expect(search).toMatchObject({ status: 'completed', candidates: [{ item: { id: 70, definitionId: 8401, pile: 'market' }, auction: { tradeId: 700, buyNowPrice: 900 } }] });
    const buyPermit = await fake.acquireRequestPermit('buy');
    const bought = await fake.buyNowItem(
      { id: 70, definitionId: 8401, tradeId: 700 },
      900,
      { requestPermit: buyPermit.permit },
    );
    expect(bought).toMatchObject({ status: 'accepted', tradeId: 700, price: 900 });
    expect(fake.inspectCapabilities().coins).toBe(4100);
    expect(fake.inspectPurchase({ id: 70, definitionId: 8401, price: 900 })).toMatchObject({ status: 'loaded', candidate: { item: { pile: 'unassigned' } } });
    const routePermit = await fake.acquireRequestPermit('purchase-route');
    await expect(fake.routePurchasedItem({ id: 70 }, 'club', { requestPermit: routePermit.permit }))
      .resolves.toMatchObject({ status: 'completed', item: { pile: 'club' } });
    expect(JSON.parse(JSON.stringify({ search, bought }))).toEqual({ search, bought });
  });

  it('normalizes exact EA market search, Buy Now reconciliation and routing without leaking live items', async () => {
    const marketItem = {
      id: 70,
      definitionId: 8401,
      type: 'player',
      rating: 84,
      rareflag: 1,
      purchasePrice: 900,
      privateMarketToken: 'must-not-leak',
      _auction: {
        tradeId: 700,
        buyNowPrice: 900,
        expires: 120,
        isActiveTrade: () => true,
        privateAuctionToken: 'must-not-leak',
      },
    };
    const runtime = eaRuntime({ id: 10, definitionId: 20 });
    const club = [];
    const unassigned = [];
    let cleared = 0;
    runtime.SearchType = { PLAYER: 'player' };
    runtime.SearchCategory = { ANY: 'any' };
    runtime.ItemPile = { TRANSFER: 'transfer', UNASSIGNED: 'unassigned', CLUB: 'club' };
    runtime.repositories.Item.club = { items: { _collection: club } };
    runtime.repositories.Item.getUnassignedItems = () => unassigned;
    runtime.services.Item.clearTransferMarketCache = () => { cleared += 1; };
    runtime.services.Item.searchTransferMarket = (criteria, page) => ({
      observe(context, callback) {
        expect(criteria).toMatchObject({ defId: [8401], type: 'player', category: 'any', maxBuy: 1000 });
        expect(page).toBe(1);
        callback({ unobserve() {} }, { success: true, status: 200, data: { items: [marketItem] }, privateResponse: 'must-not-leak' });
      },
    });
    runtime.services.Item.bid = (target, price) => ({
      observe(context, callback) {
        expect(target).toBe(marketItem);
        expect(price).toBe(900);
        unassigned.push(target);
        callback({ unobserve() {} }, { success: true, status: 200, privateBid: 'must-not-leak' });
      },
    });
    runtime.services.Item.requestUnassignedItems = () => ({
      observe(context, callback) {
        callback({ unobserve() {} }, { success: true, status: 200, privatePile: 'must-not-leak' });
      },
    });
    runtime.services.Item.move = (target, pile) => ({
      observe(context, callback) {
        expect(target).toBe(marketItem);
        expect(pile).toBe('club');
        unassigned.splice(unassigned.indexOf(target), 1);
        club.push(target);
        callback({ unobserve() {} }, { success: true, status: 200, privateMove: 'must-not-leak' });
      },
    });

    const adapter = createEaTradeAdapter(runtime);
    expect(adapter.inspectUnassignedReadiness()).toEqual({ ready: true, count: 0, reason: null });
    const search = await adapter.searchMarket({ definitionId: 8401, maxBuyNow: 1000, page: 1 });
    expect(cleared).toBe(1);
    expect(search).toMatchObject({
      status: 'completed',
      request: { definitionId: 8401, maxBuyNow: 1000, page: 1 },
      candidates: [{
        item: { id: 70, definitionId: 8401, pile: 'market' },
        rating: 84,
        auction: { state: 'active', tradeId: 700, buyNowPrice: 900 },
      }],
    });
    const buyPermit = await adapter.acquireRequestPermit('buy');
    const bought = await adapter.buyNowItem(
      { id: 70, definitionId: 8401, tradeId: 700 },
      900,
      { requestPermit: buyPermit.permit },
    );
    expect(bought).toMatchObject({ status: 'accepted', tradeId: 700, price: 900 });
    await expect(adapter.refreshPurchaseState()).resolves.toMatchObject({ status: 'completed' });
    expect(adapter.inspectPurchase({ id: 70 })).toMatchObject({
      status: 'loaded', candidate: { item: { id: 70, definitionId: 8401, pile: 'unassigned' } }, purchasePrice: 900,
    });
    expect(adapter.inspectDefinitionOwnership(8401)).toEqual({ definitionId: 8401, club: 0, transfer: 0, unassigned: 1, storage: 0 });
    expect(adapter.inspectDefinitionOwnerships([8401, 9999])).toEqual({
      8401: { definitionId: 8401, club: 0, transfer: 0, unassigned: 1, storage: 0 },
      9999: { definitionId: 9999, club: 0, transfer: 0, unassigned: 0, storage: 0 },
    });
    expect(adapter.inspectUnassignedReadiness()).toEqual({ ready: false, count: 1, reason: 'unassigned-not-empty' });
    const routePermit = await adapter.acquireRequestPermit('purchase-route');
    await expect(adapter.routePurchasedItem(
      { id: 70, definitionId: 8401, tradeId: 700 },
      'club',
      { requestPermit: routePermit.permit },
    ))
      .resolves.toMatchObject({ status: 'completed', item: { pile: 'club' }, destination: 'club' });
    expect(adapter.inspectPurchase({ id: 70, pile: 'club' })).toMatchObject({ status: 'loaded', candidate: { item: { pile: 'club' } } });
    expect(adapter.inspectUnassignedReadiness()).toEqual({ ready: true, count: 0, reason: null });

    const serialized = JSON.stringify({ search, bought });
    expect(serialized).not.toContain('must-not-leak');
    expect(JSON.parse(serialized)).toEqual({ search, bought });
  });

  it('fails closed when an EA Buy Now reference was not returned by the exact adapter search', async () => {
    const adapter = createEaTradeAdapter(eaRuntime({ id: 10, definitionId: 20 }));
    await expect(adapter.buyNowItem({ id: 70, definitionId: 8401, tradeId: 700 }, 900)).resolves.toEqual({
      status: 'not-found', item: null, tradeId: 700, price: 900, response: null, error: null,
    });
  });

  it('rejects a mismatched definition and invalidates live items after the next market response', async () => {
    const first = {
      id: 70, definitionId: 8401, type: 'player', rating: 84, rareflag: 1,
      _auction: { tradeId: 700, buyNowPrice: 900, isActiveTrade: () => true },
    };
    const second = {
      id: 71, definitionId: 8402, type: 'player', rating: 84, rareflag: 1,
      _auction: { tradeId: 701, buyNowPrice: 950, isActiveTrade: () => true },
    };
    const runtime = eaRuntime({ id: 10, definitionId: 20 });
    runtime.services.Item.clearTransferMarketCache = () => {};
    runtime.services.Item.searchTransferMarket = (criteria) => ({
      observe(context, callback) {
        callback({ unobserve() {} }, { success: true, data: { items: criteria.defId[0] === 8401 ? [first] : [second] } });
      },
    });
    const adapter = createEaTradeAdapter(runtime);
    await adapter.searchMarket({ definitionId: 8401, maxBuyNow: 1000 });
    await expect(adapter.buyNowItem({ id: 70, definitionId: 9999, tradeId: 700 }, 900))
      .resolves.toMatchObject({ status: 'mismatch', error: { kind: 'definition-mismatch' } });
    await adapter.searchMarket({ definitionId: 8402, maxBuyNow: 1000 });
    await expect(adapter.buyNowItem({ id: 70, definitionId: 8401, tradeId: 700 }, 900))
      .resolves.toMatchObject({ status: 'not-found' });
  });

  it('normalizes the EA list observable without exposing the live item', async () => {
    const item = { id: 10, definitionId: 20 };
    const runtime = eaRuntime(item);
    runtime.services.Item.list = (target, startPrice, buyNow, durationSeconds) => ({
      observe(context, callback) {
        expect(target).toBe(item);
        expect({ startPrice, buyNow, durationSeconds }).toEqual({ startPrice: 700, buyNow: 750, durationSeconds: 3600 });
        callback({ unobserve() {} }, { success: true, status: 200, privateItem: target });
      },
    });
    const adapter = createEaTradeAdapter(runtime);
    const listPermit = await adapter.acquireRequestPermit('list');
    const result = await adapter.listItem(
      { id: 10, definitionId: 20, pile: 'transfer' },
      { startPrice: 700, buyNow: 750, durationSeconds: 3600 },
      { requestPermit: listPermit.permit },
    );
    expect(result).toEqual({
      status: 'accepted',
      item: { id: 10, definitionId: 20, pile: 'transfer' },
      requested: { startPrice: 700, buyNow: 750, durationSeconds: 3600 },
      response: { success: true, status: 200, code: null },
      error: null,
    });
    expect(JSON.stringify(result)).not.toContain('privateItem');
  });

  it('preserves a top-level EA 427 status when the nested error has no code', async () => {
    const item = { id: 10, definitionId: 20 };
    const runtime = eaRuntime(item);
    runtime.services.Item.list = () => ({
      observe(context, callback) {
        callback({ unobserve() {} }, {
          success: false,
          status: 427,
          error: { message: 'Auction operation blocked', privateToken: 'secret' },
        });
      },
    });
    const adapter = createEaTradeAdapter(runtime);
    const listPermit = await adapter.acquireRequestPermit('list');
    const result = await adapter.listItem(
      { id: 10, definitionId: 20, pile: 'transfer' },
      { startPrice: 700, buyNow: 750, durationSeconds: 3600 },
      { requestPermit: listPermit.permit },
    );
    expect(result).toMatchObject({
      status: 'rejected',
      response: { success: false, status: 427, code: null, message: 'Auction operation blocked' },
      error: { kind: 'auction-operation-blocked', code: 427, action: 'stop-and-require-manual-reset' },
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('reports missing runtime capabilities without throwing', () => {
    const result = createEaTradeAdapter({}).inspectCapabilities();
    expect(result.runtimeReady).toBe(false);
    expect(result.canTrade).toBe(false);
    expect(result.coins).toBeNull();
    expect(result.transferCapacity).toEqual({ used: null, max: null, free: null });
    expect(result.warnings).toEqual(expect.arrayContaining([
      'EA Item service is unavailable',
      'EA Item repository is unavailable',
      'EA user session is unavailable',
      'UTSearchCriteriaDTO is unavailable',
    ]));
  });

  it('blocks a network request before the EA service when shared pacing is cooling down', async () => {
    const runtime = eaRuntime({ id: 10, definitionId: 20 });
    let calls = 0;
    runtime.services.Item.requestTransferItems = () => { calls += 1; return { success: true }; };
    const requestPacer = {
      acquire: async () => ({ allowed: false, reason: 'trade-rate-limit-cooldown', retryAt: 5000 }),
    };
    const adapter = createEaTradeAdapter(runtime, { requestPacer });
    expect(adapter.inspectCapabilities().runtimeReady).toBe(true);
    await expect(adapter.refreshTransferItems()).resolves.toEqual({
      status: 'blocked',
      response: null,
      error: {
        kind: 'rate-limit',
        code: 429,
        action: 'stop-and-cooldown',
        retryAt: 5000,
      },
    });
    expect(calls).toBe(0);
  });

  it('requires an action-bound one-use permit for every EA trade mutation', async () => {
    const item = { id: 10, definitionId: 20 };
    const runtime = eaRuntime(item);
    let listCalls = 0;
    runtime.services.Item.list = () => {
      listCalls += 1;
      return { success: true };
    };
    const adapter = createEaTradeAdapter(runtime);
    const listing = { startPrice: 700, buyNow: 750, durationSeconds: 3600 };

    await expect(adapter.listItem(item, listing)).resolves.toMatchObject({
      status: 'blocked', error: { kind: 'invalid-request-permit' },
    });
    const wrongAction = await adapter.acquireRequestPermit('buy');
    await expect(adapter.listItem(item, listing, { requestPermit: wrongAction.permit })).resolves.toMatchObject({
      status: 'blocked', error: { kind: 'invalid-request-permit' },
    });
    const permit = await adapter.acquireRequestPermit('list');
    await expect(adapter.listItem(item, listing, { requestPermit: permit.permit })).resolves.toMatchObject({ status: 'accepted' });
    await expect(adapter.listItem(item, listing, { requestPermit: permit.permit })).resolves.toMatchObject({
      status: 'blocked', error: { kind: 'invalid-request-permit' },
    });
    expect(listCalls).toBe(1);
  });

  it('normalizes one aggregate EA Re-list All observable and consumes its permit once', async () => {
    const runtime = eaRuntime({ id: 10, definitionId: 20 });
    let relistCalls = 0;
    runtime.services.Item.relistExpiredAuctions = () => {
      relistCalls += 1;
      return {
        observe(context, callback) {
          callback({ unobserve() {} }, {
            success: true,
            status: 200,
            privateItems: [{ id: 10, token: 'must-not-leak' }],
          });
        },
      };
    };
    const adapter = createEaTradeAdapter(runtime);

    await expect(adapter.relistExpiredAuctions()).resolves.toMatchObject({
      status: 'blocked', error: { kind: 'invalid-request-permit' },
    });
    const wrongAction = await adapter.acquireRequestPermit('list');
    await expect(adapter.relistExpiredAuctions({ requestPermit: wrongAction.permit })).resolves.toMatchObject({
      status: 'blocked', error: { kind: 'invalid-request-permit' },
    });
    const permit = await adapter.acquireRequestPermit('bulk-relist');
    const accepted = await adapter.relistExpiredAuctions({ requestPermit: permit.permit });
    expect(accepted).toEqual({
      status: 'accepted',
      response: { success: true, status: 200, code: null },
      error: null,
    });
    expect(JSON.stringify(accepted)).not.toContain('must-not-leak');
    await expect(adapter.relistExpiredAuctions({ requestPermit: permit.permit })).resolves.toMatchObject({
      status: 'blocked', error: { kind: 'invalid-request-permit' },
    });
    expect(relistCalls).toBe(1);
  });

  it('records an EA 429 response in shared pacing without retrying the action', async () => {
    const runtime = eaRuntime({ id: 10, definitionId: 20 });
    let calls = 0;
    runtime.services.Item.requestTransferItems = () => { calls += 1; return { success: false, status: 429 }; };
    const requestPacer = {
      acquire: vi.fn(async () => ({ allowed: true })),
      recordRateLimit: vi.fn(async () => ({ status: 'cooldown', retryAt: 61000 })),
      recordSuccess: vi.fn(),
    };
    const adapter = createEaTradeAdapter(runtime, {
      requestPacer,
      pacingContext: {
        policy: { initialRateLimitCooldownSeconds: 60, maximumRateLimitCooldownSeconds: 1800 },
      },
    });

    await expect(adapter.refreshTransferItems()).resolves.toMatchObject({
      status: 'rejected', error: { kind: 'rate-limit', code: 429, action: 'stop-and-cooldown' },
    });
    expect(calls).toBe(1);
    expect(requestPacer.recordRateLimit).toHaveBeenCalledWith('transfer-refresh', {
      initialCooldownSeconds: 60,
      maximumCooldownSeconds: 1800,
    });
    expect(requestPacer.recordSuccess).not.toHaveBeenCalled();
  });

  it('is composed lazily by the Runtime Adapter factory', () => {
    const storage = { getItem: () => null, setItem() {}, removeItem() {}, get length() { return 0; } };
    const adapters = createRuntimeAdapters({ localStorage: storage, sessionStorage: storage, document: {} });
    expect(adapters.trade().inspectCapabilities()).toMatchObject({ runtimeReady: false, canTrade: false });
  });
});
