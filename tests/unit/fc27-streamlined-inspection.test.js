import { expect, it } from 'vitest';
import { streamlinedRuntime } from '../helpers/fc27-streamlined-runtime.js';
import { inspectFc27StreamlinedFresh } from '../../src/adapters/ea/fc27-streamlined-inspection.js';

it('combines fresh progress and selected Club validation with no mutation or identity export', async () => {
  const f = streamlinedRuntime(); f.replies.rows[0].submittedScore = 0;
  const result = await inspectFc27StreamlinedFresh(f.root);
  expect(result).toMatchObject({ status: 'verified', requests: 2, eaMutationsPerformed: false,
    progress: { submittedScore: 0, targetScore: 200 }, materials: { fresh: true, count: 10, points: 200 } });
  expect(f.calls.map(call => call.kind)).toEqual(['progress', 'request']);
  expect(f.calls[1]).toMatchObject({ retry: true, reauth: true, method: 'POST',
    url: 'https://utas.test.ea.com/ut/game/fc27/club' });
  for (const key of ['accountScope', 'itemIds', 'definitionId', 'context']) expect(JSON.stringify(result)).not.toContain(key);
});

it('stops before checking materials when native page progress differs from the server', async () => {
  const f = streamlinedRuntime();
  const result = await inspectFc27StreamlinedFresh(f.root);
  expect(result).toMatchObject({ status: 'blocked', reason: 'FC27_STREAMLINED_PROGRESS_CHANGED' });
  expect(f.calls).toEqual([{ kind: 'progress', setId: 31 }]);
});

it('verifies a mixed-pile preview with a single Storage GET and no cache changes', async () => {
  const f = streamlinedRuntime({ targetScore: 240, mixedStorage: true });
  f.replies.rows[0].submittedScore = 0;
  const before = JSON.stringify(f.root.repositories);
  const result = await inspectFc27StreamlinedFresh(f.root);
  expect(result).toMatchObject({ status: 'verified', requests: 3, eaMutationsPerformed: false,
    planning: { selected: 12, score: 240, sources: { club: 11, storage: 1 } },
    materials: { fresh: true, count: 12, points: 240 } });
  expect(f.calls.map(call => call.kind)).toEqual(['progress', 'request', 'storage']);
  expect(JSON.stringify(f.root.repositories)).toBe(before);
});
