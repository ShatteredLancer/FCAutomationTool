import { expect, it, vi } from 'vitest';
import { executionRuntime } from '../helpers/fc27-execution-runtime.js';
import { createFc27PublicPrices } from '../../src/adapters/browser/fc27-public-prices.js';
import { validatePurchasePriceApproval, purchaseApprovedPrice } from '../../src/fc27/purchase-price-approval.js';
import { futbinFiltered, futbinMinimalPC, futggPC } from '../fixtures/fc27-public-prices.js';
function fixture() {
  const { root } = executionRuntime(), data = new Map(); let time = Date.parse('2026-10-04T03:42:02Z');
  const gm = vi.fn(options => options.onload({ status: 200, responseText: JSON.stringify(options.url.includes('getFilteredPlayers') ? futbinFiltered : futbinMinimalPC) }));
  const transport = { getPrices: vi.fn(async () => ({ status: 200, text: JSON.stringify({ data: [futggPC.data[0]] }) })) };
  const service = createFc27PublicPrices({ root, gmRequest: gm, transport, now: () => time,
    get: async (key, fallback) => data.get(key) ?? fallback, set: async (key, value) => data.set(key, structuredClone(value)) });
  const player = { definitionId: 71494, rating: 80, nationId: 95, leagueId: 2221, teamId: 116308, preferredPosition: 12 };
  return { root, data, gm, transport, service, player, advance: () => { time += 300001; } };
}
it('reuses FSU ID/filter routes, retains both prices and never obtains EA market prices', async () => {
  const f = fixture();
  expect(await f.service.quote(f.player)).toMatchObject({ estimate: 650, maxBuy: 650, futbin: 700 });
  expect(f.gm.mock.calls[0][0]).toMatchObject({ anonymous: true, method: 'GET', timeout: 15000 });
  expect(f.gm.mock.calls[0][0].url).toContain('position=RM');
  await f.service.quote(f.player); expect(f.gm).toHaveBeenCalledTimes(1);
  f.advance(); await f.service.quote(f.player);
  expect(f.gm.mock.calls[1][0].url).toContain('fetchPlayerInformationMinimal?ID=994&platform=PC');
  await f.service.saveSettings({ source: 'futbin', premium: 50 });
  expect(await f.service.quote(f.player)).toMatchObject({ estimate: 700, maxBuy: 750 });
});
it('does not keep an omitted FUTBIN version as a new price', async () => {
  const f = fixture(); await f.service.quote(f.player); f.advance();
  f.gm.mockImplementation(options => options.onload({ status: 200, responseText: '{"data":[]}' }));
  expect((await f.service.quote(f.player)).futbin).toBeNull();
});
it('applies account quote lifetime to new reads without rewriting previous snapshots or approvals', async () => {
  const f = fixture(), ids = [f.player.definitionId];
  const original = await f.service.load(ids, { purpose: 'listing', rows: [f.player] });
  const fetchedAt = original.references[71494].quotes.futgg.fetchedAt;
  expect(original.expiresAt).toBe(fetchedAt + 300000);
  const record = { scope: f.service.scope(), entries: [{ definitionId: 71494, state: 'waiting' }],
    plan: [{ definitionId: 71494, priceReference: original.references[71494], pricePolicy: original.policy }] };
  const approval = await f.service.preparePurchase(record), frozen = JSON.stringify({ original, approval });
  f.advance();
  await f.service.saveSettings({ quoteValidityMinutes: 30 });
  for (const purpose of ['listing', 'puzzle', 'purchase']) {
    const result = await f.service.load(ids, { purpose, rows: [f.player], policy: original.policy });
    expect(result.expiresAt).toBe(fetchedAt + 1800000);
    expect(result.references[71494].quotes.futgg.fetchedAt).toBe(fetchedAt);
  }
  expect(f.transport.getPrices).toHaveBeenCalledTimes(1);
  expect(f.gm).toHaveBeenCalledTimes(1);
  expect(JSON.stringify({ original, approval })).toBe(frozen);
  expect(purchaseApprovedPrice(approval, 71494, { now: fetchedAt + 300001 }).reason).toBe('FC27_BUY_REFERENCE_PRICE_EXPIRED');
  await f.service.saveSettings({ quoteValidityMinutes: 1 });
  const refreshed = await f.service.load(ids, { purpose: 'listing', rows: [f.player] });
  expect(refreshed.expiresAt).toBe(fetchedAt + 300001 + 60000);
  expect(f.transport.getPrices).toHaveBeenCalledTimes(2);
  expect(f.gm).toHaveBeenCalledTimes(2);
});
it('does not send malformed filters when a player lacks required attributes', async () => {
  const f = fixture();
  expect((await f.service.quote({ definitionId: 71494 })).quotes.futbin.error).toBe('FC27_PUBLIC_PRICE_PLAYER_INVALID');
  expect(f.gm).not.toHaveBeenCalled();
  expect((await f.service.quote(f.player)).futbin).toBe(700);
  expect(f.gm).toHaveBeenCalledTimes(1);
});
it('honours source HTTP cooldown without converting it into an EA authentication error', async () => {
  const f = fixture(); f.transport.getPrices.mockResolvedValue({ status: 429, headers: { 'retry-after': '600' } });
  expect((await f.service.quote(f.player)).quotes.futgg.error).toBe('FC27_PUBLIC_PRICE_HTTP_429');
  await f.service.load([73562], { rows: [{ ...f.player, definitionId: 73562 }] });
  expect(f.transport.getPrices).toHaveBeenCalledTimes(1);
});

