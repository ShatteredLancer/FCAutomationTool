import { expect, it } from 'vitest';
import { compileGalleryScoringRules, evaluateGalleryLineup } from '../../src/gallery/scoring.js';
import { searchGalleryLineupCosts } from '../../src/gallery/lineup-cost-search.js';
import { planGalleryGrade } from '../../src/gallery/planner.js';

// Synthetic wide league: an already-full low-value collection must not spend
// every warm-start step on its cheapest band before seeing replacement cards.
function fixture() {
  const set = { id: 'futgg:17', requiredCards: 30, grades: [{ name: 'B', threshold: 3000 }] };
  const catalog = { source: 'futgg', tags: [{ id: 1, name: 'No bonus', bonusType: 'ITEM_SCORE_PERCENTAGE', thresholdType: 'ITEM_COUNT',
    rules: [{ attribute: 'RARE', type: 'COUNT', target: 'ATTRIBUTE', values: ['999'] }], tiers: [{ minItems: 1, bonus: 0 }] }] };
  const card = (eaId, gradingScore) => ({ eaId, playerEaId: eaId, gradingScore, overall: 75, rarityEaId: 1, firstOwned: false });
  const existing = Array.from({ length: 80 }, (_, i) => ({ ...card(i + 1, 1), collected: true }));
  const candidates = Array.from({ length: 100 }, (_, i) => ({ id: 1000 + i, row: card(1000 + i, i < 70 ? 2 : 100),
    price: i < 70 ? 200 : 1000, score: { value: i < 70 ? 2 : 100, source: 'ea' } }));
  return { set, catalog, existing, candidates };
}
it('tests a full priced-pool scoring witness before low-price bands consume the warm-start budget', () => {
  const { set, catalog, existing, candidates } = fixture();
  const steps = searchGalleryLineupCosts({ existing, candidates, set, catalog, compiled: compileGalleryScoringRules(catalog),
    threshold: 3000, maxEvaluations: 1 });
  let next, work = 0;
  do { next = steps.next(); work++; } while (!next.done);
  expect(next.value.evaluations).toBeLessThanOrEqual(1);
  expect(work).toBeLessThanOrEqual(16010);
  expect(next.value.plans.length).toBeGreaterThan(0);
  const byId = new Map([...existing, ...candidates.map(c => c.row)].map(row => [row.eaId, row]));
  expect(evaluateGalleryLineup(next.value.plans[0].ids.map(id => byId.get(id)), compileGalleryScoringRules(catalog)).total).toBeGreaterThanOrEqual(3000);
});

it('retains and fully validates the best league witness even when the requested grade is not reached', () => {
  const { set, catalog, existing, candidates } = fixture();
  const input = { set, catalog, targetGrade: 4000, lineupSearch: true, maxEvaluations: 50,
    progress: { season: '27', setId: 17, complete: true, rows: [...existing, ...candidates.map(c => ({ ...c.row, collected: false }))] },
    prices: Object.fromEntries(candidates.map(c => [c.id, c.price])) };
  const result = planGalleryGrade(input);
  expect(result.status).toBe('partial'); expect(result.searchComplete).toBe(false);
  expect(result.bestScore).toBe(3000); expect(result.distanceToTarget).toBe(1000);
  expect(result.bestCandidate.items).toHaveLength(30);
  expect(result.bestCandidate.totalPrice).toBe(30000);
  expect(result.evaluations).toBeLessThanOrEqual(50);
});
