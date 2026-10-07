import { expect, it, vi } from 'vitest';
import { streamlinedRuntime, pendingContribution } from '../helpers/fc27-streamlined-runtime.js';
import { recoverFc27Streamlined } from '../../src/adapters/browser/fc27-streamlined-recovery.js';

it('settles a completed journal without a work area and repeats no contribution or read on the next login', async () => {
  const f = streamlinedRuntime({ targetScore: 100 }), { journal, record } = await pendingContribution(f);
  record.batches[0].receipt.challengeCompleted = true; record.batches[0].receipt.challengeAwardCount = 1;
  await journal.write(f.input.context, record, record.revision);
  f.state.players = []; f.replies.rows[0].status = 'COMPLETED'; f.replies.rows[0].timesCompleted = 1;
  f.root.getAppMain = () => null;
  const release = vi.fn(), createPersistence = () => ({ journal, lock: { acquire: async () => release } });
  expect(await recoverFc27Streamlined(f.root, { createPersistence, now: () => 1000 }))
    .toMatchObject({ status: 'recovered', currentScore: 100, targetScore: 100, setId: 31, challengeId: 61 });
  expect((await journal.read(f.input.context)).batches[0].state).toBe('confirmed');
  const calls = f.calls.length;
  expect(await recoverFc27Streamlined(f.root, { createPersistence })).toEqual({ status: 'absent' });
  expect(f.calls).toHaveLength(calls); expect(release).toHaveBeenCalledOnce();
  expect(f.calls.some(call => call.kind === 'contribute')).toBe(false);
});

it('retains unknown journal if progress is inconsistent and performs no eviction', async () => {
  const f = streamlinedRuntime(), { journal } = await pendingContribution(f);
  f.state.players = []; f.replies.rows[0].submittedScore = 0; f.root.getAppMain = () => null;
  const createPersistence = () => ({ journal, lock: { acquire: async () => async () => {} } });
  expect(await recoverFc27Streamlined(f.root, { createPersistence }))
    .toMatchObject({ status: 'recovery-required', reason: 'FC27_STREAMLINED_PROGRESS_CHANGED' });
  expect((await journal.read(f.input.context)).batches[0].state).toBe('pending');
  expect(f.calls.map(call => call.kind)).toEqual(['request', 'progress']);
});
