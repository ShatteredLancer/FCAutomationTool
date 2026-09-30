import { describe, expect, it } from 'vitest';
import { planGalleryGrade } from '../../src/gallery/planner.js';

const set = { id: 'futgg:30', requiredCards: 2, grades: [
  { name: 'D', threshold: 100 }, { name: 'C', threshold: 180 }, { name: 'B', threshold: 300 },
] };
const catalog = { source: 'futgg', tags: [{ id: 1, name: 'No-op bonus', bonusType: 'ITEM_SCORE_PERCENTAGE',
  thresholdType: 'ITEM_COUNT', rules: [{ attribute: 'RARE', type: 'COUNT', target: 'ATTRIBUTE', values: ['999'] }],
  tiers: [{ minItems: 1, bonus: 1 }] }] };
const row = (eaId, gradingScore, collected, extra = {}) => ({ eaId, playerEaId: eaId, name: `P${eaId}`, version: 'Gallery',
  overall: 80, gradingScore, galleryScore: gradingScore, collected, firstOwned: false, holographic: false,
  positions: ['ST'], skillMoves: 3, weakFoot: 3, nationEaId: 1, clubEaId: 1, leagueEaId: 1, rarityEaId: 1, ...extra });

describe('Gallery grade planner', () => {
  it('finds a bounded, priced plan for a named grade', () => {
    const result = planGalleryGrade({ set, catalog, targetGrade: 'B',
      progress: { rows: [row(1, 100, true), row(2, 100, true), row(3, 200, false), row(4, 210, false)] },
      prices: { 3: 350, 4: 500 } });
    expect(result.status).toBe('ready');
    expect(result.plans[0]).toMatchObject({ reached: true, threshold: 300, totalPrice: 350, estimated: false });
    expect(result.plans[0].items.map(item => item.eaId)).toEqual([3]);
  });

  it('keeps missing prices and catalog-estimated scores explicit', () => {
    const result = planGalleryGrade({ set, catalog, targetGrade: 300,
      progress: { rows: [row(1, 100, true), row(2, 100, true), row(3, 200, false, { gradingScore: null, galleryScore: 200 })] },
      prices: {} });
    expect(result.status).toBe('ready');
    expect(result.plans[0]).toMatchObject({ totalPrice: null, estimated: true, confidence: 'catalog-estimate' });
    expect(result.plans[0].missingPriceIds).toEqual([3]);
  });

  it('does not invent a plan when existing EA score is unknown', () => {
    const result = planGalleryGrade({ set, catalog, targetGrade: 'C',
      progress: { rows: [row(1, null, true), row(2, 100, true), row(3, 200, false)] }, prices: { 3: 1 } });
    expect(result).toMatchObject({ status: 'partial', reason: 'existing-score-unknown', plans: [] });
  });

  it('reports an unreachable grade instead of treating absent candidates as free', () => {
    const result = planGalleryGrade({ set, catalog, targetGrade: 'B',
      progress: { rows: [row(1, 100, true), row(3, 110, false)] }, prices: { 3: 100 } });
    expect(result.status).toBe('no-plan');
    expect(result.bestScore).toBeLessThan(300);
  });

  it('reports bounded search exhaustion as partial rather than globally unreachable', () => {
    const result = planGalleryGrade({ set, catalog, targetGrade: 'B', maxEvaluations: 2,
      progress: { rows: [row(1, 100, true), row(2, 100, true), row(3, 110, false), row(4, 120, false)] },
      prices: { 3: 100, 4: 100 } });
    expect(result.status).toBe('partial');
    expect(result.reason).toBe('search-budget-exhausted');
    expect(result.evaluations).toBeLessThanOrEqual(2);
  });

  it('stops all beam expansions at the shared budget, not just one inner loop', () => {
    const result = planGalleryGrade({ set: { ...set, requiredCards: 4 }, catalog, targetGrade: 1000,
      maxEvaluations: 7, progress: { rows: [1, 2, 3, 4].map(id => row(id, 10, false)) } });
    expect(result).toMatchObject({ status: 'partial', reason: 'search-budget-exhausted', evaluations: 7 });
  });

  it('marks candidate truncation when no plan can be proven from the bounded pool', () => {
    const result = planGalleryGrade({ set, catalog, targetGrade: 500, maxCandidates: 1,
      progress: { rows: [row(1, 100, true), row(2, 100, true), row(3, 110, false), row(4, 210, false)] },
      prices: { 3: 100, 4: 100 } });
    expect(result.status).toBe('partial');
    expect(result.reason).toBe('candidate-search-truncated');
    expect(result.omittedCandidates).toBe(1);
  });

  it('does not treat unverified collection rows as missing purchases', () => {
    const result = planGalleryGrade({ set, catalog, targetGrade: 'B',
      progress: { rows: [row(1, 100, true), row(2, 200, null)] }, prices: { 2: 100 } });
    expect(result).toMatchObject({ status: 'partial', reason: 'collection-status-unknown', plans: [] });
  });

  it('counts each combination once rather than evaluating all card permutations', () => {
    const result = planGalleryGrade({ set: { ...set, requiredCards: 3 }, catalog, targetGrade: 1000,
      progress: { rows: [row(1, 10, false), row(2, 10, false), row(3, 10, false)] }, prices: { 1: 200, 2: 200, 3: 200 } });
    expect(result.evaluations).toBe(8);
    expect(result.searchComplete).toBe(true);
  });

  it('preserves distinct versions of a player and leaves all inputs untouched', () => {
    const input = { set, catalog, targetGrade: 'B', progress: { rows: [row(1, 100, true),
      row(2, 110, false, { playerEaId: 77 }), row(3, 210, false, { playerEaId: 77 })] }, prices: { 2: 10, 3: 100 } };
    const copy = structuredClone(input);
    const result = planGalleryGrade(input);
    expect(result.status).toBe('ready');
    expect(result.plans.some(plan => plan.items.some(item => item.eaId === 3))).toBe(true);
    expect(input).toEqual(copy);
  });

  it('does not claim the optimistic First Owner bound as an achieved target', () => {
    const bonus = { source: 'futgg', tags: [{ id: 1, name: 'First Owner', bonusType: 'ITEM_SCORE_PERCENTAGE',
      thresholdType: 'ITEM_COUNT', rules: [{ attribute: 'FIRST_OWNED', type: 'COUNT', target: 'ATTRIBUTE', values: ['1'] }],
      tiers: [{ minItems: 2, bonus: 100 }] }] };
    const result = planGalleryGrade({ set, catalog: bonus, targetGrade: 400,
      progress: { rows: [row(1, 100, true, { firstOwned: null }), row(2, 100, false, { firstOwned: null })] }, prices: { 2: 100 } });
    expect(result.status).not.toBe('ready');
    expect(result.reason).toBe('score-conditions-unknown');
  });

  it('does not call a bounded scoring selection proof of global impossibility', () => {
    const result = planGalleryGrade({ set, catalog, targetGrade: 1000,
      progress: { rows: [row(1, 100, true), row(2, 100, true), row(3, 100, true)] } });
    expect(result).toMatchObject({ status: 'partial', reason: 'score-selection-bounded', searchComplete: false });
  });

  it.each([0, -1, NaN, Infinity, 1.5])('rejects invalid search bounds %s without doing work', bound => {
    expect(planGalleryGrade({ set, catalog, targetGrade: 'B', maxEvaluations: bound, progress: { rows: [] } }))
      .toMatchObject({ status: 'unavailable', reason: 'search-options-invalid' });
  });
});
