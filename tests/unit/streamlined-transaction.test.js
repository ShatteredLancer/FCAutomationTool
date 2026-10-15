import { expect, it, vi } from 'vitest';
import { createStreamlinedTransaction } from '../../src/streamlined/transaction.js';
import { createStreamlinedJournal } from '../../src/streamlined/journal.js';
import { testPlan, safeItem } from '../helpers/streamlined.js';
import { normalizeStreamlinedContributionReply } from '../../src/streamlined/contribution.js';

const receipt = (plan, batch, previousScore = 0, completed = false) => normalizeStreamlinedContributionReply({
  success: true, status: 200, response: { challengeId: plan.challenge.id, setId: plan.challenge.setId,
    submittedScore: previousScore + batch.refs.reduce((sum, ref) => sum + ref.points, 0),
    grantedChallengeAwards: completed ? [{ type: 'pack' }] : [], grantedSetAwards: [] },
}, { challengeId: plan.challenge.id, setId: plan.challenge.setId, previousScore, itemIds: batch.refs.map(ref => ref.id) });

function setup(options = {}) {
  const store = new Map(), events = [], plan = testPlan();
  const journal = createStreamlinedJournal({ get: async key => store.get(key),
    set: async (key, value) => { store.set(key, structuredClone(value)); events.push(`persist:${value.batches.map(b => b.state)}`); }, now: () => 100 });
  const adapter = { capabilities: { contributionVerified: true },
    verify: vi.fn(async () => true), contribute: vi.fn(async () => { events.push('contribute'); return { status: 'accepted' }; }),
    reconcile: vi.fn(async (record, batch) => { events.push('reconcile'); return {
      fresh: true, context: record.context, setId: 31, challengeId: 61, observedAt: 100,
      absent: batch.refs, submittedScore: record.submittedScore + 20, operationConfirmed: true }; }) };
  const release = vi.fn(), lock = { acquire: async () => release };
  const tx = createStreamlinedTransaction({ adapter, journal, lock, now: () => 100, ...options });
  const approval = { approved: true, fingerprint: plan.fingerprint, batchIndices: [0, 1] };
  return { tx, adapter, journal, lock, plan, approval, events, release };
}

it('keeps accepted response, failed readback and repeated recovery causes without resending', async () => {
  const onDiagnostic = vi.fn(), f = setup({ onDiagnostic });
  f.adapter.contribute.mockImplementation(async (plan, batch) => receipt(plan, batch));
  f.adapter.reconcile.mockRejectedValue(Error('FC27_STREAMLINED_MATERIAL_STILL_PRESENT'));
  const result = await f.tx.execute(f.plan, f.approval);
  expect(result).toMatchObject({ status: 'recovery-required', reason: 'FC27_STREAMLINED_MATERIAL_STILL_PRESENT' });
  expect(result.confirmation).toBeUndefined();
  expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ phase: 'response', status: 'accepted', httpStatus: 200 }));
  expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ phase: 'readback', status: 'blocked',
    reason: 'FC27_STREAMLINED_MATERIAL_STILL_PRESENT', count: 1, currentScore: 0, targetScore: 40 }));
  for (let i = 0; i < 2; i++) expect(await f.tx.recover(f.plan.context)).toMatchObject({
    status: 'recovery-required', reason: 'FC27_STREAMLINED_MATERIAL_STILL_PRESENT' });
  expect(f.adapter.contribute).toHaveBeenCalledOnce();
  expect((await f.journal.read(f.plan.context)).batches[0]).toMatchObject({ state: 'unknown', receipt: { status: 'accepted' } });
  expect(JSON.stringify(onDiagnostic.mock.calls)).not.toMatch(/itemIds|accountScope|fingerprint|"refs"/);
});

