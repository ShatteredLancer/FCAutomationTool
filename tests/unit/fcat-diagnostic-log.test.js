import { expect, it, vi } from 'vitest';
import { createFcatDiagnosticLog } from '../../src/diagnostics/fcat-diagnostic-log.js';

function harness(options = {}) {
  const store = new Map();
  const get = vi.fn(async key => store.get(key));
  const set = vi.fn(async (key, value) => { store.set(key, value); });
  let time = 1000;
  const log = createFcatDiagnosticLog({ gmGetValue: get, gmSetValue: set, version: '27.0.2', now: () => time, ...options });
  return { log, store, get, set, advance: value => { time += value; } };
}

it('retains bounded cycle counters and proof class, never raw completion or account data', async () => {
  const t = harness();
  await t.log.record({ area: 'streamlined', event: 'contribution-transaction', phase: 'contribution-readback',
    status: 'blocked', reason: 'FC27_STREAMLINED_CYCLE_RESET_UNVERIFIED', mismatch: 'cycle-count-conflict',
    cycleCountBefore: 0, cycleCountAfter: 2, receipt: { itemIds: [123456] }, token: 'secret' });
  expect((await t.log.exportPayload()).transactionResults.at(-1)).toMatchObject({
    mismatch: 'cycle-count-conflict', cycleCountBefore: 0, cycleCountAfter: 2 });
  expect(JSON.stringify(await t.log.exportPayload())).not.toMatch(/receipt|itemIds|123456|secret/);
});

it('retains contribution failure stages across new planning and quote floods without raw trade data', async () => {
  const t = harness({ maxEntries: 1, maxCriticalEntries: 1 });
  await t.log.record({ area: 'streamlined', event: 'contribution-transaction', phase: 'contribution-readback',
    status: 'blocked', reason: 'FC27_STREAMLINED_MATERIAL_STILL_PRESENT', httpStatus: 200, count: 2,
    methodPath: 'methods.search', observedHash: 'a'.repeat(64), expectedHash: 'b'.repeat(64),
    currentScore: 430, targetScore: 1250, itemIds: [123456], raw: { token: 'secret' }, accountScope: 'secret' });
  for (let i = 0; i < 125; i++) await t.log.record({ area: 'streamlined', event: 'candidate-bucket', count: i });
  const restored = createFcatDiagnosticLog({ gmGetValue: t.get, gmSetValue: t.set });
  const payload = await restored.exportPayload();
  expect(payload.transactionResults).toContainEqual(expect.objectContaining({ phase: 'contribution-readback',
    reason: 'FC27_STREAMLINED_MATERIAL_STILL_PRESENT', count: 2, currentScore: 430, targetScore: 1250 }));
  expect(payload.transactionResults.at(-1)).toMatchObject({ methodPath: 'methods.search', observedHash: 'a'.repeat(64), expectedHash: 'b'.repeat(64) });
  expect(JSON.stringify(payload)).not.toMatch(/123456|secret|itemIds|accountScope|"raw"/);
});

it('retains bounded planning performance summaries across quote floods and reloads', async () => {
  const t = harness({ maxEntries: 1, maxCriticalEntries: 1 });
  await t.log.record({ area: 'streamlined', event: 'planning-read', phase: 'quotes', durationMs: 100000,
    requestedCount: 482, count: 482, account: 'secret', raw: [{ id: 123 }] });
  for (let count = 0; count < 301; count++) await t.log.record({ area: 'pricing', event: 'public-quote', count });
  const restored = createFcatDiagnosticLog({ gmGetValue: t.get, gmSetValue: t.set });
  const payload = await restored.exportPayload();
  expect(payload.performanceEntries).toContainEqual(expect.objectContaining({ phase: 'quotes', durationMs: 100000, requestedCount: 482 }));
  expect(JSON.stringify(payload.performanceEntries)).not.toMatch(/secret|raw|itemId/);
  for (let count = 0; count < 70; count++) await t.log.record({ area: 'pricing', event: 'quote-batch', durationMs: count });
  expect((await t.log.exportPayload()).performanceEntries).toHaveLength(40);
});

