import { expect, it, vi } from 'vitest';
import { createFc27PuzzleFillTransaction } from '../../src/fc27/puzzle-fill-transaction.js';
import { previewFc27PuzzleSquad } from '../../src/fc27/puzzle-preview.js';
import { puzzleFillFixture } from '../helpers/fc27-puzzle-fill-fixture.js';

function fixture(options = {}) {
  const input = puzzleFillFixture();
  const events = []; let time = 10000; let stopped = false; let record = null; let held = false;
  let plan;
  const stamp = () => ({ context: structuredClone(input.context), fresh: true, observedAt: time, setId: 19, challengeId: 43 });
  const copyInput = () => structuredClone(Object.fromEntries(Object.entries(input).filter(([, value]) => typeof value !== 'function')));
  const adapter = {
    assertCurrent: vi.fn(() => true),
    readInputs: vi.fn(async () => ({ ...stamp(), input: copyInput(), squadEmpty: true })),
    validateItems: vi.fn(async () => { events.push('exact'); return { ...stamp(), items: structuredClone(input.inventory.items) }; }),
    save: vi.fn(async (_plan, beforeDispatch) => { await beforeDispatch(); events.push('save'); return { status: 'confirmed', setId: 19, challengeId: 43 }; }),
    syncSavedSquad: vi.fn(async () => { events.push('sync'); return { status: 'synchronized' }; }),
    readSavedSquad: vi.fn(async () => { events.push('reread'); return { ...stamp(), items: plan.items.map(item =>
      ({ ...structuredClone(item), slot: plan.selected.find(ref => ref.id === item.id).slot })) }; }),
    submit: vi.fn(), move: vi.fn(), buy: vi.fn(),
  };
  const journal = { read: vi.fn(async () => structuredClone(record)), write: vi.fn(async (_scope, value) => {
    if (!held) throw new Error('FC27_EXCLUSIVE_ACCESS_LOST');
    events.push(value.phase); record = structuredClone(value);
  }) };
  const exclusive = vi.fn(async (_scope, task) => { held = true; try { return await task(); } finally { held = false; } });
  const checkOtherTransactions = vi.fn(async () => true);
  const engine = createFc27PuzzleFillTransaction({ enabled: true, adapter, journal, exclusive,
    checkOtherTransactions, now: () => time, createOperationId: () => 'synthetic-fill', shouldStop: () => stopped, ...options });
  plan = engine.prepare(input, previewFc27PuzzleSquad(input));
  const approval = { approved: true, action: 'fill-only', setId: 19, challengeId: 43, count: 1, maxPlayers: 11, maxRating: 74 };
  const approve = () => engine.approve(plan, approval);
  return { input, adapter, journal, engine, plan, approve, approval, exclusive, checkOtherTransactions, events,
    record: () => record, setRecord: value => { record = value; }, advance: value => { time += value; }, stop: () => { stopped = true; } };
}

it('does one locked, journaled save and exact saved reread using shared prepareOnly, with no submission', async () => {
  const x = fixture();
  const result = await x.engine.execute(x.approve().permit);
  expect(result).toMatchObject({ status: 'filled', saved: true, submitted: false, selectedCount: 11 });
  expect(x.events).toEqual(['exact', 'save-pending', 'save', 'reread', 'sync', 'saved']);
  expect(x.adapter.save).toHaveBeenCalledOnce();
  expect(x.adapter.readInputs).toHaveBeenCalledTimes(3);
  expect(x.adapter.submit).not.toHaveBeenCalled(); expect(x.adapter.move).not.toHaveBeenCalled(); expect(x.adapter.buy).not.toHaveBeenCalled();
  expect(x.record()).toMatchObject({ kind: 'puzzle-fill', phase: 'saved', submitted: false });
  expect(JSON.stringify(result)).not.toMatch(/accountScope|definitionId|itemRefs|permit/);
});

it.each([undefined, false, 1, 'true'])('keeps writes disabled for enablement %s', async enabled => {
  const x = fixture({ enabled });
  expect(x.approve().reason).toBe('FC27_PUZZLE_FILL_DISABLED');
  expect((await x.engine.execute({})).reason).toBe('FC27_PUZZLE_FILL_DISABLED');
  expect(x.adapter.save).not.toHaveBeenCalled();
});

it('requires the original plan, exact fill-only approval and a one-use permit', async () => {
  const x = fixture();
  expect(x.engine.approve(structuredClone(x.plan), x.approval).status).toBe('blocked');
  expect(x.engine.approve(x.plan, { ...x.approval, action: 'submit' }).status).toBe('blocked');
  expect(x.engine.approve(x.plan, { ...x.approval, count: 2 }).status).toBe('blocked');
  const permit = x.approve().permit;
  expect(x.approve().status).toBe('blocked');
  expect((await x.engine.execute({})).status).toBe('blocked');
  expect((await x.engine.execute(permit)).status).toBe('filled');
  expect((await x.engine.execute(permit)).status).toBe('blocked');
  expect(x.adapter.save).toHaveBeenCalledOnce();
});