it('retains the exact method path and bounded hashes when fresh material validation blocks', async () => {
  const onDiagnostic = vi.fn(), f = setup({ onDiagnostic });
  f.adapter.verify.mockRejectedValue(Object.assign(Error('FC27_TRANSACTION_METHOD_UNREVIEWED'), {
    methodPath: 'methods.search', observedHash: 'a'.repeat(64), expectedHash: 'b'.repeat(64),
    sourceCode: 'private-source', accountScope: 'private-account', token: 'private-token',
  }));
  expect(await f.tx.execute(f.plan, f.approval)).toMatchObject({ status: 'blocked', reason: 'FC27_TRANSACTION_METHOD_UNREVIEWED' });
  expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ phase: 'validation', status: 'blocked',
    methodPath: 'methods.search', observedHash: 'a'.repeat(64), expectedHash: 'b'.repeat(64) }));
  expect(f.adapter.contribute).not.toHaveBeenCalled();
  expect(JSON.stringify(onDiagnostic.mock.calls)).not.toMatch(/private-|sourceCode|accountScope|token/);
});

it('records the original dispatch error separately from missing-receipt readback', async () => {
  const onDiagnostic = vi.fn(), f = setup({ onDiagnostic });
  f.adapter.contribute.mockRejectedValue(Error('FC27_STREAMLINED_CONTRIBUTION_UNCONFIRMED'));
  f.adapter.reconcile.mockRejectedValue(Error('FC27_STREAMLINED_RECEIPT_REQUIRED'));
  expect(await f.tx.execute(f.plan, f.approval)).toMatchObject({ status: 'recovery-required', reason: 'FC27_STREAMLINED_RECEIPT_REQUIRED' });
  expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ phase: 'dispatch', status: 'unknown',
    reason: 'FC27_STREAMLINED_CONTRIBUTION_UNCONFIRMED' }));
  expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ phase: 'readback', reason: 'FC27_STREAMLINED_RECEIPT_REQUIRED' }));
  expect(f.adapter.contribute).toHaveBeenCalledOnce();
});

it.each([
  ['unknown', 'EA_CONTRIBUTION_RESPONSE_CONFLICT', 200],
  ['unknown', 'EA_CONTRIBUTION_RESPONSE_UNVERIFIED', 521],
  ['rejected', 'EA_SQUAD_CONFLICT', 200],
  ['rejected', 'EA_CONTRIBUTION_REJECTED', 409],
])('retains the fixed normalized %s response reason %s without changing its outcome', async (status, reason, code) => {
  const onDiagnostic = vi.fn(), f = setup({ onDiagnostic });
  f.adapter.contribute.mockResolvedValue({ status, reason, code });
  f.adapter.reconcile.mockRejectedValue(Error('FC27_STREAMLINED_RECEIPT_REQUIRED'));
  expect((await f.tx.execute(f.plan, f.approval)).status).toBe(status === 'rejected' ? 'rejected' : 'recovery-required');
  expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ phase: 'response', status, httpStatus: code,
    reason: `FC27_STREAMLINED_${reason}` }));
  expect(f.adapter.contribute).toHaveBeenCalledOnce();
});

it('distinguishes validation and finalization failures without exporting arbitrary error text', async () => {
  const onDiagnostic = vi.fn(), f = setup({ onDiagnostic });
  f.adapter.verify.mockRejectedValueOnce(Error('secret https://example.test/?token=secret'));
  expect((await f.tx.execute(f.plan, f.approval)).status).toBe('blocked');
  expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ phase: 'validation', status: 'blocked',
    reason: 'FC27_STREAMLINED_TRANSACTION_UNCONFIRMED' }));
  f.adapter.contribute.mockImplementation(async (plan, batch) => receipt(plan, batch));
  f.adapter.finalize = vi.fn(async () => false);
  expect((await f.tx.execute(f.plan, f.approval)).status).toBe('recovery-required');
  expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ phase: 'finalization', status: 'blocked',
    reason: 'FC27_STREAMLINED_FINALIZATION_REQUIRED' }));
  expect(JSON.stringify(onDiagnostic.mock.calls)).not.toMatch(/secret|example\.test|token/);
});

