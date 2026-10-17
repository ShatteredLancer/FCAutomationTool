import { afterEach, expect, it, vi } from 'vitest';
import { streamlinedRuntime } from '../helpers/fc27-streamlined-runtime.js';
import { createFc27StreamlinedProgressReader } from '../../src/adapters/ea/fc27-streamlined-progress.js';

afterEach(() => vi.useRealTimers());
it.each([0, 408, 500, 502, 503, 504, 520, 521, 522, 523, 524])('retries transient GET status %s once and accepts only fresh success', async status => {
  vi.useFakeTimers();
  const f = streamlinedRuntime();
  f.replies.progressReplies = [{ success: false, status }, {}];
  const pending = createFc27StreamlinedProgressReader(f.root).read(f.input.challenge);
  await vi.advanceTimersByTimeAsync(1499); expect(f.calls).toHaveLength(1);
  const oldReply = f.replies.deliver;
  await vi.advanceTimersByTimeAsync(1);
  await expect(pending).resolves.toMatchObject({ fresh: true, attempts: 2 });
  oldReply(); f.replies.deliver();
  expect(f.calls).toHaveLength(2); expect(f.unobserve).toHaveBeenCalledTimes(2);
});

it('stops after three failed GETs and exports only bounded HTTP/native failure metadata', async () => {
  vi.useFakeTimers();
  const f = streamlinedRuntime(); f.replies.success = false; f.replies.status = 503;
  f.replies.progressReplies = Array.from({ length: 3 }, () => ({ error: { code: 521, token: 'private' } }));
  const pending = createFc27StreamlinedProgressReader(f.root).read(f.input.challenge);
  const failure = expect(pending).rejects.toMatchObject({ message: 'FC27_STREAMLINED_PROGRESS_READ_FAILED',
    httpStatus: 503, localReason: 'FC27_NATIVE_ERROR_521', attempt: 3, attemptLimit: 3 });
  await vi.advanceTimersByTimeAsync(4500); await failure;
  expect(f.calls).toHaveLength(3); expect(f.unobserve).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(20000); expect(f.calls).toHaveLength(3);
  expect(JSON.stringify(await pending.catch(error => error))).not.toContain('private');
});

it.each([200, 304, 400, 401, 403, 404, 429, 461])('does not retry status %s without explicit transient evidence', async status => {
  const f = streamlinedRuntime(); f.replies.success = false; f.replies.status = status;
  await expect(createFc27StreamlinedProgressReader(f.root).read(f.input.challenge)).rejects.toMatchObject({
    message: 'FC27_STREAMLINED_PROGRESS_READ_FAILED', httpStatus: status, attempt: 1 });
  expect(f.calls).toHaveLength(1);
});

it.each([401, 429, 461, 'private-code'])('does not retry transient HTTP when native code %s is not transient', async code => {
  const f = streamlinedRuntime(); f.replies.progressReplies = [{ success: false, status: 503, error: { code } }];
  await expect(createFc27StreamlinedProgressReader(f.root).read(f.input.challenge)).rejects.toMatchObject({
    message: 'FC27_STREAMLINED_PROGRESS_READ_FAILED', httpStatus: 503, attempt: 1 });
  expect(f.calls).toHaveLength(1);
});

it('shares one deadline across backoff instead of granting another fifteen seconds', async () => {
  vi.useFakeTimers();
  const f = streamlinedRuntime(); f.replies.hold = true; f.replies.status = 503; f.replies.success = false;
  const reader = createFc27StreamlinedProgressReader(f.root);
  const pending = reader.read(f.input.challenge);
  const failure = expect(pending).rejects.toThrow('PROGRESS_READ_TIMEOUT');
  await vi.advanceTimersByTimeAsync(14000); const oldReply = f.replies.deliver; oldReply();
  await vi.advanceTimersByTimeAsync(1000); await failure;
  await vi.advanceTimersByTimeAsync(10000); oldReply(); expect(f.calls).toHaveLength(1);
  f.replies.hold = false; f.replies.success = true; f.replies.status = 200;
  await expect(reader.read(f.input.challenge)).resolves.toMatchObject({ fresh: true, attempts: 1 });
});

it.each(['account', 'controller', 'method'])('rechecks %s during backoff before issuing another GET', async kind => {
  vi.useFakeTimers();
  const f = streamlinedRuntime(); f.replies.progressReplies = [{ success: false, status: 503 }];
  const pending = createFc27StreamlinedProgressReader(f.root).read(f.input.challenge);
  const failure = expect(pending).rejects.toThrow(/CONTEXT_(CHANGED|UNAVAILABLE)/);
  await vi.advanceTimersByTimeAsync(1);
  if (kind === 'account') f.user.selectedPersona = 444;
  if (kind === 'controller') f.root.getAppMain = () => null;
  if (kind === 'method') f.root.services.SBC.sbcDAO.getChallengesForSet = () => {};
  await vi.advanceTimersByTimeAsync(1500); await failure;
  expect(f.calls).toHaveLength(1); expect(f.unobserve).toHaveBeenCalledTimes(1);
});

it.each([-1, '0', 0.5])('rejects malformed native completion count %s instead of treating it as absent', async count => {
  const f = streamlinedRuntime(); f.replies.rows[0].timesCompleted = count;
  await expect(createFc27StreamlinedProgressReader(f.root).read(f.input.challenge)).rejects.toThrow('PROGRESS_COUNT_UNVERIFIED');
});
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
