import { afterEach, expect, it, vi } from 'vitest';
import { executionRuntime } from '../helpers/fc27-execution-runtime.js';
import { createFc27GalleryListing } from '../../src/adapters/browser/fc27-gallery-listing.js';
import { readFc27Context } from '../../src/adapters/ea/fc27-local-read.js';
import { traditionalJournalScope } from '../../src/fc27/traditional-journal.js';
import { galleryPurchaseKey } from '../../src/gallery/purchase-session.js';

afterEach(() => vi.restoreAllMocks());

it('previews and lists all eligible exact set entities without reading purchase history or forging receipts', async () => {
  const f = fixture();
  const refs = [11, 12, 13, 14].map(id => ({ id, definitionId: 111, pile: id === 12 ? 'transfer' : 'club' }));
  const inventory = { scan: vi.fn(async () => refs), resolve: () => null, validate: vi.fn(async () => {}) };
  f.deps.purchase.inspect = vi.fn(async () => { throw Error('must not use purchases'); });
  const inspect = f.adapter.inspectListingItem;
  f.adapter.inspectListingItem = ref => {
    const value = inspect(ref);
    if (ref.id === 13) value.candidate.tradeable = false;
    if (ref.id === 14) value.candidate.auction.state = 'active';
    return value;
  };
  const service = createFc27GalleryListing({ ...f.deps, inventoryFactory: () => inventory });
  const target = { source: 'futgg', set: { id: 'futgg:1', name: 'Set' }, pool: { items: [{ eaId: 111 }] } };
  expect(await service.prepare({ target })).toMatchObject({ status: 'ready', candidates: [
    { item: refs[0], purchase: null }, { item: refs[1], purchase: null },
  ] });
  expect(f.adapter.listItem).not.toHaveBeenCalled();
  const plan = service.plan({ selectedIds: [11, 12], settings: f.settings });
  expect(await service.saveSchedule({ approved: true, plan })).toMatchObject({ reason: 'FC27_GALLERY_LISTING_SET_SCHEDULE_UNSUPPORTED' });
  expect(await service.execute({ approved: true, plan, settings: f.settings, isCurrent: () => true })).toMatchObject({ status: 'completed', accepted: 2 });
  expect(inventory.validate).toHaveBeenCalledWith(refs[0]);
  expect(f.deps.purchase.inspect).not.toHaveBeenCalled();
  expect(await service.inspect()).toMatchObject({ source: { kind: 'set', setId: 'futgg:1' },
    entries: [{ purchaseTradeId: null }, { purchaseTradeId: null }] });
});

it('does not list when a set entity disappears at final live validation', async () => {
  const f = fixture(), ref = { id: 11, definitionId: 111, pile: 'club' };
  const service = createFc27GalleryListing({ ...f.deps, inventoryFactory: () => ({
    scan: async () => [ref], resolve: () => null,
    validate: async () => { throw Error('FC27_GALLERY_LISTING_ITEM_CHANGED'); },
  }) });
  await service.prepare({ target: { source: 'futgg', set: { id: 'futgg:1' } } });
  const plan = service.plan({ selectedIds: [11], settings: f.settings });
  expect(await service.execute({ approved: true, plan, settings: f.settings, isCurrent: () => true }))
    .toMatchObject({ reason: 'FC27_GALLERY_LISTING_ITEM_CHANGED' });
  expect(f.adapter.listItem).not.toHaveBeenCalled();
});

it('resumes an interrupted set listing across reload without requiring a purchase journal', async () => {
  const f = fixture(), ref = { id: 11, definitionId: 111, pile: 'club' };
  const deps = { ...f.deps, inventoryFactory: () => ({ scan: async () => [ref], resolve: () => null, hydrate: async () => true, validate: async () => {} }) };
  const service = createFc27GalleryListing(deps);
  const target = { source: 'futgg', set: { id: 'futgg:1' } };
  await service.prepare({ target }); const plan = service.plan({ selectedIds: [11], settings: f.settings });
  f.adapter.acquireRequestPermit = async () => ({ status: 'blocked' });
  expect(await service.execute({ approved: true, plan, settings: f.settings, isCurrent: () => true })).toMatchObject({ status: 'partial' });
  const next = createFc27GalleryListing(deps);
  const old = await next.prepare({ target }); expect(old.status).toBe('resume-required');
  f.adapter.acquireRequestPermit = async () => ({ status: 'acquired', permit: {} });
  expect(await next.execute({ approved: true, resume: true, expectedRunId: old.runId, isCurrent: () => true }))
    .toMatchObject({ status: 'completed', accepted: 1 });
});