it('records receipt validation failure while keeping the dispatched batch unknown', async () => {
  const onDiagnostic = vi.fn(), f = setup({ onDiagnostic });
  f.adapter.contribute.mockResolvedValue({ schema: 1, status: 'accepted', code: 200 });
  expect(await f.tx.execute(f.plan, f.approval)).toMatchObject({ status: 'recovery-required', reason: 'FC27_STREAMLINED_RECEIPT_INVALID' });
  expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ phase: 'receipt', status: 'invalid', reason: 'FC27_STREAMLINED_RECEIPT_INVALID' }));
  expect((await f.journal.read(f.plan.context)).batches[0].state).toBe('unknown');
  expect(f.adapter.contribute).toHaveBeenCalledOnce();
  expect(f.adapter.reconcile).not.toHaveBeenCalled();
});

it.each(['throw', 'reject'])('does not let a diagnostic %s alter writes, receipts or recovery', async mode => {
  const onDiagnostic = vi.fn(() => { if (mode === 'throw') throw Error('diagnostic failed'); return Promise.reject(Error('diagnostic failed')); });
  const f = setup({ onDiagnostic });
  expect((await f.tx.execute(f.plan, f.approval)).status).toBe('completed');
  expect(onDiagnostic).toHaveBeenCalled();
  expect((await f.tx.recover(f.plan.context)).status).toBe('observed');
  expect(f.adapter.contribute).toHaveBeenCalledTimes(2);
});
it('persists before writes, reconciles each batch and does not repeat confirmed contributions', async () => {
  const f = setup();
  expect((await f.tx.execute(f.plan, f.approval)).status).toBe('completed');
  expect(f.events.slice(0, 5)).toEqual(['persist:waiting,waiting', 'persist:pending,waiting', 'contribute', 'reconcile', 'persist:confirmed,waiting']);
  expect((await f.tx.execute(f.plan, f.approval)).status).toBe('completed');
  expect(f.adapter.contribute).toHaveBeenCalledTimes(2);
  expect((await f.journal.read(f.plan.context)).rewardState).toBe('unknown');
  expect(f.release).toHaveBeenCalledTimes(2);
});

it('starts a distinct plan after terminal batches but never overwrites unfinished batches', async () => {
  const f = setup();
  const next = testPlan({ inventory: [safeItem({ id: 7, definitionId: 8 }), safeItem({ id: 9, definitionId: 10 })] });
  const approval = { ...f.approval, fingerprint: next.fingerprint };
  await f.tx.execute(f.plan, { ...f.approval, batchIndices: [0] });
  expect((await f.tx.execute(next, approval)).reason).toContain('RECOVERY_REQUIRED');
  await f.tx.execute(f.plan, f.approval);
  expect((await f.tx.execute(next, approval)).status).toBe('completed');
  expect(f.adapter.contribute).toHaveBeenCalledTimes(4);
});

it('allows fresh approval after preflight failed before any dispatch, but keeps unknown receipts blocked', async () => {
  const f = setup();
  f.adapter.verify.mockRejectedValueOnce(Error('FC27_BUY_RECOVERY_REQUIRED'));
  expect((await f.tx.execute(f.plan, f.approval)).reason).toBe('FC27_BUY_RECOVERY_REQUIRED');
  expect(f.adapter.contribute).not.toHaveBeenCalled();
  const next = testPlan({ inventory: [safeItem({ id: 7, definitionId: 8 }), safeItem({ id: 9, definitionId: 10 })] });
  const approval = { ...f.approval, fingerprint: next.fingerprint };
  expect((await f.tx.execute(next, approval)).status).toBe('completed');
  const g = setup(); g.adapter.reconcile.mockResolvedValue({});
  expect((await g.tx.execute(g.plan, g.approval)).status).toBe('recovery-required');
  expect((await g.tx.execute(next, approval)).reason).toContain('RECOVERY_REQUIRED');
  expect(g.adapter.contribute).toHaveBeenCalledOnce();
});

