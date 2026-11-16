import { expect, it, vi } from 'vitest';
import { streamlinedRuntime } from '../helpers/fc27-streamlined-runtime.js';
import { createFc27StreamlinedPurchaseAdapter } from '../../src/adapters/ea/fc27-streamlined-purchase.js';
import { createStreamlinedJournal, canReplaceStreamlinedRejectedWave } from '../../src/streamlined/journal.js';
import { normalizeStreamlinedContributionReply } from '../../src/streamlined/contribution.js';

// Public metadata and synthetic entities only. EA's reviewed Set factory can
// reproject a remaining-seconds deadline one second differently after reload.
async function fixture({ frozen = 100, loaded = frozen, at = 1000, contribution = null } = {}) {
  const f = streamlinedRuntime({ endTime: frozen });
  const candidate = { ...f.plan.items[0], source: 'market', quote: {
    definitionId: f.plan.items[0].definitionId, source: 'futgg', price: 200, fetchedAt: 1, expiresAt: 1000000 } };
  const plan = { ...f.plan, route: { groups: [{ source: 'market', quantity: 1, item: candidate, items: [candidate] }] } };
  f.set.endTime = loaded;
  let time = at, callbacks;
  const buyer = { verifySquad: vi.fn(), find: vi.fn(), buy: vi.fn(), move: vi.fn() }, onEvent = vi.fn();
  const adapter = await createFc27StreamlinedPurchaseAdapter(f.root, { plan, persistence: {}, canWrite: () => false,
    now: () => time, contributionAdapter: contribution, onEvent,
    createBuyer: async (_root, options) => { callbacks = options; return buyer; } });
  return { f, plan, adapter, buyer, onEvent, callbacks, setTime: value => { time = value; } };
}

it.each([-1, 1])('rebinds only the loaded one-second deadline projection (delta=%i) without changing the frozen plan', async delta => {
  const f = await fixture({ loaded: 100 + delta }), before = structuredClone(f.plan);
  await expect(f.adapter.assertCurrent({})).resolves.toBeUndefined();
  expect(f.buyer.verifySquad).toHaveBeenCalledOnce();
  expect(f.plan).toEqual(before);
  expect(f.buyer.find).not.toHaveBeenCalled(); expect(f.buyer.buy).not.toHaveBeenCalled();
  expect(f.onEvent).toHaveBeenCalledWith(expect.objectContaining({ stage: 'context-check', status: 'verified', mismatch: 'deadline-reprojection' }));
  f.f.set.endTime++;
  await expect(f.adapter.assertCurrent({})).rejects.toThrow('CONTEXT_CHANGED');
});

it.each([[100, 102], [100, 98], [100, 0], [0, 100], [null, 100]])('rejects a real expiry contract change (%s -> %s)', async (frozen, loaded) => {
  const f = await fixture({ frozen, loaded });
  await expect(f.adapter.assertCurrent({})).rejects.toThrow('CONTEXT_CHANGED');
  expect(f.buyer.verifySquad).not.toHaveBeenCalled(); expect(f.buyer.find).not.toHaveBeenCalled();
  expect(f.onEvent).toHaveBeenCalledWith(expect.objectContaining({ stage: 'context-check', status: 'blocked', mismatch: 'deadline' }));
});

it.each([-1, 1])('keeps read-only recovery but blocks every market write at the earlier frozen/loaded deadline (delta=%i)', async delta => {
  const loaded = 100 + delta, f = await fixture({ loaded, at: Math.min(100, loaded) * 1000 });
  await expect(f.adapter.assertCurrent({})).resolves.toBeUndefined();
  await expect(Promise.resolve().then(() => f.callbacks.verifyCurrent())).rejects.toThrow('CHALLENGE_EXPIRED');
  for (const call of [() => f.adapter.find(f.plan.route.groups[0].item, 200), () => f.adapter.buy({}), () => f.adapter.move({})]) {
    await expect(call()).rejects.toThrow('CHALLENGE_EXPIRED');
  }
  expect(f.buyer.find).not.toHaveBeenCalled(); expect(f.buyer.buy).not.toHaveBeenCalled(); expect(f.buyer.move).not.toHaveBeenCalled();
});

it('does not dispatch a contribution when the original earlier deadline passes during fresh validation', async () => {
  const memory = new Map(), journal = createStreamlinedJournal({
    get: async key => structuredClone(memory.get(key) ?? null), set: async (key, value) => memory.set(key, structuredClone(value)) });
  const writer = { capabilities: { contributionVerified: true }, verify: vi.fn(async () => { f.setTime(100000); return true; }), contribute: vi.fn() };
  const f = await fixture({ loaded: 101, at: 99999, contribution: { adapter: writer, journal } });
  expect(await f.adapter.contribute(f.f.plan)).toMatchObject({ confirmed: false, notDispatched: true, stopped: true });
  expect(writer.verify).toHaveBeenCalledOnce(); expect(writer.contribute).not.toHaveBeenCalled();
});

