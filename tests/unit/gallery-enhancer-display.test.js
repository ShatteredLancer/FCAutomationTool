import { expect, it } from 'vitest';
import { summarizeGalleryScoreSteps, compileGalleryScoringRules, evaluateGalleryLineup } from '../../src/gallery/scoring.js';
import { createGalleryScoreQueue } from '../../src/gallery/score-queue.js';
import tierBoundary from '../fixtures/gallery-first-owner-tier-boundary.json';

const tag = (id, attribute, type, tiers) => ({ id, name: `tag ${id}`,
  bonusType: 'ITEM_SCORE_PERCENTAGE', thresholdType: 'ITEM_COUNT',
  rules: [{ attribute, type, target: attribute === 'BASE_DEF_ID' ? 'BASE_DEF_ID' : 'ATTRIBUTE', values: ['0'] }], tiers });
const input = () => ({ set: { id: 'futgg:1', requiredCards: 5, grades: [{ name: 'D', threshold: 1 }] },
  catalog: { source: 'futgg', tags: [tag(1, 'BASE_DEF_ID', 'MAX_COUNT_ALL_SAME', [{ minItems: 2, bonus: 100 }])] },
  progress: { season: '27', setId: 1, complete: true, rows: [
    { eaId: 9, playerEaId: 1, gradingScore: 100 }, { eaId: 8, playerEaId: 1, gradingScore: 100 },
    { eaId: 7, playerEaId: 2, gradingScore: 100 }, { eaId: 6, playerEaId: 2, gradingScore: 100 },
    { eaId: 5, playerEaId: 3, gradingScore: 100 }, { eaId: 4, playerEaId: 3, gradingScore: 100 },
  ].map(row => ({ ...row, collected: true, firstOwned: false })) } });
function drain(steps) { let next, yields = 0; do { next = steps.next(); if (!next.done) yields++; } while (!next.done); return { value: next.value, yields }; }

it('replays the deidentified thirty-card 289021 total and the 19-to-20 first-owner tier boundary', () => {
  const rows = tierBoundary.rows.map(values => Object.fromEntries(tierBoundary.columns.map((field, i) => [field, values[i]])));
  const compiled = compileGalleryScoringRules({ source: 'futgg', tags: tierBoundary.tags });
  const result = evaluateGalleryLineup(rows, compiled);
  expect(result).toMatchObject(tierBoundary.expected);
  expect(result.tags.find(t => t.name === 'First Owner')).toMatchObject({ count: 19, matched: 48740, pct: 300, bonus: 146220 });
  expect(result.tags.find(t => t.name === 'Multiples!')).toMatchObject({ count: 2, matched: 28500, bonus: 2850 });
  const changed = rows.map(row => row.gradingScore === 513 ? { ...row, firstOwned: true } : row);
  const next = evaluateGalleryLineup(changed, compiled);
  expect(next.base).toBe(result.base);
  expect(next.tags.find(t => t.name === 'First Owner')).toMatchObject({ count: 20, pct: 500, matched: 49253, bonus: 246265 });
  expect(next.total - result.total).toBe(100045);
});

it('uses current Enhancer stable base/tag seeds and one largest same-value group, with no swap optimization', () => {
  const value = input();
  const result = drain(summarizeGalleryScoreSteps(value, { selectionMode: 'enhancer' }));
  expect(result.value).toMatchObject({ selection: 'enhancer-seeds', status: 'calculated', ruleDifference: false,
    low: { base: 500, bonus: 200, total: 700, lineupIds: [9, 8, 7, 6, 5] } });
  expect(result.yields).toBeLessThanOrEqual(value.catalog.tags.length + 1);
  // The existing optimization API remains independently available for plans.
  expect(drain(summarizeGalleryScoreSteps(value)).value.selection).toBe('bounded-search');
});

it('uses one Multiples group in planning too, instead of adding all duplicate groups', () => {
  const value = input();
  expect(drain(summarizeGalleryScoreSteps(value)).value.low.total).toBe(700);
});

it('separates display cache from older optimization results and recomputes changed inputs', async () => {
  const records = new Map(), cache = { read: async (_s, _i, key) => records.get(key), write: async (_s, rows) => rows.forEach(r => records.set(r.key, r.summary)) };
  const value = input(), old = createGalleryScoreQueue({ cache, schedule: async () => {} });
  old.read('a', value); await old.idle(); old.dispose();
  const queue = createGalleryScoreQueue({ cache, selectionMode: 'enhancer', schedule: async () => {} });
  queue.read('a', value); await queue.idle();
  expect(queue.peek('a', value.set.id).low.total).toBe(700);
  value.progress.rows[0].gradingScore = 200;
  expect(queue.read('a', value).status).toBe('calculating'); await queue.idle();
  expect(queue.peek('a', value.set.id).low.total).toBe(900);
  queue.dispose();
});