it('retains Streamlined bucket and repeated-wave arithmetic while redacting physical inventory identities', async () => {
  const t = harness();
  await t.log.record({ area: 'streamlined', event: 'candidate-bucket', source: 'inventory', phase: 'storage',
    rating: 84, unitScore: 830, count: 11, referencePrice: 700, minBatches: 14, repeatPurchaseCount: 13,
    raw: [{ id: 123 }], account: 'secret' });
  expect((await t.log.exportPayload()).criticalEntries[0]).toMatchObject({ rating: 84, unitScore: 830,
    minBatches: 14, repeatPurchaseCount: 13 });
  expect(JSON.stringify((await t.log.exportPayload()).criticalEntries)).not.toMatch(/secret|raw|itemId/);
});

it('exports bounded holdings-read arithmetic without physical identities, DTOs or credentials', async () => {
  const t = harness();
  await t.log.record({ area: 'streamlined', event: 'purchase-native', phase: 'holdings-read',
    requestedCount: 50, responseCount: 250, acceptedCount: 2, foreignCount: 248, unknownCount: 2, offset: 250,
    raw: [{ id: 123456 }], itemId: 123456, account: 'secret', token: 'secret' });
  const payload = await t.log.exportPayload();
  expect(payload.entries.at(-1)).toMatchObject({ phase: 'holdings-read', requestedCount: 50,
    responseCount: 250, acceptedCount: 2, foreignCount: 248, unknownCount: 2, offset: 250 });
  expect(JSON.stringify(payload)).not.toMatch(/123456|secret|"itemId"|"token"|"raw"/);
});

it('exports skipped settled-auction counts and fixed mismatch causes without trade or item identities', async () => {
  const t = harness();
  await t.log.record({ area: 'streamlined', event: 'purchase-native', phase: 'offer-filter', definitionId: 10,
    count: 1, skippedCount: 3, itemId: 123456, tradeId: '123456', account: 'secret' });
  await t.log.record({ area: 'streamlined', event: 'contribution', reason: 'FC27_STREAMLINED_PURCHASE_OFFER_CHANGED',
    mismatch: 'record-identity', raw: { itemId: 123456 }, token: 'secret' });
  const payload = await t.log.exportPayload();
  expect(payload.entries).toContainEqual(expect.objectContaining({ phase: 'offer-filter', count: 1, skippedCount: 3 }));
  expect(payload.entries.at(-1)).toMatchObject({ mismatch: 'record-identity' });
  expect(JSON.stringify(payload)).not.toMatch(/123456|secret|"itemId"|"tradeId"|"token"|"raw"/);
});

it('exports planning time and settled-receipt arithmetic without exporting identities or mixing actual and planned score', async () => {
  const t = harness();
  await t.log.record({ area: 'streamlined', event: 'plan', initialScore: 17210, plannedScore: 17430, targetScore: 34000,
    durationMs: 35000, processingMs: 500, schedulingMs: 34000, itemId: 123456 });
  await t.log.record({ area: 'streamlined', event: 'contribution', status: 'completed', currentScore: 34000,
    pendingWriteCount: 0, unconsumedPurchaseCount: 0, contributedCount: 7, confirmedBatches: 2,
    purchasesSettled: true, tradeId: '123456', account: 'secret' });
  const payload = await t.log.exportPayload();
  expect(payload.entries[0]).toMatchObject({ initialScore: 17210, plannedScore: 17430, durationMs: 35000, processingMs: 500, schedulingMs: 34000 });
  expect(payload.entries.at(-1)).toMatchObject({ currentScore: 34000, pendingWriteCount: 0, unconsumedPurchaseCount: 0,
    contributedCount: 7, confirmedBatches: 2, purchasesSettled: true });
  expect(JSON.stringify(payload)).not.toMatch(/123456|secret|itemId|tradeId/);
});

it('retains approved and remaining purchase budget separately from an estimate without exporting identities', async () => {
  const t = harness();
  await t.log.record({ area: 'streamlined', event: 'contribution', status: 'paused',
    approvedBudget: 48070, spent: 1200, remainingBudget: 46870, currentScore: 2490,
    account: 'secret', itemId: 123456 });
  const entries = (await t.log.exportPayload()).entries;
  expect(entries.at(-1)).toMatchObject({ approvedBudget: 48070, spent: 1200, remainingBudget: 46870 });
  expect(JSON.stringify(entries)).not.toMatch(/secret|123456|account|itemId/);
});