it('persists unexpected progress across both immediate reconciliation and later recovery', async () => {
  for (const recover of [false, true]) {
    const f = setup(), original = f.adapter.reconcile.getMockImplementation();
    f.adapter.reconcile.mockImplementation(async (...args) => ({ ...await original(...args), submittedScore: 10 }));
    if (recover) f.adapter.reconcile.mockResolvedValueOnce({});
    expect((await f.tx.execute(f.plan, f.approval)).status).toBe(recover ? 'recovery-required' : 'replan-required');
    if (recover) expect((await f.tx.recover(f.plan.context)).status).toBe('replan-required');
    expect((await f.tx.execute(f.plan, f.approval)).reason).toContain('PROGRESS_CHANGED');
    expect(f.adapter.contribute).toHaveBeenCalledTimes(1);
  }
});
it('stops after reconciliation and resumes the remaining batch', async () => {
  const f = setup();
  f.adapter.contribute.mockImplementationOnce(async () => { f.tx.stop(); return { status: 'accepted' }; });
  expect((await f.tx.execute(f.plan, f.approval)).status).toBe('stopped');
  expect(f.adapter.reconcile).toHaveBeenCalledTimes(1);
  expect((await f.tx.execute(f.plan, f.approval)).status).toBe('completed');
  expect(f.adapter.contribute).toHaveBeenCalledTimes(2);
});
it('recovers failed local finalization without a second contribution or consuming the next batch', async () => {
  const f = setup();
  f.adapter.contribute.mockImplementation(async (plan, batch) => receipt(plan, batch));
  f.adapter.finalize = vi.fn().mockRejectedValueOnce(Error('cache unavailable')).mockResolvedValueOnce(false).mockResolvedValue(true);
  const result = await f.tx.execute(f.plan, f.approval);
  expect(result.status).toBe('recovery-required');
  expect(result.confirmation).toEqual({ submittedScore: 20, targetScore: 40, completed: false, finalizationPending: true });
  const pending = await f.journal.read(f.plan.context);
  expect(pending.batches[0].state).toBe('unknown'); expect(pending.batches[0].receipt.status).toBe('accepted');
  expect(pending.batches[1].state).toBe('waiting');
  expect(await f.tx.recover(f.plan.context)).toMatchObject({ status: 'recovery-required', confirmation: result.confirmation });
  expect((await f.tx.recover(f.plan.context)).status).toBe('recovered');
  expect(f.adapter.contribute).toHaveBeenCalledTimes(1);
  expect(f.adapter.finalize).toHaveBeenCalledTimes(3);
});
it('keeps the specific sanitized readback failure and the accepted receipt for recovery', async () => {
  const f = setup();
  f.adapter.contribute.mockImplementation(async (plan, batch) => receipt(plan, batch));
  f.adapter.reconcile.mockRejectedValueOnce(Error('FC27_STREAMLINED_CYCLE_RESET_UNVERIFIED'));
  const result = await f.tx.execute(f.plan, f.approval);
  expect(result.reason).toBe('FC27_STREAMLINED_CYCLE_RESET_UNVERIFIED');
  expect(result.record.batches[0]).toMatchObject({ state: 'unknown', receipt: { status: 'accepted' } });
  expect((await f.tx.recover(f.plan.context)).status).toBe('recovered');
  expect(f.adapter.contribute).toHaveBeenCalledOnce();
});
it('never retries an unknown contribution; fresh recovery does not send a write', async () => {
  const f = setup();
  f.adapter.contribute.mockRejectedValueOnce(Error('timeout'));
  f.adapter.reconcile.mockResolvedValueOnce({});
  expect((await f.tx.execute(f.plan, f.approval)).status).toBe('recovery-required');
  expect((await f.tx.execute(f.plan, f.approval)).reason).toContain('RECOVERY_REQUIRED');
  expect((await f.tx.recover(f.plan.context)).status).toBe('recovered');
  expect(f.adapter.contribute).toHaveBeenCalledTimes(1);
  expect((await f.tx.execute(f.plan, f.approval)).status).toBe('completed');
});
it('rejects stale, wrong-account and inconsistent progress evidence', async () => {
  for (const delta of [{ observedAt: 101 }, { context: {} }, { submittedScore: 0 }, { absent: [] }]) {
    const f = setup(), original = f.adapter.reconcile.getMockImplementation();
    f.adapter.reconcile.mockImplementation(async (...args) => ({ ...await original(...args), ...delta }));
    expect((await f.tx.execute(f.plan, f.approval)).status).toBe('recovery-required');
    expect(f.adapter.contribute).toHaveBeenCalledTimes(1);
  }
});
it('requires verified write capability, exact approval, fresh materials and successful persistence', async () => {
  for (const mutate of [f => { f.adapter.capabilities.contributionVerified = false; },
    f => { f.approval.approved = false; }, f => { f.adapter.verify.mockResolvedValue(false); },
    f => { f.journal = { ...f.journal, write: async () => { throw Error('disk'); } };
      f.tx = createStreamlinedTransaction({ adapter: f.adapter, journal: f.journal, lock: f.lock }); }]) {
    const f = setup(); mutate(f);
    expect((await f.tx.execute(f.plan, f.approval)).status).toBe('blocked');
    expect(f.adapter.contribute).not.toHaveBeenCalled();
  }
});
it('does not continue after an explicit rejection or concurrent execute', async () => {
  const f = setup();
  f.adapter.contribute.mockImplementationOnce(async () => {
    expect((await f.tx.execute(f.plan, f.approval)).reason).toContain('BUSY');
    return { status: 'rejected' };
  });
  expect((await f.tx.execute(f.plan, f.approval)).status).toBe('rejected');
  expect(f.adapter.reconcile).not.toHaveBeenCalled();
  expect((await f.tx.execute(f.plan, f.approval)).reason).toContain('REPLAN_REQUIRED');
});

