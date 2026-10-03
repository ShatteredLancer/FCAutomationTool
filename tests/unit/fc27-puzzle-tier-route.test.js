import { expect, it } from 'vitest';
import { puzzleFillFixture } from '../helpers/fc27-puzzle-fill-fixture.js';
import { marketRow } from '../helpers/fc27-market-fixture.js';
import { planFc27PuzzleShortageQueries } from '../../src/fc27/puzzle-procurement.js';
import { mixedQualityFixture } from '../helpers/fc27-puzzle-mixed-quality-fixture.js';
import { previewFc27PuzzleSquad } from '../../src/fc27/puzzle-preview.js';
import { createFc27PuzzleProcurementSession } from '../../src/fc27/puzzle-procurement-session.js';

it('covers eight bronze and three silver around an owned national link instead of querying three silver pages', () => {
  const input = puzzleFillFixture();
  input.challenge.rawRequirements = [marketRow(10, 46, 1), marketRow(9, 4),
    marketRow(17, 2, 3), marketRow(3, 1), marketRow(35, 14)];
  input.challenge.rawRequirements[0].pairs[0].values = [39, 46];
  input.inventory.items = input.inventory.items.map((item, i) => ({ ...item,
    rating: i < 8 ? 60 : 70, nationId: i < 2 ? 46 : i === 2 ? 39 : 100 + i,
    leagueId: i < 2 ? 56 : 100 + i }));
  const result = planFc27PuzzleShortageQueries(input);
  expect(result).toMatchObject({ status: 'ready', complete: false });
  expect(result.queries).toEqual([
    { start: 0, count: 20, level: 'bronze', nation: 46 },
    { start: 0, count: 20, level: 'silver', nation: 46 },
    { start: 0, count: 20, level: 'bronze', league: 56 },
  ]);
});

it('solves the observed mixed-quality shape through the full procurement route and reuses reads on a repeated attempt', async () => {
  const { input, pages } = mixedQualityFixture();
  expect(previewFc27PuzzleSquad(input).reason).toBe('FC27_PUZZLE_SEARCH_LIMIT');
  const records = new Map(); const reads = []; const progress = [];
  const session = createFc27PuzzleProcurementSession({ get: async (key, fallback) => records.get(key) ?? fallback,
    set: async (key, value) => { records.set(key, value); }, createTransport: async () => ({
      readCatalogPage: async query => {
        reads.push(query);
        const page = pages.find(page => JSON.stringify(page.query) === JSON.stringify(query));
        expect(page, JSON.stringify(query)).toBeDefined();
        return { ...page, season: '27', source: 'ea-defid', status: 'observed', observedAt: Date.now() };
      },
      readQuotePage: async query => {
        reads.push(query);
        return { season: '27', platform: input.context.platform, source: 'ea-visible-buy-now', status: 'observed',
          definitionId: query.definitionId, observedAt: Date.now(), eligible: 1, price: 200 };
      },
    }) });
  const result = await session.plan(input, { onProgress: value => progress.push(value) });
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'suggested' });
  const plan = result.plans[0];
  const ratings = [...plan.selectedOwned, ...plan.purchases].map(item => item.rating);
  expect(ratings.filter(rating => rating < 65)).toHaveLength(8);
  expect(ratings.filter(rating => rating >= 65 && rating < 75)).toHaveLength(3);
  expect(plan.teamFacts.chemistry).toBeGreaterThanOrEqual(14);
  expect(plan.selectedOwned.length).toBeGreaterThan(0);
  expect(plan.conceptPlan.status).toBe('prepared');
  expect(progress.some(value => value.phase === 'quote-read' && value.quoteCompleted === value.quoteTotal && value.quoteTotal > 0)).toBe(true);
  const count = reads.length;
  expect((await session.plan(input)).status).toBe('suggested');
  expect(reads).toHaveLength(count);
}, 30000);