it('retains anonymous FSU exclusion evidence across reloads without inventing price fields', async () => {
  const t = harness();
  await t.log.record({ area: 'streamlined', event: 'inventory-exclusion', source: 'club', phase: 'fsu-gold-range',
    rating: 84, count: 11, fsuGoldMin: 75, fsuGoldMax: 83, inventoryMaxRating: 99, onlyUntradeable: true,
    itemId: 123, raw: [{ id: 123 }] });
  const reloaded = createFcatDiagnosticLog({ gmGetValue: t.get, gmSetValue: t.set });
  const payload = await reloaded.exportPayload();
  expect(payload.criticalEntries[0]).toMatchObject({ phase: 'fsu-gold-range', source: 'club', rating: 84, count: 11,
    fsuGoldMin: 75, fsuGoldMax: 83, inventoryMaxRating: 99, onlyUntradeable: true });
  expect(JSON.stringify(payload.criticalEntries)).not.toMatch(/raw|itemId/);
  expect(payload.criticalEntries[0]).not.toHaveProperty('maxBuy');
});

it('keeps bounded transaction summaries across public quote floods and reloads without exposing identities', async () => {
  const t = harness({ maxEntries: 1, maxCriticalEntries: 2 });
  for (let count = 0; count < 45; count++) await t.log.record({ area: 'gallery', event: 'listing-result',
    phase: 'execute', status: 'partial', count, requestedCount: 14, acceptedCount: 12, rejectedCount: 1,
    skippedCount: 0, unknownCount: 1, itemId: 123, tradeId: '456', operationId: 'private-run', account: 'private-account' });
  for (let count = 0; count < 130; count++) await t.log.record({ area: 'pricing', event: 'public-quote', count });
  const reloaded = createFcatDiagnosticLog({ gmGetValue: t.get, gmSetValue: t.set });
  const payload = await reloaded.exportPayload();
  expect(payload.transactionResults).toHaveLength(40);
  expect(payload.transactionResults[0].count).toBe(5);
  expect(payload.transactionResults.at(-1)).toMatchObject({ event: 'listing-result', status: 'partial', requestedCount: 14,
    acceptedCount: 12, rejectedCount: 1, skippedCount: 0, unknownCount: 1 });
  expect(JSON.stringify(payload)).not.toMatch(/itemId|tradeId|operationId|private-/);
  payload.transactionResults[0].count = 999;
  expect((await reloaded.exportPayload()).transactionResults[0].count).toBe(5);
});

it('exports bounded public-version price provenance but never account or transaction identities', async () => {
  const t = harness();
  await t.log.record({ area: 'pricing', event: 'public-quote', source: 'futgg', definitionId: 71494,
    referencePrice: 650, fetchedAt: 1000, sourceUpdatedAt: 900, expiresAt: 2000,
    itemId: 1234, tradeId: '12345', accountScope: 'private-account', url: 'https://private.example/' });
  const payload = await t.log.exportPayload();
  expect(payload.criticalEntries[0]).toMatchObject({ definitionId: 71494, referencePrice: 650, sourceUpdatedAt: 900 });
  expect(JSON.stringify(payload)).not.toMatch(/private|itemId|tradeId|accountScope/);
});

it('records Streamlined total material value separately from purchase cost without inventing unknown values', async () => {
  const t = harness();
  await t.log.record({ area: 'streamlined', event: 'plan', objective: 'lowest-value', priceSource: 'futgg',
    estimatedCost: 8000, materialValue: 200, totalValue: 8200, unknownCount: 0, inventory: [{ id: 123 }] });
  await t.log.record({ area: 'streamlined', event: 'plan', objective: 'lowest-value', estimatedCost: 0,
    materialValue: null, totalValue: null, unknownCount: 1 });
  for (let count = 0; count < 310; count++) await t.log.record({ area: 'gallery', event: 'pool-request', count });
  const payload = await t.log.exportPayload();
  expect(payload.criticalEntries[0]).toMatchObject({ objective: 'lowest-value', estimatedCost: 8000,
    priceSource: 'futgg', materialValue: 200, totalValue: 8200 });
  expect(payload.criticalEntries[1]).not.toHaveProperty('totalValue');
  expect(payload.criticalEntries[1]).toMatchObject({ unknownCount: 1 });
  expect(JSON.stringify(payload)).not.toMatch(/inventory|itemId/);
});

