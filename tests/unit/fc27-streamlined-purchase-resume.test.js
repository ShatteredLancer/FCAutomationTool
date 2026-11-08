import { expect, it, vi } from 'vitest';
import { createFc27StreamlinedSession } from '../../src/adapters/browser/fc27-streamlined-session.js';
import { createStreamlinedProcurement } from '../../src/streamlined/procurement.js';
import { createStreamlinedPurchaseJournal } from '../../src/streamlined/purchase-journal.js';
import { challenge, safeItem, policy, eligibility } from '../helpers/streamlined.js';

// Synthetic identities and materials; replay the observed sequence, not the
// user's inventory: confirmed work -> rejected wave -> recovered purchases -> Solve.
async function setup({ targetScore = 160, budget = 1000 } = {}) {
  const memory = new Map();
  let readHook = async () => {};
  const get = async (key, fallback) => { await readHook(key); return structuredClone(memory.get(key) ?? fallback); };
  const set = async (key, value) => memory.set(key, structuredClone(value));
  const journal = createStreamlinedPurchaseJournal({ get, set });
  const target = challenge({ scoreRequirement: targetScore, selectionLimit: 6 });
  let score = 0, serial = 100, reject = true, time = 20, currentTarget = target;
  const owned = new Map(Array.from({ length: 4 }, (_, index) => {
    const row = safeItem({ id: index + 1, definitionId: index + 11 });
    return [row.id, row];
  }));
  const current = () => ({ ...currentTarget, submittedScore: score, remainingScore: currentTarget.targetScore - score });
  const quote = definitionId => ({ source: 'futbin', definitionId, price: 200, fetchedAt: 1, expiresAt: 100000 });
  const readMarketCandidates = vi.fn(async () => ({ pricePolicy: { source: 'futbin' },
    market: Array.from({ length: 4 }, (_, index) => safeItem({ source: 'market', definitionId: index + 21,
      quote: quote(index + 21) })).map(row => ({ ...row, purchaseMaxBuy: 250 })) }));
  const buyer = {
    assertCurrent: vi.fn(async () => {}), locate: vi.fn(async entry => owned.has(entry.itemId) ? 'club' : 'purchased'),
    readState: vi.fn(async () => ({ submittedScore: score, freeSlots: 30, heldDefinitions: [], blockedDefinitions: [] })),
    find: vi.fn(async item => reject && serial >= 104 ? null
      : ({ definitionId: item.definitionId, itemId: ++serial, tradeId: String(serial + 1000), price: 200 })),
    buy: vi.fn(async entry => ({ ...entry, status: 'bought' })),
    move: vi.fn(async entry => { owned.set(entry.itemId, safeItem({ id: entry.itemId, definitionId: entry.definitionId })); return { status: 'bought' }; }),
    materialize: vi.fn(async entries => entries.map(entry => ({ groupIndex: entry.groupIndex, item: owned.get(entry.itemId) }))),
    prepareContribution: vi.fn(async material => ({ material })),
    contribute: vi.fn(async batch => {
      if (score > 0 && reject) return { notDispatched: true, reason: 'FC27_STREAMLINED_EA_CONTRIBUTION_REJECTED' };
      for (const { item } of batch.material) { score += item.points; owned.delete(item.id); }
      return { confirmed: true, submittedScore: score };
    }),
    recoverContribution: vi.fn(async () => ({ notDispatched: true })),
  };
  const lock = { acquire: async () => () => {} };
  const driver = () => createStreamlinedProcurement({ journal, lock, adapter: buyer, operationId: () => 'synthetic-run', now: () => time });
  const execution = {
    prepare: vi.fn(), transaction: { recover: vi.fn(async () => ({ status: 'absent' })) },
    recoverPurchase: vi.fn(async () => {
      const record = await journal.read(target.context);
      return record ? driver().execute(record.plan, null, { reconcileOnly: true }) : { status: 'absent' };
    }),
    purchase: vi.fn(async (plan, approval) => driver().execute(plan, { ...approval, budget: approval.budget ?? budget,
      attempts: 2, expiresAt: time + 100000 })),
  };
  const session = () => createFc27StreamlinedSession({ get, set, now: () => time,
    inspect: () => ({ context: target.context, challenge: current() }),
    readInputs: () => ({ context: target.context, challenge: current(), policy, eligibility,
      inventory: [...owned.values()], assertCurrent() {} }), readMarketCandidates,
    prices: { load: async ids => ({ policy: { source: 'futbin' }, references: Object.fromEntries(ids.map(id =>
      [id, { quotes: { futbin: quote(id) } }])) }) }, createExecution: async () => execution });
  const first = session(), planned = await first.plan({ objective: 'inventory-first' });
  expect(planned.status).toBe('ready');
  const stopped = await first.contribute({ fingerprint: planned.plan.fingerprint, budget });
  expect(stopped, JSON.stringify(stopped)).toMatchObject({ status: 'recovery-required', record: { submittedScore: 120,
    spent: 800, consumedIds: expect.any(Array) } });
  expect(stopped.record.consumedIds).toHaveLength(6);
  expect(stopped.record.entries.filter(entry => entry.state === 'club')).toHaveLength(2);
  const before = structuredClone(stopped.record);
  reject = false;
  buyer.buy.mockClear(); buyer.move.mockClear(); buyer.contribute.mockClear();
  readMarketCandidates.mockClear();
  return { session: session(), execution, buyer, readMarketCandidates, journal, target, before, memory,
    setTime: value => { time = value; }, setTarget: value => { currentTarget = value; }, setReadHook: value => { readHook = value; } };
}

