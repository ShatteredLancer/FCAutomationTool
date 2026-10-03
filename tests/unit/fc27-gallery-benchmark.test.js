import { expect, it } from 'vitest';
import { benchmarkGalleryPlans, planGallerySequentialSteps } from '../../src/gallery/benchmark.js';
import { runGalleryPlan } from '../../src/gallery/cooperative-plan.js';
it('reports shared versions and spend difference without monetizing rewards', () => {
  const result = benchmarkGalleryPlans({ jointPlan: { totalPrice: 300, items: [{ eaId: 1 }, { eaId: 2 }] },
    individualPlans: [{ totalPrice: 200, items: [{ eaId: 1 }] }, { totalPrice: 250, items: [{ eaId: 1 }, { eaId: 2 }] }] });
  expect(result).toMatchObject({ status: 'observed', jointPrice: 300, separatePrice: 450, savings: 150, jointCardCount: 2, separateCardCount: 2 });
});
it('does not invent savings when any quote is unknown', () => {
  expect(benchmarkGalleryPlans({ jointPlan: { totalPrice: null, items: [] }, individualPlans: [] }))
    .toMatchObject({ status: 'partial', reason: 'price-unknown', savings: null });
});

it('projects an earlier purchase into the next set instead of charging twice', async () => {
  const catalog = { source: 'futgg', tags: [{ id: 1, name: 'No-op', bonusType: 'ITEM_SCORE_PERCENTAGE',
    thresholdType: 'ITEM_COUNT', rules: [{ attribute: 'RARE', type: 'COUNT', target: 'ATTRIBUTE', values: ['999'] }],
    tiers: [{ minItems: 1, bonus: 1 }] }] };
  const row = (eaId, score, collected) => ({ eaId, playerEaId: eaId, name: `P${eaId}`, version: 'Gallery', overall: 80,
    gradingScore: score, galleryScore: score, collected, firstOwned: false, holographic: false, positions: ['ST'],
    skillMoves: 3, weakFoot: 3, nationEaId: 1, clubEaId: 1, leagueEaId: 1, rarityEaId: 1 });
  const makeTarget = (id, existing) => ({ set: { id: `futgg:${id}`, requiredCards: 2, grades: [{ name: 'A', threshold: 300 }] }, catalog,
    progress: { complete: true, rows: [row(existing, 100, true), row(3, 200, false)] }, prices: { 3: 100 }, targetGrade: 'A' });
  const baseline = await runGalleryPlan(planGallerySequentialSteps({ targets: [makeTarget(30, 1), makeTarget(31, 2)] }));
  expect(baseline).toMatchObject({ status: 'observed', totalPrice: 100 });
  expect(baseline.plans[0].items.map(item => item.eaId)).toEqual([3]);
  expect(baseline.plans[1].items).toEqual([]);
  expect(benchmarkGalleryPlans({ jointPlan: { totalPrice: 100, items: baseline.plans[0].items }, individualPlans: baseline.plans }))
    .toMatchObject({ status: 'observed', savings: 0, sharedVersions: 0 });
});