it('retains the real Puzzle solver reason and candidate counts across Gallery sync floods', async () => {
  const t = harness({ maxEntries: 1 });
  await t.log.record({ area: 'puzzle', event: 'procurement-result', reason: 'FC27_PURCHASE_REPAIR_NO_PLAN',
    localReason: 'FC27_MARKET_POLICY_INVALID', usableCandidates: 46, excludedUnavailable: 0, evaluations: 0,
    initialEstimatedCost: 10000, estimatedCost: 200, refinementPasses: 1, optimizationBudgetExhausted: false,
    inventory: [{ id: 123 }], token: 'secret' });
  await t.log.record({ area: 'gallery', event: 'pool-request' });
  const payload = await t.log.exportPayload();
  expect(payload.criticalEntries[0]).toMatchObject({ localReason: 'FC27_MARKET_POLICY_INVALID', usableCandidates: 46, evaluations: 0 });
  expect(payload.criticalEntries[0]).toMatchObject({ initialEstimatedCost: 10000, estimatedCost: 200,
    refinementPasses: 1, optimizationBudgetExhausted: false });
  const reloaded = createFcatDiagnosticLog({ gmGetValue: t.get, gmSetValue: t.set });
  expect((await reloaded.exportPayload()).criticalEntries[0]).toMatchObject({ initialEstimatedCost: 10000, refinementPasses: 1 });
  expect(JSON.stringify(payload)).not.toMatch(/inventory|secret/);
  await t.log.record({ area: 'puzzle', event: 'procurement-result', localReason: 'https://secret.example' });
  expect((await t.log.exportPayload()).criticalEntries[1]).not.toHaveProperty('localReason');
});

it('retains bounded redacted trade stages independently of sync floods and reloads', async () => {
  const t = harness({ maxEntries: 2, maxCriticalEntries: 2 });
  for (const phase of ['prepare', 'mutation', 'readback']) await t.log.record({ area: 'gallery', event: 'listing-stage',
    phase, status: 'failed', reason: 'FC27_GALLERY_LISTING_READBACK_UNCONFIRMED', httpStatus: 429,
    token: 'private-secret', itemId: 123, account: 'private-account' });
  for (let count = 0; count < 5; count++) await t.log.record({ area: 'gallery', event: 'pool-request', count });
  const reloaded = createFcatDiagnosticLog({ gmGetValue: t.get, gmSetValue: t.set, maxEntries: 2, maxCriticalEntries: 2 });
  const exported = await reloaded.exportPayload();
  expect(exported.entries.map(row => row.event)).toEqual(['pool-request', 'pool-request']);
  expect(exported.criticalEntries.map(row => row.phase)).toEqual(['mutation', 'readback']);
  expect(exported.criticalEntries[0]).toMatchObject({ httpStatus: 429 });
  expect(JSON.stringify(exported.criticalEntries)).not.toMatch(/private-|itemId|account/);
  expect(JSON.stringify(exported.entries)).not.toMatch(/private-|itemId|account/);
  exported.criticalEntries[0].phase = 'changed';
  expect((await reloaded.exportPayload()).criticalEntries[0].phase).toBe('mutation');
});

it('persists a bounded, allowlisted and redacted event stream', async () => {
  const t = harness({ maxEntries: 2 });
  await t.log.record({ area: 'gallery', event: 'catalog-request', source: 'futgg', status: 'failed',
    reason: 'HTTP 403', httpStatus: 403, cached: false, url: 'https://private.example/token', body: 'secret' });
  t.advance(10);
  await t.log.record({ area: 'gallery', event: 'pool-request', source: 'futgg', status: 'success', count: 1 });
  t.advance(10);
  await t.log.record({ area: 'gallery', event: 'price-request', source: 'futgg', status: 'success', batchSize: 3 });
  const exported = await t.log.exportPayload();
  expect(exported).toMatchObject({ schema: 1, product: 'FC Automation Tool', season: '27', version: '27.0.2' });
  expect(exported.entries).toHaveLength(2);
  expect(exported.entries[0]).not.toHaveProperty('url');
  expect(exported.entries[0]).not.toHaveProperty('body');
  expect(exported.entries[0]).toMatchObject({ event: 'pool-request', count: 1 });
  expect(t.store.get(t.log.key).entries).toHaveLength(2);
});