it('still settles a confirmed in-flight contribution once when the deadline passes after dispatch', async () => {
  const memory = new Map(), journal = createStreamlinedJournal({
    get: async key => structuredClone(memory.get(key) ?? null), set: async (key, value) => memory.set(key, structuredClone(value)) });
  const writer = { capabilities: { contributionVerified: true }, verify: vi.fn(async () => true),
    contribute: vi.fn(async (plan, batch) => {
      f.setTime(100000);
      return normalizeStreamlinedContributionReply({ success: true, status: 200, response: {
        setId: plan.challenge.setId, challengeId: plan.challenge.id, submittedScore: plan.score } }, {
        setId: plan.challenge.setId, challengeId: plan.challenge.id, previousScore: 0, itemIds: batch.refs.map(ref => ref.id) });
    }), reconcile: vi.fn(async (record, batch) => ({ fresh: true, context: record.context, observedAt: 100000,
      setId: record.plan.challenge.setId, challengeId: record.plan.challenge.id, absent: batch.refs,
      submittedScore: record.plan.score, operationConfirmed: true })) };
  const f = await fixture({ loaded: 101, at: 99999, contribution: { adapter: writer, journal } });
  expect(await f.adapter.contribute(f.f.plan)).toMatchObject({ confirmed: true, submittedScore: 100 });
  expect((await journal.read(f.plan.context)).batches[0].state).toBe('confirmed');
  await expect(f.adapter.contribute(f.f.plan)).rejects.toThrow('CHALLENGE_EXPIRED');
  expect(writer.contribute).toHaveBeenCalledOnce();
});

it('does not turn a one-second deadline rebind into permission to use another account or target', async () => {
  for (const kind of ['account', 'target']) {
    const f = await fixture({ loaded: 101 });
    if (kind === 'account') f.plan.context = { ...f.plan.context, accountScope: 'synthetic-other' };
    else f.f.challenge.id++;
    await expect(f.adapter.assertCurrent({})).rejects.toThrow('CONTEXT_CHANGED');
    expect(f.buyer.verifySquad).not.toHaveBeenCalled(); expect(f.buyer.buy).not.toHaveBeenCalled();
    expect(f.onEvent).toHaveBeenCalledWith(expect.objectContaining({ stage: 'context-check', status: 'blocked', mismatch: kind }));
  }
});

it.each(['targetScore', 'selectionLimit', 'eligibility', 'repeats'])('retains exact non-expiry metadata during a one-second rebind (%s)', async key => {
  const f = await fixture({ loaded: 101 });
  if (key === 'targetScore') f.f.challenge.scoreRequirement++;
  if (key === 'selectionLimit') f.f.controller.workAreaController.viewModel.getSelectionLimit = () => 20;
  if (key === 'eligibility') f.f.challenge.eligibilityRequirements[0].kvPairs._collection[40] = [60];
  if (key === 'repeats') f.f.set.repeats++;
  await expect(f.adapter.assertCurrent({})).rejects.toThrow('CONTEXT_CHANGED');
  expect(f.buyer.verifySquad).not.toHaveBeenCalled(); expect(f.buyer.buy).not.toHaveBeenCalled();
});

it('only permits a receipt-free rejected wave to be revalidated under a one-second deadline projection', async () => {
  const f = await fixture(), before = f.f.plan;
  const record = { context: before.context, plan: before, submittedScore: before.challenge.submittedScore,
    batches: [{ state: 'rejected', startingScore: before.challenge.submittedScore }] };
  for (const delta of [-2, -1, 0, 1, 2]) {
    const plan = { ...before, challenge: { ...before.challenge, endTime: before.challenge.endTime + delta } };
    expect(canReplaceStreamlinedRejectedWave(record, plan)).toBe(Math.abs(delta) <= 1);
    for (const state of ['pending', 'unknown', 'confirmed', 'waiting']) {
      expect(canReplaceStreamlinedRejectedWave({ ...record, batches: [{ ...record.batches[0], state }] }, plan)).toBe(false);
    }
    expect(canReplaceStreamlinedRejectedWave({ ...record, batches: [{ ...record.batches[0], receipt: {} }] }, plan)).toBe(false);
    expect(canReplaceStreamlinedRejectedWave(record, { ...plan, challenge: { ...plan.challenge, targetScore: 9999 } })).toBe(false);
    expect(canReplaceStreamlinedRejectedWave(record, { ...plan, context: { ...plan.context, accountScope: 'synthetic-other' } })).toBe(false);
  }
});
