import { expect, it, vi } from 'vitest';
import { executionRuntime } from '../helpers/fc27-execution-runtime.js';
import { createFc27PublicPrices } from '../../src/adapters/browser/fc27-public-prices.js';
import { validatePurchasePriceApproval, purchaseApprovedPrice } from '../../src/fc27/purchase-price-approval.js';
import { futbinFiltered, futbinMinimalPC, futbinMinimalPS, futggPC } from '../fixtures/fc27-public-prices.js';
function fixture({ legacy = true } = {}) {
  const { root } = executionRuntime(), data = new Map(); let time = Date.parse('2026-10-04T03:42:02Z');
  const gm = vi.fn(options => options.onload({ status: 200, responseText: JSON.stringify(options.url.includes('getFilteredPlayers')
    ? futbinFiltered : options.url.includes('platform=PC') ? futbinMinimalPC : futbinMinimalPS) }));
  const transport = { getPrices: vi.fn(async () => ({ status: 200, text: JSON.stringify({ data: [futggPC.data[0]] }) })) };
  const service = createFc27PublicPrices({ root, gmRequest: gm, transport, now: () => time,
    get: async (key, fallback) => data.get(key) ?? fallback, set: async (key, value) => data.set(key, structuredClone(value)) });
  if (legacy) {
    const scope = service.scope();
    data.set(`fcat-fc27-public-price-policy-v1:${scope}`, { schema: 1, scope, policy: {} });
  }
  const player = { definitionId: 71494, rating: 80, nationId: 95, leagueId: 2221, teamId: 116308, preferredPosition: 12 };
  return { root, data, gm, transport, service, player, advance: () => { time += 300001; } };
}

it.each(['gallery', 'puzzle', 'purchase', 'listing', 'streamlined', 'roadmap'])('uses default FUTBIN batches for %s and shares page hits with other purposes', async purpose => {
  const f = fixture({ legacy: false });
  const rows = Array.from({ length: 14 }, (_, i) => ({ ...f.player, definitionId: i + 1000, rating: 84 }));
  f.gm.mockImplementation(options => options.onload({ status: 200, responseText: JSON.stringify({ errorcode: '200',
    data: rows.map(row => ({ resource_id: row.definitionId, rating: 84, ps_LCPrice: 650, pc_LCPrice: 900 })) }) }));
  const first = await f.service.load(rows.slice(0, 12).map(row => row.definitionId), { purpose, rows });
  expect(Object.keys(first.prices)).toHaveLength(12);
  expect(first.requestedSources).toEqual(['futbin']);
  expect(first.policy).toMatchObject({ source: 'futbin', futbinPlatform: 'ps' });
  const second = await f.service.load([1012], { purpose: 'listing', rows });
  expect(second.prices).toEqual({ 1012: 650 });
  expect(second.references[1012].quotes.futbin.fetchedAt).toBe(first.references[1000].quotes.futbin.fetchedAt);
  const [overlap, single] = await Promise.all([
    f.service.load([1000, 1013], { purpose: 'purchase', rows }), f.service.quote(rows[13]),
  ]);
  expect(overlap.prices).toEqual({ 1000: 650, 1013: 650 });
  expect(single.estimate).toBe(650);
  expect(f.gm).toHaveBeenCalledTimes(1);
  expect(f.gm.mock.calls[0][0].url).toContain('rating=84-84');
  expect(f.transport.getPrices).not.toHaveBeenCalled();
});

it.each(['roadmap', 'gallery-plan'])('demand %s reads only the selected authority, leaving dual-source Gallery display unchanged', async purpose => {
 for (const source of ['futbin', 'futgg']) {
  const f = fixture(); await f.service.saveSettings({ readSources: 'both', source });
  const result = await f.service.load([f.player.definitionId], { purpose, rows: [f.player] });
  expect(result.requestedSources).toEqual([source]);
  expect(result.policy.source).toBe(source);
  if (source === 'futbin') { expect(f.gm).toHaveBeenCalled(); expect(f.transport.getPrices).not.toHaveBeenCalled(); }
  else { expect(f.gm).not.toHaveBeenCalled(); expect(f.transport.getPrices).toHaveBeenCalled(); }
 }
});