it('restores persisted records and ignores malformed entries', async () => {
  const t = harness();
  t.store.set(t.log.key, { schema: 1, entries: [
    { at: 1, area: 'gallery', event: 'ok', reason: 'HTTP 403' },
    { at: 'bad', area: 'gallery', event: 'bad' },
    { at: 2, area: 'gallery', event: 'line\nbreak' },
  ] });
  await expect(t.log.snapshot()).resolves.toEqual([{ at: 1, area: 'gallery', event: 'ok', reason: 'HTTP 403' }]);
});

it('does not reject business code when GM persistence fails', async () => {
  const t = harness({ gmSetValue: vi.fn(async () => { throw new Error('storage unavailable'); }) });
  await expect(t.log.record({ area: 'gallery', event: 'request', status: 'failed' })).resolves.toBe(true);
  await expect(t.log.snapshot()).resolves.toHaveLength(1);
});

it('caps the default log at 300 entries and exports independent snapshots', async () => {
  const t = harness();
  await Promise.all(Array.from({ length: 305 }, (_, count) => t.log.record({ area: 'gallery', event: 'request', count })));
  const payload = await t.log.exportPayload();
  expect(payload.entries).toHaveLength(300);
  expect(payload.entries[0].count).toBe(5);
  payload.entries[0].count = 999;
  expect((await t.log.snapshot())[0].count).toBe(5);
});

it('rejects raw text in allowlisted fields and arbitrary payload fields', async () => {
  const t = harness();
  await t.log.record({ area: 'gallery', event: 'request', reason: 'https://private.example/?token=secret',
    source: 'Cookie: private-secret', phase: 'Bearer private-secret', url: 'secret-url', account: 'secret-account',
    token: 'secret-token', response: { data: 'secret' }, count: -1 });
  const exported = JSON.stringify(await t.log.exportPayload());
  expect(exported).not.toMatch(/private-secret|private\.example|secret-url|secret-account|secret-token/);
  expect((await t.log.snapshot())[0]).toEqual({ at: 1000, area: 'gallery', event: 'request', version: '27.0.2' });
});

it('exports only known purchase method names and SHA256 evidence, never method source or arbitrary text', async () => {
  const t = harness();
  await t.log.record({ area: 'puzzle', event: 'buy-method-check', method: 'service.bid',
    observedHash: 'a'.repeat(64), sourceCode: 'private-source', account: 'private-account' });
  await t.log.record({ area: 'puzzle', event: 'buy-method-check', method: 'private-account', observedHash: 'private-token' });
  const exported = await t.log.exportPayload();
  expect(exported.entries[0]).toMatchObject({ method: 'service.bid', observedHash: 'a'.repeat(64) });
  expect(exported.entries[1]).not.toHaveProperty('method');
  expect(exported.entries[1]).not.toHaveProperty('observedHash');
  expect(JSON.stringify(exported)).not.toContain('private-');
});

it.each(['UTItemDAO.prototype.searchConceptItems', 'UTItemDAO.prototype.searchTransferMarket',
  'FCAuthenticationService.prototype.getIdentifier', 'Identification.prototype.handleRequest', 'Identification.prototype.handleResponse'])
('exports reviewed Market method names and digests for %s without leaking raw source or account data', async method => {
  const t = harness({ maxEntries: 1 });
  await t.log.record({ area: 'gallery', event: 'market-compare', phase: 'response', status: 'blocked',
    reason: 'FC27_MARKET_METHOD_10_CHANGED', method, observedHash: 'a'.repeat(64),
    sourceCode: 'private-source', account: 'private-account', token: 'private-token' });
  for (let i = 0; i < 4; i++) await t.log.record({ area: 'gallery', event: 'pool-request', count: i });
  const payload = await t.log.exportPayload();
  expect(payload.criticalEntries).toEqual(expect.arrayContaining([expect.objectContaining({ method, observedHash: 'a'.repeat(64) })]));
  expect(JSON.stringify(payload)).not.toContain('private-');
});