it('uses only the selected public source for Puzzle purpose loads', async () => {
  const f = fixture();
  const result = await f.service.load([f.player.definitionId], { purpose: 'puzzle', rows: [f.player] });
  expect(result.requestedSources).toEqual(['futgg']);
  expect(result.references[f.player.definitionId].quotes.futbin.error).toBe('FC27_PUBLIC_PRICE_SOURCE_NOT_REQUESTED');
  expect(f.transport.getPrices).toHaveBeenCalledTimes(1);
  expect(f.gm).not.toHaveBeenCalled();
});
it('routes a single-source preference and the shared purchase/listing reference correctly', async () => {
  const f = fixture();
  await f.service.saveSettings({ readSources: 'both', source: 'futbin', listingSource: 'futgg' });
  const listing = await f.service.load([71494], { purpose: 'listing', rows: [f.player] });
  expect(listing.requestedSources).toEqual(['futgg', 'futbin']);
  expect(listing.listingPriceSource).toBe('futbin');
  expect(listing.prices[71494]).toBe(700);
  expect(listing.references[71494].futbin).toBe(700);
  const futbinOnly = fixture();
  await futbinOnly.service.saveSettings({ readSources: 'futbin' });
  const result = await futbinOnly.service.load([71494], { purpose: 'gallery', rows: [futbinOnly.player] });
  expect(result.requestedSources).toEqual(['futbin']);
  expect(futbinOnly.transport.getPrices).not.toHaveBeenCalled();
  expect(futbinOnly.gm).toHaveBeenCalledTimes(1);
});
it('does not substitute FUTBIN when the shared FUT.GG reference has no quote', async () => {
  const f = fixture();
  f.transport.getPrices.mockResolvedValue({ status: 200, text: '{"data":[]}' });
  await f.service.saveSettings({ readSources: 'both', source: 'futgg', premium: 500 });
  const listing = await f.service.load([71494], { purpose: 'listing', rows: [f.player] });
  expect(listing.prices).toEqual({});
  expect(listing.references[71494]).toMatchObject({ futgg: null, futbin: 700, estimate: null });
  const purchase = await f.service.load([71494], { purpose: 'purchase', rows: [f.player] });
  expect(purchase.requestedSources).toEqual(['futgg']);
  expect(purchase.references[71494].maxBuy).toBeNull();
});
it('blocks a frozen FUT.GG policy after switching to FUTBIN without rewriting the old cap', async () => {
  const f = fixture(), policy = await f.service.readSettings();
  const snapshot = await f.service.load([71494], { purpose: 'purchase', rows: [f.player] });
  const record = { scope: f.service.scope(), entries: [{ definitionId: 71494, state: 'waiting' }],
    plan: [{ definitionId: 71494, priceReference: snapshot.references[71494], pricePolicy: policy }] };
  const approval = await f.service.preparePurchase(record);
  delete approval.policy.readSources; delete approval.policy.listingSource;
  const frozen = JSON.stringify(approval);
  await f.service.saveSettings({ readSources: 'futbin' });
  await expect(f.service.load([71494], { purpose: 'purchase', policy, force: true }))
    .rejects.toThrow('FC27_PUBLIC_PRICE_FUTGG_DISABLED');
  expect(() => validatePurchasePriceApproval(approval, record.scope, [71494])).not.toThrow();
  expect(JSON.stringify(approval)).toBe(frozen);
  expect(f.transport.getPrices).toHaveBeenCalledTimes(1);
});
it('shares FUT.GG for buying/listing and ignores purchase premiums for listing prices', async () => {
  const f = fixture();
  await f.service.saveSettings({ readSources: 'both', listingSource: 'futbin', source: 'futgg', premium: 1000 });
  const listing = await f.service.load([71494], { purpose: 'listing', rows: [f.player] });
  expect(listing.prices).toEqual({ 71494: 650 });
  expect(listing.listingPriceSource).toBe('futgg');
  const purchase = await f.service.load([71494], { purpose: 'puzzle', rows: [f.player] });
  expect(purchase.requestedSources).toEqual(['futgg']);
  expect(purchase.references[71494]).toMatchObject({ estimate: 650, maxBuy: 1650 });
});