it('persists the sanitized accepted receipt before reconciliation and retains it across refresh recovery', async () => {
  const f = setup();
  f.adapter.contribute.mockImplementationOnce(async (plan, batch) => receipt(plan, batch));
  f.adapter.reconcile.mockImplementationOnce(async (record, batch) => {
    const stored = await f.journal.read(record.context);
    expect(stored.batches[0].receipt).toEqual(receipt(record.plan, batch));
    throw Error('read timeout');
  });
  expect((await f.tx.execute(f.plan, f.approval)).status).toBe('recovery-required');
  const stored = await f.journal.read(f.plan.context);
  expect(stored.batches[0].receipt).toMatchObject({ status: 'accepted', submittedScore: 20 });
  expect(stored.batches[0].state).toBe('unknown');
  expect((await f.tx.recover(f.plan.context)).status).toBe('recovered');
  expect(f.adapter.contribute).toHaveBeenCalledTimes(1);
});

it('recognizes a verified repeat reset without substituting zero for the committed score', async () => {
  const f = setup(), original = f.adapter.reconcile.getMockImplementation();
  f.adapter.contribute.mockImplementation(async (plan, batch) => receipt(plan, batch, batch.index * 20, batch.index === 1));
  f.adapter.reconcile.mockImplementation(async (record, batch) => ({ ...await original(record, batch),
    ...(batch.index === 1 ? { submittedScore: 0, cycleResetConfirmed: true } : {}) }));
  const result = await f.tx.execute(f.plan, f.approval);
  expect(result.status).toBe('completed');
  expect(result.record.submittedScore).toBe(40);
  expect(result.record.rewardState).toBe('unknown');
  expect((await f.tx.execute(f.plan, f.approval)).status).toBe('completed');
  expect(f.adapter.contribute).toHaveBeenCalledTimes(2);
});

