import { describe, expect, it } from 'vitest';
import { planGalleryJoint } from '../../src/gallery/joint-planner.js';
import { summarizeGalleryScore } from '../../src/gallery/scoring.js';

const catalog = { source: 'futgg', tags: [{ id: 1, name: 'No-op', bonusType: 'ITEM_SCORE_PERCENTAGE',
  thresholdType: 'ITEM_COUNT', rules: [{ attribute: 'RARE', type: 'COUNT', target: 'ATTRIBUTE', values: ['999'] }],
  tiers: [{ minItems: 1, bonus: 0 }] }] };
const makeSet = (id, threshold = 250) => ({ id: `futgg:${id}`, requiredCards: 2,
  grades: [{ name: 'D', threshold: 100 }, { name: 'B', threshold }] });
const row = (eaId, score, collected = false, extra = {}) => ({ eaId, playerEaId: eaId,
  name: `P${eaId}`, version: 'Gallery', overall: 80, gradingScore: score, galleryScore: score,
  collected, firstOwned: false, holographic: false, positions: ['ST'], skillMoves: 3, weakFoot: 3,
  nationEaId: 1, clubEaId: 1, leagueEaId: 1, rarityEaId: 1, ...extra });
const target = (id, rows, prices = {}, targetGrade = 'B') => ({ id: `target-${id}`, set: makeSet(id), catalog,
  progress: { season: '27', setId: id, complete: true, rows }, prices, targetGrade });

