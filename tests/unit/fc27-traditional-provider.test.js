import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { executionRuntime } from '../helpers/fc27-execution-runtime.js';
import { createFc27TraditionalProvider, projectFc27Submission, projectFc27OwnedPackCount } from '../../src/adapters/ea/fc27-traditional-provider.js';
import { createFc27TransactionTransport } from '../../src/adapters/ea/fc27-transaction-transport.js';
import { createTraditionalTransaction } from '../../src/fc27/traditional-transaction.js';
import { createFc27TransactionPersistence } from '../../src/adapters/browser/fc27-transaction-persistence.js';
import { FC27_CLUB_READ_METHODS } from '../../src/adapters/ea/fc27-club-read.js';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000000); });
afterEach(() => vi.useRealTimers());
it.each(['\n', '\r\n'])('keeps the synthetic method digest stable for %j source line endings', async eol => {
  const { root } = executionRuntime();
  for (const [path, expected] of FC27_CLUB_READ_METHODS) {
    const method = path.split('.').reduce((value, key) => value[key], root);
    const source = Function.prototype.toString.call(method).replace(/\r?\n/g, eol);
    const digest = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
    expect(Buffer.from(digest).toString('hex')).toBe(expected);
  }
  const unknown = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode('unreviewed source'));
  expect(Buffer.from(unknown).toString('hex')).toBe('0'.repeat(64));
});

async function settle(promise) {
  const observed = promise.then(value => ({ value }), error => ({ error }));
  await vi.runAllTimersAsync();
  const result = await observed;
  if (result.error) throw result.error;
  return result.value;
}
async function fixture() {
  const x = executionRuntime();
  let held = false; const values = new Map();
  const provider = await createFc27TraditionalProvider(x.root, { canWrite: () => held });
  const input = await settle(provider.prepareInputs({ setId: 4, maxRating: 74 }));
  const persistence = createFc27TransactionPersistence({ context: input.policy.context,
    gmGetValue: (key, fallback) => values.get(key) ?? fallback,
    gmSetValue: (key, value) => values.set(key, structuredClone(value)),
    lockManager: { request: async (name, _options, task) => { held = true; try { return await task({ name, mode: 'exclusive' }); } finally { held = false; } } } });
  const engine = createTraditionalTransaction({ enabled: true, adapter: provider, ...persistence, createOperationId: () => 'synthetic-attempt' });
  const plan = engine.prepare(input);
  const approval = () => engine.approve(plan, { approved: true, count: 1, setId: 4, challengeId: 16, maxRating: 74, maxPlayers: 11 });
  return { ...x, provider, input, plan, engine, approval, values };
}

it('executes the real provider contract end to end on an explicitly synthetic runtime', async () => {
  const x = await fixture();
  expect(x.plan.status).toBe('prepared');
  expect(x.calls.filter(call => call.method === 'PUT')).toHaveLength(0);
  const result = await settle(x.engine.execute(x.approval().permit));
  expect(result).toMatchObject({ status: 'completed', submitted: true, consumedCount: 11 });
  const writes = x.calls.filter(call => call.method === 'PUT');
  expect(writes).toHaveLength(2);
  expect(writes[0].body.players).toHaveLength(23);
  expect(writes[0].body.players.slice(11).every(slot => slot.itemData.id === 0)).toBe(true);
  expect(writes[1].url).toContain('skipUserSquadValidation=false');
  expect(writes.every(write => write.retry === false && write.reauth === false)).toBe(true);
  expect([...x.values.values()][0]).toMatchObject({ schema: 2, phase: 'completed', setTimesCompleted: 0 });
  expect(Object.keys(x.root.repositories.Item.club.items._collection)).toHaveLength(0);
  expect(x.root.info.base.clubCache.localDirty).toBe(true);
});

it('does not use stale FSU ready cache as exact validation', async () => {
  const x = await fixture(); x.root.info.base.state = true; x.root.info.base.clubCache.status = 'ready';
  x.state.players = x.state.players.slice(1);
  const result = await settle(x.engine.execute(x.approval().permit));
  expect(result).toMatchObject({ submitted: false, reason: 'FC27_EXACT_ITEMS_CHANGED' });
  expect(x.calls.filter(call => call.method === 'PUT')).toHaveLength(0);
});

it.each([409, 429, 500])('sends one submit for HTTP %s, never forces or retries', async status => {
  const x = await fixture(); x.state.submitStatus = status;
  const result = await settle(x.engine.execute(x.approval().permit));
  expect(result).toMatchObject({ status: 'blocked', submitted: status === 500 ? null : false });
  expect(x.calls.filter(call => call.url?.includes('skipUserSquadValidation'))).toHaveLength(1);
  expect(Object.keys(x.root.repositories.Item.club.items._collection)).toHaveLength(11);
});