it('does not infer a reset from zero page score or mismatched receipt identity', async () => {
  for (const kind of ['unverified-reset', 'wrong-item', 'wrong-challenge', 'conflicting-score']) {
    const f = setup(), original = f.adapter.reconcile.getMockImplementation();
    f.adapter.contribute.mockImplementationOnce(async (plan, batch) => ({ ...receipt(plan, batch),
      ...(kind === 'wrong-item' ? { itemIds: [999] } : {}),
      ...(kind === 'wrong-challenge' ? { challengeId: 999 } : {}) }));
    f.adapter.reconcile.mockImplementation(async (record, batch) => ({ ...await original(record, batch),
      submittedScore: kind === 'conflicting-score' ? 10 : 0 }));
    expect((await f.tx.execute(f.plan, f.approval)).status).toBe('recovery-required');
    expect(f.adapter.contribute).toHaveBeenCalledTimes(1);
  }
});

it('can contribute a selected later batch, then resume an earlier unchecked batch with real receipts', async () => {
  const f = setup();
  f.adapter.contribute.mockImplementation(async (plan, batch) =>
    receipt(plan, batch, (await f.journal.read(plan.context)).submittedScore));
  expect((await f.tx.execute(f.plan, { ...f.approval, batchIndices: [1] })).status).toBe('partial');
  expect((await f.tx.execute(f.plan, { ...f.approval, batchIndices: [0] })).status).toBe('completed');
  expect(f.adapter.contribute).toHaveBeenCalledTimes(2);
});

it.each(['confirmed', 'rejected', 'unsent'])('keeps %s history of another SBC untouched without page reconciliation', async kind => {
  const f = setup();
  if (kind === 'confirmed') await f.tx.execute(f.plan, f.approval);
  else {
    const record = await f.journal.begin(f.plan);
    if (kind === 'rejected') {
      record.batches.forEach(b => { b.state = 'rejected'; });
      await f.journal.write(f.plan.context, record, record.revision);
    }
  }
  const before = await f.journal.read(f.plan.context), events = [...f.events];
  f.adapter.reconcile.mockClear(); f.adapter.contribute.mockClear(); f.release.mockClear();
  expect(await f.tx.recover(f.plan.context, { setId: 200, challengeId: 300 })).toEqual({ status: 'absent' });
  expect(await f.journal.read(f.plan.context)).toEqual(before);
  expect(f.events).toEqual(events);
  expect(f.adapter.reconcile).not.toHaveBeenCalled();
  expect(f.adapter.contribute).not.toHaveBeenCalled();
  expect(f.release).toHaveBeenCalledOnce();
});

it.each(['pending', 'unknown', 'partial'])('keeps %s history bound to its own target and preserves target-independent recovery', async kind => {
  const f = setup();
  if (kind === 'partial') await f.tx.execute(f.plan, { ...f.approval, batchIndices: [0] });
  else {
    const record = await f.journal.begin(f.plan);
    record.batches[0].state = kind; record.batches[0].startingScore = 0;
    record.batches[0].receipt = receipt(f.plan, record.batches[0]);
    await f.journal.write(f.plan.context, record, record.revision);
  }
  const before = await f.journal.read(f.plan.context);
  f.adapter.reconcile.mockClear(); f.adapter.contribute.mockClear();
  expect(await f.tx.recover(f.plan.context, { setId: 200, challengeId: 300 })).toEqual({
    status: 'recovery-required', reason: 'FC27_STREAMLINED_OTHER_TARGET_RECOVERY_REQUIRED',
    recovery: { setId: 31, challengeId: 61 } });
  expect(await f.journal.read(f.plan.context)).toEqual(before);
  expect(f.adapter.reconcile).not.toHaveBeenCalled();
  expect((await f.tx.recover(f.plan.context)).status).toBe(kind === 'partial' ? 'observed' : 'recovered');
  expect(f.adapter.contribute).not.toHaveBeenCalled();
});
