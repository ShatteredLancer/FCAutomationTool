import { expect, it } from 'vitest';
import { planGalleryGrade } from '../../src/gallery/planner.js';
import { planGalleryJoint } from '../../src/gallery/joint-planner.js';

const target = () => ({
  set: { id: 'fodder:test/new-pool', requiredCards: 3, grades: [{ name: 'S', threshold: 399, rewards: [] }] },
  catalog: { source: 'fodder', engine: { version: 1, bonusMinusOne: true }, tags: [
    { id: 1, match: { by: 'level', how: 'is', values: ['silver'] }, steps: [{ at: 2, pct: 100 }] },
    { id: 2, match: { by: 'league', how: 'same' }, steps: [{ at: 3, pct: 10 }] },
  ] },
  progress: { season: '27', setId: 'fodder:test/new-pool', complete: true, rows: [
    { eaId: 1, playerEaId: 1, overall: 80, gradingScore: 100, leagueEaId: 1, collected: true },
    { eaId: 2, playerEaId: 2, overall: 70, gradingScore: 90, leagueEaId: 1, collected: false },
    { eaId: 3, playerEaId: 3, overall: 70, gradingScore: 90, leagueEaId: 1, collected: false },
    { eaId: 4, playerEaId: 4, overall: 80, gradingScore: 500, leagueEaId: 2, collected: false },
  ] }, prices: { 2: 150, 3: 150, 4: 80000 }, targetGrade: 'S',
});

it('plans a cheap Fodder compound bonus using the native string set identity', () => {
  const input = target(), before = structuredClone(input), value = planGalleryGrade(input);
  expect(value).toMatchObject({ status: 'ready' });
  expect(value.plans[0].items.map(row => row.eaId).sort()).toEqual([2, 3]);
  expect(value.plans[0]).toMatchObject({ totalPrice: 300, score: 486 });
  expect(input).toEqual(before);
});

it('shares missing Fodder versions across sets and obeys the joint budget', () => {
  const a = target(), b = target(); b.set.id = b.progress.setId = 'fodder:test/another-pool';
  const result = planGalleryJoint({ targets: [a, b], budget: 300 });
  expect(result).toMatchObject({ status: 'ready' });
  expect(result.plans[0]).toMatchObject({ totalPrice: 300 });
  expect(result.plans[0].items).toHaveLength(2);
  expect(result.plans[0].targets.every(row => row.reached)).toBe(true);
});

it('keeps unknown rules and truncated candidate evidence explicit', () => {
  const input = target(); input.catalog.tags[0].match.by = 'new-ea-rule';
  expect(planGalleryGrade(input)).toMatchObject({ status: 'unavailable', reason: 'unknown-rule' });
  const bounded = target(); bounded.progress.poolComplete = false; bounded.progress.candidateOnly = true;
  expect(planGalleryGrade(bounded)).toMatchObject({ status: 'ready', searchComplete: false, scopeTruncated: true });
});
