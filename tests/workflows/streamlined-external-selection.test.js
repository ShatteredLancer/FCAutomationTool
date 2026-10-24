import { expect, it, vi } from 'vitest';
import { streamlinedRuntime } from '../helpers/fc27-streamlined-runtime.js';
import { readFc27StreamlinedInputs } from '../../src/adapters/ea/fc27-streamlined-read.js';
import { createFc27StreamlinedMaterializer } from '../../src/adapters/ea/fc27-streamlined-materialize.js';
import { createFc27StreamlinedProvider } from '../../src/adapters/ea/fc27-streamlined-provider.js';
import { FC27_BUY_SERVICE_METHODS } from '../../src/adapters/ea/fc27-puzzle-buy.js';
import { readStreamlinedExternalRows, planStreamlinedExternalSelection } from '../../src/streamlined/external-selection.js';
import { createStreamlinedPlan } from '../../src/streamlined/plan.js';
import { createStreamlinedJournal } from '../../src/streamlined/journal.js';
import { createStreamlinedTransaction } from '../../src/streamlined/transaction.js';

// Real selection -> splitter -> transaction -> provider -> materializer -> fresh
// validator/reconciler. Only native network responses and the shared lock are synthetic.
function fixture() {
  const f = streamlinedRuntime({ targetScore: 100 }), memory = new Map(), events = [];
  let clock = 1000;
  const club = f.root.repositories.Item.club.items._collection;
  const transfer = [{ ...club[1], id: 901, pile: 5, utasPile: 5, duplicateId: 1 }];
  const unassigned = [{ ...club[1], id: 902, pile: 1, utasPile: 1, duplicateId: 1 }];
  f.root.repositories.Item.getTransferItems = () => transfer;
  f.root.repositories.Item.getUnassignedItems = () => unassigned;
  const storage = { get: (key, fallback) => structuredClone(memory.get(key) ?? fallback),
    set: (key, value) => memory.set(key, structuredClone(value)) };
  const journal = createStreamlinedJournal({ ...storage, now: () => clock });
  const move = vi.fn((source, pile) => ({ observe(_owner, callback) {
    const record = [...memory.values()].find(row => row?.batches);
    expect(record.batches.filter(row => row.state === 'confirmed')).toHaveLength(source.id === 901 ? 1 : 2);
    expect(f.state.players.some(item => item.resourceId === source.definitionId)).toBe(false);
    expect(pile).toBe(7); events.push(`move:${source.id}`);
    const list = source.id === 901 ? transfer : unassigned;
    list.splice(list.indexOf(source), 1); club[source.id] = { ...source, pile: 7, utasPile: 7 };
    f.state.players.push({ id: source.id, resourceId: source.definitionId });
    callback(this, { success: true, data: { itemIds: [source.id] } });
  }, unobserve() {} }));
  class Service { move(...args) { return move(...args); } }
  f.root.services.Item = new Service();
  const digest = f.root.crypto.subtle.digest;
  f.root.crypto.subtle.digest = async (algorithm, bytes) => new TextDecoder().decode(bytes).replace(/\r\n/g, '\n')
    === String(Service.prototype.move).replace(/\r\n/g, '\n')
    ? Uint8Array.from(Buffer.from(FC27_BUY_SERVICE_METHODS.find(([name]) => name === 'move')[1], 'hex')).buffer
    : digest(algorithm, bytes);
  const input = readFc27StreamlinedInputs(f.root, { sources: ['club', 'transfer', 'unassigned'] });
  const snapshot = readStreamlinedExternalRows(input);
  const result = planStreamlinedExternalSelection(snapshot, ['item:901', 'item:902']);
  const plan = createStreamlinedPlan({ context: input.context, challenge: input.challenge, policy: input.policy,
    result, objective: 'inventory-first' });
  f.replies.rows[0].submittedScore = 0;
  const state = { retainConsumed: false };
  const consume = ids => { f.state.players = f.state.players.filter(item => !ids.includes(item.id));
    for (const id of ids) delete club[id]; };
  const request = vi.fn(async (_action, target, beforeDispatch) => {
    await beforeDispatch(); events.push(`contribute:${target.itemIds.join(',')}`);
    if (!state.retainConsumed) consume(target.itemIds);
    f.replies.rows[0].submittedScore += target.itemIds.length * 20;
    return { success: true, status: 200, response: { setId: 31, challengeId: 61,
      submittedScore: f.replies.rows[0].submittedScore } };
  });
  const provider = createFc27StreamlinedProvider(f.root, { journal, canWrite: () => true, now: () => clock,
    materializationStorage: storage, createTransport: async () => ({ request }),
    createMaterializer: (root, options) => createFc27StreamlinedMaterializer(root, { ...options,
      createTransport: async () => ({ readPage: async ({ definitionIds }) => {
        const rows = f.state.players.filter(item => definitionIds.includes(item.resourceId))
          .map(item => ({ ...root.factories.Item.createItem(item), pile: 7, utasPile: 7 }));
        return rows.map(item => ({ id: item.id, definitionId: item.definitionId, pile: 'club' }));
      } }) }) });
  const createTransaction = () => createStreamlinedTransaction({ adapter: provider, journal,
    lock: { acquire: async () => () => {} }, now: () => clock });
  const approval = { approved: true, fingerprint: plan.fingerprint, batchIndices: [0, 1, 2], allowPartial: true };
  const onProgress = event => { if (event.phase === 'confirmed') { events.push(`confirmed:${event.index}`); clock += 4000; } };
  return { ...f, state, events, move, request, plan, journal, createTransaction, approval, consume, onProgress };
}