it('records a terminal summary only after exact active-auction readback and journal confirmation', async () => {
  const f = fixture(), diagnosticLog = { record: vi.fn(async () => true) };
  const service = createFc27GalleryListing({ ...f.deps, diagnosticLog });
  await service.prepare();
  const plan = service.plan({ selectedIds: [11], settings: f.settings });
  expect(await service.execute({ approved: true, plan, settings: f.settings, isCurrent: () => true }))
    .toMatchObject({ status: 'completed', accepted: 1 });
  expect(diagnosticLog.record).toHaveBeenCalledWith(expect.objectContaining({ event: 'listing-result', status: 'completed',
    acceptedCount: 1, rejectedCount: 0, skippedCount: 0, unknownCount: 0, requestedCount: 1 }));
  const g = fixture(), unknownLog = { record: vi.fn(async () => true) };
  const unknownService = createFc27GalleryListing({ ...g.deps, diagnosticLog: unknownLog });
  await unknownService.prepare(); const unknownPlan = unknownService.plan({ selectedIds: [11], settings: g.settings });
  g.adapter.listItem.mockResolvedValue({ status: 'unknown' });
  await unknownService.execute({ approved: true, plan: unknownPlan, settings: g.settings, isCurrent: () => true });
  expect(unknownLog.record).toHaveBeenCalledWith(expect.objectContaining({ event: 'listing-result',
    acceptedCount: 0, unknownCount: 1 }));
});

it('does not change a confirmed listing when terminal diagnostics throw', async () => {
  const f = fixture();
  const service = createFc27GalleryListing({ ...f.deps, diagnosticLog: { record: () => { throw Error('offline'); } } });
  await service.prepare(); const plan = service.plan({ selectedIds: [11], settings: f.settings });
  expect(await service.execute({ approved: true, plan, settings: f.settings, isCurrent: () => true }))
    .toMatchObject({ status: 'completed', accepted: 1 });
  expect(f.adapter.listItem).toHaveBeenCalledTimes(1);
});

it('writes only read-back-confirmed accepted listings to the accounting adapter', async () => {
  const f = fixture(), accounting = { recordListings: vi.fn(async entries => ({ status: 'observed', entries })) };
  const service = createFc27GalleryListing({ ...f.deps, accounting });
  await service.prepare(); const plan = service.plan({ selectedIds: [11], settings: f.settings });
  expect(await service.execute({ approved: true, plan, settings: f.settings, isCurrent: () => true }))
    .toMatchObject({ status: 'completed', accepted: 1 });
  expect(accounting.recordListings).toHaveBeenCalledWith([expect.objectContaining({ status: 'accepted', listingTradeId: '9999', buyNow: 200 })]);
});

