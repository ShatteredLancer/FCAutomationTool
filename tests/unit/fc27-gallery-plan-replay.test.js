import { expect, it } from 'vitest';
import { createGalleryPlanReplay } from '../../src/gallery/plan-replay.js';
import { planGalleryGrade } from '../../src/gallery/planner.js';
import { planGalleryJoint } from '../../src/gallery/joint-planner.js';
import { createFcatDiagnosticLog } from '../../src/diagnostics/fcat-diagnostic-log.js';

const input = () => ({ scope: 'private-account', platform: 'private-platform',
  set: { id: 'futgg:41', requiredCards: 3, grades: [{ name: 'S', threshold: 500 }] },
  catalog: { source: 'futgg', tags: [{ id: 1, name: 'private-name', bonusType: 'ITEM_SCORE_PERCENTAGE',
    thresholdType: 'ITEM_COUNT', rules: [{ attribute: 'LEVEL', type: 'COUNT', target: 'ATTRIBUTE', values: ['silver'] }],
    tiers: [{ minItems: 2, bonus: 100 }] }] },
  progress: { complete: true, rows: [1, 2, 3, 4].map(eaId => ({ eaId, collected: eaId === 1,
    gradingScore: eaId === 4 ? 1000 : 100, overall: 70, firstOwned: false, raw: { token: 'private-token' },
    itemId: 'private-id', name: 'private-name' })) },
  prices: { 2: 200, 3: 250, 4: 80000 }, targetGrade: 'S' });
const project = plan => ({ status: plan.status, evaluations: plan.evaluations,
  ids: plan.plans[0]?.items.map(row => row.eaId), price: plan.plans[0]?.totalPrice,
  score: plan.plans[0]?.score ?? plan.plans[0]?.targets.map(target => target.score) });

it('replays single and shared targets with the same cost, versions, score and evaluation count', () => {
  const target = input(), joint = { targets: [target, { ...structuredClone(target),
    set: { ...target.set, id: 'futgg:42' } }], budget: 1000 };
  for (const [value, planner] of [[target, planGalleryGrade], [joint, planGalleryJoint]]) {
    const replay = createGalleryPlanReplay(value);
    expect(replay).not.toBeNull();
    expect(JSON.stringify(replay)).not.toContain('private');
    expect(project(planner(replay.input))).toEqual(project(planner(value)));
  }
});

it('retains four replay records despite background log churn and re-sanitizes on restore', async () => {
  let saved;
  const options = { gmGetValue: () => saved, gmSetValue: (_key, value) => { saved = value; }, maxEntries: 2 };
  const log = createFcatDiagnosticLog(options);
  for (let count = 0; count < 6; count++) await log.record({ area: 'gallery', event: 'grade-plan', count,
    replayInput: input(), beamTruncated: true, budgetExhausted: true, bestPrice: 450 });
  for (let count = 0; count < 8; count++) await log.record({ area: 'gallery', event: 'sync', count });
  const payload = await log.exportPayload();
  expect(payload.entries).toHaveLength(2);
  expect(payload.planning.map(row => row.event.count)).toEqual([2, 3, 4, 5]);
  expect(payload.planning[0].event).toMatchObject({ beamTruncated: true, budgetExhausted: true, bestPrice: 450 });
  saved.planning[0].replay.input.secret = 'private-secret';
  const restored = await createFcatDiagnosticLog(options).exportPayload();
  expect(restored.planning).toEqual(payload.planning);
  payload.planning[0].replay.input.prices[2] = 999;
  expect((await log.exportPayload()).planning[0].replay.input.prices[2]).toBe(200);
});

it('bounds diagnostic inputs and drops broken replay without blocking the event', async () => {
  const huge = input(); huge.progress.rows = Array(513).fill(huge.progress.rows[0]);
  expect(createGalleryPlanReplay(huge)).toBeNull();
  const bad = input(); Object.defineProperty(bad, 'progress', { get() { throw Error('broken'); } });
  const log = createFcatDiagnosticLog({ gmGetValue: () => null, gmSetValue: () => {} });
  await expect(log.record({ area: 'gallery', event: 'grade-plan', status: 'success', replayInput: bad })).resolves.toBe(true);
  expect((await log.exportPayload()).planning).toEqual([]);
});

it('retains a sanitized catalogue objective and rewards for exact reward-plan replay', () => {
  const t = input();
  t.set.grades[0].rewards = [{ type: 'event_token_1', count: 1, value: 50, label: 'private-label' }];
  t.set.grades[0].rewardsComplete = true;
  const value = { targets: [t], budget: 1000, catalogRewardKey: 'event_token_1' };
  const replay = createGalleryPlanReplay(value);
  expect(JSON.stringify(replay)).not.toContain('private');
  expect(replay.input.catalogRewardKey).toBe('event_token_1');
  expect(project(planGalleryJoint(replay.input))).toEqual(project(planGalleryJoint(value)));
  expect(planGalleryJoint(replay.input).plans[0].rewardEstimate.projectedQuantity).toBe(50);
});
