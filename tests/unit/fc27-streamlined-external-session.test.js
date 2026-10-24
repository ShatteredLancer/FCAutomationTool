import { expect, it, vi } from 'vitest';
import { createFc27StreamlinedSession } from '../../src/adapters/browser/fc27-streamlined-session.js';
import { challenge, safeItem, policy, eligibility } from '../helpers/streamlined.js';

function fixture() {
  let current = true;
  const c = challenge({ scoreRequirement: 100 });
  const state = { inventory: [safeItem({ id: 1, definitionId: 100 }),
    safeItem({ id: 2, definitionId: 100, pile: 'transfer' }), safeItem({ id: 3, definitionId: 100, pile: 'unassigned' })], policy };
  const set = vi.fn(), prices = { load: vi.fn() }, prepare = vi.fn(), execute = vi.fn(async () => ({ status: 'partial' }));
  const readInputs = vi.fn(() => ({ ...state, context: c.context, challenge: c, eligibility,
    assertCurrent() {}, resolveDisplayItem: ref => state.inventory.find(i => i.id === ref.id) }));
  const createExecution = vi.fn(async () => ({ prepare, transaction: { execute } }));
  const session = createFc27StreamlinedSession({ inspect: () => {
    if (!current) throw Error('FC27_STREAMLINED_CONTEXT_CHANGED');
    return { context: c.context, challenge: c };
  }, readInputs, createExecution, prices, get: async () => null, set });
  return { state, session, prices, set, prepare, execute, readInputs, createExecution, changeContext: () => { current = false; } };
}

it('browses both external piles and prepares exact selection without quotes, persistence or mutation', async () => {
  const f = fixture();
  const view = await f.session.readExternalInventory({ maxRating: 90 });
  expect(view.rows.map(r => r.item.pile)).toEqual(['transfer', 'unassigned']);
  expect(f.readInputs.mock.calls[0][0].sources).toEqual(['club', 'transfer', 'unassigned']);
  expect(f.session.resolveDisplayItem(view.rows[0].item)).toBe(f.state.inventory[1]);
  const result = await f.session.planExternalSelection(['item:2', 'item:3']);
  expect(result).toMatchObject({ status: 'partial', liveExecutionEnabled: true, externalSelection: true });
  expect(result.batches.map(b => b.map(i => i.id))).toEqual([[1], [2], [3]]);
  expect(f.prepare).toHaveBeenCalledOnce(); expect(f.set).not.toHaveBeenCalled();
  expect(f.execute).not.toHaveBeenCalled(); expect(f.prices.load).not.toHaveBeenCalled();
  expect((await f.session.contribute({ fingerprint: result.plan.fingerprint, batchIndices: [1] })).status).toBe('blocked');
  expect(f.execute).not.toHaveBeenCalled();
  await f.session.contribute({ fingerprint: result.plan.fingerprint, batchIndices: [0, 1, 2], allowPartial: true });
  expect(f.execute).toHaveBeenCalledOnce();
});

it.each(['pile', 'protection', 'prerequisite', 'missing'])('rejects %s drift before preparing and invalidates display references', async kind => {
  const f = fixture(); const read = await f.session.readExternalInventory({ maxRating: 90 });
  if (kind === 'pile') f.state.inventory[1] = { ...f.state.inventory[1], pile: 'club', executionPile: undefined };
  if (kind === 'protection') f.state.policy = { ...policy, protectFsuLockedPlayers: true };
  if (kind === 'prerequisite') f.state.inventory[0] = safeItem({ id: 99, definitionId: 100 });
  if (kind === 'missing') f.state.inventory = f.state.inventory.filter(i => i.id !== 2);
  expect(await f.session.planExternalSelection(['item:2'])).toMatchObject({ status: 'blocked', reason: 'FC27_STREAMLINED_EXTERNAL_SELECTION_CHANGED' });
  expect(f.prepare).not.toHaveBeenCalled(); expect(f.session.resolveDisplayItem(read.rows[0].item)).toBeNull();
});

it('closing and target drift discard only ephemeral selection', async () => {
  const f = fixture(); const read = await f.session.readExternalInventory({ maxRating: 90 });
  f.session.clearPreview();
  expect(f.session.resolveDisplayItem(read.rows[0].item)).toBeNull();
  expect((await f.session.planExternalSelection(['item:2'])).status).toBe('blocked');
  await f.session.readExternalInventory({ maxRating: 90 }); f.changeContext();
  expect((await f.session.planExternalSelection(['item:2'])).reason).toBe('FC27_STREAMLINED_CONTEXT_CHANGED');
  expect(f.set).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
});

it('stopping while execution preparation is pending cannot resurrect a closed preview', async () => {
  const f = fixture(); let release;
  f.createExecution.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const read = await f.session.readExternalInventory({ maxRating: 90 });
  const pending = f.session.planExternalSelection(['item:2']);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  f.session.stop(); f.session.clearPreview();
  release({ prepare: f.prepare, transaction: { execute: f.execute } });
  expect(await pending).toMatchObject({ status: 'blocked', reason: 'FC27_STREAMLINED_CANCELLED' });
  expect(f.prepare).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
  expect(f.session.resolveDisplayItem(read.rows[0].item)).toBeNull();
  expect(f.set).not.toHaveBeenCalled();
});

it('recovers frozen external order without selecting or replaying its prerequisite separately', async () => {
  const f = fixture(); await f.session.readExternalInventory({ maxRating: 90 });
  const prepared = await f.session.planExternalSelection(['item:2', 'item:3']);
  const record = { context: prepared.plan.context, plan: prepared.plan, submittedScore: 20,
    batches: prepared.plan.batches.map((refs, index) => ({ index, refs, state: index === 0 ? 'confirmed' : 'waiting' })) };
  f.createExecution.mockResolvedValueOnce({ prepare: f.prepare, transaction: { execute: f.execute,
    recover: vi.fn(async () => ({ status: 'observed', record })) } });
  f.state.inventory.shift();
  const recovered = await f.session.recover();
  expect(recovered.preview).toMatchObject({ externalSelection: true, liveExecutionEnabled: true, record });
  expect(f.readInputs.mock.lastCall[0].sources).toEqual(['club', 'transfer', 'unassigned']);
  expect((await f.session.contribute({ fingerprint: prepared.plan.fingerprint, batchIndices: [1, 2] })).status).toBe('blocked');
  await f.session.contribute({ fingerprint: prepared.plan.fingerprint, batchIndices: [0, 1, 2], allowPartial: true });
  expect(f.execute).toHaveBeenCalledOnce(); expect(f.prices.load).not.toHaveBeenCalled();
});