it('Solve after reload restores the existing purchased run, then consumes only its two remaining cards', async () => {
  const f = await setup();
  const result = await f.session.plan({ objective: 'inventory-first' });
  expect(result).toMatchObject({ status: 'recovered', plan: { fingerprint: f.before.fingerprint },
    record: { budget: 1000, spent: 800, submittedScore: 120 }, liveExecutionEnabled: true });
  expect(f.readMarketCandidates).not.toHaveBeenCalled();
  expect(f.buyer.buy).not.toHaveBeenCalled(); expect(f.buyer.contribute).not.toHaveBeenCalled();
  const completed = await f.session.contribute({ fingerprint: result.plan.fingerprint, budget: result.record.budget });
  expect(completed).toMatchObject({ status: 'completed', record: { spent: 800, submittedScore: 160, confirmedBatches: 2 } });
  expect(f.buyer.buy).not.toHaveBeenCalled(); expect(f.buyer.move).not.toHaveBeenCalled();
  expect(f.buyer.contribute).toHaveBeenCalledOnce();
  expect(f.buyer.contribute.mock.calls[0][0].material.map(row => row.item.id).sort()).toEqual(
    f.before.entries.filter(entry => entry.state === 'club').map(entry => entry.itemId).sort());
});

it('expired planning quotes do not discard the run or repurchase its two verified Club cards', async () => {
  const f = await setup(); f.setTime(100001);
  const result = await f.session.plan({ objective: 'inventory-first' });
  expect(result.status).toBe('recovered');
  expect(result.plan.fingerprint === f.before.fingerprint).toBe(true);
  expect(await f.session.contribute({ fingerprint: result.plan.fingerprint, budget: 1000 }))
    .toMatchObject({ status: 'completed', record: { spent: 800, submittedScore: 160 } });
  expect(f.readMarketCandidates).not.toHaveBeenCalled(); expect(f.buyer.buy).not.toHaveBeenCalled();
});

it('resumes acquired cards before buying only the remaining demand within original caps and budget', async () => {
  const f = await setup({ targetScore: 200, budget: 1500 });
  const result = await f.session.plan({ objective: 'inventory-first' });
  const completed = await f.session.contribute({ fingerprint: result.plan.fingerprint, budget: 1500 });
  expect(completed).toMatchObject({ status: 'completed', record: { spent: 1200, submittedScore: 200, budget: 1500 } });
  expect(f.buyer.buy).toHaveBeenCalledTimes(2);
  expect(f.buyer.contribute.mock.calls[0][0].material.map(row => row.item.id)).toEqual(expect.arrayContaining(
    f.before.entries.filter(entry => entry.state === 'club').map(entry => entry.itemId)));
  expect(f.buyer.find.mock.calls.every(([_item, cap]) => cap <= 250)).toBe(true);
});

it('does not redirect Solve if the target changes during the retired-history read', async () => {
  const f = await setup();
  let reads = 0;
  f.setReadHook(async key => {
    if (key.endsWith(':retired')) { reads++; f.setTarget({ ...f.target, id: f.target.id + 1 }); }
  });
  const result = await f.session.plan({ objective: 'inventory-first' });
  expect(reads).toBe(1); expect(result).toMatchObject({ status: 'blocked', reason: 'FC27_STREAMLINED_CONTEXT_CHANGED' });
  expect(f.execution.recoverPurchase).not.toHaveBeenCalled();
  expect(f.buyer.buy).not.toHaveBeenCalled(); expect(f.buyer.contribute).not.toHaveBeenCalled();
});

