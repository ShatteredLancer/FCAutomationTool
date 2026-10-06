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
  it.each([2, 3, 7, 10])('prices a %i-card bonus bundle before accepting an expensive immediate solution', count => {
    const bonusCatalog = { source: 'futgg', tags: [{ id: 2, name: 'Silver combination', bonusType: 'ITEM_SCORE_PERCENTAGE',
      thresholdType: 'ITEM_COUNT', rules: [{ attribute: 'LEVEL', type: 'COUNT', target: 'ATTRIBUTE', values: ['silver'] }],
      tiers: [{ minItems: count, bonus: 1000 }] }] };
    const cheap = Array.from({ length: 96 }, (_, i) => row(10 + i, 100, false));
    const upgrades = Array.from({ length: count }, (_, i) => row(200 + i, 90, false, { overall: 70 }));
    const input = { set: { ...set, requiredCards: 15 }, catalog: bonusCatalog, targetGrade: 7800,
      progress: { complete: true, rows: [row(1, 2051, true), row(2, 2051, true), row(3, 2051, true),
        ...cheap, ...upgrades, row(999, 8000, false)] },
      prices: { ...Object.fromEntries(cheap.map(card => [card.eaId, 500])),
        ...Object.fromEntries(upgrades.map(card => [card.eaId, 600])), 999: 79500 } };
    const before = structuredClone(input), result = planGalleryGrade(input);
    expect(result.plans[0].totalPrice).toBe(6000 + count * 100);
    expect(result.plans[0].items).toHaveLength(12);
    expect(result.plans[0].items.some(card => card.eaId === 999)).toBe(false);
    expect(result.plans[0].score).toBeGreaterThanOrEqual(7800);
    expect(result.searchComplete).toBe(false);
    expect(input).toEqual(before);
  });
  it('allows candidate-only plans without claiming complete search or global impossibility', () => {
    const threeCardSet = { ...set, requiredCards: 3 };
    const progress = { complete: true, poolComplete: false, candidateOnly: true,
      rows: [row(1, 100, true), row(2, 100, true), row(3, 200, false)] };
    expect(planGalleryGrade({ set: threeCardSet, catalog, progress, targetGrade: 'B', prices: { 3: 350 } }))
      .toMatchObject({ status: 'ready', searchComplete: false, scopeTruncated: true });
    expect(planGalleryGrade({ set: threeCardSet, catalog, progress, targetGrade: 1000 }))
      .toMatchObject({ status: 'partial', reason: 'candidate-search-truncated', searchComplete: false });
  });
  it('finds a bounded, priced plan for a named grade', () => {
    const result = planGalleryGrade({ set: { ...set, requiredCards: 3 }, catalog, targetGrade: 'B',
      progress: { rows: [row(1, 100, true), row(2, 100, true), row(3, 200, false), row(4, 210, false)] },
      prices: { 3: 350, 4: 500 } });
    expect(result.status).toBe('ready');
    expect(result.plans[0]).toMatchObject({ reached: true, threshold: 300, totalPrice: 350, estimated: false });
    expect(result.plans[0].items.map(item => item.eaId)).toEqual([3]);
  });

  it('marks lower grades reached by the current partial score without pricing a refill', () => {
    const result = planGalleryGrade({ set, catalog, targetGrade: 'D',
      progress: { rows: [row(1, 1000, true), row(2, 1000, true), row(3, 200, false)] }, prices: { 3: 350 } });
    expect(result).toMatchObject({ status: 'achieved', targetGrade: 'D', currentScore: 2000 });
  });

  it('plans only the unfilled slots and avoids an expensive card when cheap cards meet the target', () => {
    const totalSet = { id: 'futgg:99', requiredCards: 15, grades: [{ name: 'S', threshold: 7800 }] };
    const progress = { rows: [row(1, 2051, true), row(2, 2051, true), row(3, 2051, true),
      ...Array.from({ length: 14 }, (_, index) => row(10 + index, 150, false)), row(99, 2000, false)] };
    const prices = Object.fromEntries(progress.rows.filter(item => item.collected === false).map(item => [item.eaId, item.eaId === 99 ? 84500 : 500]));
    const result = planGalleryGrade({ set: totalSet, catalog, targetGrade: 'S', progress, prices });
    expect(result.status).toBe('ready');
    expect(result.plans[0].items).toHaveLength(12);
    expect(result.plans[0].items.some(item => item.eaId === 99)).toBe(false);
    expect(result.plans[0].totalPrice).toBe(6000);
    expect(result.plans[0]).toMatchObject({ currentScore: 6153, addedScore: 1800, score: 7953 });
  });

  it('keeps missing prices and catalog-estimated scores explicit', () => {
    const result = planGalleryGrade({ set: { ...set, requiredCards: 3 }, catalog, targetGrade: 300,
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

  it('plans from explicit rows while excluding an unknown collection version', () => {
    const result = planGalleryGrade({ set: { ...set, requiredCards: 3 }, catalog, targetGrade: 'B',
      progress: { complete: true, rows: [row(1, 100, true), row(2, 100, true), row(3, 200, false), row(4, 999, null)] },
      prices: { 3: 1, 4: 1 } });
    expect(result.status).toBe('ready');
    expect(result.collectionUnknownCount).toBe(1);
    expect(result.searchComplete).toBe(false);
    expect(result.plans[0].items.map(item => item.eaId)).toEqual([3]);
  });

  it('retains incomplete request and invalid collection flag guards', () => {
    const input = { set, catalog, targetGrade: 'B', prices: { 2: 100 },
      progress: { complete: false, rows: [row(1, 100, true), row(2, 200, false)] } };
    expect(planGalleryGrade(input)).toMatchObject({ status: 'partial', reason: 'collection-status-unknown', plans: [] });
    input.progress.complete = true; input.progress.rows[1].collected = 'false';
    expect(planGalleryGrade(input)).toMatchObject({ status: 'unavailable', reason: 'input-invalid' });
  });

  it.each([{ inClub: true }, { held: true }])('does not invent a score for an already-held version: %o', ownership => {
    const result = planGalleryGrade({ set, catalog, targetGrade: 'B',
      progress: { rows: [row(1, 100, true), row(2, null, false, ownership)] }, prices: { 2: 1 } });
    expect(result).toMatchObject({ status: 'partial', reason: 'existing-score-unknown', plans: [] });
  });

  it('reports an unreachable grade instead of treating absent candidates as free', () => {
    const result = planGalleryGrade({ set, catalog, targetGrade: 'B',
      progress: { rows: [row(1, 100, true), row(3, 110, false)] }, prices: { 3: 100 } });
    expect(result.status).toBe('no-plan');
    expect(result.bestScore).toBeLessThan(300);
  });

  it('reports bounded search exhaustion as partial rather than globally unreachable', () => {
    const result = planGalleryGrade({ set: { ...set, requiredCards: 3 }, catalog, targetGrade: 500, maxEvaluations: 2,
      progress: { rows: [row(1, 100, true), row(2, 100, true), row(3, 110, false), row(4, 120, false)] },
      prices: { 3: 100, 4: 100 } });
    expect(result.status).toBe('partial');
    expect(result.reason).toBe('search-budget-exhausted');
    expect(result.evaluations).toBeLessThanOrEqual(2);
    expect(result.bestScore).toBeGreaterThan(0);
    expect(result.distanceToTarget).toBeGreaterThan(0);
    expect(result.bestCandidate.ids.length).toBeGreaterThan(0);
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
    expect(result).toMatchObject({ status: 'partial', reason: 'collection-status-unknown', plans: [], collectionUnknownCount: 1 });
  });

  it.each([{ inClub: true }, { held: true }])('does not purchase a version already held outside the Gallery collected flag: %o', ownership => {
    const result = planGalleryGrade({ set: { ...set, requiredCards: 2 }, catalog, targetGrade: 'B',
      progress: { rows: [row(1, 100, true), row(2, 200, false, ownership)] }, prices: { 2: 1 } });
    expect(result).toMatchObject({ status: 'achieved', currentScore: 300, plans: [] });
  });

  it('upgrades a cheap complete bundle when the absolute cheapest is short of the target, avoiding an 80000 card', () => {
    const input = { set: { ...set, requiredCards: 15 }, catalog, targetGrade: 7800,
      progress: { rows: [row(1, 2051, true), row(2, 2051, true), row(3, 2051, true),
        ...Array.from({ length: 30 }, (_, i) => row(10 + i, 100, false)), row(98, 600, false), row(99, 8000, false)] },
      prices: { ...Object.fromEntries(Array.from({ length: 30 }, (_, i) => [10 + i, 500])), 98: 1200, 99: 80000 } };
    const result = planGalleryGrade(input);
    expect(result.status).toBe('ready');
    expect(result.plans[0].items).toHaveLength(12);
    expect(result.plans[0].score).toBeGreaterThanOrEqual(7800);
    expect(result.plans[0].totalPrice).toBe(6700);
    expect(result.plans[0].items.some(item => item.eaId === 99)).toBe(false);
  });

  it('reports why a high-score card is present when the cheapest complete lineup misses the target', () => {
    const result = planGalleryGrade({ set: { ...set, requiredCards: 3 }, catalog, targetGrade: 7800,
      progress: { rows: [row(1, 2051, true), row(2, 2051, true), row(3, 2051, true), row(4, 100, false), row(5, 100, false), row(6, 8000, false)] },
      prices: { 4: 200, 5: 200, 6: 80000 } });
    expect(result).toMatchObject({ status: 'ready', costAudit: { totalPrice: 200, reached: false } });
    expect(result.costAudit.score).toBeLessThan(7800);
  });

  it('keeps following three small upgrades in a 100-card pool rather than an expensive one-step jump', () => {
    const low = Array.from({ length: 96 }, (_, i) => row(10 + i, 100, false));
    const upgrades = [200, 201, 202].map(id => row(id, 250, false));
    const result = planGalleryGrade({ set: { ...set, requiredCards: 15 }, catalog, targetGrade: 7800,
      progress: { rows: [row(1, 2051, true), row(2, 2051, true), row(3, 2051, true), ...low, ...upgrades, row(999, 8000, false)] },
      prices: { ...Object.fromEntries(low.map(card => [card.eaId, 500])), 200: 600, 201: 600, 202: 600, 999: 80000 } });
    expect(result.plans[0].totalPrice).toBe(6300);
    expect(result.plans[0].items.some(card => card.eaId === 999)).toBe(false);
  });

  it('counts each combination once rather than evaluating all card permutations', () => {
    const result = planGalleryGrade({ set: { ...set, requiredCards: 3 }, catalog, targetGrade: 1000,
      progress: { rows: [row(1, 10, false), row(2, 10, false), row(3, 10, false)] }, prices: { 1: 200, 2: 200, 3: 200 } });
    expect(result.evaluations).toBe(8);
    expect(result.searchComplete).toBe(true);
  });

  it('can upgrade a full collection whose counting lineup is below the target', () => {
    const result = planGalleryGrade({ set: { ...set, requiredCards: 2 }, catalog, targetGrade: 250,
      progress: { rows: [row(1, 100, true), row(2, 100, true), row(3, 150, false)] }, prices: { 3: 50 } });
    expect(result.status).toBe('ready');
    expect(result.plans[0]).toMatchObject({ totalPrice: 50, score: 250 });
    expect(result.plans[0].items.map(item => item.eaId)).toEqual([3]);
  });

  it('preserves multiple purchase upgrades when all counting slots are already owned', () => {
    const result = planGalleryGrade({ set: { ...set, requiredCards: 2 }, catalog, targetGrade: 260,
      progress: { rows: [row(1, 100, true), row(2, 100, true), row(3, 130, false), row(4, 130, false)] }, prices: { 3: 50, 4: 50 } });
    expect(result.status).toBe('ready');
    expect(result.plans[0]).toMatchObject({ totalPrice: 100, score: 260 });
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
    expect(result.reason).toBe('target-unreachable');
  });

  it('does not give a market purchase an old First Owner bonus', () => {
    const bonus = { source: 'futgg', tags: [{ id: 1, name: 'First Owner', bonusType: 'ITEM_SCORE_PERCENTAGE',
      thresholdType: 'ITEM_COUNT', rules: [{ attribute: 'FIRST_OWNED', type: 'COUNT', target: 'ATTRIBUTE', values: ['1'] }],
      tiers: [{ minItems: 2, bonus: 100 }] }] };
    const result = planGalleryGrade({ set, catalog: bonus, targetGrade: 400,
      progress: { rows: [row(1, 100, true, { firstOwned: true }), row(2, 100, false, { firstOwned: true })] }, prices: { 2: 100 } });
    expect(result.status).not.toBe('ready');
    expect(result.bestScore).toBe(200);
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
