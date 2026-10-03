import { expect, it } from 'vitest';
import { puzzleFillFixture } from '../helpers/fc27-puzzle-fill-fixture.js';
import { suggestFc27PuzzleJointPurchases, suggestFc27PuzzleJointPurchasesCooperatively,
  findFc27PuzzleRepairSeedCooperatively } from '../../src/fc27/puzzle-procurement.js';
import { previewFc27PuzzleSquad, previewFc27PuzzleSquadCooperatively } from '../../src/fc27/puzzle-preview.js';
import { shortageFixture } from '../helpers/fc27-puzzle-shortage-fixture.js';
import { formatFc27PuzzleProgress } from '../../src/adapters/browser/fc27-puzzle-native-button.js';

// Synthetic cardinality/chemistry regression derived from the 2026-10-03
// diagnostic: 60 safe owned + 59 catalog versions, 3 silver / 8 bronze, 14 chem.
// The export contains counts, not the user's inventory: this is NOT its replay.
it('reaches a connected market group beyond a dominant unusable group within the original 50000 nodes', () => {
  const { input, entries } = shortageFixture();
  const result = suggestFc27PuzzleJointPurchases(input, entries);
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'suggested' });
  expect(result.nodes).toBeLessThanOrEqual(50000);
  expect(result.plans[0].teamFacts.chemistry).toBeGreaterThanOrEqual(14);
  const ratings = [...result.plans[0].selectedOwned, ...result.plans[0].purchases].map(item => item.rating);
  expect(ratings.filter(value => value < 65)).toHaveLength(8);
  expect(ratings.filter(value => value >= 65 && value < 75)).toHaveLength(3);
}, 30000);

it('shows catalog, cache and quote counters while no search budget is active', () => {
  const catalog = formatFc27PuzzleProgress({ stage: 'procurement', phase: 'catalog-read',
    catalogPages: 1, catalogTotal: 3, catalogCandidates: 20, requests: 1, cacheHits: 0 });
  expect(catalog).toContain('卡池'); expect(catalog).toContain('1 / 3'); expect(catalog).toContain('20');
  const quotes = formatFc27PuzzleProgress({ stage: 'procurement', phase: 'quote-read',
    quoteCompleted: 2, quoteTotal: 5, requests: 3, cacheHits: 2 });
  expect(quotes).toContain('报价'); expect(quotes).toContain('2 / 5'); expect(quotes).toContain('缓存 2');
});

it('lets timers and progress run during procurement with exactly the same result and budget', async () => {
  const { input, entries } = shortageFixture();
  const expected = suggestFc27PuzzleJointPurchases(input, entries, { maxNodes: 12000 });
  const progress = []; let ticks = 0;
  const timer = setInterval(() => { ticks++; }, 1);
  let result;
  try { result = await suggestFc27PuzzleJointPurchasesCooperatively(input, entries,
    { maxNodes: 12000, onProgress: value => progress.push({ ...value, ticks }) }); }
  finally { clearInterval(timer); }
  expect(result).toEqual(expected);
  expect(progress.some(value => value.ticks > 1 && value.nodes > 0 && value.nodes < 12000)).toBe(true);
  expect(progress.at(-1).nodes).toBeLessThanOrEqual(12000);
});

it('does not run four full searches for a repair seed and preserves the native requirements', async () => {
  const { input } = shortageFixture(); const original = structuredClone(input.challenge);
  const progress = [];
  await findFc27PuzzleRepairSeedCooperatively(input, value => progress.push(value));
  expect(progress.filter(value => value.nodes === 50000)).toHaveLength(1);
  expect(input.challenge).toEqual(original);
});

it('keeps sync/async owned results identical and cancels a suspended search when the target changes', async () => {
  const input = puzzleFillFixture();
  expect(await previewFc27PuzzleSquadCooperatively(input)).toEqual(previewFc27PuzzleSquad(input));
  let active = true; let yields = 0;
  await expect(previewFc27PuzzleSquadCooperatively(shortageFixture().input, {
    sliceMs: 0, yieldControl: async () => { if (++yields === 2) active = false; },
    assertCurrent: () => { if (!active) throw new Error('FC27_PUZZLE_FILL_TARGET_CHANGED'); },
  })).rejects.toThrow('FC27_PUZZLE_FILL_TARGET_CHANGED');
  expect(yields).toBe(2);
});