it('reads the selected authority first in Both without changing either price source', async () => {
  const f = fixture(), order = [];
  await f.service.saveSettings({ readSources: 'both', source: 'futbin' });
  f.gm.mockImplementation(options => {
    order.push('futbin'); options.onload({ status: 200, responseText: JSON.stringify(futbinFiltered) });
  });
  f.transport.getPrices.mockImplementation(async () => { order.push('futgg'); return { status: 200,
    text: JSON.stringify({ data: [futggPC.data[0]] }) }; });
  const result = await f.service.load([f.player.definitionId], { rows: [f.player] });
  expect(order).toEqual(['futbin', 'futgg']);
  expect(result.references[71494]).toMatchObject({ estimate: 650, futbin: 650, futgg: 650 });
});
it('uses PS by default and isolates configurable FUTBIN quotes without changing EA or FUT.GG platforms', async () => {
  const f = fixture();
  const first = await f.service.quote(f.player);
  expect(first).toMatchObject({ platform: 'pc', futbin: 650 });
  expect(f.gm.mock.calls[0][0].url).toContain('platform=PS');
  expect(f.transport.getPrices.mock.calls[0][1]).toEqual({ platform: 'pc' });
  await f.service.saveSettings({ futbinPlatform: 'pc' });
  f.gm.mockImplementation(options => options.onload({ status: 200, responseText: JSON.stringify(futbinMinimalPC) }));
  expect((await f.service.quote(f.player)).futbin).toBe(700);
  expect(f.gm.mock.calls[1][0].url).toContain('platform=PC');
  expect(f.transport.getPrices).toHaveBeenCalledTimes(1);
  await f.service.saveSettings({ futbinPlatform: 'ps' });
  expect((await f.service.quote(f.player)).futbin).toBe(650);
  expect(f.gm).toHaveBeenCalledTimes(2);
});
it('quotes a cold 482-version inventory in rating pages and reuses pages across the 250-version boundary', async () => {
  const f = fixture(); await f.service.saveSettings({ readSources: 'futbin' });
  const rows = Array.from({ length: 482 }, (_, i) => ({ ...f.player, definitionId: 1000 + i, rating: 75 + i % 10 }));
  const requests = [];
  f.gm.mockImplementation(options => {
    const url = new URL(options.url); requests.push(url);
    const rating = Number(url.searchParams.get('rating')?.split('-')[0]), page = Number(url.searchParams.get('page'));
    const all = rows.filter(row => row.rating === rating);
    options.onload({ status: 200, responseText: JSON.stringify({ errorcode: '200', data: all.slice((page - 1) * 32, page * 32)
      .map(row => ({ resource_id: row.definitionId, rating, pc_LCPrice: 1000, ps_LCPrice: 2000 })) }) });
  });
  const first = await f.service.load(rows.slice(0, 250).map(row => row.definitionId), { purpose: 'puzzle', rows, futbinBatch: true });
  const second = await f.service.load(rows.slice(250).map(row => row.definitionId), { purpose: 'puzzle', rows, futbinBatch: true });
  expect(Object.keys({ ...first.prices, ...second.prices })).toHaveLength(482);
  expect(first.prices[1000]).toBe(2000);
  expect(requests).toHaveLength(20);
  expect(requests.every(url => url.searchParams.get('platform') === 'PS')).toBe(true);
  expect(requests.every(url => !url.searchParams.has('club') && !url.searchParams.has('ID'))).toBe(true);
  await f.service.load(rows.slice(0, 250).map(row => row.definitionId), { purpose: 'puzzle', rows, futbinBatch: true });
  expect(requests).toHaveLength(20);
  await f.service.saveSettings({ readSources: 'futbin', futbinPlatform: 'pc' });
  const pc = await f.service.load(rows.slice(0, 250).map(row => row.definitionId), { purpose: 'puzzle', rows, futbinBatch: true });
  expect(pc.prices[1000]).toBe(1000);
  expect(requests).toHaveLength(30);
  expect(requests.slice(20).every(url => url.searchParams.get('platform') === 'PC')).toBe(true);
  expect(f.transport.getPrices).not.toHaveBeenCalled();
});

