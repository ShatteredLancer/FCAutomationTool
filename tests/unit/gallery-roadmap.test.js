import { expect, it } from 'vitest';
import { selectGalleryRoadmap } from '../../src/gallery/roadmap-selection.js';
import { planGalleryRoadmapSteps } from '../../src/gallery/roadmap.js';
import { planGalleryGradeSteps } from '../../src/gallery/planner.js';
import { runGalleryPlan } from '../../src/gallery/cooperative-plan.js';
const finish = iterator => { let step; do { step = iterator.next(); } while (!step.done); return step.value; };
const option = (grade, tokens, items) => ({ grade, projectedTokens: tokens, score: 100, items });
const row = (setId, options, extra = {}) => ({ setId, name: setId, baselineTokens: 0, options, ...extra });
const card = (eaId, price) => ({ eaId, price });

it('offers an overall route when cumulative purchases exceed the revolving capital', () => {
  const result = selectGalleryRoadmap({ capital: 80000, rows: [
    row('club-a', [option('S', 28, [card(1, 60000)])]), row('club-b', [option('S', 28, [card(2, 50000)])]),
  ] });
  expect(result).toMatchObject({ status: 'ready', addedTokens: 56,
    funding: { feasible: true, totalPurchase: 110000, requiredCapital: 60000, expectedNetLoss: 5500 } });
  expect(result.route).toHaveLength(2);
  expect(result.claimState).toBe('unknown');
});

it('shares exact versions across club and league targets and counts each tier increment once', () => {
  const result = selectGalleryRoadmap({ capital: 50000, rows: [
    row('club', [option('B', 5, [card(1, 40000)]), option('S', 28, [card(1, 40000), card(2, 30000)])]),
    row('league', [option('S', 28, [card(1, 40000), card(2, 30000)])]),
  ] });
  expect(result).toMatchObject({ addedTokens: 56, funding: { totalPurchase: 70000, uniqueCards: 2, sharedCards: 2 } });
  expect(result.route.map(entry => entry.targetGrade)).toEqual(['S', 'S']);
});

it('keeps a usable route when another club has one unaffordable card', () => {
  const result = selectGalleryRoadmap({ capital: 80000, rows: [
    row('cheap', [option('A', 13, [card(1, 20000)])]), row('expensive', [option('S', 28, [card(2, 90000)])]),
  ] });
  expect(result.route.map(entry => entry.setId)).toEqual(['cheap']);
  expect(result.skipped).toContainEqual(expect.objectContaining({ setId: 'expensive', reason: 'capital-gap' }));
});

it('separates a loss ceiling from revolving capital and preserves unknown prices', () => {
  const result = selectGalleryRoadmap({ capital: 80000, lossLimit: 2000, rows: [
    row('cheap', [option('A', 13, [card(1, 20000)])]), row('unknown', [option('A', 13, [card(2, null)])]),
    row('costly', [option('S', 28, [card(3, 60000)])]),
  ] });
  expect(result.funding.expectedNetLoss).toBeLessThanOrEqual(2000);
  expect(result.route.map(entry => entry.setId)).toEqual(['cheap']);
  expect(result.skipped.some(entry => entry.reason === 'price-unknown')).toBe(true);
});

const catalog = { source: 'futgg', tags: [{ id: 1, name: 'No-op bonus', bonusType: 'ITEM_SCORE_PERCENTAGE',
  thresholdType: 'ITEM_COUNT', rules: [{ attribute: 'RARE', type: 'COUNT', target: 'ATTRIBUTE', values: ['999'] }],
  tiers: [{ minItems: 1, bonus: 1 }] }] };
const target = (setId, eaId, price, collected = false) => ({ status: 'observed', catalog,
  set: { id: setId, name: setId, requiredCards: 1, grades: ['D', 'C', 'B', 'A', 'S'].map((name, i) => ({ name,
    threshold: 10 + i * 10, rewards: [{ type: 'event_token_1', count: 1, value: [0, 0, 5, 8, 15][i] }] })) },
  progress: { season: '27', source: 'futgg', setId: Number(setId.split(':')[1]), complete: true, poolComplete: true,
    rows: [{ eaId, playerEaId: eaId, gradingScore: 100, galleryScore: 100, collected, firstOwned: false,
      overall: 80, holographic: false, positions: ['ST'], skillMoves: 3, weakFoot: 3,
      nationEaId: 1, clubEaId: 1, leagueEaId: 1, rarityEaId: 1 }] }, prices: { [eaId]: price } });