function fixture() {
  let at = 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => at);
  const { root } = executionRuntime(), values = new Map(), locks = new Set(), listed = new Map();
  const context = readFc27Context(root), scope = traditionalJournalScope(context);
  root.navigator = { locks: { request: async (name, _options, task) => {
    if (locks.has(name)) return task(null);
    locks.add(name); try { return await task({ name, mode: 'exclusive' }); } finally { locks.delete(name); }
  } } };
  root.crypto.randomUUID = () => 'listing-run';
  const snapshot = { status: 'observed', operationId: 'purchase-1', binding: 'purchase-bind' };
  const record = { schema: 1, scope, context, operationId: snapshot.operationId, binding: snapshot.binding,
    plan: [{ definitionId: 111 }], entries: [{ definitionId: 111, itemId: 11, tradeId: '9011', price: 200, state: 'club' }], collection: { status: 'confirmed' } };
  values.set(galleryPurchaseKey(scope), record);
  const adapter = {
    refreshPurchaseState: vi.fn(async () => ({ status: 'completed' })),
    refreshTransferItems: vi.fn(async () => ({ status: 'completed' })),
    inspectListingItem: ref => ({ status: 'loaded', candidate: { item: { ...ref }, tradeable: true,
      evolution: false, limitedUse: false, concept: false, academyEnrolled: false,
      auction: listed.get(ref.id) ?? { state: 'none' } } }),
    inspectCapabilities: () => ({ transferCapacity: { free: 100 } }),
    inspectPriceLimits: async () => ({ status: 'loaded', refreshStatus: 'completed', after: { minimum: 150, maximum: 1000 } }),
    acquireRequestPermit: async () => ({ status: 'acquired', permit: {} }),
    listItem: vi.fn(async (ref, entry) => {
      listed.set(ref.id, { state: 'active', tradeId: '9999', startingBid: entry.startPrice, buyNowPrice: entry.buyNow });
      return { status: 'accepted', response: { success: true, status: 200 } };
    }),
  };
  const deps = { root, gmGetValue: (key, fallback) => structuredClone(values.get(key) ?? fallback),
    gmSetValue: (key, value) => { values.set(key, structuredClone(value)); },
    purchase: { inspect: async () => structuredClone(snapshot) }, liveEnabled: true, schedulingEnabled: true,
    adapterFactory: () => adapter, loadPrices: async () => ({ freshPrices: { 111: 200 }, expiresAt: 100000 }), sleep: async () => {} };
  deps.readPriceLimits = async (_root, refs) => Object.fromEntries(await Promise.all(refs.map(async ref => {
    const result = await adapter.inspectPriceLimits(ref);
    return [ref.id, { status: result?.status ?? 'unknown', ...result?.after }];
  })));
  const service = createFc27GalleryListing(deps);
  const settings = { priceMode: 'fixed', fixedPrice: 200, fixedStartPrice: 150, durationSeconds: 3600 };
  const prepare = async () => { expect((await service.prepare()).status).toBe('ready'); return service.plan({ selectedIds: [11], settings }); };
  const save = async () => { const plan = await prepare();
    expect((await service.saveSchedule({ approved: true, plan, settings, schedule: { type: 'once', runAt: 2000 } })).status).toBe('saved');
    expect((await service.armSchedule({ approved: true })).status).toBe('armed'); return plan; };
  return { service, deps, adapter, snapshot, values, record, scope, settings, prepare, save, advance: value => { at = value; } };
}

it('runs a due saved batch through prepare, frozen prices and the real listing journal only once', async () => {
  const f = fixture(); await f.save(); f.advance(2010);
  const result = await f.service.tickSchedule({ approved: true });
  expect(result).toMatchObject({ status: 'completed', accepted: 1 });
  expect(f.adapter.listItem).toHaveBeenCalledTimes(1);
  expect(await createFc27GalleryListing(f.deps).tickSchedule({ approved: true })).toMatchObject({ status: 'completed' });
  expect(f.adapter.listItem).toHaveBeenCalledTimes(1);
});
it('carries two-source quotes and the independent listing base into the frozen preview', async () => {
  const f = fixture();
  f.deps.root.UTCurrencyInputControl = { PRICE_TIERS: [{ min: 1000, inc: 100 }, { min: 0, inc: 50 }] };
  f.deps.loadPrices = vi.fn(async () => ({ freshPrices: { 111: 700 }, expiresAt: 100000,
    listingPriceSource: 'futbin', requestedSources: ['futgg', 'futbin'], references: {
      111: { quotes: { futgg: { price: 400, expiresAt: 100000, error: null }, futbin: { price: 700, expiresAt: 100000, error: null } } },
    } }));
  const service = createFc27GalleryListing(f.deps), prepared = await service.prepare();
  expect(prepared).toMatchObject({ source: 'FUTBIN', listingPriceSource: 'futbin', prices: { 111: 700 },
    pricesBySource: { 111: { futgg: 400, futbin: 700 } } });
  const plan = service.plan({ selectedIds: [11], settings: { priceMode: 'percentage', percentageRange: [100, 100] } });
  expect(plan.entries[0]).toMatchObject({ buyNow: 700, startPrice: 650, marketPrice: 700 });
  expect(f.adapter.listItem).not.toHaveBeenCalled();
});

it('cannot save an arbitrary or altered plan outside the current prepared batch', async () => {
  const f = fixture(); const plan = await f.prepare(); plan.entries[0].buyNow = 600;
  expect(await f.service.saveSchedule({ approved: true, plan, schedule: { type: 'once', runAt: 2000 } }))
    .toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_LISTING_PLAN_CHANGED' });
});

