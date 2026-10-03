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