it('independently confirms Club consumption before moving and contributing each exact external duplicate', async () => {
  const f = fixture();
  expect(f.plan.batches.map(batch => batch.map(item => item.id))).toEqual([[1], [901], [902]]);
  expect(f.events).toEqual([]);
  const tx = f.createTransaction();
  const result = await tx.execute(f.plan, f.approval, { onProgress: f.onProgress });
  expect(result, JSON.stringify({result, events:f.events})).toMatchObject({ status: 'partial', record: { submittedScore: 60 } });
  expect(result.record.batches.map(row => row.state)).toEqual(['confirmed', 'confirmed', 'confirmed']);
  expect(f.events).toEqual(['contribute:1', 'confirmed:0', 'move:901', 'contribute:901', 'confirmed:1',
    'move:902', 'contribute:902', 'confirmed:2']);
  await tx.execute(f.plan, f.approval);
  expect(f.move).toHaveBeenCalledTimes(2); expect(f.request).toHaveBeenCalledTimes(3);
});

it('stops after the confirmed prerequisite and resumes without replaying it or moving ahead of readback', async () => {
  const f = fixture(), tx = f.createTransaction();
  const result = await tx.execute(f.plan, f.approval, { onProgress: event => {
    f.onProgress(event); if (event.phase === 'confirmed' && event.index === 0) tx.stop();
  } });
  expect(result.status).toBe('stopped'); expect(f.move).not.toHaveBeenCalled();
  const resumed = f.createTransaction();
  expect((await resumed.recover(f.plan.context)).status).toBe('observed');
  expect(f.request).toHaveBeenCalledTimes(1); expect(f.move).not.toHaveBeenCalled();
  expect(await resumed.execute(f.plan, f.approval, { onProgress: f.onProgress })).toMatchObject({ status: 'partial', record: { submittedScore: 60 } });
  expect(f.events.filter(event => event === 'contribute:1')).toHaveLength(1);
});

it('retains an unverified prerequisite receipt and never moves its duplicate until read-only recovery confirms consumption', async () => {
  const f = fixture(); f.state.retainConsumed = true;
  const tx = f.createTransaction(), failed = await tx.execute(f.plan, f.approval);
  expect(failed.status).toBe('recovery-required'); expect(failed.record.batches[0].state).toBe('unknown');
  expect(failed.record.batches[0].receipt.status).toBe('accepted');
  expect((await tx.execute(f.plan, f.approval)).reason).toBe('FC27_STREAMLINED_RECOVERY_REQUIRED');
  expect((await tx.recover(f.plan.context)).status).toBe('recovery-required');
  expect(f.move).not.toHaveBeenCalled(); expect(f.request).toHaveBeenCalledTimes(1);
  f.consume([1]); f.state.retainConsumed = false;
  expect((await tx.recover(f.plan.context)).status).toBe('recovered');
  expect(f.move).not.toHaveBeenCalled(); expect(f.request).toHaveBeenCalledTimes(1);
  expect(await tx.execute(f.plan, f.approval, { onProgress: f.onProgress })).toMatchObject({ status: 'partial', record: { submittedScore: 60 } });
  expect(f.request).toHaveBeenCalledTimes(3);
});
