import { expect, it, vi } from 'vitest';
import { streamlinedRuntime } from '../helpers/fc27-streamlined-runtime.js';
import { createFc27StreamlinedMaterializer, createFc27StreamlinedMaterializationRecovery } from '../../src/adapters/ea/fc27-streamlined-materialize.js';
import { contextKey } from '../../src/fc27/prelaunch-contract.js';
import { FC27_BUY_SERVICE_METHODS } from '../../src/adapters/ea/fc27-puzzle-buy.js';
import { readFc27StreamlinedInputs } from '../../src/adapters/ea/fc27-streamlined-read.js';
import { createStreamlinedPlan } from '../../src/streamlined/plan.js';
import { splitStreamlinedBatches } from '../../src/streamlined/planner.js';
import expiredTransfer from '../fixtures/fc27-streamlined-expired-transfer-2026-10-24.json';

async function setup(pile = 'unassigned', sourceChanges = {}) {
  const f = streamlinedRuntime({ targetScore: 20 }), memory = new Map(), club = [];
  Object.assign(f.root.AuctionTradeStateEnum, expiredTransfer.enums);
  const source = { ...f.root.repositories.Item.club.items._collection[1], id: 901, definitionId: 1901,
    pile: pile === 'transfer' ? 5 : 1, utasPile: pile === 'transfer' ? 5 : 1, ...sourceChanges };
  f.root.repositories.Item.getUnassignedItems = () => pile === 'unassigned' ? [source] : [];
  f.root.repositories.Item.getTransferItems = () => pile === 'transfer' ? [source] : [];
  const state = { reply: { success: true, data: { itemIds: [source.id] } }, moved: true,
    writes: 0, writeFailure: false, enabled: true };
  const move = vi.fn(() => ({ observe(owner, callback) {
    if (state.moved) club.push({ ...source, pile: 7, utasPile: 7 });
    callback(this, state.reply);
  }, unobserve() {} }));
  class Service { move(...args) { return move(...args); } }
  f.root.services.Item = new Service();
  const digest = f.root.crypto.subtle.digest;
  f.root.crypto.subtle.digest = async (algorithm, bytes) => {
    const text = new TextDecoder().decode(bytes).replace(/\r\n/g, '\n');
    return text === String(Service.prototype.move).replace(/\r\n/g, '\n')
      ? Uint8Array.from(Buffer.from(FC27_BUY_SERVICE_METHODS.find(([name]) => name === 'move')[1], 'hex')).buffer
      : digest(algorithm, bytes);
  };
  const input = readFc27StreamlinedInputs(f.root, { sources: [pile] });
  const selected = input.inventory;
  const plan = createStreamlinedPlan({ context: input.context, challenge: input.challenge, policy: input.policy,
    result: { status: 'ready', items: selected, batches: [selected], score: 20, purchaseCost: 0, materialValue: null,
      progress: { target: 20, submitted: 0, added: 20, total: 20, remaining: 0, excess: 0, reached: true }, searchComplete: true } });
  const options = { plan, canWrite: () => state.enabled, get: (key, fallback) => structuredClone(memory.get(key) ?? fallback),
    set: (key, value) => { if (state.writeFailure) throw Error('disk'); state.writes++; memory.set(key, structuredClone(value)); },
    createTransport: async (_root, { onEntity }) => ({ readPage: async () => {
      if (onEntity) club.forEach(onEntity); return club.map(item => ({ id: item.id, definitionId: item.definitionId, pile: 'club' }));
    } }) };
  const refs = selected.map(item => ({ id: item.id, definitionId: item.definitionId,
    pile: item.pile, executionPile: item.executionPile, points: item.points }));
  const create = overrides => createFc27StreamlinedMaterializer(f.root, { ...options, ...overrides });
  return { ...f, memory, club, source, state, move, refs, options, plan, create };
}

it.each(['unassigned', 'transfer'])('moves exact %s material and uses durable intent plus fresh Club readback', async pile => {
  const f = await setup(pile), progress = vi.fn();
  const materializer = await f.create({ onProgress: progress });
  expect(await materializer.prepare(f.refs)).toMatchObject({ status: 'materialized', moved: [901] });
  expect(f.move).toHaveBeenCalledWith(f.source, 7);
  expect([...f.memory.values()][0].entries[0].state).toBe('confirmed');
  expect(f.state.writes).toBe(2);
  expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'materialize', completed: 1 }));
  await (await f.create()).prepare(f.refs);
  expect(f.move).toHaveBeenCalledTimes(1);
});

it('moves a verified expired unsold Transfer card and independently confirms its exact Club arrival', async () => {
  const f = await setup('transfer', structuredClone(expiredTransfer.item));
  expect(f.plan.items[0].activeTrade).toBe(false);
  expect(await (await f.create()).prepare(f.refs)).toMatchObject({ status: 'materialized', moved: [901] });
  expect(f.move).toHaveBeenCalledOnce();
});