describe('Gallery joint planner', () => {
  it.each([2, 3, 7, 10])('retains a cheap %i-card tier combination shared across targets', count => {
    const bonusCatalog = { source: 'futgg', tags: [{ id: 2, name: 'Silver combination', bonusType: 'ITEM_SCORE_PERCENTAGE',
      thresholdType: 'ITEM_COUNT', rules: [{ attribute: 'LEVEL', type: 'COUNT', target: 'ATTRIBUTE', values: ['silver'] }],
      tiers: [{ minItems: count, bonus: 1000 }] }] };
    const cheap = Array.from({ length: 96 }, (_, i) => row(10 + i, 100));
    const upgrades = Array.from({ length: count }, (_, i) => row(200 + i, 90, false, { overall: 70 }));
    const prices = { ...Object.fromEntries(cheap.map(card => [card.eaId, 500])),
      ...Object.fromEntries(upgrades.map(card => [card.eaId, 600])), 999: 79500 };
    const targets = [30, 31].map(id => ({ ...target(id, [row(1, 2051, true), row(2, 2051, true), row(3, 2051, true),
      ...cheap, ...upgrades, row(999, 8000)], prices), set: { ...makeSet(id, 7800), requiredCards: 15 }, catalog: bonusCatalog }));
    const result = planGalleryJoint({ targets });
    expect(result.plans[0].totalPrice).toBe(6000 + count * 100);
    expect(result.plans[0].items).toHaveLength(12);
    expect(result.plans[0].items.some(card => card.eaId === 999)).toBe(false);
    expect(result.plans[0].targets.every(value => value.reached)).toBe(true);
    expect(result.searchComplete).toBe(false);
  });
  it('permits bounded public-pool plans without global completeness or unreachable claims', () => {
    const t = target(30, [row(1, 100, true), row(2, 100, true), row(3, 150)], { 3: 200 });
    t.progress.poolComplete = false; t.progress.candidateOnly = true;
    expect(planGalleryJoint({ targets: [t] })).toMatchObject({ status: 'ready', searchComplete: false, scopeTruncated: true });
    t.set.grades[1].threshold = 1000;
    expect(planGalleryJoint({ targets: [t] })).toMatchObject({ status: 'partial', reason: 'candidate-search-truncated', searchComplete: false });
  });
  it('deduplicates one exact version shared by two collections', () => {
    const shared = row(3, 150), result = planGalleryJoint({ targets: [
      target(30, [row(1, 100, true), row(2, 100, true), shared], { 3: 200 }),
      target(31, [row(4, 100, true), row(5, 100, true), shared], { 3: 200 }),
    ] });
    expect(result.status).toBe('ready');
    expect(result.plans[0].items.map(item => item.eaId)).toEqual([3]);
    expect(result.plans[0].totalPrice).toBe(200);
    expect(result.plans[0].targets.every(item => item.reached)).toBe(true);
  });

  it('keeps a more expensive shared alternative when it reaches both targets', () => {
    const result = planGalleryJoint({ targets: [
      target(30, [row(1, 100, true), row(2, 100, true), row(3, 150), row(4, 150)], { 3: 70, 4: 50 }),
      target(31, [row(5, 100, true), row(6, 100, true), row(3, 150), row(7, 150)], { 3: 70, 7: 50 }),
    ] });
    expect(result.status).toBe('ready');
    expect(result.plans.some(plan => plan.items.length === 1 && plan.items[0].eaId === 3)).toBe(true);
    expect(result.plans.some(plan => plan.items.length === 2 && plan.totalPrice === 100)).toBe(true);
    expect(result.plans[0].totalPrice).toBe(70);
    expect(result.plans[0].items[0].targetIds).toEqual(['futgg:30', 'futgg:31']);
  });

  it('does not merge different versions with one base player identity', () => {
    const result = planGalleryJoint({ targets: [
      target(30, [row(1, 100, true), row(2, 100, true), row(3, 150, false, { playerEaId: 99 })], { 3: 200 }),
      target(31, [row(4, 100, true), row(5, 100, true), row(8, 150, false, { playerEaId: 99 })], { 8: 200 }),
    ] });
    expect(result.plans[0].items).toHaveLength(2);
    expect(result.plans[0].items.map(item => item.eaId).sort()).toEqual([3, 8]);
  });

  it('reports unknown prices instead of treating them as free under budget', () => {
    const result = planGalleryJoint({ budget: 300, targets: [
      target(30, [row(1, 100, true), row(2, 100, true), row(3, 150)], {}),
      target(31, [row(4, 100, true), row(5, 100, true), row(3, 150)], {}),
    ] });
    expect(result).toMatchObject({ status: 'partial', reason: 'price-unknown', plans: [] });
  });

  it('reports budget boundary and excludes over-budget plans', () => {
    const result = planGalleryJoint({ budget: 199, targets: [
      target(30, [row(1, 100, true), row(2, 100, true), row(3, 150)], { 3: 200 }),
    ] });
    expect(result).toMatchObject({ status: 'no-plan', reason: 'budget-unreachable', budget: 199 });
  });

  it('excludes an unanswered version and leaves every input untouched', () => {
    const input = { targets: [target(30, [row(1, 100, true), row(2, 100, null), row(3, 150)])] };
    const copy = structuredClone(input);
    expect(planGalleryJoint(input)).toMatchObject({ status: 'ready', collectionUnknownCount: 1, searchComplete: false });
    expect(planGalleryJoint(input).plans[0].items.map(item => item.eaId)).toEqual([3]);
    expect(input).toEqual(copy);
  });

  it('keeps an incomplete request blocked and never proves impossibility from unknown versions', () => {
    const t = target(30, [row(1, 100, true), row(2, 200, null)], { 2: 1 });
    expect(planGalleryJoint({ targets: [t] })).toMatchObject({ status: 'partial', reason: 'collection-status-unknown',
      collectionUnknownCount: 1, searchComplete: false, plans: [] });
    t.progress.complete = false;
    expect(planGalleryJoint({ targets: [t] })).toMatchObject({ status: 'partial', reason: 'target-state-unknown', plans: [] });
  });

  it('reports one unknown exact version shared by multiple targets only once', () => {
    const unknown = row(99, 1000, null);
    const result = planGalleryJoint({ targets: [
      target(30, [row(1, 100, true), unknown, row(3, 150)], { 3: 200, 99: 1 }),
      target(31, [row(2, 100, true), unknown, row(3, 150)], { 3: 200, 99: 1 }),
    ] });
    expect(result).toMatchObject({ status: 'ready', collectionUnknownCount: 1,
      collectionUnknownIds: [99], searchComplete: false });
    expect(result.plans[0].items.map(item => item.eaId)).toEqual([3]);
    expect(result.plans[0].targets.every(item => item.score === 250)).toBe(true);
  });

  it.each([{ inClub: true }, { held: true }])('does not add an already-held version to a joint purchase plan: %o', ownership => {
    const t = target(30, [row(1, 100, true), row(2, 200, false, ownership)]);
    expect(planGalleryJoint({ targets: [t] })).toMatchObject({ status: 'achieved', plans: [] });
  });

  it.each([{ inClub: true }, { held: true }])('requires a score for an already-held version: %o', ownership => {
    const t = target(30, [row(1, 100, true), row(2, null, false, ownership)]);
    expect(planGalleryJoint({ targets: [t] })).toMatchObject({ status: 'partial', reason: 'target-state-unknown', plans: [] });
  });

  it.each([{ inClub: true }, { held: true }])('shares positive ownership evidence across targets without buying the version: %o', ownership => {
    const targets = [
      target(30, [row(1, 150, true), row(2, 100, false, ownership)], { 2: 1 }),
      target(31, [row(3, 150, true), row(2, 100, false)], { 2: 1 }),
    ];
    const before = structuredClone(targets);
    for (const ordered of [targets, targets.slice().reverse()]) {
      expect(planGalleryJoint({ targets: ordered })).toMatchObject({ status: 'achieved', plans: [] });
    }
    expect(targets).toEqual(before);
  });

  it('finds a cheap complete lineup before expansion exhausts the large-pool budget', () => {
    const t = target(99, [row(1, 2051, true), row(2, 2051, true), row(3, 2051, true),
      ...Array.from({ length: 90 }, (_, i) => row(10 + i, 150)), row(999, 2000)],
    { ...Object.fromEntries(Array.from({ length: 90 }, (_, i) => [10 + i, 500])), 999: 84500 }, 'S');
    t.set = { id: 'futgg:99', requiredCards: 15, grades: [{ name: 'S', threshold: 7800 }] };
    const input = { targets: [t], budget: 10000 }, before = structuredClone(input);
    const result = planGalleryJoint(input);
    expect(result.status).toBe('ready');
    expect(result.plans[0]).toMatchObject({ totalPrice: 6000, remainingBudget: 4000 });
    expect(result.plans[0].items).toHaveLength(12);
    expect(result.plans[0].items.some(item => item.eaId === 999)).toBe(false);
    expect(input).toEqual(before);
  });

  it('refines a complete low-cost bundle instead of retaining the expensive score seed', () => {
    const t = target(99, [row(1, 2051, true), row(2, 2051, true), row(3, 2051, true),
      ...Array.from({ length: 30 }, (_, i) => row(10 + i, 100)), row(98, 600), row(999, 8000)],
    { ...Object.fromEntries(Array.from({ length: 30 }, (_, i) => [10 + i, 500])), 98: 1200, 999: 80000 }, 'S');
    t.set = { id: 'futgg:99', requiredCards: 15, grades: [{ name: 'S', threshold: 7800 }] };
    const result = planGalleryJoint({ targets: [t] });
    expect(result.status).toBe('ready');
    expect(result.plans[0].totalPrice).toBe(6700);
    expect(result.plans[0].items).toHaveLength(12);
    expect(result.plans[0].items.some(item => item.eaId === 999)).toBe(false);
  });

  it('marks bounded search exhaustion as partial', () => {
    const result = planGalleryJoint({ maxEvaluations: 1, targets: [
      target(30, [row(1, 100, true), row(2, 100, true), row(3, 150), row(4, 150)], { 3: 1, 4: 1 }),
    ] });
    expect(result).toMatchObject({ status: 'partial', reason: 'search-budget-exhausted' });
  });

  it('finds a bundle that crosses a grade even when no individual card does', () => {
    const t = target(30, [row(3, 150), row(4, 150)], { 3: 100, 4: 100 });
    const result = planGalleryJoint({ targets: [t], budget: 200 });
    expect(result).toMatchObject({ status: 'ready' });
    expect(result.plans[0]).toMatchObject({ totalPrice: 200, remainingBudget: 0 });
    expect(result.plans[0].items).toHaveLength(2);
  });

  it('never adds First Owner credit for newly bought versions', () => {
    const fo = { source: 'futgg', tags: [{ id: 1, name: 'FO', bonusType: 'ITEM_SCORE_PERCENTAGE',
      thresholdType: 'ITEM_COUNT', rules: [{ attribute: 'FIRST_OWNED', type: 'COUNT', target: 'ATTRIBUTE', values: ['1'] }],
      tiers: [{ minItems: 2, bonus: 100 }] }] };
    const t = target(30, [row(3, 100, false, { firstOwned: true }), row(4, 100, false, { firstOwned: true })], { 3: 1, 4: 1 });
    expect(planGalleryJoint({ targets: [{ ...t, catalog: fo }] })).toMatchObject({ status: 'no-plan' });
  });

  it('does not silently resolve contradictory complete account facts', () => {
    expect(planGalleryJoint({ targets: [target(30, [row(1, 100, true)]), target(31, [row(1, 100, false)])] }))
      .toMatchObject({ status: 'partial', reason: 'version-facts-conflict' });
  });

  it.each(['scope', 'platform'])('rejects different target %s contexts', key => {
    const a = target(30, [row(1, 100, true)]), b = target(31, [row(2, 100, true)]);
    expect(planGalleryJoint({ targets: [{ ...a, [key]: 'one' }, { ...b, [key]: 'two' }] }))
      .toMatchObject({ status: 'unavailable', reason: 'target-context-mismatch' });
  });

  it('rejects a different season and a mismatched set identity', () => {
    const t = target(30, [row(1, 100, true)]);
    for (const progress of [{ ...t.progress, season: '26' }, { ...t.progress, setId: 31 }]) {
      expect(planGalleryJoint({ targets: [{ ...t, progress }] })).toMatchObject({ status: 'unavailable' });
    }
  });

  it('marks missing score candidates and pool truncation as partial', () => {
    const t = target(30, [row(1, 100, true), row(2, 100, true), row(3, null)], {});
    expect(planGalleryJoint({ targets: [t] })).toMatchObject({ status: 'partial', reason: 'candidate-search-truncated' });
  });

  it('shows separate catalog rewards without claiming any earned or claimable total', () => {
    const a = target(30, [row(1, 100, true), row(2, 100, true), row(3, 150)], { 3: 70 });
    a.set.grades[1].rewards = [{ type: 'event_token_1', count: 1, value: 50, label: '50 Tokens' },
      { type: 'badge', count: 1, value: 1, label: 'Badge' }];
    const plan = planGalleryJoint({ targets: [a] }).plans[0];
    expect(plan.targets[0]).toMatchObject({ rewardStatus: 'catalog-only', rewards: a.set.grades[1].rewards });
    expect(plan).not.toHaveProperty('earnedRewards');
    expect(plan).not.toHaveProperty('tokenTotal');
  });

  it.each([0, -1, NaN, Infinity, 1.5])('rejects invalid search budgets %s', maxEvaluations => {
    expect(planGalleryJoint({ targets: [target(30, [])], maxEvaluations })).toMatchObject({ status: 'unavailable', reason: 'search-options-invalid' });
  });

  it('prefers a priced alternative over a feasible unknown-price plan', () => {
    const result = planGalleryJoint({ targets: [
      target(30, [row(1, 100, true), row(2, 100, true), row(3, 150), row(4, 150)], { 4: 90 }),
    ] });
    expect(result.plans[0].totalPrice).toBe(90);
    expect(result.plans.some(plan => plan.missingPriceIds.includes(3))).toBe(true);
  });

  it('returns achieved for an already satisfied target without shopping', () => {
    expect(planGalleryJoint({ targets: [target(30, [row(1, 150, true), row(2, 150, true)])], budget: 0 }))
      .toMatchObject({ status: 'achieved', plans: [] });
  });

  it('does not silently pick a quote when shared-version price snapshots disagree', () => {
    const targets = [target(30, [row(1, 100, true), row(2, 100, true), row(3, 150)], { 3: 70 }),
      target(31, [row(5, 100, true), row(6, 100, true), row(3, 150)], { 3: 90 })];
    expect(planGalleryJoint({ targets, budget: 100 })).toMatchObject({ status: 'partial', reason: 'price-unknown' });
    expect(planGalleryJoint({ targets }).plans[0]).toMatchObject({ totalPrice: null, missingPriceIds: [3] });
  });

  it('preserves catalog score estimates explicitly', () => {
    const result = planGalleryJoint({ targets: [target(30, [row(1, 100, true), row(2, 100, true),
      row(3, null, false, { galleryScore: 150 })], { 3: 70 })] });
    expect(result.plans[0]).toMatchObject({ estimated: true });
    expect(result.plans[0].items[0].scoreSource).toBe('catalog');
  });

  it('keeps unknown FO contributions conservative', () => {
    const t = target(30, [row(1, 100, true, { firstOwned: null }), row(2, 100, true, { firstOwned: null })]);
    t.catalog = { source: 'futgg', tags: [{ id: 1, name: 'FO', bonusType: 'ITEM_SCORE_PERCENTAGE',
      thresholdType: 'ITEM_COUNT', rules: [{ attribute: 'FIRST_OWNED', type: 'COUNT', target: 'ATTRIBUTE', values: ['1'] }],
      tiers: [{ minItems: 2, bonus: 100 }] }] };
    expect(planGalleryJoint({ targets: [t] })).toMatchObject({ status: 'partial', reason: 'score-conditions-unknown' });
  });

  it('keeps following three small upgrades in a 100-card pool rather than an expensive one-step jump', () => {
    const low = Array.from({ length: 96 }, (_, i) => row(10 + i, 100));
    const t = target(30, [row(1, 2051, true), row(2, 2051, true), row(3, 2051, true), ...low,
      ...[200, 201, 202].map(id => row(id, 250)), row(999, 8000)],
      { ...Object.fromEntries(low.map(card => [card.eaId, 500])), 200: 600, 201: 600, 202: 600, 999: 80000 }, 'S');
    t.set.requiredCards = 15; t.set.grades = [{ name: 'S', threshold: 7800, rewards: [] }];
    const result = planGalleryJoint({ targets: [t] });
    expect(result.plans[0].totalPrice).toBe(6300);
    expect(result.plans[0].items.some(card => card.eaId === 999)).toBe(false);
  });

  it('matches an exhaustive oracle for small shared pools and preserves all inputs', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const rows = [1, 2, 3, 4, 5].map(id => row(id, 80 + (id * seed * 37) % 180));
      const prices = Object.fromEntries(rows.map(item => [item.eaId, 50 + (item.eaId * seed * 17) % 200]));
      const targets = [target(30, rows.slice(0, 4), prices), target(31, rows.slice(1), prices)];
      let best = Infinity;
      for (let mask = 0; mask < 32; mask++) {
        const ids = rows.filter((_, index) => mask & (1 << index)).map(item => item.eaId);
        const reached = targets.every(t => {
          const summary = summarizeGalleryScore({ set: t.set, catalog, progress: { ...t.progress,
            rows: t.progress.rows.map(item => ({ ...item, collected: ids.includes(item.eaId) })) } });
          return summary.full && summary.low.total >= 250;
        });
        if (reached) best = Math.min(best, ids.reduce((sum, id) => sum + prices[id], 0));
      }
      const input = { targets, maxPlans: 5, beamWidth: 64 }, copy = structuredClone(input);
      const result = planGalleryJoint(input);
      expect(result.plans[0]?.totalPrice ?? Infinity).toBe(best);
      expect(input).toEqual(copy);
    }
  });
});