it('stops batch page requests on an account source switch without launching individual fallback', async () => {
  const f = fixture(); await f.service.saveSettings({ readSources: 'futbin' });
  const rows = Array.from({ length: 12 }, (_, i) => ({ ...f.player, definitionId: 1000 + i })), pending = [];
  f.gm.mockImplementation(options => pending.push(options));
  const result = f.service.load(rows.map(row => row.definitionId), { purpose: 'puzzle', rows, futbinBatch: true });
  await vi.waitFor(() => expect(pending).toHaveLength(1));
  await f.service.saveSettings({ readSources: 'futgg' });
  pending[0].onload({ status: 200, responseText: JSON.stringify({ errorcode: '200', data: [] }) });
  const snapshot = await result;
  expect(f.gm).toHaveBeenCalledTimes(1);
  expect(snapshot.references[1000].quotes.futbin.error).toBe('FC27_PUBLIC_PRICE_FUTBIN_DISABLED');
});
it('keeps slow optional diagnostic persistence outside FUTBIN quote workers', async () => {
  const f = fixture(), writes = [];
  const service = createFc27PublicPrices({ root: f.root, gmRequest: f.gm, transport: f.transport,
    diagnosticLog: { record: entry => { writes.push(entry); return new Promise(() => {}); } },
    get: async (key, fallback) => f.data.get(key) ?? fallback,
    set: async (key, value) => f.data.set(key, structuredClone(value)) });
  await service.saveSettings({ readSources: 'futbin' });
  let result;
  service.load([f.player.definitionId], { rows: [f.player] }).then(value => { result = value; });
  await vi.waitFor(() => expect(result?.prices[71494]).toBe(650), { timeout: 300 });
  expect(writes.some(row => row.event === 'futbin-quote-result')).toBe(true);
});

it('merges concurrent FUTBIN filter mappings without losing unrelated or newly learned versions', async () => {
  const f = fixture(), pending = new Map();
  f.data.set('fcat-futbin-ids:27', { 99: 999 });
  await f.service.saveSettings({ readSources: 'futbin', futbinPlatform: 'pc' });
  f.gm.mockImplementation(options => pending.set(Number(new URL(options.url).searchParams.get('club')), options));
  const ids = [1, 2, 3], rows = ids.map(id => ({ ...f.player, definitionId: id, teamId: id }));
  const result = f.service.load(ids, { rows });
  await vi.waitFor(() => expect(pending.size).toBe(3));
  for (const id of [3, 1, 2]) pending.get(id).onload({ status: 200,
    responseText: JSON.stringify({ data: [{ resource_id: id, ID: id + 100, pc_LCPrice: 250 }] }) });
  expect((await result).prices).toEqual({ 1: 250, 2: 250, 3: 250 });
  expect(f.data.get('fcat-futbin-ids:27')).toEqual({ 99: 999, 1: 101, 2: 102, 3: 103 });
});
it('does not erase a mapping learned by another in-flight filter when rebuilding a stale minimal ID', async () => {
  const f = fixture(), pending = new Map();
  f.data.set('fcat-futbin-ids:27', { 1: 101, 99: 999 });
  await f.service.saveSettings({ readSources: 'futbin', futbinPlatform: 'pc' });
  f.gm.mockImplementation(options => {
    const url = new URL(options.url);
    pending.set(url.searchParams.has('ID') ? 'minimal' : Number(url.searchParams.get('club')), options);
  });
  const rows = [1, 2, 3].map(id => ({ ...f.player, definitionId: id, teamId: id }));
  const result = f.service.load([1, 2, 3], { rows });
  await vi.waitFor(() => expect(pending.size).toBe(3));
  pending.get(2).onload({ status: 200, responseText: JSON.stringify({ data: [
    { resource_id: 2, ID: 102, pc_LCPrice: 250 }, { resource_id: 1, ID: 201, pc_LCPrice: 300 },
  ] }) });
  await vi.waitFor(() => expect(f.data.get('fcat-futbin-ids:27')[1]).toBe(201));
  pending.get('minimal').onload({ status: 200,
    responseText: JSON.stringify({ data: [{ Player_Resource: 90, pc_LCPrice: 999 }] }) });
  await vi.waitFor(() => expect(pending.has(1)).toBe(true));
  expect(f.data.get('fcat-futbin-ids:27')).toEqual({ 1: 201, 2: 102, 99: 999 });
  for (const id of [1, 3]) pending.get(id).onload({ status: 200,
    responseText: JSON.stringify({ data: [{ resource_id: id, ID: id + 200, pc_LCPrice: 300 + id * 50 }] }) });
  expect((await result).prices).toEqual({ 1: 350, 2: 250, 3: 450 });
  expect(f.data.get('fcat-futbin-ids:27')).toEqual({ 1: 201, 2: 102, 3: 203, 99: 999 });
});
it('reuses FSU ID/filter routes, retains both prices and never obtains EA market prices', async () => {
  const f = fixture();
  expect(await f.service.quote(f.player)).toMatchObject({ estimate: 650, maxBuy: 650, futbin: 650 });
  expect(f.gm.mock.calls[0][0]).toMatchObject({ method: 'GET', timeout: 15000 });
  expect(f.gm.mock.calls[0][0].anonymous).toBeUndefined();
  expect(f.gm.mock.calls[0][0].url).toContain('position=RM');
  await f.service.quote(f.player); expect(f.gm).toHaveBeenCalledTimes(1);
  f.advance(); await f.service.quote(f.player);
  expect(f.gm.mock.calls[1][0].url).toContain('fetchPlayerInformationMinimal?ID=994&platform=PS');
  await f.service.saveSettings({ source: 'futbin', premium: 50 });
  expect(await f.service.quote(f.player)).toMatchObject({ estimate: 650, maxBuy: 700 });
});