it('refuses recovery evidence when the current reward identity has changed', async () => {
  const x = await fixture(); x.set.awards[0].value = 999;
  await expect(settle(x.provider.observeRecovery({ setId: 4, challengeId: 16, itemRefs: x.plan.selected,
    reward: x.plan.rewards[0] }))).rejects.toThrow('RECONCILIATION_UNCONFIRMED');
});

it('keeps successful submission pending when the target reward cannot be reconciled', async () => {
  const x = await fixture(); const original = x.root.UTHttpRequest.prototype.send;
  // Change reconciliation data without replacing any reviewed method.
  Object.defineProperty(x.state, 'packCount', { get: () => 3, set() {} });
  const result = await settle(x.engine.execute(x.approval().permit));
  expect(result).toMatchObject({ submitted: true, recoveryRequired: true, reason: 'FC27_RECONCILIATION_UNCONFIRMED' });
  expect(x.root.UTHttpRequest.prototype.send).toBe(original);
});

it('does not complete when new unassigned items remain after confirmed submission', async () => {
  const x = await fixture();
  Object.defineProperty(x.state, 'unassigned', { get: () => x.state.players.length ? [] : [{ id: 901 }] });
  const result = await settle(x.engine.execute(x.approval().permit));
  expect(result).toMatchObject({ submitted: true, recoveryRequired: true, reason: 'FC27_RECONCILIATION_UNCONFIRMED' });
  expect([...x.values.values()][0].phase).toBe('submitted');
});

it('does not evict any cache entry when an exact cached identity conflicts', async () => {
  const x = await fixture();
  x.root.repositories.Item.club.items._collection[1].definitionId = 999;
  const result = await settle(x.engine.execute(x.approval().permit));
  expect(result).toMatchObject({ submitted: true, recoveryRequired: true, reason: 'FC27_CACHE_RECONCILIATION_UNCONFIRMED' });
  expect(Object.keys(x.root.repositories.Item.club.items._collection)).toHaveLength(11);
});

it('blocks default transport mutations and fences a mutation waiting for pacing after cancel', async () => {
  const x = executionRuntime();
  const closed = await createFc27TransactionTransport(x.root);
  await expect(closed.request('submit', { challengeId: 16 })).rejects.toThrow('LIVE_DISABLED');
  const transport = await createFc27TransactionTransport(x.root, { canWrite: () => true });
  await settle(transport.request('packs'));
  const pending = expect(transport.request('submit', { challengeId: 16 })).rejects.toThrow('CONTEXT_CHANGED');
  transport.cancel(); await vi.runAllTimersAsync(); await pending;
  expect(x.calls.filter(call => call.method === 'PUT')).toHaveLength(0);
});

it('aborts its own timed out request and never treats timeout as rejection', async () => {
  const x = executionRuntime(); x.state.timeout = true;
  const transport = await createFc27TransactionTransport(x.root, { canWrite: () => true });
  await expect(settle(transport.request('submit', { challengeId: 16 }))).rejects.toThrow('REQUEST_UNCONFIRMED');
  expect(x.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
  expect(x.calls.filter(call => call.kind === 'abort')).toHaveLength(1);
});

it('preserves warning-to-item relationships without enabling a forced confirmation', () => {
  expect(projectFc27Submission({ success: true, status: 200, response: { squads: [
    { squad: 'ACTIVE_SQUAD', playerList: [1, 2] }, { squad: 'Evo', playerList: [3] },
  ] } }, { setId: 4, challengeId: 16 })).toMatchObject({ status: 'rejected', warnings: [
    { name: 'ACTIVE_SQUAD', itemIds: [1, 2] }, { name: 'Evo', itemIds: [3] },
  ] });
  expect(projectFc27Submission({ success: true, status: 200, response: { setId: 99, challengeId: 16 } },
    { setId: 4, challengeId: 16 }).status).toBe('unknown');
});

it('counts only real owned rewards of the exact pack and tradeability, not the Store catalog', () => {
  const x = executionRuntime(); const reward = x.set.awards[0];
  const pack = { id: 509, displayGroup: { value: 'mypacks' }, packType: 'CARDPACK', untradeable: true, quantity: 3 };
  expect(projectFc27OwnedPackCount(x.root, { purchase: [pack, { ...pack, displayGroup: { value: 'promo' }, quantity: 99 }] }, reward)).toBe(3);
  expect(() => projectFc27OwnedPackCount(x.root, { purchase: [{ ...pack, untradeable: false }] }, reward)).toThrow('BASELINE_UNVERIFIED');
  expect(() => projectFc27OwnedPackCount(x.root, {}, reward)).toThrow('BASELINE_UNVERIFIED');
});
