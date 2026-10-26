import { expect, it } from 'vitest';
import { selectGalleryRoadmap } from '../../src/gallery/roadmap-selection.js';
import { planGalleryRoadmapSteps } from '../../src/gallery/roadmap.js';
import { planGalleryGradeSteps } from '../../src/gallery/planner.js';
import { runGalleryPlan } from '../../src/gallery/cooperative-plan.js';
import { createGalleryRoadmapWork } from '../../src/gallery/roadmap-work.js';
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

it('returns completed roadmap work at the deadline instead of scoring until the reference expires', async () => {
  const ready = target('futgg:30', 1, 1000, true), heavy = target('futgg:31', 2, 1000, true);
  heavy.set.requiredCards = 21;
  heavy.progress.rows = Array.from({ length: 65 }, (_, i) => ({ ...heavy.progress.rows[0],
    eaId: i + 100, playerEaId: i + 100, gradingScore: i + 100, collected: true }));
  let at = 0, turns = 0;
  const result = await runGalleryPlan(planGalleryRoadmapSteps({ targets: [ready, heavy], fastReferences: true }), {
    now: () => ++at, sliceMs: 1, maxMs: 10, current: () => turns < 100,
    schedule: async () => { turns++; },
  });
  expect(result).not.toBeNull();
  expect(result).toMatchObject({ partial: true, coverage: { stopped: true } });
  expect(result.freeCheck).toContainEqual(expect.objectContaining({ setId: ready.set.id, grade: 'S' }));
  expect(turns).toBeLessThan(20);
});

it('continues a paused scorer over multiple deadlines with the same final score and route', async () => {
  const heavy = target('futgg:31', 1, 1000, true); heavy.set.requiredCards = 21;
  heavy.progress.rows = Array.from({ length: 65 }, (_, i) => ({ ...heavy.progress.rows[0],
    eaId: i + 100, playerEaId: i + 100, gradingScore: i + 100 }));
  const targets = [target('futgg:30', 1, 1000, true), heavy], work = createGalleryRoadmapWork();
  let result, count = 0;
  do {
    let at = 0;
    result = await runGalleryPlan(planGalleryRoadmapSteps({ targets, work, fastReferences: true,
      previousRows: result?.rows, previousSelection: result?.selectedOptions }), {
      now: () => ++at, sliceMs: 1, maxMs: 40, schedule: async () => {},
    });
    count++;
  } while (result.coverage.stopped && count < 100);
  expect(count).toBeGreaterThan(1); expect(count).toBeLessThan(100);
  expect(result.coverage.stopped).toBe(false);
  expect(result).toEqual(finish(planGalleryRoadmapSteps({ targets, fastReferences: true })));
});

it.each(['reference', 'grade'])('pauses nested %s verification and keeps completed grades', async mode => {
  const t = target('futgg:30', 1, 1000);
  if (mode === 'reference') {
    t.set.requiredCards = 21;
    t.progress.rows = Array.from({ length: 65 }, (_, i) => ({ ...t.progress.rows[0],
      eaId: i + 100, playerEaId: i + 100, gradingScore: i + 100, collected: i < 21 }));
    // Baseline has exactly the required lineup; the proposed union is heavy.
    t.set.grades.forEach(grade => { grade.threshold += 100000; });
    t.publicReference = { basis: 'empty-collection-public-reference', expiresAt: Date.now() + 300000,
      grades: [{ grade: 'B', cost: 1000, ids: t.progress.rows.map(row => row.eaId) }] };
    t.prices = Object.fromEntries(t.progress.rows.map(row => [row.eaId,1000]));
  }
  let at = 0, turns = 0;
  function* longGrade() { for (let i = 0; i < 1000; i++) yield { phase: 'grade', evaluations: i };
    return { status: 'partial', plans: [] }; }
  const result = await runGalleryPlan(planGalleryRoadmapSteps({ targets: [t], fastReferences: mode === 'reference',
    gradePlanner: longGrade }), { now: () => ++at, sliceMs: 1, maxMs: 10, schedule: async () => { turns++; } });
  expect(result).toMatchObject({ partial: true, coverage: { stopped: true } });
  expect(turns).toBeLessThan(20); expect(result.rows[0].analysisComplete).toBe(false);
});

it('keeps an earlier unresolved-grade reason when continuing later grades', () => {
  const targets = [target('futgg:30', 1, 1000)], work = createGalleryRoadmapWork();
  function* planner({ targetGrade }) {
    return targetGrade === 'B' ? { status: 'partial', reason: 'candidate-search-truncated', plans: [] }
      : { status: 'ready', plans: [{ reached: true, score: 100, totalPrice: 1000, items: [{ eaId: 1, price: 1000 }] }] };
  }
  const steps = planGalleryRoadmapSteps({ targets, work, gradePlanner: planner });
  steps.next(); let next;
  do { next = steps.next(true); } while (!next.done);
  const resumed = finish(planGalleryRoadmapSteps({ targets, work, gradePlanner: planner,
    previousRows: next.value.rows, previousSelection: next.value.selectedOptions }));
  expect(resumed.rows[0].reason).toBe('candidate-search-truncated');
  expect(resumed.partial).toBe(true);
});
