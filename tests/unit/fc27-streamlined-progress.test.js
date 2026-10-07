import { afterEach, expect, it, vi } from 'vitest';
import { streamlinedRuntime } from '../helpers/fc27-streamlined-runtime.js';
import { createFc27StreamlinedProgressReader } from '../../src/adapters/ea/fc27-streamlined-progress.js';

afterEach(() => vi.useRealTimers());
it('reads the prototype DAO once, keeps page metadata distinct and leaves shared caches unchanged', async () => {
  const f = streamlinedRuntime(), before = JSON.stringify(f.root.repositories);
  const result = await createFc27StreamlinedProgressReader(f.root, { now: () => 1000 }).read(f.input.challenge);
  expect(result).toMatchObject({ fresh: true, observedAt: 1000, timesCompleted: 0,
    challenge: { submittedScore: 100, remainingScore: 100 }, setMetadataFresh: false, rewardConfirmed: false });
  expect(result.freshFields).not.toContain('repeats');
  expect(f.challenge.submittedScore).toBe(0);
  expect(JSON.stringify(f.root.repositories)).toBe(before);
  expect(f.calls).toEqual([{ kind: 'progress', setId: 31 }]);
  expect(f.unobserve).toHaveBeenCalledTimes(1);
});

it('accepts the native collection wrapper but rejects missing, ambiguous, invalid and excessive rows', async () => {
  const f = streamlinedRuntime(), reader = createFc27StreamlinedProgressReader(f.root);
  const row = f.replies.rows[0];
  f.replies.rows = { _collection: { 61: row } };
  await expect(reader.read(f.input.challenge)).resolves.toMatchObject({ fresh: true });
  for (const rows of [null, [], [null], [{ ...row, setId: 32 }], [row, row],
    [{ ...row, id: 62 }], Array.from({ length: 101 }, (_, i) => ({ ...row, id: i + 1 }))]) {
    f.replies.rows = rows;
    await expect(reader.read(f.input.challenge)).rejects.toThrow('PROGRESS_READ_UNVERIFIED');
  }
  f.replies.rows = [row]; f.replies.success = false;
  await expect(reader.read(f.input.challenge)).rejects.toThrow('PROGRESS_READ_FAILED');
  f.replies.success = true; f.replies.status = 401;
  await expect(reader.read(f.input.challenge)).rejects.toThrow('PROGRESS_READ_FAILED');
});

it('rejects changed methods before requesting and account/controller/method drift in flight', async () => {
  const f = streamlinedRuntime();
  f.root.services.SBC.sbcDAO.getChallengesForSet = () => {};
  await expect(createFc27StreamlinedProgressReader(f.root).read(f.input.challenge)).rejects.toThrow('PROGRESS_READ_UNVERIFIED');
  expect(f.calls).toEqual([]);
  for (const change of [g => { g.user.selectedPersona = 444; },
    g => { g.root.getAppMain = () => null; },
    g => { g.root.services.SBC.sbcDAO.getChallengesForSet = () => {}; }]) {
    const g = streamlinedRuntime(); g.replies.hold = true;
    const pending = createFc27StreamlinedProgressReader(g.root).read(g.input.challenge);
    await vi.waitFor(() => expect(g.replies.deliver).toBeTypeOf('function'));
    change(g); g.replies.deliver();
    await expect(pending).rejects.toThrow();
    expect(g.unobserve).toHaveBeenCalledTimes(1);
  }
});

it('serializes requests, times out without retry, ignores late replies and releases busy', async () => {
  vi.useFakeTimers();
  const f = streamlinedRuntime(); f.replies.hold = true;
  const reader = createFc27StreamlinedProgressReader(f.root);
  const first = reader.read(f.input.challenge), rejection = expect(first).rejects.toThrow('PROGRESS_READ_TIMEOUT');
  await Promise.resolve();
  await expect(reader.read(f.input.challenge)).rejects.toThrow('BUSY');
  await vi.advanceTimersByTimeAsync(15001); await rejection;
  f.replies.deliver();
  expect(f.calls).toHaveLength(1); expect(f.unobserve).toHaveBeenCalledTimes(1);
  f.replies.hold = false;
  await expect(reader.read(f.input.challenge)).resolves.toMatchObject({ fresh: true });
});