it.each(['active', 'closed', 'unknown', 'bid', 'owner', 'state'])
('does not move a previously expired unsold Transfer card after %s drift', async change => {
  const f = await setup('transfer', structuredClone(expiredTransfer.item));
  if (['active', 'closed', 'unknown'].includes(change)) f.source._auction._tradeState = change;
  if (change === 'bid') f.source._auction.currentBid = 650;
  if (change === 'owner') delete f.source._auction.tradeOwner;
  if (change === 'state') f.source.state = 'invalid';
  await expect((await f.create()).prepare(f.refs)).rejects.toThrow('MATERIALIZE_');
  expect(f.move).not.toHaveBeenCalled();
  expect(f.state.writes).toBe(0);
});

it.each(['active', 'protected', 'rating', 'tradeable', 'duplicate', 'version'])('blocks changed %s material before moving', async kind => {
  const f = await setup('transfer');
  if (kind === 'active') f.source._auction = { _tradeState: 'active', isActiveTrade: () => true };
  if (kind === 'protected') f.source._rareflag = 2;
  if (kind === 'rating') f.source._rating = 99;
  if (kind === 'tradeable') f.source.tradable = true;
  if (kind === 'duplicate') f.club.push({ ...f.source, id: 1 });
  if (kind === 'version') f.source.definitionId++;
  await expect((await f.create()).prepare(f.refs)).rejects.toThrow('MATERIALIZE_');
  expect(f.move).not.toHaveBeenCalled();
});

it('rejects another live Club copy even when the source has no duplicateId', async () => {
  const f = await setup(); f.club.push({ ...f.source, id: 1 });
  await expect((await f.create()).prepare(f.refs)).rejects.toThrow('DUPLICATE_BLOCKED');
  expect(f.move).not.toHaveBeenCalled();
});

it('blocks a fresh Club version even when its entity is absent from the local cache', async () => {
  const f = await setup(); f.source.duplicateId = 902;
  f.club.push({ ...f.source, id: 902, pile: 7, utasPile: 7 });
  await expect((await f.create()).prepare(f.refs)).rejects.toThrow('DUPLICATE_BLOCKED');
  expect(f.move).not.toHaveBeenCalled();

});

it('moves the exact external entity after fresh Club confirms the old counterpart is gone', async () => {
  const f = await setup(); f.source.duplicateId = 999;
  f.root.repositories.Item.getStorageItems = () => [{ ...f.source, id: 903, pile: 8, utasPile: 8 }];
  expect(await (await f.create()).prepare(f.refs)).toMatchObject({ status: 'materialized' });
  expect(f.move).toHaveBeenCalledWith(f.source, 7);
});

it('reports materialization stages without exposing card data', async () => {
  const f = await setup(), progress = vi.fn();
  await (await f.create({ onProgress: progress })).prepare(f.refs);
  expect(progress.mock.calls.map(([row]) => row.stage)).toEqual([
    'checking-source', 'checking-club', 'journal-pending', 'move-request',
    'move-acknowledged', 'club-readback', 'confirmed',
  ]);
  expect(progress.mock.calls.every(([row], i) => row.completed === Number(i === 6) && row.total === 1)).toBe(true);
});

it.each(['unknown', 'missingIds', 'missingReadback'])('keeps %s move recoverable and does not blindly resend', async kind => {
  const f = await setup();
  if (kind === 'unknown') { f.state.reply = {}; f.state.moved = false; }
  if (kind === 'missingIds') { f.state.reply = { success: true, data: { itemIds: [] } }; f.state.moved = false; }
  if (kind === 'missingReadback') f.state.moved = false;
  await expect((await f.create()).prepare(f.refs)).rejects.toThrow('MATERIALIZE_');
  expect([...f.memory.values()][0].entries[0].state).toBe('pending');
  await expect((await f.create()).prepare(f.refs)).rejects.toThrow('RECOVERY_REQUIRED');
  expect(f.move).toHaveBeenCalledTimes(1);
  f.club.push({ ...f.source, pile: 7, utasPile: 7 });
  await (await f.create()).prepare(f.refs);
  expect([...f.memory.values()][0].entries[0].state).toBe('confirmed');
  expect(f.move).toHaveBeenCalledTimes(1);
});

it('records explicit rejection and permits a fresh approved attempt', async () => {
  const f = await setup(); f.state.reply = { success: false }; f.state.moved = false;
  await expect((await f.create()).prepare(f.refs)).rejects.toThrow('MOVE_REJECTED');
  expect([...f.memory.values()][0].entries[0].state).toBe('rejected');
  f.state.reply = { success: true, data: { itemIds: [901] } }; f.state.moved = true;
  await (await f.create()).prepare(f.refs);
  expect(f.move).toHaveBeenCalledTimes(2);
});