it('scans automatic targets through the existing grade planner, without manual joint selection', () => {
  const input = { capital: 80000, targets: [target('futgg:30', 1, 60000), target('futgg:31', 2, 50000)] };
  const before = JSON.stringify(input), result = finish(planGalleryRoadmapSteps(input));
  expect(result).toMatchObject({ status: 'ready', addedTokens: 56, coverage: { total: 2, inspected: 2 },
    funding: { totalPurchase: 110000, requiredCapital: 60000 } });
  expect(result.route.every(step => step.targetGrade === 'S')).toBe(true);
  expect(JSON.stringify(input)).toBe(before);
});

it('does not repurchase sold or consumed collected versions and does not equate scoring with reward claims', () => {
  const t = target('futgg:30', 1, 60000, true); t.progress.rows[0].inClub = false;
  const result = finish(planGalleryRoadmapSteps({ targets: [t] }));
  expect(result).toMatchObject({ baselineTokens: 28, addedTokens: 0, route: [], claimState: 'unknown' });
  expect(result.freeCheck).toContainEqual(expect.objectContaining({ grade: 'S', claimState: 'unknown' }));
});

it('reports unavailable collections and keeps completed work on cooperative deadline', () => {
  const a = target('futgg:30', 1, 60000), b = target('futgg:31', 2, 50000); b.stale = true;
  const result = finish(planGalleryRoadmapSteps({ targets: [a, b] }));
  expect(result).toMatchObject({ partial: true, coverage: { total: 2, missing: 1 } });
  expect(result.unavailable[0].reason).toBe('progress-unavailable');
  const iterator = planGalleryRoadmapSteps({ targets: [a, b] });
  let next = iterator.next();
  while (!next.done) next = iterator.next(true);
  expect(next.value.coverage.stopped).toBe(true);
});

it('continues checked grades and selected routes instead of restarting after a deadline', () => {
  const targets = [target('futgg:30', 1, 60000), target('futgg:31', 2, 50000)], calls = [];
  function* planner(input) { calls.push(`${input.set.id}:${input.targetGrade}`); return yield* planGalleryGradeSteps(input); }
  const iterator = planGalleryRoadmapSteps({ targets, capital: 80000, gradePlanner: planner });
  let next = iterator.next();
  while (!next.done && next.value?.phase !== 'roadmap') next = iterator.next();
  while (!next.done) next = iterator.next(true);
  const partial = next.value;
  expect(partial.coverage.stopped).toBe(true);
  expect(partial.rows[0].checkedGrades).toContain('B');
  const result = finish(planGalleryRoadmapSteps({ targets, capital: 80000, gradePlanner: planner,
    previousRows: partial.rows, previousSelection: partial.selectedOptions }));
  expect(result).toMatchObject({ status: 'ready', addedTokens: 56, coverage: { stopped: false } });
  expect(calls.filter(value => value === 'futgg:30:B')).toHaveLength(1);
});

it('tries an affordable alternative rather than rejecting a club because one special version costs too much', () => {
  const t = target('futgg:30', 1, 60000);
  t.progress.rows.push({ ...t.progress.rows[0], eaId: 2, playerEaId: 2 }); t.prices[2] = 1000;
  const result = finish(planGalleryRoadmapSteps({ targets: [t], capital: 5000 }));
  expect(result).toMatchObject({ status: 'ready', funding: { feasible: true, requiredCapital: 1000 } });
  expect(result.route[0].items[0].eaId).toBe(2);
});

it('does not turn an unknown collection flag into either a free card or an automatic purchase', () => {
  const t = target('futgg:30', 1, 1000); t.progress.rows[0].collected = null;
  const result = finish(planGalleryRoadmapSteps({ targets: [t], capital: 5000 }));
  expect(result.route).toEqual([]); expect(result.partial).toBe(true);
});

it('keeps a large catalog cooperative and resumes a partial route without replaying checked grades', async () => {
  const targets = Array.from({ length: 150 }, (_, i) => target(`futgg:${i + 100}`, i + 1, 1000));
  let time = 0, turns = 0;
  const result = await runGalleryPlan(planGalleryRoadmapSteps({ targets, capital: 20000 }), {
    now: () => ++time, sliceMs: 1, maxMs: 1000000, schedule: async () => { turns++; },
  });
  expect(result).toMatchObject({ status: 'ready', addedTokens: 4200,
    coverage: { total: 150, inspected: 150, stopped: false }, funding: { totalPurchase: 150000, expectedNetLoss: 7500 } });
  expect(turns).toBeGreaterThan(150);
  const stopped = await runGalleryPlan(planGalleryRoadmapSteps({ targets }), {
    now: () => ++time, sliceMs: 1, maxMs: 2, schedule: async () => {},
  });
  expect(stopped.coverage.stopped).toBe(true);
  const resumed = finish(planGalleryRoadmapSteps({ targets, previousRows: stopped.rows, previousSelection: stopped.selectedOptions }));
  expect(resumed.coverage).toMatchObject({ total: 150, inspected: 150, stopped: false });
});
