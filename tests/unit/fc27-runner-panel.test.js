import { expect, it, vi } from 'vitest';
import { createRunnerPanelController } from '../../src/fc27/runner-panel.js';

const inputs = { status: 'observed', reason: 'FC27_TRANSACTION_UNVERIFIED' };
const snapshot = () => ({ inputs, targets: [{ setId: 6, name: 'Gold Upgrade' }] });

it('refreshes local inputs without issuing a network preview and never enables Live', () => {
  const read = vi.fn(snapshot), preview = vi.fn(), publish = vi.fn();
  const panel = createRunnerPanelController({ read, preview, publish });
  panel.refresh();
  expect(read).toHaveBeenCalledOnce();
  expect(preview).not.toHaveBeenCalled();
  expect(publish).toHaveBeenLastCalledWith({ busy: false, snapshot: snapshot(), result: null, liveExecutionEnabled: false });
});
it('serializes previews, retains shortage reasons and rejects unreviewed targets and limits', async () => {
  let finish;
  const preview = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const publish = vi.fn();
  const panel = createRunnerPanelController({ read: snapshot, preview, publish });
  for (const [id, cap] of [[1, 74], [6, 99], [6, '83']]) expect(await panel.preview(id, cap)).toBe(false);
  const pending = panel.preview(6, 83);
  expect(await panel.preview(6, 83)).toBe(false);
  expect(panel.refresh()).toBe(false);
  const result = { status: 'insufficient', reason: 'SAFE_MATERIAL_SHORTAGE', plan: { required: 11, safeCandidates: 5 } };
  finish(result);
  await pending;
  expect(preview).toHaveBeenCalledExactlyOnceWith({ setId: 6, maxRating: 83 });
  expect(publish.mock.lastCall[0]).toMatchObject({ busy: false, result, liveExecutionEnabled: false });
  panel.refresh();
  expect(publish.mock.lastCall[0].result).toBeNull();
});
it('rechecks inputs before each request and discards late results after disposal', async () => {
  let finish;
  const read = vi.fn(snapshot), preview = vi.fn(() => new Promise(resolve => { finish = resolve; })), publish = vi.fn();
  const panel = createRunnerPanelController({ read, preview, publish });
  read.mockReturnValueOnce({ inputs: { status: 'blocked', reason: 'FC27_CONTEXT_UNAVAILABLE' }, targets: [] });
  expect(await panel.preview(6)).toBe(false);
  expect(preview).not.toHaveBeenCalled();
  const pending = panel.preview(6);
  panel.dispose();
  publish.mockClear();
  finish({ status: 'preview' });
  await pending;
  expect(publish).not.toHaveBeenCalled();
  expect(panel.refresh()).toBe(false);
});
it('exports fixed error reasons without leaking exceptions or automatically retrying', async () => {
  const preview = vi.fn(async () => { throw new Error('secret-response'); }), publish = vi.fn();
  const panel = createRunnerPanelController({ read: snapshot, preview, publish });
  await panel.preview(6);
  expect(publish.mock.lastCall[0].result.reason).toBe('FC27_RUNNER_PREVIEW_UNAVAILABLE');
  expect(preview).toHaveBeenCalledOnce();
  expect(JSON.stringify(publish.mock.calls)).not.toContain('secret');
});