it('does not arm a schedule after the purchase batch changes', async () => {
  const f = fixture(); await f.save(); await f.service.disarmSchedule(); f.snapshot.operationId = 'purchase-2';
  expect(await f.service.armSchedule({ approved: true })).toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_LISTING_PURCHASE_CHANGED' });
  expect(f.adapter.listItem).not.toHaveBeenCalled();
});

it('stops if the purchase changes while preparing the scheduled plan', async () => {
  const f = fixture(); await f.save(); f.advance(2000);
  f.adapter.refreshTransferItems.mockImplementation(async () => { f.snapshot.operationId = 'purchase-2'; return { status: 'completed' }; });
  expect((await f.service.tickSchedule({ approved: true })).status).toBe('blocked');
  expect(f.adapter.listItem).not.toHaveBeenCalled();
});

it('keeps unknown outcomes for explicit recovery rather than scheduling another mutation', async () => {
  const f = fixture(); await f.save(); f.advance(2000);
  f.adapter.listItem.mockResolvedValue({ status: 'unknown' });
  expect((await f.service.tickSchedule({ approved: true })).status).toBe('partial');
  expect((await createFc27GalleryListing(f.deps).tickSchedule({ approved: true })).status).toBe('blocked');
  expect(f.adapter.listItem).toHaveBeenCalledTimes(1);
});

it('serializes competing scheduled ticks across service instances', async () => {
  const f = fixture(); await f.save(); f.advance(2000);
  const results = await Promise.all([f.service.tickSchedule({ approved: true }), createFc27GalleryListing(f.deps).tickSchedule({ approved: true })]);
  expect(results.filter(result => result.status === 'completed')).toHaveLength(1);
  expect(f.adapter.listItem).toHaveBeenCalledTimes(1);
});

it('rechecks the purchase binding after waiting for an EA request permit', async () => {
  const f = fixture(); await f.save(); f.advance(2000);
  f.adapter.acquireRequestPermit = async () => {
    f.snapshot.binding = 'replacement'; return { status: 'acquired', permit: {} };
  };
  expect(await f.service.tickSchedule({ approved: true }))
    .toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_LISTING_PURCHASE_CHANGED' });
  expect(f.adapter.listItem).not.toHaveBeenCalled();
});

it('does not let a competing service disarm or replace a claimed occurrence', async () => {
  const f = fixture(); await f.save(); f.advance(2000);
  const competitor = createFc27GalleryListing(f.deps);
  let disarmed;
  f.adapter.refreshTransferItems.mockImplementationOnce(async () => {
    disarmed = await competitor.disarmSchedule(); return { status: 'completed' };
  });
  expect((await f.service.tickSchedule({ approved: true })).status).toBe('completed');
  expect(disarmed).toMatchObject({ status: 'blocked', reason: 'FC27_EXCLUSIVE_ACCESS_UNAVAILABLE' });
  expect(f.adapter.listItem).toHaveBeenCalledTimes(1);
});

it('does not run a manual preview against a replacement purchase batch', async () => {
  const f = fixture(); const plan = await f.prepare(); f.snapshot.operationId = 'replacement';
  expect(await f.service.execute({ approved: true, plan, settings: f.settings, isCurrent: () => true }))
    .toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_LISTING_PURCHASE_CHANGED' });
  expect(f.adapter.listItem).not.toHaveBeenCalled();
});

it('prepares a new purchase batch without resuming an unrelated old listing', async () => {
  const f = fixture(), first = await f.prepare();
  f.adapter.listItem.mockResolvedValueOnce({ status: 'unknown' });
  await f.service.execute({ approved: true, plan: first, settings: f.settings, isCurrent: () => true });
  expect((await f.service.prepare()).status).toBe('resume-required');
  f.snapshot.operationId = 'purchase-2';
  f.record.operationId = 'purchase-2'; f.record.entries[0].itemId = 22;
  expect(await f.service.prepare()).toMatchObject({ status: 'ready', candidates: [{ item: { id: 22 } }] });
  expect(f.adapter.listItem).toHaveBeenCalledTimes(1);
});