it.each(['expired', 'backwards', 'stop', 'lock', 'journal', 'other-operation', 'occupied', 'stale', 'wrong-target', 'wrong-context', 'missing', 'policy-drift', 'rule-drift'])
('blocks %s before the write boundary', async kind => {
  const x = fixture(); const permit = x.approve().permit;
  if (kind === 'expired') x.advance(60001);
  if (kind === 'backwards') x.advance(-1);
  if (kind === 'stop') x.stop();
  if (kind === 'lock') x.exclusive.mockResolvedValue(null);
  if (kind === 'journal') x.setRecord({ phase: 'save-pending' });
  if (kind === 'other-operation') x.checkOtherTransactions.mockResolvedValue(false);
  const read = x.adapter.readInputs.getMockImplementation();
  if (kind === 'occupied') x.adapter.readInputs.mockImplementation(async () => ({ ...await read(), squadEmpty: false }));
  const exact = x.adapter.validateItems.getMockImplementation();
  if (kind === 'stale') x.adapter.validateItems.mockImplementation(async () => ({ ...await exact(), observedAt: -10000 }));
  if (kind === 'wrong-target') x.adapter.validateItems.mockImplementation(async () => ({ ...await exact(), challengeId: 44 }));
  if (kind === 'wrong-context') x.adapter.validateItems.mockImplementation(async () => ({ ...await exact(), context: {} }));
  if (kind === 'missing') x.adapter.validateItems.mockImplementation(async () => ({ ...await exact(), items: [] }));
  if (kind === 'policy-drift') x.input.policy.protectFsuLockedPlayers = false;
  if (kind === 'rule-drift') x.adapter.validateItems.mockImplementation(async () => {
    const result = await exact(); x.input.challenge.rawRequirements[1].pairs[0].values[0] = 33; return result;
  });
  expect((await x.engine.execute(permit)).status).toBe('blocked');
  expect(x.adapter.save).not.toHaveBeenCalled(); expect(x.journal.write).not.toHaveBeenCalled();
});

it.each(['lost-response', 'rejected', 'reread-failed', 'wrong-slots', 'post-policy', 'journal-failed'])
('retains uncertain write state for %s and never retries', async kind => {
  const x = fixture();
  if (kind === 'lost-response') x.adapter.save.mockImplementation(async (_plan, beforeDispatch) => { await beforeDispatch(); throw new Error('secret raw payload'); });
  if (kind === 'rejected') x.adapter.save.mockImplementation(async (_plan, beforeDispatch) => { await beforeDispatch(); return { status: 'unknown' }; });
  if (kind === 'reread-failed') x.adapter.readSavedSquad.mockRejectedValue(new Error('FC27_PUZZLE_READ_FAILED'));
  const reread = x.adapter.readSavedSquad.getMockImplementation();
  if (kind === 'wrong-slots') x.adapter.readSavedSquad.mockImplementation(async () => {
    const reply = await reread(); reply.items[0].slot = reply.items[1].slot; return reply;
  });
  if (kind === 'post-policy') x.adapter.readSavedSquad.mockImplementation(async () => {
    const reply = await reread(); x.input.policy.protectActiveSquad = false; return reply;
  });
  const write = x.journal.write.getMockImplementation();
  if (kind === 'journal-failed') x.journal.write.mockImplementation(async (scope, value) => {
    if (value.phase === 'saved') throw new Error('private gm error');
    return write(scope, value);
  });
  const permit = x.approve().permit;
  const result = await x.engine.execute(permit);
  expect(result).toMatchObject({ status: 'recovery-required', submitted: false, saved: null });
  expect(x.record().phase).toBe('save-pending');
  expect(x.adapter.save).toHaveBeenCalledOnce(); expect(x.adapter.submit).not.toHaveBeenCalled();
  expect((await x.engine.execute(permit)).status).toBe('blocked');
  expect(JSON.stringify(result)).not.toMatch(/secret|private gm/);
});

it('never saves when the journal boundary cannot be persisted', async () => {
  const x = fixture(); x.journal.write.mockRejectedValue(new Error('GM failed'));
  expect(await x.engine.execute(x.approve().permit)).toMatchObject({ status: 'recovery-required', saved: false });
  expect(x.events).not.toContain('save');
});

it('continues saved reread after stop or TTL expiry during an accepted save', async () => {
  const x = fixture(); const save = x.adapter.save.getMockImplementation();
  x.adapter.save.mockImplementation(async (...args) => { const result = await save(...args); x.stop(); x.advance(61000); return result; });
  expect((await x.engine.execute(x.approve().permit)).status).toBe('filled');
  expect(x.adapter.readSavedSquad).toHaveBeenCalledOnce();
});

it('does not issue a save after expiry while persisting the boundary', async () => {
  const x = fixture(); const write = x.journal.write.getMockImplementation();
  x.journal.write.mockImplementation(async (scope, value) => { await write(scope, value); x.advance(60001); });
  expect(await x.engine.execute(x.approve().permit)).toMatchObject({ status: 'recovery-required', saved: false });
  expect(x.events).not.toContain('save');
});

it.each(['scope-drift', 'expired-evidence', 'unconfirmed-journal'])('stops %s arising during the durable boundary', async kind => {
  const x = fixture(); const write = x.journal.write.getMockImplementation();
  if (kind === 'scope-drift') x.adapter.assertCurrent.mockReturnValue(false);
  if (kind === 'expired-evidence') x.journal.write.mockImplementation(async (scope, value) => {
    await write(scope, value); x.advance(15001);
  });
  if (kind === 'unconfirmed-journal') x.journal.write.mockResolvedValue();
  expect(await x.engine.execute(x.approve().permit)).toMatchObject({ status: kind === 'scope-drift' ? 'blocked' : 'recovery-required', saved: false });
  expect(x.events).not.toContain('save');
});