it('holds the busy guard across the preflight read and recovery', async () => {
  const f = await setup(); let finish;
  f.setReadHook(key => key.endsWith(':retired') && !finish ? new Promise(resolve => { finish = resolve; }) : Promise.resolve());
  const pending = f.session.plan({ objective: 'inventory-first' });
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  expect(await f.session.plan({ objective: 'inventory-first' })).toMatchObject({ reason: 'FC27_STREAMLINED_BUSY' });
  expect(await f.session.recover()).toMatchObject({ reason: 'FC27_STREAMLINED_BUSY' });
  finish(); expect((await pending).status).toBe('recovered');
  expect(f.execution.recoverPurchase).toHaveBeenCalledOnce();
});

it('does not fall back to a new plan after a malformed active journal', async () => {
  const f = await setup();
  const key = [...f.memory.keys()].find(value => value.includes('streamlined-market-run'));
  f.memory.set(key, { ...f.before, spent: f.before.budget + 1 });
  expect(await f.session.plan({ objective: 'inventory-first' })).toMatchObject({ status: 'blocked',
    reason: 'FC27_STREAMLINED_PURCHASE_JOURNAL_INVALID' });
  expect(f.execution.recoverPurchase).not.toHaveBeenCalled(); expect(f.readMarketCandidates).not.toHaveBeenCalled();
  expect(f.buyer.buy).not.toHaveBeenCalled(); expect(f.buyer.contribute).not.toHaveBeenCalled();
});

it('Solve after explicit recovery retains the same journal identity and frozen budget', async () => {
  const f = await setup();
  expect(await f.session.recover()).toMatchObject({ status: 'recovered' });
  const result = await f.session.plan({ objective: 'lowest-value' });
  expect(result).toMatchObject({ plan: { fingerprint: f.before.fingerprint }, record: { budget: 1000, spent: 800 } });
  expect(f.readMarketCandidates).not.toHaveBeenCalled();
  expect(f.buyer.buy).not.toHaveBeenCalled(); expect(f.buyer.contribute).not.toHaveBeenCalled();
});

it('does not replace a run or enable contribution when the acquired cards cannot be verified', async () => {
  const f = await setup();
  f.buyer.locate.mockResolvedValue('missing');
  const result = await f.session.plan({ objective: 'inventory-first' });
  expect(result.status).toBe('recovery-required'); expect(result.plan).toBeUndefined();
  expect((await f.journal.read(f.target.context)).fingerprint === f.before.fingerprint).toBe(true);
  expect(f.readMarketCandidates).not.toHaveBeenCalled(); expect(f.buyer.buy).not.toHaveBeenCalled();
  expect((await f.session.contribute({ fingerprint: f.before.fingerprint })).status).toBe('blocked');
  expect(f.buyer.contribute).not.toHaveBeenCalled();
});

it('retains the original budget and refuses a higher budget on the continuation click', async () => {
  const f = await setup(), result = await f.session.plan({ objective: 'inventory-first' });
  expect(await f.session.contribute({ fingerprint: result.plan.fingerprint, budget: 1001 }))
    .toMatchObject({ reason: 'FC27_STREAMLINED_PURCHASE_APPROVAL_CHANGED' });
  expect(f.buyer.buy).not.toHaveBeenCalled(); expect(f.buyer.contribute).not.toHaveBeenCalled();
  expect((await f.journal.read(f.target.context)).budget).toBe(1000);
});

it('keeps protection/preparation failure blocking the recovered preview', async () => {
  const f = await setup();
  f.execution.prepare.mockImplementation(() => { throw Error('FC27_STREAMLINED_PROTECTION_UNVERIFIED'); });
  expect(await f.session.plan({ objective: 'inventory-first' })).toMatchObject({ status: 'recovery-required',
    reason: 'FC27_STREAMLINED_PROTECTION_UNVERIFIED' });
  expect((await f.session.contribute({ fingerprint: f.before.fingerprint })).status).toBe('blocked');
  expect(f.buyer.buy).not.toHaveBeenCalled(); expect(f.buyer.contribute).not.toHaveBeenCalled();
});

it('cancels Solve during read-only recovery without leaving an executable preview', async () => {
  const f = await setup(); let finish;
  f.execution.recoverPurchase.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.session.plan({ objective: 'inventory-first' });
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  f.session.stop(); finish({ status: 'recovered', record: f.before });
  expect(await pending).toMatchObject({ status: 'cancelled' });
  expect((await f.session.contribute({ fingerprint: f.before.fingerprint })).status).toBe('blocked');
  expect(f.buyer.buy).not.toHaveBeenCalled(); expect(f.buyer.contribute).not.toHaveBeenCalled();
});
