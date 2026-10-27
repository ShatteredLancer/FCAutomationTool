import { expect, it } from 'vitest';
import { planGalleryRoadmapSteps } from '../../src/gallery/roadmap.js';
import { verifyGalleryReferenceSteps } from '../../src/gallery/verify-reference-plan.js';
const finish = steps => { let step; do { step = steps.next(); } while (!step.done); return step.value; };
const target = () => {
  const grades = ['D','C','B','A','S'].map((name, i) => ({ name, threshold: 10 + i * 10,
    rewards: [{ type: 'event_token_1', count: 1, value: [0,0,5,8,15][i] }] }));
  return { status: 'observed', set: { id: 'futgg:30', slug: 'club', name: 'Club', requiredCards: 2, grades },
    catalog: { source: 'futgg', tags: [{ id: 1, name: 'No-op', bonusType: 'ITEM_SCORE_PERCENTAGE', thresholdType: 'ITEM_COUNT',
      rules: [{ type: 'COUNT', target: 'ATTRIBUTE', attribute: 'RARE', values: ['999'] }], tiers: [{ minItems: 1, bonus: 1 }] }] },
    progress: { season: '27', source: 'futgg', setId: 30, complete: true, poolComplete: true, rows: [1,2].map(eaId => ({ eaId, playerEaId: eaId,
      gradingScore: 100, collected: false, firstOwned: false, rarityEaId: 1, overall: 80, holographic: false,
      positions: ['ST'], weakFoot: 3, skillMoves: 3, clubEaId: 1, nationEaId: 1, leagueEaId: 1 })) }, prices: { 1: 1000, 2: 2000 },
    publicReference: { source: 'fodder', basis: 'empty-collection-public-reference', expiresAt: Date.now() + 300000,
      grades: ['D','C','B','A','S'].map(grade => ({ grade, ids: [1,2], cost: 3000 })) } };
};
it('quick full-view validates a known complete proposal without repeating deep grade searches', () => {
  let deepCalls = 0;
  function* slowPlanner() { deepCalls++; return { status: 'partial', plans: [] }; }
  const result = finish(planGalleryRoadmapSteps({ targets: [target()], fastReferences: true, gradePlanner: slowPlanner }));
  expect(deepCalls).toBe(0);
  expect(result).toMatchObject({ status: 'ready', addedTokens: 28, funding: { totalPurchase: 3000 } });
  expect(result.route[0].targetGrade).toBe('S');
});
it('deducts sold collected versions and keeps unknown cards/foreign scores/prices out of the route', () => {
  const t = target(); t.progress.rows[0].collected = true; t.progress.rows[0].inClub = false;
  const known = finish(planGalleryRoadmapSteps({ targets: [t], fastReferences: true }));
  expect(known.funding.totalPurchase).toBe(2000);
  t.progress.rows[1].collected = null;
  expect(finish(planGalleryRoadmapSteps({ targets: [t], fastReferences: true })).route).toEqual([]);
  t.progress.rows[1].collected = false; delete t.prices[2];
  expect(finish(planGalleryRoadmapSteps({ targets: [t], fastReferences: true })).route).toEqual([]);
});
it('keeps missing public proposals explicit instead of spending the whole quick pass searching one collection', () => {
  const t = target(); delete t.publicReference;
  let calls = 0; function* planner() { calls++; return { status: 'partial', plans: [] }; }
  const result = finish(planGalleryRoadmapSteps({ targets: [t], fastReferences: true, gradePlanner: planner }));
  expect(calls).toBe(0); expect(result.partial).toBe(true);
  expect(result.unavailable[0].reason).toBe('deep-analysis-pending');
});
it('uses current prices and local scoring, not the server cost/total, and rejects foreign versions', () => {
  const t = target(); t.publicReference.grades.forEach(g => { g.cost = 1; g.total = 99999999; });
  expect(finish(planGalleryRoadmapSteps({ targets: [t], fastReferences: true })).funding.totalPurchase).toBe(3000);
  t.progress.rows.forEach(row => { row.gradingScore = 0; });
  expect(finish(planGalleryRoadmapSteps({ targets: [t], fastReferences: true })).route).toEqual([]);
  t.publicReference.grades.forEach(g => { g.ids = [1,999]; });
  expect(finish(planGalleryRoadmapSteps({ targets: [t], fastReferences: true })).route).toEqual([]);
});
it('removes purchases made redundant by a collected version outside the public lineup', () => {
  const t = target(); t.progress.rows.push({ ...t.progress.rows[0], eaId: 3, playerEaId: 3, collected: true, inClub: false });
  const result = finish(planGalleryRoadmapSteps({ targets: [t], fastReferences: true }));
  expect(result.funding.totalPurchase).toBe(1000);
  expect(result.route[0].items.map(item => item.eaId)).toEqual([1]);
});
it('deep mode preserves a cheaper local solution and rejects a reference above per-card capital', () => {
  function* cheaper() { return { status: 'ready', plans: [{ reached: true, score: 200,
    totalPrice: 500, items: [{ eaId: 7, price: 500 }] }] }; }
  expect(finish(planGalleryRoadmapSteps({ targets: [target()], gradePlanner: cheaper })).funding.totalPurchase).toBe(500);
  expect(finish(planGalleryRoadmapSteps({ targets: [target()], fastReferences: true, capital: 1500 })).route).toEqual([]);
});

it('uses an expired captured estimate only for the explicitly forecast-only overall path', () => {
  const t = target();
  t.publicReference = { ...t.publicReference, source: 'fodder', platform: 'console', forecastOnly: true,
    fetchedAt: 1000, capturedAt: 1001, expiresAt: 301000 };
  t.forecastPriceBasis = 'fodder-public-estimate'; t.forecastPriceCapturedAt = 1001; t.priceSnapshot = null;
  const proposal = t.publicReference.grades[0];
  expect(finish(verifyGalleryReferenceSteps({ target: t, proposal }))).toBeNull();
  expect(finish(verifyGalleryReferenceSteps({ target: t, proposal, allowCapturedForecast: true }))).toMatchObject({ reached: true, totalPrice: 3000 });
  expect(finish(planGalleryRoadmapSteps({ targets: [t], fastReferences: true })).route).toHaveLength(1);
  function* noIndependentPlan() { return { status: 'partial', plans: [] }; }
  expect(finish(planGalleryRoadmapSteps({ targets: [t], gradePlanner: noIndependentPlan })).route).toEqual([]);
  t.priceSnapshot = { expiresAt: 301000 };
  expect(finish(verifyGalleryReferenceSteps({ target: t, proposal, allowCapturedForecast: true }))).toBeNull();
});