it('returns an explicit old listing read failure without issuing EA requests', async () => {
  const f = fixture();
  const service = createFc27GalleryListing({ ...f.deps, gmGetValue: (key, fallback) => {
    if (key.startsWith('fcat-fc27-gallery-bulk-list-v1:')) throw Error('storage offline');
    return f.deps.gmGetValue(key, fallback);
  } });
  expect(await service.prepare()).toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_BULK_LIST_JOURNAL_READ_FAILED' });
  expect(f.adapter.refreshTransferItems).not.toHaveBeenCalled();
  expect(f.adapter.listItem).not.toHaveBeenCalled();
});

it('persists a missed occurrence so reload cannot arm it again', async () => {
  const f = fixture(); await f.save(); f.advance(40000);
  expect((await f.service.tickSchedule({ approved: true })).status).toBe('missed');
  await f.service.disarmSchedule();
  expect((await createFc27GalleryListing(f.deps).armSchedule({ approved: true })).status).toBe('blocked');
  expect(f.adapter.listItem).not.toHaveBeenCalled();
});

it('does not expose background schedule mutation until shared Scheduler authorization is wired', async () => {
  const f = fixture();
  const service = createFc27GalleryListing({ ...f.deps, schedulingEnabled: false });
  expect(service.scheduleCapability()).toMatchObject({ enabled: false, reason: 'FC27_GALLERY_LISTING_SCHEDULER_PENDING' });
  expect(await service.pollSchedule()).toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_LISTING_SCHEDULER_PENDING' });
  expect(await service.armSchedule({ approved: true })).toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_LISTING_SCHEDULER_PENDING' });
  expect(await service.tickSchedule({ approved: true })).toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_LISTING_SCHEDULER_PENDING' });
  expect(await service.saveSchedule({ approved: true })).toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_LISTING_SCHEDULER_PENDING' });
  expect(f.adapter.refreshTransferItems).not.toHaveBeenCalled();
  expect(f.adapter.listItem).not.toHaveBeenCalled();
  expect((await service.prepare()).status).toBe('ready');
  const plan = service.plan({ selectedIds: [11], settings: f.settings });
  expect(await service.execute({ approved: true, plan, settings: f.settings, isCurrent: () => true }))
    .toMatchObject({ status: 'completed', accepted: 1 });
});

it('matches Enhancer persistence: retains preferences but not session-only fixed prices', async () => {
  const f = fixture();
  await f.service.writeSettings({ ...f.settings, delaySeconds: [3, 5] });
  expect(await createFc27GalleryListing(f.deps).readSettings()).toMatchObject({
    priceMode: 'fixed', fixedPrice: null, fixedStartPrice: null, durationSeconds: 3600, delaySeconds: [3, 5],
  });
});

it('does not replace receipt cost with EA lastSalePrice', async () => {
  const f = fixture();
  f.deps.root.repositories.Item.club.items._collection[11] = { id: 11, definitionId: 111, lastSalePrice: 9999 };
  expect(await f.service.prepare()).toMatchObject({ candidates: [{ boughtFor: 200 }] });
});

it.each([
  [{ lastSalePrice: 750, owners: 2 }, 750, 'ea'],
  [{ lastSalePrice: 0, owners: 1 }, null, 'first-owner'],
  [{ lastSalePrice: 0, owners: 2 }, null, 'unknown'],
  [{ owners: 2 }, null, 'unknown'],
  [{ lastSalePrice: -1, owners: 2 }, null, 'unknown'],
  [{ definitionId: 999, lastSalePrice: 750, owners: 2 }, null, 'unknown'],
  [{ id: 12, lastSalePrice: 750, owners: 2 }, null, 'unknown'],
])('projects native sellable purchase cost without inventing a purchase receipt: %j', async (fields, boughtFor, boughtForSource) => {
  const f = fixture(), ref = { id: 11, definitionId: 111, pile: 'club' };
  const item = { ...ref, ...fields };
  const service = createFc27GalleryListing({ ...f.deps, inventoryFactory: () => ({
    scan: async () => [ref], resolve: () => ({ item }),
  }) });
  expect(await service.prepare({ target: { source: 'futgg', set: { id: 'futgg:1' } } }))
    .toMatchObject({ status: 'ready', candidates: [{ boughtFor, boughtForSource, purchase: null }] });
  expect(f.adapter.listItem).not.toHaveBeenCalled();
});