it('prepares and reloads a Gallery purchase from FUT.GG-only planning without requesting FUTBIN', async () => {
  const f = fixture(); await f.service.saveSettings({ futbinEnabled: false });
  const snapshot = await f.service.load([71494], { rows: [f.player] });
  const record = { scope: f.service.scope(), entries: [{ definitionId: 71494, state: 'waiting' }],
    plan: [{ definitionId: 71494, priceReference: snapshot.references[71494], pricePolicy: snapshot.policy }] };
  const approval = await f.service.preparePurchase(record);
  expect(() => validatePurchasePriceApproval(structuredClone(approval), record.scope, [71494])).not.toThrow();
  expect(purchaseApprovedPrice(approval, 71494)).toMatchObject({ estimate: 650, maxBuy: 650 });
  expect(f.gm).not.toHaveBeenCalled();
  expect(f.transport.getPrices).toHaveBeenCalledTimes(1);
});

it('honours the account read switch even for forced refresh and stale plan policies', async () => {
  const f = fixture();
  const oldPolicy = await f.service.readSettings();
  await f.service.saveSettings({ futbinEnabled: false, futbinRefresh: 'force' });
  for (const purpose of ['gallery', 'puzzle', 'purchase']) {
    const result = await f.service.load([f.player.definitionId], { purpose, rows: [f.player],
      policy: oldPolicy, sources: ['futgg', 'futbin'], force: true });
    expect(result.requestedSources).toEqual(['futgg']);
    expect(result.references[f.player.definitionId].futbin).toBeNull();
  }
  await expect(f.service.load([f.player.definitionId], { purpose: 'purchase', policy: { source: 'futbin' } }))
    .rejects.toThrow('FC27_PUBLIC_PRICE_FUTBIN_DISABLED');
  expect(f.gm).not.toHaveBeenCalled();
  await f.service.saveSettings({ futbinEnabled: true });
  expect((await f.service.quote(f.player)).futbin).toBe(700);
  expect(f.gm).toHaveBeenCalledTimes(1);
});

it('stops subsequent FUTBIN requests when disabled during a queued read and permits re-enabling', async () => {
  const f = fixture(); let first = true;
  f.gm.mockImplementation(options => {
    if (!first) { options.onload({ status: 200, responseText: JSON.stringify(futbinFiltered) }); return; }
    first = false;
    void f.service.saveSettings({ futbinEnabled: false }).then(() =>
      options.onload({ status: 200, responseText: JSON.stringify(futbinFiltered) }));
  });
  const result = await f.service.load([71494, 73562], { rows: [f.player, { ...f.player, definitionId: 73562 }] });
  expect(f.gm).toHaveBeenCalledTimes(1);
  expect(result.references[73562].quotes.futbin.error).toBe('FC27_PUBLIC_PRICE_FUTBIN_DISABLED');
  await f.service.saveSettings({ futbinEnabled: true });
  await f.service.load([73562], { sources: ['futbin'], rows: [{ ...f.player, definitionId: 73562 }] });
  expect(f.gm).toHaveBeenCalledTimes(2);
});
