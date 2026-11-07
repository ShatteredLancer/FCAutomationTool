import { expect, it, vi } from 'vitest';
import { streamlinedRuntime } from '../helpers/fc27-streamlined-runtime.js';
import { safeItem } from '../helpers/streamlined.js';
import { createFc27StreamlinedExecution } from '../../src/adapters/browser/fc27-streamlined-execution.js';
import { createStreamlinedJournal, streamlinedJournalKey } from '../../src/streamlined/journal.js';
import { createStreamlinedPlan } from '../../src/streamlined/plan.js';
import { normalizeStreamlinedContributionReply } from '../../src/streamlined/contribution.js';
import { contextKey } from '../../src/fc27/prelaunch-contract.js';

async function fixture(pile = 'transfer') {
  const f = streamlinedRuntime(), memory = new Map();
  const get = async (key, fallback = null) => structuredClone(memory.get(key) ?? fallback);
  const set = vi.fn(async (key, value) => memory.set(key, structuredClone(value)));
  const items = [safeItem({ id: 501, definitionId: 600 }), safeItem({ id: 502, definitionId: 601, pile })];
  const challenge = { ...f.plan.challenge, submittedScore: 0, remainingScore: 100, targetScore: 100 };
  const plan = createStreamlinedPlan({ context: f.plan.context, challenge, policy: f.plan.policy,
    result: { status: 'partial', items, batches: items.map(item => [item]), score: 40,
      progress: { target: 100, submitted: 0, added: 40, total: 40, remaining: 60, excess: 0, reached: false },
      purchaseCost: 0, materialValue: 400, searchComplete: true } });
  const journal = createStreamlinedJournal({ get, set });
  const record = await journal.begin(plan);
  Object.assign(record.batches[0], { state: 'confirmed', startingScore: 0,
    receipt: normalizeStreamlinedContributionReply({ success: true, status: 200, response: {
      challengeId: challenge.id, setId: challenge.setId, submittedScore: 20,
    } }, { challengeId: challenge.id, setId: challenge.setId, previousScore: 0, itemIds: [501] }) });
  record.submittedScore = 20;
  const saved = await journal.write(plan.context, record, record.revision);
  const native = vi.fn(); let busy = false;
  const options = { context: plan.context, get, set,
    lockManager: { request: async (name, options, task) => task(busy ? null : { name, mode: options.mode }) },
    createMaintenance: async () => ({}), createProvider: () => ({ request: native }), canWrite: () => false };
  const execution = await createFc27StreamlinedExecution(f.root, options);
  set.mockClear();
  return { execution, journal, plan, saved, memory, get, set, native, busy: () => { busy = true; } };
}

it.each(['club', 'storage', 'transfer', 'unassigned'])('archives settled %s history only on explicit action and retains all receipts', async pile => {
  const f = await fixture(pile);
  expect(await f.execution.inspectContributionHistory(f.plan.challenge)).toMatchObject({ historyAction: { canArchive: true, kind: 'contribution' } });
  expect(f.set).not.toHaveBeenCalled();
  expect(await f.execution.archiveContributionHistory(f.plan.challenge)).toMatchObject({ status: 'archived' });
  expect(await f.journal.read(f.plan.context)).toBeNull();
  const key = streamlinedJournalKey(f.plan.context);
  expect(await f.get(`${key}:history:${f.saved.revision}`)).toEqual(f.saved);
  expect(await f.get(key)).toMatchObject({ retired: true, revision: f.saved.revision + 1 });
  expect(f.native).not.toHaveBeenCalled();
  await expect(f.execution.archiveContributionHistory(f.plan.challenge)).rejects.toThrow('RECOVERY_REQUIRED');
});

it.each(['pending', 'unknown', 'missing-receipt', 'changed-score', 'waiting-dispatch'])('does not retire %s evidence or offer a misleading enabled action', async scenario => {
  const f = await fixture(), changed = structuredClone(f.saved);
  let reason;
  if (['pending', 'unknown'].includes(scenario)) { changed.batches[0].state = scenario; reason = 'CONTRIBUTION_PENDING'; }
  if (scenario === 'missing-receipt') { delete changed.batches[0].receipt; reason = 'RECEIPT_UNVERIFIED'; }
  if (scenario === 'changed-score') { changed.batches[0].progressChanged = true; reason = 'PROGRESS_CHANGED'; }
  if (scenario === 'waiting-dispatch') { changed.batches[1].progressChanged = true; reason = 'PROGRESS_CHANGED'; }
  f.memory.set(streamlinedJournalKey(f.plan.context), changed);
  expect(await f.execution.inspectContributionHistory(f.plan.challenge)).toMatchObject({ historyAction: {
    canArchive: false, reason: `FC27_STREAMLINED_HISTORY_${reason}` } });
  await expect(f.execution.archiveContributionHistory(f.plan.challenge)).rejects.toThrow('RECOVERY_REQUIRED');
  expect(f.set).not.toHaveBeenCalled(); expect(f.native).not.toHaveBeenCalled();
});

it.each(['move', 'changed-record', 'lock'])('rechecks %s after offering retirement and preserves the active record', async drift => {
  const f = await fixture();
  await f.execution.inspectContributionHistory(f.plan.challenge);
  if (drift === 'move') f.memory.set(contextKey(f.plan.context, 'streamlined-materialization'), { schema: 1,
    entries: [{ id: 502, definitionId: 601, pile: 'transfer', state: 'pending',
      setId: f.plan.challenge.setId, challengeId: f.plan.challenge.id }] });
  if (drift === 'changed-record') f.memory.set(streamlinedJournalKey(f.plan.context), { ...f.saved, revision: f.saved.revision + 1 });
  if (drift === 'lock') f.busy();
  await expect(f.execution.archiveContributionHistory(f.plan.challenge)).rejects.toThrow(
    drift === 'move' ? 'MATERIALIZE_RECOVERY_REQUIRED' : drift === 'lock' ? 'BUSY' : 'JOURNAL_CHANGED');
  expect(f.set).not.toHaveBeenCalled(); expect(f.native).not.toHaveBeenCalled();
  expect(await f.journal.read(f.plan.context)).not.toBeNull();
});