it('records the FUTBIN route and exact-version result without changing the quote', async () => {
  const events = [];
  const f = fixture();
  const service = createFc27PublicPrices({ root: f.root, gmRequest: f.gm, transport: f.transport,
    diagnosticLog: { record: async entry => events.push(entry) }, now: () => Date.parse('2026-10-04T03:42:02Z'),
    get: async (key, fallback) => f.data.get(key) ?? fallback,
    set: async (key, value) => f.data.set(key, structuredClone(value)) });
  await service.saveSettings({ readSources: 'futbin', source: 'futbin', listingSource: 'futbin' });
  expect((await service.load([f.player.definitionId], { sources: ['futbin'], rows: [f.player] })).prices[71494]).toBe(650);
  expect(events).toEqual(expect.arrayContaining([
    expect.objectContaining({ event: 'transport-request', source: 'futbin', endpoint: 'filtered', status: 'received', httpStatus: 200 }),
    expect.objectContaining({ event: 'futbin-quote-result', definitionId: 71494, status: 'success', exactVersion: true }),
  ]));
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
  expect((await f.service.quote(f.player)).futbin).toBe(650);
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
  expect(listing.requestedSources).toEqual(['futbin', 'futgg']);
  expect(listing.listingPriceSource).toBe('futbin');
  expect(listing.prices[71494]).toBe(650);
  expect(listing.references[71494].futbin).toBe(650);
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
  expect(listing.references[71494]).toMatchObject({ futgg: null, futbin: 650, estimate: null });
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
  expect((await f.service.quote(f.player)).futbin).toBe(650);
  expect(f.gm).toHaveBeenCalledTimes(1);
});

it('stops subsequent FUTBIN requests when disabled during a queued read and permits re-enabling', async () => {
  const f = fixture(), pending = [];
  f.gm.mockImplementation(options => pending.push(options));
  const ids = [71494, 73562, 73563, 73564, 73565];
  const result = f.service.load(ids, { sources: ['futbin'], rows: ids.map(definitionId => ({ ...f.player, definitionId })) });
  await vi.waitFor(() => expect(pending).toHaveLength(3));
  await f.service.saveSettings({ futbinEnabled: false });
  for (const [index, options] of pending.entries()) options.onload({ status: 200,
    responseText: JSON.stringify({ data: [{ resource_id: ids[index], ID: index + 100, ps_LCPrice: 250 }] }) });
  const snapshot = await result;
  expect(f.gm).toHaveBeenCalledTimes(3);
  for (const id of ids.slice(3)) expect(snapshot.references[id].quotes.futbin.error).toBe('FC27_PUBLIC_PRICE_FUTBIN_DISABLED');
  await f.service.saveSettings({ futbinEnabled: true });
  f.gm.mockImplementation(options => options.onload({ status: 200,
    responseText: JSON.stringify({ data: [{ resource_id: 73564, ID: 104, ps_LCPrice: 300 }] }) }));
  expect((await f.service.load([73564], { sources: ['futbin'], rows: [{ ...f.player, definitionId: 73564 }] })).references[73564].futbin).toBe(300);
  expect(f.gm).toHaveBeenCalledTimes(4);
});