it('uses each Transfer entity cost even for two copies of the same version', async () => {
  const f = fixture(), refs = [11, 12].map(id => ({ id, definitionId: 111, pile: 'transfer' }));
  f.deps.root.repositories.Item.transfer = refs.map((ref, index) => ({ ...ref, lastSalePrice: 400 + index * 150, owners: 2 }));
  const service = createFc27GalleryListing({ ...f.deps, inventoryFactory: () => ({
    scan: async () => refs, resolve: () => null,
  }) });
  expect(await service.prepare({ target: { source: 'futgg', set: { id: 'futgg:1' } } }))
    .toMatchObject({ status: 'ready', candidates: [{ boughtFor: 400, purchase: null }, { boughtFor: 550, purchase: null }] });
});

it('keeps a market preview distinct from manual overrides and rejects it after quote expiry', async () => {
  const f = fixture();
  f.deps.root.UTCurrencyInputControl = { PRICE_TIERS: [{ min: 1000, inc: 100 }, { min: 150, inc: 50 }, { min: 0, inc: 150 }] };
  expect((await f.service.prepare()).status).toBe('ready');
  const plan = f.service.plan({ selectedIds: [11], settings: { priceMode: 'percentage', percentageRange: [100, 100] }, previewPrices: { 11: 200 } });
  expect(plan.entries[0]).toMatchObject({ buyNow: 200, priceOrigin: 'market' });
  f.advance(100001);
  expect(await f.service.execute({ approved: true, plan, settings: { priceMode: 'percentage' }, isCurrent: () => true }))
    .toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_LISTING_QUOTE_EXPIRED' });
  expect(f.service.plan({ selectedIds: [11], settings: { priceMode: 'percentage', percentageRange: [100, 100] }, previewPrices: { 11: 200 } }))
    .toMatchObject({ entries: [], skipped: [{ reason: 'market-price-expired' }] });
  expect(f.adapter.listItem).not.toHaveBeenCalled();
});


it('handles missing price-limit responses without losing the entire preparation stage', async () => {
  const f = fixture(), events = [];
  f.adapter.inspectPriceLimits = async () => undefined;
  const service = createFc27GalleryListing({ ...f.deps, diagnosticLog: { record: row => events.push(row) } });
  expect(await service.prepare()).toMatchObject({ status: 'ready' });
  expect(service.plan({ selectedIds: [11], settings: f.settings })).toMatchObject({ entries: [],
    skipped: [{ itemId: 11, reason: 'price-limits-unavailable' }] });
  expect(events).toContainEqual(expect.objectContaining({ event: 'listing-stage', phase: 'price-limits', status: 'unknown' }));
  expect(f.adapter.listItem).not.toHaveBeenCalled();
});

it('reports failed preparation phase and safely isolates diagnostic failures', async () => {
  const f = fixture(), events = [];
  f.adapter.refreshTransferItems.mockResolvedValue({ status: 'error', error: { code: 401 } });
  const service = createFc27GalleryListing({ ...f.deps, diagnosticLog: { record(row) { events.push(row); throw new Error('log'); } } });
  expect(await service.prepare()).toMatchObject({ status: 'blocked', phase: 'transfer-refresh', reason: 'FC27_GALLERY_TRANSFER_UNCONFIRMED' });
  expect(events).toContainEqual(expect.objectContaining({ phase: 'transfer-refresh', httpStatus: 401 }));
  expect(f.adapter.listItem).not.toHaveBeenCalled();
});

it('cancels a saved occurrence without requesting EA and leaves it disarmed after reload', async () => {
  const f = fixture(); await f.save();
  f.adapter.refreshTransferItems.mockClear();
  expect((await f.service.disarmSchedule('user-cancelled')).status).toBe('disarmed');
  f.advance(2000);
  expect((await createFc27GalleryListing(f.deps).pollSchedule()).status).toBe('disarmed');
  expect(f.adapter.refreshTransferItems).not.toHaveBeenCalled();
  expect(f.adapter.listItem).not.toHaveBeenCalled();
});

it('reports unavailable Web Locks without rejecting the UI promise or sending EA requests', async () => {
  const f = fixture(); const plan = await f.prepare();
  f.deps.root.navigator.locks.request = async () => { throw new Error('lock unavailable'); };
  expect(await f.service.saveSchedule({ approved: true, plan, settings: f.settings, schedule: { type: 'once', runAt: 2000 } }))
    .toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_LISTING_UNAVAILABLE' });
  expect(f.adapter.listItem).not.toHaveBeenCalled();
});