it.each(['write', 'permission', 'account', 'policy'])('blocks %s changes before any move', async kind => {
  const f = await setup(), materializer = await f.create({ assertCurrent: () => {
    if (kind === 'policy') throw Error('FC27_STREAMLINED_POLICY_CHANGED');
  } });
  if (kind === 'write') f.state.writeFailure = true;
  if (kind === 'permission') f.state.enabled = false;
  if (kind === 'account') f.user.selectedPersona = 444;
  await expect(materializer.prepare(f.refs)).rejects.toThrow('FC27_');
  expect(f.move).not.toHaveBeenCalled();
});

it('batches Club first and separates external copies of the same version', async () => {
  const f = await setup();
  const owned = { ...f.plan.items[0], id: 10, pile: 'club', executionPile: undefined };
  const storage = { ...owned, id: 11, pile: 'storage' };
  const second = { ...f.plan.items[0], id: 902, pile: 'transfer' };
  const batches = splitStreamlinedBatches([f.plan.items[0], second, storage, owned], 30);
  expect(batches.map(batch => batch.map(item => item.id))).toEqual([[11, 10], [901], [902]]);
});

it('recovers another challenge move without needing its page, policy or write capability', async () => {
  const f = await setup(), key = contextKey(f.plan.context, 'streamlined-materialization');
  const pending = { id: 901, definitionId: 1901, pile: 'unassigned', setId: 99, challengeId: 199, state: 'pending' };
  f.memory.set(key, { schema: 1, entries: [pending] });
  f.club.push({ ...f.source, pile: 7, utasPile: 7 });
  f.state.enabled = false;
  const recovery = await createFc27StreamlinedMaterializationRecovery(f.root, { ...f.options, plan: undefined,
    context: f.plan.context });
  expect(await recovery.recover()).toMatchObject({ status: 'recovered', confirmed: 1,
    recovery: { kind: 'streamlined-materialization', setId: 99, challengeId: 199, pendingCount: 0 } });
  expect(f.memory.get(key).entries[0].state).toBe('confirmed');
  expect(f.move).not.toHaveBeenCalled();
});

it.each(['missing', 'wrong-copy', 'wrong-version', 'read-failed'])('preserves an uncertain old %s move and its target', async kind => {
  const f = await setup(), key = contextKey(f.plan.context, 'streamlined-materialization');
  const entry = { id: 901, definitionId: 1901, pile: 'unassigned', setId: 99, challengeId: 199, state: 'pending' };
  f.memory.set(key, { schema: 1, entries: [entry] });
  if (kind === 'wrong-copy') f.club.push({ ...f.source, id: 902 });
  if (kind === 'wrong-version') f.club.push({ ...f.source, definitionId: 1902 });
  const recovery = await createFc27StreamlinedMaterializationRecovery(f.root, { ...f.options, context: f.plan.context,
    ...(kind === 'read-failed' ? { createTransport: async () => { throw Error('FC27_CLUB_HTTP_401'); } } : {}) });
  expect(await recovery.recover()).toMatchObject({ status: 'recovery-required',
    recovery: { kind: 'streamlined-materialization', setId: 99, challengeId: 199, pendingCount: 1 } });
  expect(f.memory.get(key).entries[0]).toEqual(entry);
  await expect((await f.create()).prepare(f.refs)).rejects.toMatchObject({
    message: 'FC27_STREAMLINED_MATERIALIZE_RECOVERY_REQUIRED',
    recovery: { setId: 99, challengeId: 199, pendingCount: 1 } });
  expect(f.move).not.toHaveBeenCalled();
});

it('does not confirm recovery after account/page drift or failed durable readback', async () => {
  for (const kind of ['account', 'page', 'write']) {
    const f = await setup(), key = contextKey(f.plan.context, 'streamlined-materialization');
    f.memory.set(key, { schema: 1, entries: [{ id: 901, definitionId: 1901, pile: 'unassigned',
      setId: 99, challengeId: 199, state: 'pending' }] });
    f.club.push({ ...f.source, pile: 7, utasPile: 7 });
    let reads = 0;
    const recovery = await createFc27StreamlinedMaterializationRecovery(f.root, { ...f.options,
      context: f.plan.context, assertCurrent: () => { if (kind === 'page' && ++reads > 2) throw Error('FC27_STREAMLINED_CONTEXT_CHANGED'); } });
    if (kind === 'account') f.user.selectedPersona = 444;
    if (kind === 'write') f.state.writeFailure = true;
    expect(await recovery.recover()).toMatchObject({ status: 'recovery-required' });
    expect(f.memory.get(key).entries[0].state).toBe('pending');
    expect(f.move).not.toHaveBeenCalled();
  }
});
