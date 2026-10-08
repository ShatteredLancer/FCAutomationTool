import { expect, it, vi } from 'vitest';
import { streamlinedRuntime, pendingContribution } from '../helpers/fc27-streamlined-runtime.js';
import { createFc27StreamlinedProvider } from '../../src/adapters/ea/fc27-streamlined-provider.js';
import { createStreamlinedPlan } from '../../src/streamlined/plan.js';
import { createStreamlinedJournal } from '../../src/streamlined/journal.js';
import { createStreamlinedTransaction } from '../../src/streamlined/transaction.js';

async function setup({ legacyPolicy = false } = {}) {
  const f = streamlinedRuntime(), pending = await pendingContribution(f);
  if (legacyPolicy) {
    const { marketMaxRating: _marketMaxRating, ...policy } = f.plan.policy;
    f.plan = createStreamlinedPlan({ context: f.plan.context, challenge: f.plan.challenge, policy, result: f.plan });
    pending.record.plan = f.plan;
  }
  delete pending.record.batches[0].receipt;
  pending.record = await pending.journal.write(f.plan.context, pending.record, pending.record.revision);
  pending.batch = pending.record.batches[0];
  f.replies.rows[0].submittedScore = 0;
  let clock = 1000, enabled = true;
  const dispatched = vi.fn(), request = vi.fn(async (_action, target, beforeDispatch) => {
    await beforeDispatch(); dispatched(target);
    return { success: true, status: 200, response: { setId: 31, challengeId: 61,
      submittedScore: 100, grantedChallengeAwards: [], grantedSetAwards: [] } };
  });
  const provider = createFc27StreamlinedProvider(f.root, { journal: pending.journal,
    canWrite: () => enabled, now: () => clock, createTransport: async () => ({ request }) });
  return { ...f, ...pending, provider, request, dispatched, setClock: n => { clock = n; }, disable: () => { enabled = false; } };
}

it.each([false, true])('checks fresh readers and durable intent with legacy policy=%s before one exact contribution', async legacyPolicy => {
  const f = await setup({ legacyPolicy });
  expect(await f.provider.verify(f.plan, f.batch, 0)).toBe(true);
  expect(await f.provider.contribute(f.plan, f.batch)).toMatchObject({ schema: 1, status: 'accepted', submittedScore: 100 });
  expect(f.dispatched).toHaveBeenCalledWith({ challengeId: 61, itemIds: [1, 2, 3, 4, 5] });
  await expect(f.provider.contribute(f.plan, f.batch)).rejects.toThrow('VALIDATION_REQUIRED');
  expect(f.request).toHaveBeenCalledTimes(1);
});

it('does not dispatch without fresh validation, after expiry, with changed policy or revoked writes', async () => {
  for (const kind of ['unverified', 'expired', 'policy', 'disabled', 'journal']) {
    const f = await setup();
    if (kind !== 'unverified') await f.provider.verify(f.plan, f.batch, 0);
    if (kind === 'expired') f.setClock(16001);
    if (kind === 'policy') f.root.info.set.goldenrange = 82;
    if (kind === 'disabled') f.disable();
    if (kind === 'journal') {
      const record = await f.journal.read(f.plan.context); record.batches[0].state = 'rejected'; delete record.batches[0].receipt;
      await f.journal.write(f.plan.context, record, record.revision);
    }
    if (kind === 'unverified') await expect(f.provider.contribute(f.plan, f.batch)).rejects.toThrow();
    else expect(await f.provider.contribute(f.plan, f.batch)).toMatchObject({ status: 'rejected', reason: expect.stringMatching(/^FC27_/) });
    expect(f.dispatched).not.toHaveBeenCalled();
  }
});

it('keeps writes disabled by default and does not treat a preview as an approval', async () => {
  const f = streamlinedRuntime();
  const provider = createFc27StreamlinedProvider(f.root, {});
  expect(provider.capabilities.contributionVerified).toBe(false);
  await expect(provider.contribute(f.plan, { index: 0, refs: [] })).rejects.toThrow('VALIDATION_REQUIRED');
  expect(f.calls).toHaveLength(0);
});

it('executes and reconciles two batches with real read adapters while the page and repository stay stale', async () => {
  const f = streamlinedRuntime(), selected = f.input.inventory.slice(0, 10);
  const plan = createStreamlinedPlan({ context: f.input.context, challenge: f.input.challenge,
    policy: f.input.policy, result: { status: 'ready', items: selected, batches: [selected.slice(0, 5), selected.slice(5)],
      score: 200, progress: { target: 200, submitted: 0, added: 200, total: 200, remaining: 0, excess: 0, reached: true },
      purchaseCost: 0, materialValue: null, searchComplete: true } });
  const memory = new Map(), journal = createStreamlinedJournal({
    get: key => structuredClone(memory.get(key)), set: (key, value) => memory.set(key, structuredClone(value)) });
  f.replies.rows[0].submittedScore = 0;
  const before = JSON.stringify(f.root.repositories), mutations = [];
  const provider = createFc27StreamlinedProvider(f.root, { journal, canWrite: () => true,
    createTransport: async () => ({ async request(action, target, beforeDispatch) {
      await beforeDispatch(); mutations.push(target.itemIds);
      f.state.players = f.state.players.filter(item => !target.itemIds.includes(item.id));
      f.replies.rows[0].submittedScore += target.itemIds.length * 20;
      return { success: true, status: 200, response: { setId: 31, challengeId: 61,
        submittedScore: f.replies.rows[0].submittedScore } };
    } }) });
  const tx = createStreamlinedTransaction({ adapter: provider, journal, lock: { acquire: async () => () => {} } });
  const approval = { approved: true, fingerprint: plan.fingerprint, batchIndices: [0, 1] };
  const result = await tx.execute(plan, approval);
  expect(result.status).toBe('completed');
  expect(result.record.batches.map(batch => batch.state)).toEqual(['confirmed', 'confirmed']);
  expect(result.record.submittedScore).toBe(200);
  expect(JSON.stringify(f.root.repositories)).toBe(before); expect(f.challenge.submittedScore).toBe(0);
  expect((await tx.execute(plan, approval)).status).toBe('completed');
  expect(mutations).toEqual([[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]]);
});