it('retains Puzzle failures and method evidence after a public quote flood', async () => {
  const t = harness({ maxEntries: 2, maxCriticalEntries: 2 });
  await t.log.record({ area: 'puzzle', event: 'solve-result', setId: 19, challengeId: 43,
    status: 'blocked', reason: 'FC27_TRANSACTION_METHOD_UNREVIEWED',
    methodPath: 'EAObservable.prototype.notify', observedHash: 'a'.repeat(64), expectedHash: 'b'.repeat(64),
    sourceCode: 'private-source', accountScope: 'private-account' });
  for (let count = 0; count < 150; count++) await t.log.record({ area: 'pricing', event: 'public-quote', count });
  const restored = createFcatDiagnosticLog({ gmGetValue: t.get, gmSetValue: t.set });
  const payload = await restored.exportPayload();
  expect(payload.transactionResults).toContainEqual(expect.objectContaining({ area: 'puzzle', event: 'solve-result',
    methodPath: 'EAObservable.prototype.notify', observedHash: 'a'.repeat(64) }));
  expect(JSON.stringify(payload)).not.toContain('private-');
});

it('retains reviewed-transaction evidence without exporting method source or identities', async () => {
  const t = harness();
  await t.log.record({ area: 'streamlined', event: 'execution-preflight', reason: 'FC27_TRANSACTION_METHOD_UNREVIEWED',
    methodPath: 'dao.submitPlayers', observedHash: 'a'.repeat(64), expectedHash: 'b'.repeat(64),
    sourceCode: 'private-source', account: 'private-account' });
  await t.log.record({ area: 'streamlined', event: 'execution-preflight', reason: 'FC27_TRANSACTION_METHOD_UNREVIEWED',
    methodPath: 'evil.prototype.secret', observedHash: 'private-hash' });
  const exported = await t.log.exportPayload();
  expect(exported.entries[0]).toMatchObject({ methodPath: 'dao.submitPlayers', observedHash: 'a'.repeat(64), expectedHash: 'b'.repeat(64) });
  expect(exported.entries[1]).not.toHaveProperty('methodPath');
  expect(JSON.stringify(exported)).not.toContain('private-');
});

it('serializes writes during asynchronous restore and export waits for them', async () => {
  const store = new Map(); let restore;
  const log = createFcatDiagnosticLog({ gmGetValue: () => new Promise(resolve => { restore = resolve; }),
    gmSetValue: (key, value) => store.set(key, value), now: () => 1000 });
  const first = log.record({ area: 'gallery', event: 'first' });
  const second = log.record({ area: 'gallery', event: 'second' });
  const exporting = log.exportPayload();
  await vi.waitFor(() => expect(restore).toBeTypeOf('function'), { interval: 1 });
  restore({ schema: 1, entries: [{ at: 1, area: 'gallery', event: 'restored' }] });
  await Promise.all([first, second]);
  expect((await exporting).entries.map(entry => entry.event)).toEqual(['restored', 'first', 'second']);
  expect(store.get(log.key).entries).toHaveLength(3);
});

it('isolates synchronous GM and clock errors without dropping later events', async () => {
  const log = createFcatDiagnosticLog({ gmGetValue: () => { throw new Error('read'); },
    gmSetValue: () => { throw new Error('write'); } });
  await expect(log.record({ area: 'gallery', event: 'first' })).resolves.toBe(true);
  await expect(log.record({ area: 'gallery', event: 'second' })).resolves.toBe(true);
  expect(await log.snapshot()).toHaveLength(2);
  const broken = createFcatDiagnosticLog({ gmGetValue: () => null, gmSetValue: () => {}, now: () => { throw new Error('clock'); } });
  await expect(broken.record({ area: 'gallery', event: 'request' })).resolves.toBe(false);
});
